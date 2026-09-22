'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const exportMod = require('../server/export');

function dataDirDeTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-export-'));
  fs.mkdirSync(path.join(dir, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'projects', 'abc.md'),
    '---\n' +
    "id: abc\nprefixe: ABC\ntitre: Projet Secret Alpha\ndomaine: pro\nstatut: actif\n" +
    "echeance: ''\nprochaine_action: ''\njira: ''\ndernier_n: 1\nordre: 0\n" +
    'taches:\n' +
    '  - n: 1\n' +
    "    titre: Tache confidentielle\n" +
    "    statut: a_faire\n" +
    "    responsable: contact-x\n" +
    "    echeance: ''\n" +
    "    nature_echeance: souhaitee\n" +
    "    prio: P2\n" +
    "    effort: M\n" +
    "    bloque_par: ''\n" +
    "    derniere_relance: ''\n" +
    "    prochaine_relance: '2020-01-01'\n" +
    "    maj_le: '2020-01-01'\n" +
    "    note_blocage: ''\n" +
    '---\n' +
    'contexte\n');
  fs.writeFileSync(path.join(dir, 'people.md'),
    "- id: contact-x\n  nom: Personne Confidentielle\n  chatId: '!chatid-secret:beeper.com'\n" +
    "  participantID: participant-secret\n  accountID: account-secret\n");
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    proprietaire: 'Test',
    filNoteASoiMeme: '!fil-de-notes-secret:beeper.com',
    exportMobile: {code: '246810', depot: 'JCK-Sabords/secretariat-mobile'}
  }));
  return dir;
}

test('l instantane ne contient aucun identifiant de contact ni la configuration', () => {
  const dir = dataDirDeTest();
  const instantane = exportMod.construireInstantane(dir, '2020-01-02');
  const brut = JSON.stringify(instantane);
  assert.doesNotMatch(brut, /chatId/i);
  assert.doesNotMatch(brut, /participantID/i);
  assert.doesNotMatch(brut, /accountID/i);
  assert.ok(!brut.includes('!chatid-secret:beeper.com'));
  assert.ok(!brut.includes('participant-secret'));
  assert.ok(!brut.includes('account-secret'));
  assert.ok(!brut.includes('!fil-de-notes-secret:beeper.com'));
  assert.ok(!brut.includes('246810'));
  // Le nom, lui, doit apparaitre : c'est la seule identification tolerable.
  assert.ok(brut.includes('Personne Confidentielle'));
});

test('chiffrer puis dechiffrer restitue le texte exact', () => {
  const texte = JSON.stringify({bonjour: 'le monde', accents: 'éàûç'});
  const paquet = exportMod.chiffrer(texte, '246810');
  const clair = exportMod.dechiffrer(paquet, '246810');
  assert.equal(clair, texte);
});

test('un mauvais code echoue proprement', () => {
  const paquet = exportMod.chiffrer('secret', '246810');
  assert.throws(() => exportMod.dechiffrer(paquet, '000000'));
});

test('un texte chiffre altere d un seul octet echoue (etiquette d authentification)', () => {
  const paquet = exportMod.chiffrer('secret', '246810');
  const buf = Buffer.from(paquet.texte, 'base64');
  buf[0] = buf[0] ^ 0xff;
  const altere = Object.assign({}, paquet, {texte: buf.toString('base64')});
  assert.throws(() => exportMod.dechiffrer(altere, '246810'));
});

test('deux chiffrements du meme texte produisent des paquets differents', () => {
  const a = exportMod.chiffrer('meme texte', '246810');
  const b = exportMod.chiffrer('meme texte', '246810');
  assert.notEqual(a.sel, b.sel);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.texte, b.texte);
});

test('les parametres PBKDF2 respectent le cahier des charges', () => {
  const paquet = exportMod.chiffrer('x', '246810');
  assert.equal(paquet.iterations, 600000);
  assert.equal(Buffer.from(paquet.sel, 'base64').length, 16);
  assert.equal(Buffer.from(paquet.iv, 'base64').length, 12);
});
