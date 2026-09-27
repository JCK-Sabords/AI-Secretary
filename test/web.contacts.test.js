'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Le repertoire ne pouvait s'enrichir que depuis une relance bloquee, et une
// relance bloquee suppose une tache deja assignee a quelqu'un qu'on ne pouvait
// choisir que dans le repertoire : le cercle etait ferme. Ces tests fixent la
// sortie de ce cercle, l'entree d'ajout de contact dans la liste des
// responsables, et ce qui ne doit jamais en decouler : que cette entree finisse
// ecrite comme responsable dans un fichier de projet.

function source() {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
}

function extraire(debut) {
  const code = source();
  const i = code.indexOf(debut);
  assert.notStrictEqual(i, -1, debut + ' doit exister dans web/index.html');
  const fin = code.indexOf('\n}', i);
  assert.notStrictEqual(fin, -1);
  return code.slice(i, fin + 2);
}

// Les deux fonctions lisent `etat` et `slugifyId` : on les recharge avec un
// etat factice, sans navigateur.
function charger(people) {
  const morceaux = [
    'var FORMAT_ID_CLIENT = /^[a-z0-9][a-z0-9_-]*$/;',
    extraire('function slugifyId(titre){'),
    'var etat = ' + JSON.stringify({people: people}) + ';',
    'var VALEUR_NOUVEAU_CONTACT = "__nouveau_contact";',
    extraire('function respMapAvecAjout(){'),
    extraire('function idPourNouveauContact(nom){')
  ];
  return new Function(morceaux.join('\n') +
    '\nreturn {respMapAvecAjout, idPourNouveauContact, VALEUR_NOUVEAU_CONTACT};')();
}

test('la liste des responsables propose toujours d ajouter un contact', () => {
  const {respMapAvecAjout, VALEUR_NOUVEAU_CONTACT} = charger([
    {id: 'christian', nom: 'Christian K.'}
  ]);
  const m = respMapAvecAjout();
  assert.strictEqual(m.moi, 'Moi');
  assert.strictEqual(m.christian, 'Christian K.');
  assert.ok(m[VALEUR_NOUVEAU_CONTACT], 'l entree d ajout doit etre presente');
});

// C'est le cas qui bloquait tout : un repertoire vide doit quand meme offrir la
// sortie, sinon on ne peut jamais deleguer a personne.
test('l entree d ajout est proposee meme quand le repertoire est vide', () => {
  const {respMapAvecAjout, VALEUR_NOUVEAU_CONTACT} = charger([]);
  const m = respMapAvecAjout();
  assert.deepStrictEqual(Object.keys(m), ['moi', VALEUR_NOUVEAU_CONTACT]);
});

test('l identifiant de fiche derive du nom du contact', () => {
  const {idPourNouveauContact} = charger([]);
  assert.strictEqual(idPourNouveauContact('Camille Durand'), 'camille-durand');
  assert.strictEqual(idPourNouveauContact('Émilie Dupont-Durand'), 'emilie-dupont-durand');
});

// Deux partenaires homonymes doivent coexister : le second ne doit pas ecraser
// la fiche du premier, ce qui redirigerait ses relances vers la mauvaise
// conversation.
test('un homonyme recoit un identifiant distinct, il n ecrase jamais le premier', () => {
  const {idPourNouveauContact} = charger([
    {id: 'jean-martin', nom: 'Jean Martin'},
    {id: 'jean-martin-2', nom: 'Jean Martin'}
  ]);
  assert.strictEqual(idPourNouveauContact('Jean Martin'), 'jean-martin-3');
});

test('un nom sans caractere latin donne tout de meme un identifiant valide', () => {
  const {idPourNouveauContact} = charger([]);
  const id = idPourNouveauContact('!!!');
  assert.match(id, /^[a-z0-9][a-z0-9_-]*$/, 'identifiant obtenu : ' + id);
  assert.ok(id.length <= 64);
});

/* ---------- ce qui ne doit jamais etre ecrit ---------- */

// L'entree d'ajout est une action, pas un responsable. Si elle etait
// enregistree, la tache serait assignee a une personne inexistante et sa
// relance deviendrait impossible sans que rien ne l'explique.
test('l entree d ajout ne peut pas etre enregistree comme responsable', () => {
  const s = source();
  assert.match(s, /if \(responsable === VALEUR_NOUVEAU_CONTACT\) responsable = 'moi';/,
    "l'editeur complet doit s'en premunir");
  assert.match(s, /e\.target\.value === VALEUR_NOUVEAU_CONTACT[\s\S]{0,400}ouvrirAjoutContact/,
    "choisir l'entree doit ouvrir le tiroir, pas enregistrer");
});

// Un tiroir annule ne doit pas laisser son contexte derriere lui : le choix
// suivant, venu d'une relance bloquee, prendrait le mauvais chemin et creerait
// une fiche en double au lieu de resoudre celle qui existe.
test('fermer le tiroir efface le contexte d ajout', () => {
  const closeDrawer = extraire('function closeDrawer(){');
  assert.match(closeDrawer, /contexteContact = null/);
});
