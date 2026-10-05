'use strict';

// Part de chaque tache delegable a une IA, estimee par Claude et conservee tache
// par tache.
//
// Le panneau « Ma semaine » portait deja cette estimation, mais seulement pour
// les cinq taches qu'il classe, et son cache est indexe sur une empreinte du
// portefeuille entier : changer le titre d'une seule tache invalidait tout et
// relancait un calcul complet. Pour afficher le pourcentage sur chaque ligne de
// chaque projet, il faut l'inverse, un stockage par tache ou une modification ne
// fait recalculer que la tache modifiee.
//
// Regle de cout, qui gouverne tout ce fichier : aucun appel a Claude quand rien
// n'a change, et un seul appel, groupe, pour toutes les taches a (re)calculer.
// Jamais un appel par tache.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = require('./repo.js');
const store = require('./store.js');
const dictee = require('./dictee.js');

const FICHIER = 'delegation.json';

function chemin(dataDir) {
  return path.join(dataDir, 'history', FICHIER);
}

// Ce qui, en changeant, rend l'estimation caduque. Volontairement etroit :
// l'echeance et la priorite disent quand faire la tache, jamais si une IA peut
// la faire a ma place. Les inclure ferait recalculer a chaque report de date,
// c'est-a-dire tres souvent, pour une reponse identique.
//
// Le titre est le coeur de l'estimation, l'effort en donne l'ampleur, le
// responsable dit si le travail est seulement a moi, et le projet fournit le
// contexte qui separe « rediger une note » de « rediger une note de cadrage
// technique ».
function empreinteTache(t) {
  const brut = JSON.stringify([t.titre, t.effort, t.responsable, t.projet]);
  return crypto.createHash('sha256').update(brut).digest('hex').slice(0, 16);
}

// Liste a plat des taches ouvertes, dans la forme qui part au modele.
function tachesPourPrompt(projects) {
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      out.push({
        ref: store.refOf(p, t),
        titre: t.titre,
        projet: p.id,
        projetTitre: p.titre,
        domaine: p.domaine,
        effort: t.effort,
        responsable: t.responsable
      });
    });
  });
  return out;
}

function lireCache(dataDir) {
  try {
    const o = JSON.parse(fs.readFileSync(chemin(dataDir), 'utf8'));
    if (!o || typeof o !== 'object' || !o.taches || typeof o.taches !== 'object') {
      return {taches: {}};
    }
    return {taches: o.taches};
  } catch (e) {
    // Fichier absent au premier lancement, ou illisible : on repart d'un cache
    // vide plutot que d'echouer. Le cout est un calcul de plus, rien de plus.
    return {taches: {}};
  }
}

function ecrireCache(dataDir, valeur) {
  try {
    const dossier = path.dirname(chemin(dataDir));
    fs.mkdirSync(dossier, {recursive: true});
    fs.writeFileSync(chemin(dataDir), JSON.stringify(valeur, null, 2));
  } catch (e) {
    // Un cache non ecrit coute un appel de plus la prochaine fois, rien de plus :
    // jamais une erreur remontee a l'utilisateur.
  }
}

// Taches dont l'estimation manque ou ne vaut plus. C'est la seule chose qui
// partira au modele.
function aRecalculer(taches, cache) {
  return taches.filter((t) => {
    const e = cache.taches[t.ref];
    return !e || e.empreinte !== empreinteTache(t);
  });
}

function construirePrompt(taches, proprietaire) {
  const liste = JSON.stringify(taches, null, 2);
  return [
    "Tu estimes, pour le secretariat particulier de " + proprietaire + ', quelle part de',
    'chaque tache ci-dessous peut etre confiee a une IA de type Claude Code, qui sait lire et',
    'ecrire des fichiers, du code, des documents et des messages, mais ne peut ni telephoner,',
    'ni se deplacer, ni signer, ni rencontrer quelqu un, ni decider a la place du proprietaire.',
    '',
    'Taches :',
    liste,
    '',
    'Pour chaque tache, donne un entier de 0 a 100 :',
    '- 0 a 20 : rien ou presque ne se delegue (deplacement, rendez-vous, appel, decision',
    '  personnelle, acte physique).',
    '- 30 a 60 : une IA prepare, redige un brouillon ou rassemble la matiere, mais le',
    '  proprietaire doit finir, valider ou agir lui-meme.',
    '- 70 a 100 : une IA peut faire le gros du travail (ecrire du code, un document, une',
    '  analyse, un message a relire).',
    '',
    'Reponds UNIQUEMENT par un objet JSON, sans texte autour, de la forme :',
    '{"estimations": [{"ref": "XX1", "pourcentage": 80}, ...]}',
    '',
    'Une entree par tache, avec la reference exacte donnee ci-dessus. Aucune autre cle.'
  ].join('\n');
}

// Extrait le premier objet JSON de la sortie. dictee.extraireJson ne convient
// pas ici : il est specialise pour la dictee, dont la reponse a la forme
// {ops, message}, et normalise tout le reste a cette forme, ce qui vidait
// silencieusement les estimations.
function extraireJson(sortie) {
  const m = String(sortie).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('aucun JSON dans la reponse');
  return JSON.parse(m[0]);
}

// Relit la reponse du modele. Toute reference inconnue est ecartee et tout
// pourcentage hors bornes est ramene dans l'intervalle : la validation est faite
// ici plutot que plaidee dans le prompt.
function interpreter(json, taches) {
  const connues = new Set(taches.map((t) => t.ref));
  const out = {};
  const liste = (json && Array.isArray(json.estimations)) ? json.estimations : [];
  liste.forEach((e) => {
    if (!e || !connues.has(e.ref)) return;
    const n = Number(e.pourcentage);
    if (!Number.isFinite(n)) return;
    out[e.ref] = Math.max(0, Math.min(100, Math.round(n)));
  });
  return out;
}

// Calculs en cours, par empreinte du lot a calculer : deux ouvertures du tableau
// de bord pendant le meme calcul partagent la meme promesse au lieu de lancer
// deux fois le meme appel.
const enCours = new Map();

async function calculer(ctx, options) {
  const opts = options || {};
  const {projects} = repo.loadAllSafe(ctx.projectsDir);
  const taches = tachesPourPrompt(projects);
  const cache = lireCache(ctx.dataDir);

  // Les references disparues sont retirees : sans cela le fichier grossirait
  // indefiniment, et une tache supprimee puis recreee sous le meme numero ne
  // peut pas arriver, les numeros n'etant jamais reattribues.
  const vivantes = new Set(taches.map((t) => t.ref));
  Object.keys(cache.taches).forEach((ref) => {
    if (!vivantes.has(ref)) delete cache.taches[ref];
  });

  const manquantes = opts.forcer ? taches : aRecalculer(taches, cache);

  // Le cas le plus frequent de loin : rien n'a bouge depuis le dernier calcul.
  // Aucun appel a Claude n'est lance, et le fichier n'est meme pas reecrit.
  if (manquantes.length === 0) {
    return {parRef: pourcentages(cache), aJour: true, calcule: 0};
  }

  const cle = ctx.dataDir + '|' + manquantes.map((t) => t.ref).sort().join(',');
  if (enCours.has(cle)) return enCours.get(cle);
  const promesse = calculerVraiment(ctx, opts, taches, manquantes, cache);
  enCours.set(cle, promesse);
  try { return await promesse; } finally { enCours.delete(cle); }
}

// Nombre de taches par appel. Constate le jour de la mise en place : un lot de 66
// taches ne revenait qu'avec 46 estimations, le modele en omettant une vingtaine
// sans rien signaler. Les manquantes repartaient au chargement suivant, donc le
// resultat finissait par etre complet, mais il fallait deux passages. Par lots de
// 25, chaque reponse reste assez courte pour etre entiere, et un portefeuille
// entierement neuf est couvert en une seule fois.
//
// Ce decoupage ne change rien au regime courant, celui qui compte : des qu'une
// seule tache est modifiee, un lot d'une tache part, et quand rien ne change, rien
// ne part du tout.
const LOT = 25;

function lots(taches) {
  const out = [];
  for (let i = 0; i < taches.length; i += LOT) out.push(taches.slice(i, i + LOT));
  return out;
}

async function calculerVraiment(ctx, opts, taches, manquantes, cache) {
  const proprietaire = opts.proprietaire ||
    require('./config.js').lireConfig(ctx.dataDir).proprietaire;
  const lanceur = opts.lancerClaude || (ctx && ctx.lancerClaude) || dictee.lancerClaudeReel;

  const estimations = {};
  let unEchec = false;
  for (const lot of lots(manquantes)) {
    try {
      const sortie = await lanceur(construirePrompt(lot, proprietaire));
      Object.assign(estimations, interpreter(extraireJson(sortie), lot));
    } catch (e) {
      // Claude injoignable ou reponse illisible sur ce lot. Les autres lots sont
      // tout de meme tentes, et ce qui a ete obtenu est conserve : un echec
      // partiel ne doit pas faire perdre le travail des lots qui ont abouti.
      unEchec = true;
    }
  }

  if (unEchec && Object.keys(estimations).length === 0) {
    // Rien n'a abouti : on rend ce qu'on avait deja plutot qu'une erreur. Les
    // lignes sans estimation s'affichent sans pourcentage, et le bouton de
    // delegation reste utilisable, il n'en depend pas.
    return {parRef: pourcentages(cache), aJour: false,
      erreur: 'estimation indisponible', calcule: 0};
  }

  const quand = new Date().toISOString();
  manquantes.forEach((t) => {
    if (!(t.ref in estimations)) return;
    cache.taches[t.ref] = {
      empreinte: empreinteTache(t),
      pourcentage: estimations[t.ref],
      calculeLe: quand
    };
  });
  ecrireCache(ctx.dataDir, cache);
  return {parRef: pourcentages(cache), aJour: true,
    calcule: Object.keys(estimations).length};
}

function pourcentages(cache) {
  const out = {};
  Object.keys(cache.taches).forEach((ref) => {
    out[ref] = cache.taches[ref].pourcentage;
  });
  return out;
}

module.exports = {empreinteTache, tachesPourPrompt, aRecalculer, construirePrompt,
  interpreter, extraireJson, calculer, lireCache, ecrireCache, FICHIER};
