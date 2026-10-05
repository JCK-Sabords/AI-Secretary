'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delegation = require('../server/delegation');

// Part de chaque tache delegable a une IA, estimee par Claude et conservee tache
// par tache.
//
// Tout ce fichier tourne autour d'une seule regle, qui est la raison d'etre du
// module : aucun appel a Claude quand rien n'a change, et un seul lot d'appels
// pour les seules taches a recalculer. Les tests comptent donc les appels, et pas
// seulement les resultats : un module qui rendrait les bons pourcentages en
// appelant Claude a chaque chargement de page serait un echec silencieux.

function atelier() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'deleg-'));
  fs.mkdirSync(path.join(base, 'projects'), {recursive: true});
  fs.mkdirSync(path.join(base, 'history'), {recursive: true});
  fs.writeFileSync(path.join(base, 'config.json'),
    JSON.stringify({proprietaire: 'Alex'}));
  return base;
}

function ecrireProjet(base, id, prefixe, taches) {
  const lignes = ['---', 'id: ' + id, 'prefixe: ' + prefixe, 'titre: Projet ' + id,
    'domaine: side', 'statut: actif', "echeance: ''", "prochaine_action: ''",
    "jira: ''", 'dernier_n: ' + taches.length, 'taches:'];
  taches.forEach((t) => {
    lignes.push('  - n: ' + t.n, '    titre: ' + t.titre,
      '    responsable: ' + (t.responsable || 'moi'), "    echeance: ''",
      '    nature_echeance: souhaitee', '    prio: ' + (t.prio || 'P3'),
      '    effort: ' + (t.effort || 'M'), "    bloque_par: ''",
      "    derniere_relance: ''", "    prochaine_relance: ''",
      '    maj_le: 2026-09-01', "    note_blocage: ''");
  });
  lignes.push('---', '## Contexte', 'rien');
  fs.writeFileSync(path.join(base, 'projects', id + '.md'), lignes.join('\n'));
}

// Faux lanceur : repond un pourcentage fixe pour chaque tache du prompt, et
// compte les appels ainsi que les references demandees.
//
// Les references sont lues dans le bloc de taches seul, pas dans le prompt
// entier : les consignes contiennent un exemple de reponse, « XX1 », qu'une
// lecture naive ramasserait comme une tache a estimer.
function lanceur(journal, pourcentage) {
  return async (prompt) => {
    const bloc = /Taches :\n([\s\S]*?)\n\nPour chaque/.exec(prompt);
    assert.ok(bloc, 'le prompt doit porter un bloc de taches lisible');
    const refs = JSON.parse(bloc[1]).map((t) => t.ref);
    journal.appels.push(refs);
    return JSON.stringify({estimations: refs.map((r) =>
      ({ref: r, pourcentage: pourcentage === undefined ? 42 : pourcentage}))});
  };
}

function ctx(base) {
  return {projectsDir: path.join(base, 'projects'), dataDir: base};
}

/* ---------- l'empreinte decide de ce qui est recalcule ---------- */

// Volontairement etroite : l'echeance et la priorite disent quand faire la tache,
// jamais si une IA peut la faire a ma place. Les inclure ferait recalculer a
// chaque report de date, c'est-a-dire tres souvent, pour une reponse identique.
test('l empreinte ignore ce qui ne change pas la delegabilite', () => {
  const base = {titre: 'ecrire un script', effort: 'M', responsable: 'moi', projet: 'x'};
  const avec = (over) => delegation.empreinteTache(Object.assign({}, base, over));
  assert.strictEqual(avec({}), avec({echeance: '2026-12-01'}));
  assert.strictEqual(avec({}), avec({prio: 'P1'}));
});

test('l empreinte change des que la delegabilite peut changer', () => {
  const base = {titre: 'ecrire un script', effort: 'M', responsable: 'moi', projet: 'x'};
  const avec = (over) => delegation.empreinteTache(Object.assign({}, base, over));
  const ref = avec({});
  assert.notStrictEqual(ref, avec({titre: 'appeler le notaire'}));
  assert.notStrictEqual(ref, avec({effort: 'L'}));
  assert.notStrictEqual(ref, avec({responsable: 'christian'}));
  assert.notStrictEqual(ref, avec({projet: 'y'}));
});

/* ---------- le nombre d'appels, qui est le sujet ---------- */

test('un premier calcul estime toutes les taches, en un passage', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}, {n: 2, titre: 'deux'}]);
  const journal = {appels: []};
  const r = await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.deepStrictEqual(Object.keys(r.parRef).sort(), ['AL1', 'AL2']);
  assert.strictEqual(r.calcule, 2);
  assert.strictEqual(journal.appels.length, 1, 'un seul appel groupe, jamais un par tache');
});

// Le cas de loin le plus frequent : le tableau de bord est recharge et rien n'a
// bouge. C'est la raison d'etre du cache.
test('un second calcul sans changement ne lance aucun appel', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}, {n: 2, titre: 'deux'}]);
  const journal = {appels: []};
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  const r = await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.strictEqual(journal.appels.length, 1, 'aucun appel ne doit s ajouter');
  assert.strictEqual(r.calcule, 0);
  assert.deepStrictEqual(Object.keys(r.parRef).sort(), ['AL1', 'AL2']);
});

// Le point demande : une modification ne doit faire repayer que la tache modifiee.
test('modifier une tache ne fait recalculer que celle-la', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}, {n: 2, titre: 'deux'},
    {n: 3, titre: 'trois'}]);
  const journal = {appels: []};
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'},
    {n: 2, titre: 'deux, reformule'}, {n: 3, titre: 'trois'}]);
  const r = await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.strictEqual(journal.appels.length, 2);
  assert.deepStrictEqual(journal.appels[1], ['AL2'],
    'seule la tache modifiee doit repartir au modele');
  assert.strictEqual(r.calcule, 1);
  // Les deux autres gardent leur estimation : elles ne sont pas perdues au passage.
  assert.deepStrictEqual(Object.keys(r.parRef).sort(), ['AL1', 'AL2', 'AL3']);
});

// Reporter une echeance est l'operation la plus courante du tableau de bord. Elle
// ne doit rien couter : c'est tout l'interet d'une empreinte etroite.
test('reporter une echeance ne lance aucun appel', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}]);
  const journal = {appels: []};
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  const f = path.join(base, 'projects', 'alpha.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("echeance: ''\n    nature",
    'echeance: 2026-12-25\n    nature'));
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.strictEqual(journal.appels.length, 1, 'un report de date ne doit rien faire recalculer');
});

test('une tache ajoutee est seule a partir au modele', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}]);
  const journal = {appels: []};
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}, {n: 2, titre: 'deux'}]);
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.deepStrictEqual(journal.appels[1], ['AL2']);
});

// Sans cela le fichier grossirait indefiniment, une tache supprimee y restant
// pour toujours.
test('une tache supprimee sort du cache', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}, {n: 2, titre: 'deux'}]);
  const journal = {appels: []};
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}]);
  const r = await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.deepStrictEqual(Object.keys(r.parRef), ['AL1']);
  assert.strictEqual(journal.appels.length, 1, 'une suppression ne doit rien faire recalculer');
});

/* ---------- le decoupage en lots ---------- */

// Constate le jour de la mise en place : un lot de 66 taches ne revenait qu'avec
// 46 estimations, le modele en omettant une vingtaine sans rien signaler. Le
// resultat finissait complet, mais il fallait deux chargements de page.
test('un gros portefeuille est couvert en un passage, par lots', async () => {
  const base = atelier();
  const taches = [];
  for (let i = 1; i <= 60; i++) taches.push({n: i, titre: 'tache ' + i});
  ecrireProjet(base, 'alpha', 'AL', taches);
  const journal = {appels: []};
  const r = await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.strictEqual(Object.keys(r.parRef).length, 60);
  assert.ok(journal.appels.length > 1, 'le lot doit etre decoupe');
  journal.appels.forEach((lot) => {
    assert.ok(lot.length <= 25, 'aucun lot ne doit depasser 25 taches, ' + lot.length + ' vu');
  });
  // Et le passage suivant ne coute plus rien.
  const avant = journal.appels.length;
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  assert.strictEqual(journal.appels.length, avant);
});

/* ---------- robustesse ---------- */

// La delegation elle-meme ne depend pas de l'estimation : le bouton reste
// utilisable. Une panne ne doit donc jamais vider ce qui est deja connu.
test('un echec de Claude conserve les estimations deja obtenues', async () => {
  const base = atelier();
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}]);
  const journal = {appels: []};
  await delegation.calculer(ctx(base), {lancerClaude: lanceur(journal)});
  ecrireProjet(base, 'alpha', 'AL', [{n: 1, titre: 'un'}, {n: 2, titre: 'deux'}]);
  const r = await delegation.calculer(ctx(base), {
    lancerClaude: async () => { throw new Error('claude injoignable'); }
  });
  assert.strictEqual(r.erreur, 'estimation indisponible');
  assert.strictEqual(r.parRef.AL1, 42, 'l estimation deja connue doit survivre');
});

// Le modele peut renvoyer une reference qui n'existe pas, ou une valeur aberrante.
// La validation est faite ici plutot que plaidee dans le prompt.
test('une reference inconnue est ecartee et un pourcentage aberrant est borne', () => {
  const taches = [{ref: 'AL1'}, {ref: 'AL2'}];
  const vu = delegation.interpreter({estimations: [
    {ref: 'AL1', pourcentage: 150},
    {ref: 'AL2', pourcentage: -20},
    {ref: 'ZZ9', pourcentage: 50},
    {ref: 'AL1', pourcentage: 'abc'}
  ]}, taches);
  assert.strictEqual(vu.AL1, 100);
  assert.strictEqual(vu.AL2, 0);
  assert.ok(!('ZZ9' in vu), 'une tache inexistante ne doit jamais apparaitre');
});

// dictee.extraireJson est specialise pour la dictee, dont la reponse a la forme
// {ops, message}, et normalise tout le reste a cette forme : branche ici, il
// vidait silencieusement les estimations. Defaut constate en conditions reelles.
test('l extraction du JSON ne normalise pas la reponse', () => {
  const vu = delegation.extraireJson('blabla {"estimations":[{"ref":"AL1","pourcentage":80}]} fin');
  assert.deepStrictEqual(vu, {estimations: [{ref: 'AL1', pourcentage: 80}]});
});

// Premier lancement, ou fichier abime a la main : on repart d'un cache vide
// plutot que d'echouer. Le cout est un calcul de plus, rien de plus.
test('un cache absent ou illisible ne fait pas echouer le calcul', () => {
  const base = atelier();
  assert.deepStrictEqual(delegation.lireCache(base), {taches: {}});
  fs.writeFileSync(path.join(base, 'history', delegation.FICHIER), 'pas du json');
  assert.deepStrictEqual(delegation.lireCache(base), {taches: {}});
});
