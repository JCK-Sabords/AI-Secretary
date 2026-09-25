'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Le lien de delegation ouvre une session dans l'application Claude Code de
// bureau, avec la demande deja ecrite. Sa grammaire a ete relevee dans les
// ressources de l'application : claude://code/new?q=<demande>&folder=<dossier>,
// `q` etant tronquee a 14336 caracteres.
//
// Le schema compte autant que le reste. claude-cli://, l'autre schema enregistre
// sur le poste, ouvre une fenetre de terminal et non une session dans
// l'application : c'est l'erreur de la premiere version, et le test ci-dessous
// est la pour qu'elle ne revienne pas. Aucun navigateur ne signalerait la
// difference, le clic ouvrirait simplement la mauvaise chose.

function source() {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
}

// Les trois fonctions sont pures et ne touchent ni au DOM ni au reseau : on les
// extrait avec les deux aides dont elles dependent (frDate, echeanceRelative).
function chargerLien() {
  const code = source();
  const morceaux = ['function D(s){', 'function daysBetween(', 'function frDate(',
    'function echeanceRelative(', 'function demandeDelegation(',
    'function cheminAbsoluValide(', 'function lienDelegation(']
    .map((debut) => {
      const i = code.indexOf(debut);
      assert.notStrictEqual(i, -1, debut + ' doit exister dans web/index.html');
      const fin = code.indexOf('\n}', i);
      assert.notStrictEqual(fin, -1);
      return code.slice(i, fin + 2);
    });
  morceaux.push('var LIMITE_DEMANDE = 14336;');
  return new Function(morceaux.join('\n') +
    '\nreturn {demandeDelegation, lienDelegation, cheminAbsoluValide, LIMITE_DEMANDE};')();
}

const TACHE = {n: 2, titre: 'Refaire le site', prio: 'P2', echeance: '2026-10-01',
  note_blocage: ''};
const PROJET = {id: 'topi', prefixe: 'TO', titre: 'TOPI', contexte: 'Refonte en Astro.',
  dossier: ''};

test('la demande situe la tache, son projet et son echeance', () => {
  const {demandeDelegation} = chargerLien();
  const d = demandeDelegation(TACHE, PROJET, '2026-09-25');
  assert.match(d, /Refaire le site/);
  assert.match(d, /TOPI/);
  assert.match(d, /TO2/, 'la reference permet d en reparler a l agent');
  assert.match(d, /P2/);
  assert.match(d, /dans 6 j/, 'l echeance est donnee en delai comme dans le tableau');
  assert.match(d, /Refonte en Astro/, 'le contexte du projet est transmis');
});

test('une tache sans echeance le dit, plutot que de laisser un vide', () => {
  const {demandeDelegation} = chargerLien();
  assert.match(demandeDelegation(Object.assign({}, TACHE, {echeance: ''}), PROJET,
    '2026-09-25'), /sans échéance/);
});

test('un blocage note est transmis', () => {
  const {demandeDelegation} = chargerLien();
  assert.match(demandeDelegation(Object.assign({}, TACHE,
    {note_blocage: 'attente du devis'}), PROJET, '2026-09-25'), /attente du devis/);
});

// La contrainte dure : au-dela de 5000 caracteres, Claude Code refuse le lien.
test('la demande ne depasse jamais la limite acceptee par Claude Code', () => {
  const {demandeDelegation, LIMITE_DEMANDE} = chargerLien();
  assert.strictEqual(LIMITE_DEMANDE, 14336, 'plafond applique par l application de bureau');
  const enorme = Object.assign({}, PROJET, {contexte: 'x'.repeat(40000)});
  const d = demandeDelegation(TACHE, enorme, '2026-09-25');
  assert.ok(d.length <= LIMITE_DEMANDE, 'longueur ' + d.length);
  assert.match(d, /Refaire le site/, 'la demande survit a la troncature du contexte');
  assert.match(d, /Aide-moi/, 'la consigne finale aussi');
});

test('un titre de tache demesure ne fait pas deborder le lien', () => {
  const {demandeDelegation, LIMITE_DEMANDE} = chargerLien();
  const d = demandeDelegation(Object.assign({}, TACHE, {titre: 'y'.repeat(30000)}),
    PROJET, '2026-09-25');
  assert.ok(d.length <= LIMITE_DEMANDE, 'longueur ' + d.length);
});

test('le lien vise l application de bureau, jamais le terminal', () => {
  const {lienDelegation} = chargerLien();
  const url = lienDelegation(TACHE, PROJET, '2026-09-25');
  assert.ok(url.startsWith('claude://code/new?q='), url.slice(0, 40));
  assert.ok(!url.startsWith('claude-cli://'),
    'claude-cli:// ouvrirait un terminal, pas une session de l application');
  assert.ok(!/[ \n"]/.test(url), 'aucun caractere brut non encode dans l URL');
  assert.match(decodeURIComponent(url.slice('claude://code/new?q='.length)),
    /Refaire le site/);
});

test('le dossier du projet est transmis quand il est absolu', () => {
  const {lienDelegation} = chargerLien();
  const url = lienDelegation(TACHE, Object.assign({}, PROJET,
    {dossier: 'C:\\Users\\alex\\topi'}), '2026-09-25');
  assert.match(url, /&folder=/);
  assert.strictEqual(decodeURIComponent(url.split('&folder=')[1]), 'C:\\Users\\alex\\topi');
});

// Un chemin relatif ou reseau n'a pas de sens comme dossier de session : mieux
// vaut ouvrir sans dossier que d'ouvrir au mauvais endroit.
test('un dossier qui n est pas un chemin absolu n est pas transmis', () => {
  const {lienDelegation, cheminAbsoluValide} = chargerLien();
  ['', '   ', 'topi', './topi', '../topi', 'C:\\Users\\..\\alex',
    '\\\\serveur\\partage', '//serveur/partage'].forEach((mauvais) => {
    assert.strictEqual(cheminAbsoluValide(mauvais), false, JSON.stringify(mauvais));
    assert.ok(!lienDelegation(TACHE, Object.assign({}, PROJET, {dossier: mauvais}),
      '2026-09-25').includes('&folder='), JSON.stringify(mauvais));
  });
});

test('un chemin absolu, Windows ou Unix, est accepte', () => {
  const {cheminAbsoluValide} = chargerLien();
  ['C:\\Users\\alex', 'c:/Users/alex', '/home/alex/topi'].forEach((bon) => {
    assert.strictEqual(cheminAbsoluValide(bon), true, bon);
  });
});

// La page n'affiche le lien qu'a travers esc() : sans cela, un titre de tache
// portant un guillemet casserait l'attribut href.
test('le lien passe par esc avant d entrer dans le HTML', () => {
  assert.match(source(), /href="' \+ esc\(lienDelegation\(/);
});
