'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Les taches d'un projet s'affichent par priorite decroissante. Le serveur tient
// deja cet ordre pour l'export mobile, la liste WhatsApp et l'agent hebdomadaire
// (store.openTasks) ; le tableau de bord, lui, lit `p.taches` directement et doit
// donc trier de son cote. Les deux regles sont ecrites a deux endroits : ces
// tests les comparent, parce qu'une divergence ne produirait aucune erreur, juste
// deux classements differents pour les memes taches.

function source() {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
}

// `parPriorite` et `rangPrio` sont pures : ni DOM, ni reseau.
function chargerTri() {
  const code = source();
  const morceaux = ['var RANG_PRIO = {', 'function rangPrio(t)', 'function parPriorite(taches){']
    .map((debut) => {
      const i = code.indexOf(debut);
      assert.notStrictEqual(i, -1, debut + ' doit exister dans web/index.html');
      const fin = debut.endsWith('{') ? code.indexOf('\n}', i) + 2 : code.indexOf('\n', i);
      return code.slice(i, fin);
    });
  return new Function(morceaux.join('\n') + '\nreturn {rangPrio, parPriorite};')();
}

const t = (n, prio) => ({n: n, prio: prio});

test('les taches s affichent de la plus prioritaire a la moins prioritaire', () => {
  const {parPriorite} = chargerTri();
  const vu = parPriorite([t(1, 'P3'), t(2, 'P1'), t(3, 'P4'), t(4, 'P2')]);
  assert.deepStrictEqual(vu.map((x) => x.n), [2, 4, 1, 3]);
});

// L'ordre etabli au glisser-deposer reste le departage entre ex aequo. Le tri
// doit donc etre stable, sans quoi deux taches de meme priorite permuteraient
// d'un rendu a l'autre sans que rien n'ait bouge.
test('a priorite egale, l ordre du glisser-deposer est conserve', () => {
  const {parPriorite} = chargerTri();
  const vu = parPriorite([t(7, 'P2'), t(3, 'P1'), t(5, 'P2'), t(9, 'P1'), t(1, 'P2')]);
  assert.deepStrictEqual(vu.map((x) => x.n), [3, 9, 7, 5, 1]);
});

test('une priorite absente ou inconnue passe en queue, jamais en tete', () => {
  const {parPriorite, rangPrio} = chargerTri();
  assert.deepStrictEqual(
    parPriorite([t(1, ''), t(2, 'P4'), t(3, 'P1'), t(4, undefined)]).map((x) => x.n),
    [3, 2, 1, 4]);
  assert.ok(rangPrio(t(1, 'P4')) < rangPrio(t(2, '')));
});

test('le tri ne modifie pas la liste qu on lui donne', () => {
  const {parPriorite} = chargerTri();
  const taches = [t(1, 'P3'), t(2, 'P1')];
  parPriorite(taches);
  assert.deepStrictEqual(taches.map((x) => x.n), [1, 2]);
});

// La meme regle vit dans server/store.js. Si l'une des deux changeait seule, le
// tableau de bord et l'export mobile presenteraient deux ordres differents.
test('le tableau de bord et le serveur classent pareil', () => {
  const {parPriorite} = chargerTri();
  const store = require('../server/store');
  const taches = [t(1, 'P3'), t(2, 'P1'), t(3, ''), t(4, 'P2'), t(5, 'P1')];
  assert.deepStrictEqual(
    parPriorite(taches).map((x) => x.n),
    store.openTasks({taches: taches}).map((x) => x.n));
});

/* ---------- le glisser-deposer reste coherent avec cet ordre ---------- */

// Sans cela, un glisser qui franchit une priorite ne produirait rien de visible :
// le tri remettrait aussitot la tache dans son groupe et le geste semblerait
// ignore. Il est donc lu pour ce qu'il dit, deposer parmi des P1 passe en P1.
test('deposer une tache dans un autre groupe change sa priorite', () => {
  const corps = /function deplacerTache\(pid, sourceN, targetN\)\{[\s\S]*?\n\}/.exec(source());
  assert.ok(corps, 'deplacerTache doit exister');
  assert.match(corps[0], /source\.prio !== cible\.prio/,
    'le franchissement d une priorite doit etre detecte');
  assert.match(corps[0], /'update_task'[\s\S]*prio: cible\.prio/,
    'la priorite doit suivre la destination');
  // Les deux changements partent dans le meme lot : une tache repriorisee dont le
  // rangement n'aurait pas suivi se retrouverait au mauvais endroit de son groupe.
  assert.strictEqual((corps[0].match(/envoyerOps\(/g) || []).length, 1,
    'les deux operations doivent vivre ou echouer ensemble');
  assert.match(corps[0], /envoyerOps\(ops\)/);
});
