'use strict';

// Rapprochement entre la liste de taches tenue a la main dans la conversation
// WhatsApp a soi-meme et le portefeuille du secretariat.
//
// Le proprietaire renvoie regulierement dans ce fil la meme liste, amputee des
// lignes qu'il a faites. Une ligne presente dans un message et absente du
// suivant est donc une tache terminee, et une ligne presente dans la liste mais
// absente du portefeuille est une tache a creer.
//
// Tout ce fichier est pur : aucun acces reseau, aucun acces disque. Il prend des
// textes de messages et des projets deja charges, et renvoie des constats. Les
// effets (lecture Beeper, suppression, creation) sont decides ailleurs, ce qui
// permet de tester le rapprochement sans Beeper et sans toucher aux donnees.

// Un message WhatsApp arrive en HTML : Beeper rend une liste a puces sous forme
// de <ul><li>. On accepte aussi le texte brut prefixe par une puce, pour un
// message tape autrement (copier-coller, autre client).
const ENTITES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' '
};

function decoderEntites(s) {
  return String(s).replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITES[m] || m);
}

// Nombre minimal de lignes pour qu'un message soit considere comme la liste de
// taches. Deux lignes ne suffisent pas : un message court a deux puces serait
// pris pour une liste, et sa comparaison avec la vraie liste ferait disparaitre
// presque tout le portefeuille d'un coup.
const MINIMUM_LIGNES = 3;

// Extrait les lignes de taches d'un message, ou null si le message n'est pas une
// liste de taches. Null et non un tableau vide : l'appelant doit pouvoir
// distinguer « pas une liste » (un lien, une photo, une note) de « une liste
// devenue vide », qui n'arrive pas ici mais que le type ne doit pas confondre.
function extraireListe(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') return null;

  let lignes = [];
  const elements = texte.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  if (elements) {
    lignes = elements.map((e) => e.replace(/<li[^>]*>/i, '').replace(/<\/li>/i, ''));
  } else if (!/<[a-z]/i.test(texte)) {
    // Texte brut : seules les lignes explicitement prefixees par une puce sont
    // retenues, pour ne pas prendre un paragraphe ordinaire pour une liste.
    lignes = texte.split(/\r?\n/)
      .filter((l) => /^\s*[*\-•·]\s+/.test(l))
      .map((l) => l.replace(/^\s*[*\-•·]\s+/, ''));
  }

  const propres = lignes
    .map((l) => decoderEntites(l.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');

  return propres.length >= MINIMUM_LIGNES ? propres : null;
}

// Forme de comparaison d'une ligne : sans accents, sans casse, sans ponctuation.
// Elle ne sert qu'a rapprocher deux libelles, jamais a afficher quoi que ce soit
// ni a ecrire dans les fichiers : le libelle d'origine est toujours conserve.
function normaliser(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function jetons(s) {
  const n = normaliser(s);
  return n === '' ? [] : n.split(' ');
}

// Coefficient de Dice sur les ensembles de mots : deux fois le nombre de mots
// communs, divise par le total des mots des deux cotes. Insensible a l'ordre des
// mots, et il tolere qu'un cote porte des mots en plus, ce qui est le cas
// courant ici : la ligne WhatsApp ajoute souvent une date ou un numero de
// telephone que le titre de la tache n'a pas.
function similarite(a, b) {
  const ja = new Set(jetons(a));
  const jb = new Set(jetons(b));
  if (ja.size === 0 || jb.size === 0) return 0;
  let communs = 0;
  ja.forEach((m) => { if (jb.has(m)) communs++; });
  return (2 * communs) / (ja.size + jb.size);
}

// Seuil de rapprochement. Choisi pour accepter « TOPI FAM - faire page presse -
// 21 sept » face a « TOPI FAM - faire page presse » (0,83) tout en refusant
// « vendre BTC » face a « vendre actions » (0,50), qui ne partagent qu'un verbe.
const SEUIL = 0.72;
// Ecart minimal entre le meilleur et le deuxieme candidat. Sans cette marge,
// deux taches jumelles (« TOPI FAM - faire page presse » et « ... page booklet »)
// se disputeraient la meme ligne et le choix serait arbitraire : on prefere ne
// rien decider et laisser la ligne de cote.
const MARGE = 0.05;

// Cherche, parmi les taches ouvertes du portefeuille, celle que designe une
// ligne de la liste. Renvoie {projet, tache, score} ou null.
//
// `taches` est une liste plate de {projet, tache} deja filtree sur les taches
// ouvertes par l'appelant : ce fichier ne connait pas la regle « tache ouverte »,
// qui appartient a store.js.
function apparier(ligne, taches) {
  let meilleur = null;
  let second = 0;
  taches.forEach((candidat) => {
    const score = similarite(ligne, candidat.tache.titre);
    if (meilleur === null || score > meilleur.score) {
      second = meilleur === null ? 0 : meilleur.score;
      meilleur = {projet: candidat.projet, tache: candidat.tache, score};
    } else if (score > second) {
      second = score;
    }
  });
  if (meilleur === null || meilleur.score < SEUIL) return null;
  if (meilleur.score - second < MARGE) return null;
  return meilleur;
}

// Lignes presentes dans la liste precedente et absentes de la courante : le
// proprietaire les a effacees de sa note, donc il les a faites.
//
// La comparaison passe par la forme normalisee, pour qu'une correction de casse
// ou d'accent d'un message a l'autre ne fasse pas croire a une disparition.
function lignesRetirees(precedente, courante) {
  const presentes = new Set((courante || []).map(normaliser));
  return (precedente || []).filter((l) => !presentes.has(normaliser(l)));
}

// Lignes de la liste courante qui ne correspondent a aucune tache ouverte du
// portefeuille. Ce sont les candidates a la creation.
function lignesInconnues(courante, taches) {
  return (courante || []).filter((l) => apparier(l, taches) === null);
}

module.exports = {
  extraireListe, normaliser, similarite, apparier,
  lignesRetirees, lignesInconnues, MINIMUM_LIGNES, SEUIL
};
