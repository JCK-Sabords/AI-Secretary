'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Ces tests verrouillent la lecon d'un vrai usage rate. Dans la premiere version
// de la fenetre « Taches absentes du secretariat », le seul bouton mis en avant
// etait « Fermer », qui abandonne les lignes proposees. C'est donc celui sur
// lequel on clique, et sept taches sont parties a la poubelle sans que rien ne
// l'annonce. Deux garanties sont testees ici : la phrase du pied dit toujours
// combien de lignes attendent encore, et le bouton d'abandon n'est jamais celui
// qui est mis en avant.

function source() {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
}

function chargerLibelle() {
  const m = /function libelleCompteAjouts\(enAttente, prets, devinageEnCours\)\{[\s\S]*?\n\}/
    .exec(source());
  assert.ok(m, 'libelleCompteAjouts doit exister dans web/index.html');
  return new Function('return (' + m[0] + ')')();
}

test('le pied annonce combien de lignes attendent encore', () => {
  const libelle = chargerLibelle();
  assert.match(libelle(7, 4, false), /^4 sur 7 pr/);
  assert.match(libelle(7, 7, false), /^7 tâches prêtes/);
  assert.match(libelle(1, 1, false), /^1 tâche prête/);
});

test('le pied signale l attente de Claude plutot que de laisser la fenetre muette', () => {
  const libelle = chargerLibelle();
  assert.match(libelle(7, 0, true), /Claude cherche/);
});

test('le pied ne dit "tout est ajoute" que lorsque plus rien n attend', () => {
  const libelle = chargerLibelle();
  assert.strictEqual(libelle(0, 0, false), 'Tout est ajouté.');
  assert.notStrictEqual(libelle(3, 0, false), 'Tout est ajouté.');
});

// Le coeur de la regression : l'action mise en avant doit etre celle qui ajoute,
// jamais celle qui abandonne.
test('le bouton qui abandonne n est jamais le bouton mis en avant', () => {
  const s = source();
  const fermer = /<button class="([^"]*)" type="button" data-rapp-fermer>/.exec(s);
  assert.ok(fermer, 'le bouton de fermeture doit exister');
  assert.ok(!/primary/.test(fermer[1]),
    'le bouton qui abandonne les lignes ne doit pas porter la classe primary');

  const tout = /<button class="([^"]*)" type="button" data-rapp-tout>/.exec(s);
  assert.ok(tout, 'le bouton « Tout ajouter » doit exister');
  assert.ok(/primary/.test(tout[1]),
    'l action mise en avant doit etre celle qui ajoute');
});

test('le bouton de fermeture dit ce qu il abandonne', () => {
  assert.ok(source().includes('Fermer sans ajouter le reste'),
    'le libelle doit annoncer que le reste ne sera pas ajoute');
});

// La fenetre doit s'afficher avant la reponse de Claude : le classement et le
// controle d'ouverture partent en parallele, et le premier rendu a lieu avant
// l'attente. Sans cela, l'utilisateur reste devant un ecran vide pres d'une
// minute, sans savoir qu'une fenetre va s'ouvrir.
test('la fenetre est rendue avant d attendre Claude', () => {
  const m = /async function etapeAjouts\(\)\{[\s\S]*?\n\}/.exec(source());
  assert.ok(m, 'etapeAjouts doit exister');
  const corps = m[0];
  const premierRendu = corps.indexOf('rendreAjouts();');
  const attenteClaude = corps.indexOf('await claudeBranche');
  assert.ok(premierRendu !== -1 && attenteClaude !== -1);
  assert.ok(premierRendu < attenteClaude,
    'le premier rendu doit preceder l attente de Claude');
  const lancementDeviner = corps.indexOf("fetch('/api/lancement/deviner'");
  assert.ok(lancementDeviner !== -1 && lancementDeviner < attenteClaude,
    'le classement doit partir en parallele du controle d ouverture');
});
