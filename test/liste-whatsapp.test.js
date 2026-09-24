'use strict';
const test = require('node:test');
const assert = require('node:assert');
const liste = require('../server/liste-whatsapp.js');

// Message reel tel que Beeper le renvoie : une liste a puces WhatsApp arrive en
// HTML, avec les entites encodees (&gt; pour une fleche tapee au clavier).
const MESSAGE_HTML =
  '<ul><li>Passer PSPO 2</li><li>Refaire site TOPI</li>' +
  '<li>rdv banque de sperme --&gt; Cochin, rappeler 0158413726</li>' +
  '<li>finir secrétaire IA</li></ul>';

test('extraireListe lit une liste HTML et decode les entites', () => {
  const lignes = liste.extraireListe(MESSAGE_HTML);
  assert.deepStrictEqual(lignes, [
    'Passer PSPO 2',
    'Refaire site TOPI',
    'rdv banque de sperme --> Cochin, rappeler 0158413726',
    'finir secrétaire IA'
  ]);
});

test('extraireListe lit une liste en texte brut a puces', () => {
  const lignes = liste.extraireListe('* Passer PSPO 2\n* Refaire site TOPI\n- Vendre or');
  assert.deepStrictEqual(lignes, ['Passer PSPO 2', 'Refaire site TOPI', 'Vendre or']);
});

// Un lien, une note d'une ligne ou un paragraphe ordinaire ne sont pas des
// listes de taches : les prendre pour telles ferait disparaitre le portefeuille.
test('extraireListe renvoie null sur ce qui n est pas une liste', () => {
  assert.strictEqual(liste.extraireListe('https://exemple.test/page'), null);
  assert.strictEqual(liste.extraireListe('Coherence cardiaque avant repas'), null);
  assert.strictEqual(liste.extraireListe(''), null);
  assert.strictEqual(liste.extraireListe(null), null);
  assert.strictEqual(liste.extraireListe('Une phrase.\nPuis une autre phrase.'), null);
});

test('extraireListe refuse une liste trop courte', () => {
  assert.strictEqual(liste.extraireListe('<ul><li>un</li><li>deux</li></ul>'), null);
  assert.deepStrictEqual(
    liste.extraireListe('<ul><li>un</li><li>deux</li><li>trois</li></ul>'),
    ['un', 'deux', 'trois']);
});

test('normaliser efface accents, casse et ponctuation', () => {
  assert.strictEqual(liste.normaliser('Finir secrétaire IA'), 'finir secretaire ia');
  assert.strictEqual(liste.normaliser('TOPI FAM - faire page presse'), 'topi fam faire page presse');
});

// Cas reel : d'un message a l'autre, trois lignes ont disparu. Ce sont les
// taches faites.
test('lignesRetirees repere ce qui a disparu d un message au suivant', () => {
  const avant = ['Passer PSPO 2', 'Générer prez et pricing TOPI',
    'TOPI FAM - faire page presse - 21 sept', 'vendre BTC'];
  const apres = ['Passer PSPO 2', 'vendre BTC'];
  assert.deepStrictEqual(liste.lignesRetirees(avant, apres),
    ['Générer prez et pricing TOPI', 'TOPI FAM - faire page presse - 21 sept']);
});

test('lignesRetirees ignore une simple correction de casse ou d accent', () => {
  assert.deepStrictEqual(
    liste.lignesRetirees(['finir secretaire IA'], ['Finir secrétaire IA']), []);
});

function taches(paires) {
  return paires.map(([prefixe, n, titre]) => ({
    projet: {id: 'p' + prefixe, prefixe, titre: 'Projet ' + prefixe},
    tache: {n, titre}
  }));
}

const PORTEFEUILLE = taches([
  ['AU', 1, 'Passer PSPO 2'],
  ['AU', 6, 'Finir secretaire IA'],
  ['TO', 1, 'TOPI FAM - faire page presse'],
  ['TO', 2, 'TOPI FAM - faire page booklet'],
  ['TI', 1, 'Generer prez et pricing TOPI pour vendre pour recrutement']
]);

test('apparier retrouve la tache malgre accents et casse', () => {
  const m = liste.apparier('finir secrétaire IA', PORTEFEUILLE);
  assert.strictEqual(m.tache.n, 6);
  assert.strictEqual(m.score, 1);
});

test('apparier tolere une date ajoutee en fin de ligne', () => {
  const m = liste.apparier('TOPI FAM - faire page presse - 21 sept', PORTEFEUILLE);
  assert.strictEqual(m.tache.n, 1);
  assert.strictEqual(m.projet.prefixe, 'TO');
});

test('apparier ne confond pas deux lignes qui ne partagent qu un verbe', () => {
  const p = taches([['XX', 1, 'vendre actions']]);
  assert.strictEqual(liste.apparier('vendre BTC', p), null);
});

// Deux taches jumelles ne doivent pas se disputer une ligne ambigue : sans
// vainqueur net, on prefere ne rien decider plutot que de supprimer la mauvaise.
test('apparier refuse de trancher entre deux candidats trop proches', () => {
  const jumelles = taches([
    ['TO', 1, 'TOPI FAM faire page'],
    ['TO', 2, 'TOPI FAM faire page']
  ]);
  assert.strictEqual(liste.apparier('TOPI FAM faire page', jumelles), null);
});

test('apparier renvoie null sur un portefeuille vide', () => {
  assert.strictEqual(liste.apparier('quoi que ce soit', []), null);
});

test('lignesInconnues garde ce qui n est dans aucune tache ouverte', () => {
  const lignes = ['Passer PSPO 2', 'vendre BTC', 'finir secrétaire IA', 'Vendre or'];
  assert.deepStrictEqual(liste.lignesInconnues(lignes, PORTEFEUILLE),
    ['vendre BTC', 'Vendre or']);
});
