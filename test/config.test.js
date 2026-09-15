'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../server/config');

function tmpdata() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-config-'));
}

test('lireConfig renvoie des valeurs de repli quand le fichier config.json est absent', () => {
  const r = config.lireConfig(tmpdata());
  assert.deepStrictEqual(r, {proprietaire: "l'utilisateur", filNoteASoiMeme: ''});
});

test('lireConfig renvoie des valeurs de repli sans lever quand le JSON est casse', () => {
  const d = tmpdata();
  fs.writeFileSync(path.join(d, 'config.json'), '{ceci n est pas du JSON', 'utf8');
  assert.doesNotThrow(() => config.lireConfig(d));
  const r = config.lireConfig(d);
  assert.deepStrictEqual(r, {proprietaire: "l'utilisateur", filNoteASoiMeme: ''});
});

test('lireConfig complete une cle proprietaire manquante par la valeur de repli', () => {
  const d = tmpdata();
  fs.writeFileSync(path.join(d, 'config.json'),
    JSON.stringify({filNoteASoiMeme: '!fil:beeper.com'}), 'utf8');
  const r = config.lireConfig(d);
  assert.strictEqual(r.proprietaire, "l'utilisateur");
  assert.strictEqual(r.filNoteASoiMeme, '!fil:beeper.com');
});

test('lireConfig complete une cle filNoteASoiMeme manquante par une chaine vide', () => {
  const d = tmpdata();
  fs.writeFileSync(path.join(d, 'config.json'),
    JSON.stringify({proprietaire: 'Alex'}), 'utf8');
  const r = config.lireConfig(d);
  assert.strictEqual(r.proprietaire, 'Alex');
  assert.strictEqual(r.filNoteASoiMeme, '');
});

test('lireConfig renvoie les deux cles telles quelles quand le fichier est complet', () => {
  const d = tmpdata();
  fs.writeFileSync(path.join(d, 'config.json'),
    JSON.stringify({proprietaire: 'Alex', filNoteASoiMeme: '!fil:beeper.com'}), 'utf8');
  const r = config.lireConfig(d);
  assert.deepStrictEqual(r, {proprietaire: 'Alex', filNoteASoiMeme: '!fil:beeper.com'});
});

test('lireConfig ne leve jamais, meme sur un dossier inexistant', () => {
  const d = path.join(os.tmpdir(), 'secretaire-config-inexistant-' + Date.now());
  assert.doesNotThrow(() => config.lireConfig(d));
  assert.deepStrictEqual(config.lireConfig(d), {proprietaire: "l'utilisateur", filNoteASoiMeme: ''});
});

/* ============================ substituerProprietaire ============================ */
/* Utilisee par agent/run-weekly.js pour remplacer le marqueur {{PROPRIETAIRE}} de
   agent/weekly-recap.md par le nom lu dans la configuration, juste avant d'envoyer
   le prompt sur l'entree standard (tache 16). */

test('substituerProprietaire remplace une occurrence unique du marqueur', () => {
  const r = config.substituerProprietaire('Tu es le secretaire de {{PROPRIETAIRE}}.', 'Alex');
  assert.strictEqual(r, 'Tu es le secretaire de Alex.');
});

test('substituerProprietaire remplace toutes les occurrences du marqueur', () => {
  const gabarit = '{{PROPRIETAIRE}} et encore {{PROPRIETAIRE}} et enfin {{PROPRIETAIRE}}.';
  const r = config.substituerProprietaire(gabarit, 'Dominique');
  assert.strictEqual(r, 'Dominique et encore Dominique et enfin Dominique.');
  assert.ok(!r.includes('{{'), 'aucun marqueur ne doit subsister apres substitution');
});

test('substituerProprietaire laisse un gabarit sans marqueur inchange', () => {
  const r = config.substituerProprietaire('rien a remplacer ici', 'Alex');
  assert.strictEqual(r, 'rien a remplacer ici');
});

// Verifie directement sur le vrai gabarit du depot, plutot que sur un extrait
// fabrique : aucun marqueur {{ ne doit subsister apres substitution sur le fichier
// reellement utilise par l'agent hebdomadaire.
test('substituerProprietaire ne laisse subsister aucun marqueur {{ sur le vrai gabarit agent/weekly-recap.md', () => {
  const gabarit = fs.readFileSync(
    path.join(__dirname, '..', 'agent', 'weekly-recap.md'), 'utf8');
  assert.ok(gabarit.includes('{{PROPRIETAIRE}}'),
    'le gabarit doit porter au moins une occurrence du marqueur avant substitution');
  const r = config.substituerProprietaire(gabarit, 'Alex');
  assert.ok(!r.includes('{{'), 'aucun marqueur ne doit subsister apres substitution');
  assert.ok(r.includes('Alex'), 'le nom substitue doit apparaitre dans le resultat');
});
