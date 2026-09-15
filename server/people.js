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

function texteRelance(personne, projet, tache, attente) {
  const prenom = personne.nom.split(' ')[0];
  const quand = tache.echeance ? " d'ici le " + tache.echeance : ' cette semaine';
  return 'Salut ' + prenom + ", j'espere que tout roule.\n\n" +
    'Je reviens vers toi sur « ' + tache.titre + ' » (' + projet.titre + '), cale il y a ' +
    attente + ' jours.\nTu penses pouvoir me donner un point' + quand + ' ? ' +
    "Si c'est bloque quelque part, dis-le moi et on ajuste.\n\nMerci !";
}

// Fonction pure : ne fait jamais appel a Beeper. Elle se contente de lire le
// repertoire deja resolu (gens) et les projets deja charges (projects) pour
// produire la file des relances a preparer. Aucun effet de bord, aucun reseau.
function relances(projects, gens, today) {
  const par = {};
  gens.forEach((g) => { par[g.id] = g; });
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      if (t.responsable === 'moi') return;
      if (!t.prochaine_relance) return;
      if (store.daysBetween(t.prochaine_relance, today) > 0) return;
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
        texte: texteRelance(personne, p, t, attente)
      });
    });
  });
  return out;
}

// Fonction pure, jumelle exacte de relances : parcourt les memes taches ouvertes,
// dues, deleguees, mais ne retient que celles que relances ecarte faute de contact
// exploitable, avec la raison precise. Les deux fonctions doivent rester
// exactement complementaires (voir test/people.test.js) : la condition ici est la
// negation exacte de celle de relances, testee sur les memes champs et dans le
// meme ordre (personne absente ou fiche sans nom valide d'abord, chatId vide
// ensuite), pour qu'aucune tache ne tombe dans les deux listes ni dans aucune.
function relancesBloquees(projects, gens, today) {
  const par = {};
  gens.forEach((g) => { par[g.id] = g; });
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      if (t.responsable === 'moi') return;
      if (!t.prochaine_relance) return;
      if (store.daysBetween(t.prochaine_relance, today) > 0) return;
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

module.exports = {loadPeople, loadPeopleSafe, savePeople, relances, relancesBloquees};
