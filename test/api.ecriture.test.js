const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const api = require('../server/api');
const repo = require('../server/repo');

function contexte() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-w-'));
  const projectsDir = path.join(root, 'data', 'projects');
  repo.saveProject(projectsDir, {id: 'demo', prefixe: 'DE', titre: 'Demo',
    domaine: 'side', statut: 'actif', echeance: '', prochaine_action: 'faire',
    jira: '', dernier_n: 1, contexte: '',
    taches: [{n: 1, titre: 'a', statut: 'a_faire', responsable: 'moi', echeance: '',
      nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
      derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01',
      note_blocage: ''}]});
  return {root, projectsDir, dataDir: path.join(root, 'data'), today: '2026-09-06'};
}

// Ajoute un depot Git initialise autour d un contexte existant, pour les tests qui
// verifient le comportement de repo.commit.
function contexteAvecDepotGit() {
  const ctx = contexte();
  execFileSync('git', ['init', '-q'], {cwd: ctx.root, stdio: 'ignore'});
  execFileSync('git', ['config', 'user.name', 'Secretaire Test'], {cwd: ctx.root, stdio: 'ignore'});
  execFileSync('git', ['config', 'user.email', 'secretaire-test@example.com'],
    {cwd: ctx.root, stdio: 'ignore'});
  return ctx;
}

// Ajoute au contexte un fichier .md illisible (frontmatter YAML casse), en plus du
// projet demo valide deja cree par contexte(). Utilise pour verifier le garde-fou
// 409 : loadAllSafe doit signaler ce fichier en erreur sans jamais toucher au reste.
function ajouterFichierIllisible(ctx) {
  fs.writeFileSync(path.join(ctx.projectsDir, 'casse.md'), '---\nid: [oups\n---\n');
}

function cheminDemo(ctx) {
  return path.join(ctx.projectsDir, 'demo.md');
}

test('POST /api/ops applique et persiste', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'POST', url: '/api/ops'},
    {ops: [{op: 'add_task', projet: 'demo', titre: 'nouvelle', prio: 'P1'}]}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.applied.length, 1);
  const relu = repo.loadAll(ctx.projectsDir);
  assert.strictEqual(relu[0].taches.length, 2);
  assert.strictEqual(relu[0].taches[1].prio, 'P1');
});

test('POST /api/ops refuse une operation invalide sans rien ecrire', async () => {
  const ctx = contexte();
  const avant = fs.readFileSync(path.join(ctx.projectsDir, 'demo.md'), 'utf8');
  const r = await api.handle({method: 'POST', url: '/api/ops'},
    {ops: [{op: 'send_message', to: 'x'}]}, ctx);
  assert.strictEqual(r.json.applied.length, 0);
  assert.strictEqual(r.json.rejected.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(ctx.projectsDir, 'demo.md'), 'utf8'), avant);
});

test('POST /api/tache sans numero cree la tache', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'creee', statut: 'en_cours'}}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(repo.loadAll(ctx.projectsDir)[0].taches.length, 2);
});

test('POST /api/tache avec une reference met a jour', async () => {
  const ctx = contexte();
  await api.handle({method: 'POST', url: '/api/tache'},
    {ref: 'DE1', champs: {statut: 'fait'}}, ctx);
  assert.strictEqual(repo.loadAll(ctx.projectsDir)[0].taches[0].statut, 'fait');
});

test('DELETE /api/tache supprime', async () => {
  const ctx = contexte();
  await api.handle({method: 'DELETE', url: '/api/tache'}, {ref: 'DE1'}, ctx);
  assert.strictEqual(repo.loadAll(ctx.projectsDir)[0].taches.length, 0);
});

test('la reponse d ecriture renvoie l etat a jour', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'x'}}, ctx);
  assert.ok(r.json.etat.projects[0].severite);
});

test('POST /api/ops renvoie 409 et laisse le projet valide intact quand un fichier est illisible', async () => {
  const ctx = contexte();
  ajouterFichierIllisible(ctx);
  const avant = fs.readFileSync(cheminDemo(ctx));
  const r = await api.handle({method: 'POST', url: '/api/ops'},
    {ops: [{op: 'add_task', projet: 'demo', titre: 'nouvelle'}]}, ctx);
  assert.strictEqual(r.status, 409);
  const apres = fs.readFileSync(cheminDemo(ctx));
  assert.ok(avant.equals(apres), 'le fichier du projet valide doit rester inchange octet pour octet');
});

test('POST /api/tache renvoie 409 et laisse le projet valide intact quand un fichier est illisible', async () => {
  const ctx = contexte();
  ajouterFichierIllisible(ctx);
  const avant = fs.readFileSync(cheminDemo(ctx));
  const r = await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'nouvelle'}}, ctx);
  assert.strictEqual(r.status, 409);
  const apres = fs.readFileSync(cheminDemo(ctx));
  assert.ok(avant.equals(apres), 'le fichier du projet valide doit rester inchange octet pour octet');
});

test('DELETE /api/tache renvoie 409 et laisse le projet valide intact quand un fichier est illisible', async () => {
  const ctx = contexte();
  ajouterFichierIllisible(ctx);
  const avant = fs.readFileSync(cheminDemo(ctx));
  const r = await api.handle({method: 'DELETE', url: '/api/tache'}, {ref: 'DE1'}, ctx);
  assert.strictEqual(r.status, 409);
  const apres = fs.readFileSync(cheminDemo(ctx));
  assert.ok(avant.equals(apres), 'le fichier du projet valide doit rester inchange octet pour octet');
});

test('commit vaut true apres une ecriture reussie dans un depot Git', async () => {
  const ctx = contexteAvecDepotGit();
  const r = await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'nouvelle'}}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.commit, true);
});

// Avant le 22 septembre 2026, un contexte sans depot Git renvoyait commit false :
// la donnee etait ecrite mais jamais sauvegardee. C'etait precisement la panne. Le
// depot de donnees est desormais cree au premier usage, donc toute ecriture est
// versionnee, meme dans une installation neuve qui n'a jamais connu Git.
test('commit vaut true meme sans depot Git prealable, le depot de donnees etant cree', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'nouvelle'}}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.commit, true, 'l ecriture doit etre sauvegardee');
  assert.strictEqual(repo.loadAll(ctx.projectsDir)[0].taches.length, 2);
});

test('commit vaut null quand toutes les operations ont ete refusees', async () => {
  const ctx = contexteAvecDepotGit();
  const r = await api.handle({method: 'POST', url: '/api/ops'},
    {ops: [{op: 'send_message', to: 'x'}]}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.applied.length, 0);
  assert.strictEqual(r.json.commit, null);
});

test('POST /api/tache renvoie 400 sur un corps nul, tableau, chaine ou objet vide', async () => {
  const ctx = contexte();
  for (const corps of [null, [], 'texte', {}]) {
    const r = await api.handle({method: 'POST', url: '/api/tache'}, corps, ctx);
    assert.strictEqual(r.status, 400, 'corps refuse attendu pour ' + JSON.stringify(corps));
    assert.strictEqual(repo.loadAll(ctx.projectsDir)[0].taches.length, 1,
      'aucune ecriture ne doit avoir lieu pour ' + JSON.stringify(corps));
  }
});
