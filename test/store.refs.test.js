const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');

const projets = [
  {id: 'estimmo', prefixe: 'ES', taches: [{n: 1}, {n: 4}]},
  {id: 'cabinet', prefixe: 'CA', taches: [{n: 2}]}
];

test('refOf concatene le prefixe et le numero', () => {
  assert.strictEqual(store.refOf(projets[0], {n: 4}), 'ES4');
});

test('parseRef accepte la casse et les espaces', () => {
  assert.deepStrictEqual(store.parseRef(' es4 '), {prefixe: 'ES', n: 4});
  assert.strictEqual(store.parseRef('bricole'), null);
  assert.strictEqual(store.parseRef('4'), null);
});

test('findByRef retrouve la tache', () => {
  const hit = store.findByRef(projets, 'CA2');
  assert.strictEqual(hit.project.id, 'cabinet');
  assert.strictEqual(hit.task.n, 2);
  assert.strictEqual(store.findByRef(projets, 'ES9'), null);
  assert.strictEqual(store.findByRef(projets, 'ZZ1'), null);
});

test('nextTaskNumber ne reattribue jamais un numero supprime', () => {
  const p = {dernier_n: 4, taches: [{n: 1}, {n: 4}]};
  const dernierAvantAppel = p.dernier_n;
  assert.strictEqual(store.nextTaskNumber(p), 5);
  assert.strictEqual(p.dernier_n, dernierAvantAppel,
    'nextTaskNumber ne doit pas modifier le projet');
  p.taches = [{n: 1}];
  assert.strictEqual(store.nextTaskNumber(p), 5,
    'le maximum doit rester connu meme apres suppression');
  assert.strictEqual(p.dernier_n, dernierAvantAppel,
    'nextTaskNumber ne doit pas modifier le projet');
});

test('nextTaskNumber vaut 1 sur un projet vide', () => {
  assert.strictEqual(store.nextTaskNumber({taches: []}), 1);
});

test('allocatePrefix prend les deux premieres lettres', () => {
  assert.strictEqual(store.allocatePrefix('Estimmo', []), 'ES');
});

test('allocatePrefix evite les collisions', () => {
  assert.strictEqual(store.allocatePrefix('Estimation', ['ES']), 'ET');
  assert.strictEqual(store.allocatePrefix('Estimmo', ['ES', 'ET', 'EI', 'EM', 'EO']), 'EA');
});

test('allocatePrefix ignore accents et espaces', () => {
  assert.strictEqual(store.allocatePrefix("Écoles à Paris", []), 'EC');
});

test('une reference construite sur un prefixe de repli reste relisible', () => {
  const pris = ['ES', 'ET', 'EI', 'EM', 'EO'];
  const prefixe = store.allocatePrefix('Estimmo', pris);
  assert.strictEqual(prefixe, 'EA');

  const projet = {id: 'estimmo-2', prefixe, taches: [{n: 14}]};
  const projects = [projet];

  const ref = store.refOf(projet, projet.taches[0]);
  assert.strictEqual(ref, 'EA14');
  assert.deepStrictEqual(store.parseRef(ref), {prefixe: 'EA', n: 14});

  const hit = store.findByRef(projects, ref);
  assert.strictEqual(hit.project.id, 'estimmo-2');
  assert.strictEqual(hit.task.n, 14);
});
