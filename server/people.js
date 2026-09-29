'use strict';
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const store = require('./store');

function fichier(dataDir) {
  return path.join(dataDir, 'people.md');
}

// Sur le modele exact de repo.loadAllSafe : un repertoire de personnes casse ne
// doit jamais faire tomber le reste de l etat. Chaque anomalie (YAML illisible,
// contenu qui n est pas une liste, entree incomplete, identifiant en double) est
// rangee dans errors avec un message en francais ; les entrees saines restantes
// sont renvoyees dans people. En cas de doublon d id, la premiere occurrence est
// conservee (coherent avec POST /api/personne, qui remplace la premiere trouvee).
function loadPeopleSafe(dataDir) {
  const f = fichier(dataDir);
  if (!fs.existsSync(f)) return {people: [], errors: []};

  const brut = fs.readFileSync(f, 'utf8');
  let data;
  try {
    data = yaml.load(brut);
  } catch (e) {
    return {people: [], errors: [{fichier: 'people.md',
      message: "le contenu de people.md n'est pas un YAML valide : " + e.message}]};
  }

  // Un fichier absent ou vide represente legitimement un repertoire sans
  // personne : on ne le distingue pas du cas "fichier absent" ci-dessus.
  if (data == null) return {people: [], errors: []};

  if (!Array.isArray(data)) {
    return {people: [], errors: [{fichier: 'people.md',
      message: "le contenu de people.md n'est pas une liste de personnes"}]};
  }

  const people = [];
  const errors = [];
  const vus = new Set();
  data.forEach((entree, i) => {
    if (!entree || typeof entree !== 'object' || Array.isArray(entree)) {
      errors.push({fichier: 'people.md',
        message: "l'entree " + (i + 1) + " de people.md n'est pas un objet"});
      return;
    }
    if (typeof entree.id !== 'string' || entree.id.trim() === '') {
      errors.push({fichier: 'people.md',
        message: "l'entree " + (i + 1) + " de people.md n'a pas d'identifiant (id) valide"});
      return;
    }
    if (typeof entree.nom !== 'string' || entree.nom.trim() === '') {
      errors.push({fichier: 'people.md', message:
        "l'entree " + (i + 1) + " de people.md (id " + entree.id + ") n'a pas de nom valide"});
      return;
    }
    if (vus.has(entree.id)) {
      errors.push({fichier: 'people.md', message:
        'identifiant en double dans people.md : ' + entree.id +
        ' (la premiere occurrence est conservee)'});
      return;
    }
    vus.add(entree.id);
    people.push(entree);
  });
  return {people, errors};
}

function loadPeople(dataDir) {
  return loadPeopleSafe(dataDir).people;
}

function savePeople(dataDir, gens) {
  fs.mkdirSync(dataDir, {recursive: true});
  fs.writeFileSync(fichier(dataDir), yaml.dump(gens, {lineWidth: -1}), 'utf8');
}

// Titres de civilite : « M. BAREC agent Immo » donnait « Salut M. ». Le premier
// mot n'est un prenom que s'il n'est pas un titre.
const TITRES = ['m', 'mr', 'mme', 'mlle', 'dr', 'me', 'pr', 'maitre'];

// Nom d'appel : le premier mot du nom, en sautant un eventuel titre de
// civilite. Une fiche qui ne contient qu'un titre garde ce mot plutot que de
// produire une salutation vide.
function nomAppel(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '';
  const sansPoint = (m) => m.toLowerCase().replace(/\.$/, '');
  let i = 0;
  while (i < mots.length - 1 && TITRES.indexOf(sansPoint(mots[i])) !== -1) i++;
  return mots[i];
}

// Date en francais : « 5 oct. » plutot que « 2026-10-05 ». Un brouillon part au
// nom du proprietaire, une date au format machine dedans se remarque.
const MOIS = ['janv.', 'fevr.', 'mars', 'avril', 'mai', 'juin',
  'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];
function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return String(Number(m[3])) + ' ' + MOIS[Number(m[2]) - 1];
}

function texteRelance(personne, projet, tache, attente) {
  const quand = tache.echeance ? " d'ici le " + dateFr(tache.echeance) : ' cette semaine';
  // « cale il y a 0 jours » n'apprend rien et sonne faux sur une tache creee du
  // jour : l'anciennete n'est mentionnee que lorsqu'elle veut dire quelque chose.
  const depuis = attente >= 2 ? ', cale depuis ' + attente + ' jours' : '';
  return 'Salut ' + nomAppel(personne.nom) + ", j'espere que tout roule.\n\n" +
    'Je reviens vers toi sur « ' + tache.titre + ' » (' + projet.titre + ')' + depuis +
    '.\nTu penses pouvoir me donner un point' + quand + ' ? ' +
    "Si c'est bloque quelque part, dis-le moi et on ajuste.\n\nMerci !";
}

// Fonction pure : ne fait jamais appel a Beeper. Elle se contente de lire le
// repertoire deja resolu (gens) et les projets deja charges (projects) pour
// produire la file des relances a preparer. Aucun effet de bord, aucun reseau.
function relances(projects, gens, today, avenir) {
  const par = {};
  gens.forEach((g) => { par[g.id] = g; });
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      if (t.responsable === 'moi') return;
      // Une tache confiee a quelqu'un d'autre figure toujours au panneau, meme
      // sans date de relance. Sans cette regle, deleguer une tache et ne rien
      // programmer la faisait disparaitre de la vue : elle n'etait ni dans « Ma
      // semaine », qui ne montre que ce qu'on fait soi-meme, ni dans les
      // relances. Absence de date vaut donc « a relancer des maintenant ».
      const jours = t.prochaine_relance
        ? store.daysBetween(t.prochaine_relance, today)
        : 0;
      // `avenir` demande l'autre moitie : les relances correctement preparees
      // mais pas encore dues. Elles ne sont pas actionnables, elles servent a
      // distinguer « programmee » de « cassee ». Sans elles, une tache deleguee
      // dont tout est en ordre n'apparait nulle part jusqu'au jour dit, et rien
      // ne permet de savoir si elle a ete oubliee.
      if (avenir ? jours <= 0 : jours > 0) return;
      const personne = par[t.responsable];
      // Un contact n'est pas une conversation (voir docs/beeper-observe.md) :
      // sans chatId deja resolu, aucune relance ne doit etre proposee pour lui.
      if (!personne || !personne.chatId) return;
      // relances est publique : elle doit rester robuste par elle-meme, sans
      // dependre de la validation de loadPeopleSafe. Une fiche sans nom valide
      // ferait lever texteRelance (personne.nom.split), on l'ignore donc ici.
      if (typeof personne.nom !== 'string' || personne.nom.trim() === '') return;
      const attente = t.maj_le ? -store.daysBetween(t.maj_le, today) : 0;
      out.push({
        ref: store.refOf(p, t), projetId: p.id, projetTitre: p.titre,
        tacheTitre: t.titre, echeance: t.echeance, personne, attente,
        prochaine_relance: t.prochaine_relance,
        dansJours: jours,
        texte: texteRelance(personne, p, t, attente)
      });
    });
  });
  return out;
}

// Fonction pure, jumelle de relances et relancesAVenir : parcourt les memes
// taches ouvertes et deleguees, mais ne retient que celles que ces deux
// fonctions ecartent faute de contact exploitable, avec la raison precise. Sur
// une tache dont la relance est due, les trois listes restent exactement
// complementaires (voir test/people.test.js) : la condition ici est la negation
// exacte de la leur, testee sur les memes champs et dans le meme ordre
// (personne absente ou fiche sans nom valide d'abord, chatId vide ensuite),
// pour qu'aucune tache ne tombe dans deux listes ni dans aucune.
//
// Seule asymetrie assumee : un contact non resolu est signale meme quand la
// relance n'est pas encore due, parce que c'est une action a mener tout de
// suite et que la decouvrir le jour dit serait trop tard.
function relancesBloquees(projects, gens, today) {
  const par = {};
  gens.forEach((g) => { par[g.id] = g; });
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      if (t.responsable === 'moi') return;
      // Ni date requise ni borne de date ici : un contact non
      // resolu doit se voir des qu'il est designe, pas le jour de l'echeance.
      // Attendre reviendrait a decouvrir le probleme au moment precis ou on
      // comptait envoyer, et c'est exactement le silence qui a ete signale.
      const personne = par[t.responsable];
      const nomValide = !!personne && typeof personne.nom === 'string' && personne.nom.trim() !== '';
      const base = {ref: store.refOf(p, t), projetId: p.id, projetTitre: p.titre,
        tacheTitre: t.titre, echeance: t.echeance, responsable: t.responsable};
      if (!nomValide) {
        out.push(Object.assign({}, base, {raison: 'contact_inconnu'}));
        return;
      }
      if (!personne.chatId) {
        out.push(Object.assign({}, base, {raison: 'conversation_non_resolue'}));
      }
    });
  });
  return out;
}

// Relances correctement preparees mais pas encore dues.
function relancesAVenir(projects, gens, today) {
  return relances(projects, gens, today, true);
}

module.exports = {loadPeople, loadPeopleSafe, savePeople, nomAppel, dateFr,
  relances, relancesAVenir,
  relancesBloquees};
