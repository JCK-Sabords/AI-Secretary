'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Ces tests couvrent la troisieme correction du point C1 (revue finale) :
// web/index.html ne doit jamais traiter une reponse de GET /api/etat depourvue
// d'un tableau projects comme un etat valide. Aucune dependance ajoutee : le
// script inline est extrait du fichier reel puis execute avec node:vm-like via
// new Function, sur un document et un fetch factices minimaux (seules deux API
// navigateur sont utilisees par ce script : document et fetch, voir revue du
// fichier). Rien n'est simule au-dela de ce que le scenario teste exerce
// reellement : le chemin "reponse invalide" de charger() s'arrete avant
// renderAll(), donc avant tout rendu de tableau complexe.

// Retire l'appel de demarrage place a la fin du script. Sans cela, le simple
// fait d'evaluer le fichier lance la sequence d'ouverture reelle (chargement de
// l'etat, calcul de la semaine par Claude, rapprochement WhatsApp), qui continue
// en tache de fond apres la fin du test, une fois le faux document retire :
// l'activite asynchrone orpheline faisait alors echouer la suite. Ces tests
// appellent charger() eux-memes, ils n'ont aucun besoin du demarrage.
const MOTIF_DEMARRAGE = /\ncharger\(\)[\s\S]*?;\s*$/;
function sansDemarrage(code) {
  assert.match(code, MOTIF_DEMARRAGE,
    'le script doit se terminer par son appel de demarrage');
  return code.replace(MOTIF_DEMARRAGE, '\n');
}

function scriptInline() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const m = /<script>([\s\S]*)<\/script>/.exec(html);
  assert.ok(m, 'le script inline de web/index.html doit etre trouve');
  return m[1];
}

/* ============================ etatExploitable (fonction pure) ============================ */

function chargerEtatExploitable() {
  const code = scriptInline();
  const m = /function etatExploitable\(data\)\{[^}]*\}/.exec(code);
  assert.ok(m, 'etatExploitable doit exister dans web/index.html');
  return new Function('return (' + m[0] + ')')();
}

test('etatExploitable accepte un objet portant un tableau projects, meme vide', () => {
  const etatExploitable = chargerEtatExploitable();
  assert.strictEqual(etatExploitable({projects: []}), true);
  assert.strictEqual(etatExploitable({projects: [{id: 'x'}]}), true);
});

test('etatExploitable refuse une reponse sans tableau projects', () => {
  const etatExploitable = chargerEtatExploitable();
  assert.strictEqual(etatExploitable({}), false, 'cle projects absente');
  assert.strictEqual(etatExploitable({projects: {}}), false, 'projects n est pas un tableau');
  assert.strictEqual(etatExploitable({projects: null}), false);
  assert.strictEqual(etatExploitable({erreur: 'panne'}), false, 'objet d erreur brut, sans projects');
  assert.strictEqual(etatExploitable(null), false);
  assert.strictEqual(etatExploitable(undefined), false);
  assert.strictEqual(etatExploitable('texte'), false);
});

/* ============================ charger() (integration minimale) ============================ */
// Document et fetch factices : seules les deux API navigateur utilisees par le
// script (voir grep prealable). Un element factice repond a toute lecture ou
// ecriture de propriete, et a tout appel de methode par un no-op, ce qui suffit
// au chemin "reponse invalide" exerce ici (il s'arrete avant renderAll, donc
// avant toute construction de tableau).

function elementFactice() {
  const store = {innerHTML: '', textContent: '', value: '', hidden: false,
    disabled: false, className: ''};
  const classList = {add() {}, remove() {}, toggle() {}, contains() { return false; }};
  const handler = {
    get(target, prop) {
      if (prop === 'classList') return classList;
      if (prop === 'style') return elementFactice();
      if (prop === 'dataset') return {};
      if (prop === 'children' || prop === 'childNodes') return [];
      if (prop in store) return store[prop];
      return () => {};
    },
    set(target, prop, value) { store[prop] = value; return true; }
  };
  return new Proxy(store, handler);
}

function documentFactice() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, elementFactice());
      return elements.get(id);
    },
    addEventListener() {},
    createElement() { return elementFactice(); }
  };
}

// Charge le script inline dans un environnement factice minimal et renvoie un
// objet exposant etat, erreurConnexion et charger, plus le document factice
// utilise (pour inspecter le bandeau errbar). fetchImpl est appele par toutes
// les invocations de fetch, y compris celle declenchee automatiquement en fin
// de script (charger(); tout en bas du fichier) : elle est sans consequence sur
// les assertions, qui portent sur un second appel explicite, attendu.
function chargerPage(fetchImpl) {
  const code = scriptInline();
  const original = {document: global.document, fetch: global.fetch,
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout};
  global.document = documentFactice();
  global.fetch = fetchImpl;
  // La seule fonction du script qui programme un minuteur reel est toast() (un
  // message qui s'efface tout seul apres 3.8 s) : sans ce neutralisateur, chaque
  // appel laisserait un minuteur reel actif bien apres la fin du test.
  global.setTimeout = () => 0;
  global.clearTimeout = () => {};
  try {
    const wrapped = new Function(sansDemarrage(code) +
      '\nreturn {get etat(){ return etat; }, get erreurConnexion(){ return erreurConnexion; }, ' +
      'charger: charger};');
    const api = wrapped();
    return {api, document: global.document, restaurer: () => {
      global.document = original.document;
      global.fetch = original.fetch;
      global.setTimeout = original.setTimeout;
      global.clearTimeout = original.clearTimeout;
    }};
  } catch (e) {
    global.document = original.document;
    global.fetch = original.fetch;
    global.setTimeout = original.setTimeout;
    global.clearTimeout = original.clearTimeout;
    throw e;
  }
}

test('charger() ne remplace jamais etat par une reponse sans tableau projects, et arme le bandeau persistant', async () => {
  const {api, document, restaurer} = chargerPage(async () => ({
    ok: true,
    json: async () => ({today: '2026-09-09', errors: []}) // aucune cle projects
  }));
  try {
    await api.charger();
    assert.ok(Array.isArray(api.etat.projects), 'etat.projects doit rester un tableau');
    assert.strictEqual(api.etat.projects.length, 0, 'etat initial conserve, jamais la reponse invalide');
    assert.strictEqual(api.etat.today, '', 'la reponse invalide n a pas remplace etat');
    assert.ok(api.erreurConnexion, 'le bandeau persistant doit etre arme');
    const errbar = document.getElementById('errbar');
    assert.strictEqual(errbar.hidden, false, 'le bandeau doit etre visible');
    assert.match(errbar.innerHTML, /invalide/i);
  } finally {
    restaurer();
  }
});

test('charger() accepte une reponse valide (tableau projects present) et met a jour etat', async () => {
  const bonneReponse = {today: '2026-09-09', errors: [], people: [], relances: [],
    projects: [{id: 'demo', prefixe: 'DE', titre: 'Demo', domaine: 'side',
      echeance: '', prochaine_action: 'faire', jira: '',
      severite: 'ok', signaux: {}, taches: []}]};
  const {api, document, restaurer} = chargerPage(async () => ({
    ok: true,
    json: async () => bonneReponse
  }));
  try {
    await api.charger();
    assert.strictEqual(api.etat.today, '2026-09-09');
    assert.strictEqual(api.etat.projects.length, 1);
    assert.strictEqual(api.erreurConnexion, null, 'aucune erreur ne doit etre armee sur une reponse valide');
    const errbar = document.getElementById('errbar');
    assert.strictEqual(errbar.hidden, true, 'le bandeau doit rester masque');
  } finally {
    restaurer();
  }
});
