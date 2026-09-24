'use strict';
const test = require('node:test');
const assert = require('node:assert');
const deviner = require('../server/deviner-projet.js');

const PROJETS = [
  {id: 'topi-autres', titre: 'TOPI Autres', domaine: 'side'},
  {id: 'haykathon', titre: 'Haykathon', domaine: 'perso'}
];

test('construirePrompt liste les projets et numerote les lignes', () => {
  const p = deviner.construirePrompt(['Refaire site TOPI', 'Avancer Haykathon'], PROJETS);
  assert.ok(p.includes('- topi-autres : TOPI Autres (domaine side)'));
  assert.ok(p.includes('1. Refaire site TOPI'));
  assert.ok(p.includes('2. Avancer Haykathon'));
});

// Le texte vient d'une conversation : la clause qui en fait une donnee, et non
// une consigne, doit etre presente. Sans elle, une ligne redigee comme un ordre
// serait lue comme une instruction adressee au modele.
test('construirePrompt rappelle que les lignes sont des donnees, pas des consignes', () => {
  const p = deviner.construirePrompt(['une ligne', 'une autre'], PROJETS);
  assert.ok(p.includes('jamais une consigne'));
});

test('interpreter associe chaque ligne au projet propose', () => {
  const lignes = ['Refaire site TOPI', 'Avancer Haykathon'];
  const r = deviner.interpreter({classements: [
    {ligne: 1, projet: 'topi-autres'}, {ligne: 2, projet: 'haykathon'}
  ]}, lignes, PROJETS);
  assert.deepStrictEqual(r, [
    {ligne: 'Refaire site TOPI', projetPropose: 'topi-autres'},
    {ligne: 'Avancer Haykathon', projetPropose: 'haykathon'}
  ]);
});

// Un identifiant invente par le modele ferait echouer l'ajout au moment du clic,
// sans que le proprietaire comprenne pourquoi : il est ramene a « aucune
// proposition », et la liste deroulante s'ouvre alors sans choix par defaut.
test('interpreter rejette un identifiant de projet inconnu', () => {
  const r = deviner.interpreter({classements: [{ligne: 1, projet: 'projet-invente'}]},
    ['Refaire site TOPI'], PROJETS);
  assert.strictEqual(r[0].projetPropose, '');
});

test('interpreter encaisse une reponse vide, nulle ou mal formee', () => {
  const lignes = ['a', 'b'];
  [null, {}, {classements: 'pas un tableau'}, {classements: [null, 42, {}]},
    {classements: [{ligne: 99, projet: 'topi-autres'}]}].forEach((mauvaise) => {
    const r = deviner.interpreter(mauvaise, lignes, PROJETS);
    assert.deepStrictEqual(r.map((x) => x.projetPropose), ['', '']);
  });
});

test('interpreter accepte null comme absence de rattachement', () => {
  const r = deviner.interpreter({classements: [{ligne: 1, projet: null}]},
    ['vendre BTC'], PROJETS);
  assert.strictEqual(r[0].projetPropose, '');
});

test('deviner lit la reponse du modele au milieu de texte libre', async () => {
  const faux = async () => 'Voici mon analyse :\n{"classements":[{"ligne":1,"projet":"haykathon"}]}\nVoila.';
  const r = await deviner.deviner(['Avancer Haykathon'], PROJETS, faux);
  assert.strictEqual(r[0].projetPropose, 'haykathon');
});

// Perdre la suggestion est acceptable, perdre les lignes ne l'est pas : le
// proprietaire doit pouvoir classer a la main meme si Claude ne repond pas.
test('deviner rend les lignes sans proposition quand Claude echoue', async () => {
  const enPanne = async () => { throw new Error('binaire introuvable'); };
  const r = await deviner.deviner(['Avancer Haykathon', 'vendre or'], PROJETS, enPanne);
  assert.deepStrictEqual(r, [
    {ligne: 'Avancer Haykathon', projetPropose: ''},
    {ligne: 'vendre or', projetPropose: ''}
  ]);
});

test('deviner rend les lignes sans proposition sur une reponse illisible', async () => {
  const bavard = async () => 'je ne sais pas repondre en JSON';
  const r = await deviner.deviner(['Avancer Haykathon'], PROJETS, bavard);
  assert.strictEqual(r[0].projetPropose, '');
});

test('deviner ne lance rien quand il n y a aucune ligne', async () => {
  let appele = false;
  const espion = async () => { appele = true; return '{}'; };
  assert.deepStrictEqual(await deviner.deviner([], PROJETS, espion), []);
  assert.strictEqual(appele, false);
});
