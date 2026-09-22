'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const exporterMobile = require('../outils/exporter-mobile');

const CODE_TEST = 'code-test-neutre-000000';

test('depotsEquivalents compare sans tenir compte de la casse', () => {
  assert.equal(exporterMobile.depotsEquivalents('Compte/Depot', 'compte/depot'), true);
  assert.equal(exporterMobile.depotsEquivalents('Compte/Depot', 'compte/autre'), false);
  assert.equal(exporterMobile.depotsEquivalents(null, 'compte/depot'), false);
});

test('extraireProprietaireDepot lit une URL https ou ssh github', () => {
  assert.equal(exporterMobile.extraireProprietaireDepot('https://github.com/JCK-Sabords/AI-Secretary.git'), 'JCK-Sabords/AI-Secretary');
  assert.equal(exporterMobile.extraireProprietaireDepot('git@github.com:JCK-Sabords/AI-Secretary.git'), 'JCK-Sabords/AI-Secretary');
  assert.equal(exporterMobile.extraireProprietaireDepot('https://gitlab.com/o/r.git'), null);
});

test('verifierDepotCible accepte un depot cible vide (premier export)', async () => {
  const res = await exporterMobile.verifierDepotCible(
    'compte/depot-pages', 'compte/logiciel', async () => []);
  assert.equal(res.ok, true);
});

test('verifierDepotCible accepte un depot cible ne contenant que index.html', async () => {
  const res = await exporterMobile.verifierDepotCible(
    'compte/depot-pages', 'compte/logiciel', async () => ['index.html']);
  assert.equal(res.ok, true);
});

test('verifierDepotCible refuse un depot cible contenant autre chose que index.html', async () => {
  const res = await exporterMobile.verifierDepotCible(
    'compte/depot-pages', 'compte/logiciel', async () => ['index.html', 'README.md']);
  assert.equal(res.ok, false);
  assert.match(res.raison, /refus/);
  assert.match(res.raison, /depot-pages/);
});

test('verifierDepotCible refuse quand le depot cible est le depot du logiciel, sans interroger GitHub', async () => {
  const res = await exporterMobile.verifierDepotCible(
    'compte/logiciel', 'compte/logiciel', async () => {
      throw new Error('ne doit jamais etre appele : le refus doit intervenir avant');
    });
  assert.equal(res.ok, false);
  assert.match(res.raison, /refus/);
});

test('verifierDepotCible refuse proprement si l\'interrogation du depot cible echoue', async () => {
  const res = await exporterMobile.verifierDepotCible(
    'compte/depot-pages', 'compte/logiciel', async () => { throw new Error('reseau indisponible'); });
  assert.equal(res.ok, false);
  assert.match(res.raison, /refus/);
});

// Reconstitue un mini depot logiciel jetable (outils/, server/, web/, data/)
// pour appeler exporterMobile() reellement, sans toucher au vrai data/ du
// depot de travail. Utilise pour verifier la journalisation de bout en bout.
function construireFauxDepot() {
  const faux = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-export-mobile-repo-'));
  for (const d of ['outils', 'server', 'web', 'data']) fs.mkdirSync(path.join(faux, d), {recursive: true});
  for (const f of ['export.js', 'config.js', 'store.js', 'repo.js', 'people.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'server', f), path.join(faux, 'server', f));
  }
  fs.copyFileSync(path.join(__dirname, '..', 'outils', 'exporter-mobile.js'), path.join(faux, 'outils', 'exporter-mobile.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'web', 'mobile-gabarit.html'), path.join(faux, 'web', 'mobile-gabarit.html'));
  try {
    fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(faux, 'node_modules'), 'junction');
  } catch (e) {
    // Si le lien symbolique echoue (droits Windows), on retombe sur une
    // copie : n'affecte que l'environnement de test.
    fs.cpSync(path.join(__dirname, '..', 'node_modules'), path.join(faux, 'node_modules'), {recursive: true});
  }
  return faux;
}

test('exporterMobile() journalise un message fixe, sans le code, quand data/config.json est mal forme', async () => {
  const faux = construireFauxDepot();
  const cheminModule = path.join(faux, 'outils', 'exporter-mobile.js');
  try {
    // Configuration corrompue contenant un code de test neutre : reproduit
    // le scenario de la revue ou JSON.parse recopiait un extrait du fichier,
    // code compris, dans son message d'erreur.
    fs.writeFileSync(path.join(faux, 'data', 'config.json'),
      '{"exportMobile": {"code": "' + CODE_TEST + '", "depot": "x/y"} PAS_DU_JSON_VALIDE');

    const mod = require(cheminModule);
    const res = await mod.exporterMobile();
    assert.equal(res.publie, false);
    assert.ok(!res.raison.includes(CODE_TEST));
    assert.match(res.raison, /illisible/);

    const journal = fs.readFileSync(path.join(faux, 'data', 'history', 'export.log'), 'utf8');
    assert.ok(!journal.includes(CODE_TEST));
    assert.match(journal, /illisible/);
  } finally {
    delete require.cache[require.resolve(cheminModule)];
    fs.rmSync(faux, {recursive: true, force: true});
  }
});
