'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Le lien de delegation ouvre une session Claude Code avec la demande deja
// ecrite. Sa grammaire n'est pas negociable, elle a ete relevee dans le binaire
// claude : claude-cli://open?q=<demande>&cwd=<chemin absolu>, `open` etant la
// seule action acceptee et `q` etant plafonne a 5000 caracteres. Ces tests
// verrouillent le respect de ces contraintes, qu'aucun navigateur ne signalera :
// une URL fautive echoue silencieusement au moment du clic.

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
  morceaux.push('var LIMITE_DEMANDE = 5000;');
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
  const enorme = Object.assign({}, PROJET, {contexte: 'x'.repeat(40000)});
  const d = demandeDelegation(TACHE, enorme, '2026-09-25');
  assert.ok(d.length <= LIMITE_DEMANDE, 'longueur ' + d.length);
  assert.match(d, /Refaire le site/, 'la demande survit a la troncature du contexte');
  assert.match(d, /Aide-moi/, 'la consigne finale aussi');
});

test('un titre de tache demesure ne fait pas deborder le lien', () => {
  const {demandeDelegation, LIMITE_DEMANDE} = chargerLien();
  const d = demandeDelegation(Object.assign({}, TACHE, {titre: 'y'.repeat(9000)}),
    PROJET, '2026-09-25');
  assert.ok(d.length <= LIMITE_DEMANDE, 'longueur ' + d.length);
});

test('le lien vise l action open et encode la demande', () => {
  const {lienDelegation} = chargerLien();
  const url = lienDelegation(TACHE, PROJET, '2026-09-25');
  assert.ok(url.startsWith('claude-cli://open?q='), url.slice(0, 40));
  assert.ok(!/[ \n"]/.test(url), 'aucun caractere brut non encode dans l URL');
  assert.match(decodeURIComponent(url.slice('claude-cli://open?q='.length)),
    /Refaire le site/);
});

test('le dossier du projet est transmis quand il est absolu', () => {
  const {lienDelegation} = chargerLien();
  const url = lienDelegation(TACHE, Object.assign({}, PROJET,
    {dossier: 'C:\\Users\\alex\\topi'}), '2026-09-25');
  assert.match(url, /&cwd=/);
  assert.strictEqual(decodeURIComponent(url.split('&cwd=')[1]), 'C:\\Users\\alex\\topi');
});

// Claude Code refuse ces chemins : envoyer l URL quand meme ferait echouer le
// clic sans rien expliquer. Mieux vaut ouvrir la session sans dossier.
test('un dossier que Claude Code refuserait n est pas transmis', () => {
  const {lienDelegation, cheminAbsoluValide} = chargerLien();
  ['', '   ', 'topi', './topi', '../topi', 'C:\\Users\\..\\alex',
    '\\\\serveur\\partage', '//serveur/partage'].forEach((mauvais) => {
    assert.strictEqual(cheminAbsoluValide(mauvais), false, JSON.stringify(mauvais));
    assert.ok(!lienDelegation(TACHE, Object.assign({}, PROJET, {dossier: mauvais}),
      '2026-09-25').includes('&cwd='), JSON.stringify(mauvais));
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
