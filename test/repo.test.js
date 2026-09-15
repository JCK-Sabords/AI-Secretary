const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const repo = require('../server/repo');
const store = require('../server/store');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-'));
}
function projetDemo() {
  return {id: 'demo', prefixe: 'DE', titre: 'Demo', domaine: 'side', statut: 'actif',
    echeance: '', prochaine_action: 'faire', jira: '', dernier_n: 0,
    taches: [], contexte: '## Contexte\nrien'};
}
function depotGitTemporaire() {
  const dir = tmpdir();
  execFileSync('git', ['init', '-q'], {cwd: dir, stdio: 'ignore'});
  execFileSync('git', ['config', 'user.name', 'Secretaire Test'], {cwd: dir, stdio: 'ignore'});
  execFileSync('git', ['config', 'user.email', 'secretaire-test@example.com'], {cwd: dir, stdio: 'ignore'});
  return dir;
}

test('saveProject puis loadAll fait un aller-retour fidele', () => {
  const dir = tmpdir();
  repo.saveProject(dir, projetDemo());
  const lus = repo.loadAll(dir);
  assert.strictEqual(lus.length, 1);
  assert.strictEqual(lus[0].id, 'demo');
  assert.strictEqual(lus[0].prochaine_action, 'faire');
});

test('loadAll ignore les fichiers hors .md', () => {
  const dir = tmpdir();
  repo.saveProject(dir, projetDemo());
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'bruit');
  assert.strictEqual(repo.loadAll(dir).length, 1);
});

test('loadAll signale un fichier illisible sans perdre les autres', () => {
  const dir = tmpdir();
  repo.saveProject(dir, projetDemo());
  fs.writeFileSync(path.join(dir, 'casse.md'), '---\nid: [oups\n---\n');
  const res = repo.loadAllSafe(dir);
  assert.strictEqual(res.projects.length, 1);
  assert.strictEqual(res.errors.length, 1);
  assert.match(res.errors[0].fichier, /casse\.md/);
});

test('saveProject restaure le fichier si la relecture echoue', () => {
  const dir = tmpdir();
  repo.saveProject(dir, projetDemo());
  const avant = fs.readFileSync(path.join(dir, 'demo.md'), 'utf8');
  const casse = projetDemo();
  // n doit etre un nombre : le fichier s ecrit, mais la relecture le rejette
  casse.taches = [{n: 'pas-un-nombre', titre: 'x'}];
  assert.throws(() => repo.saveProject(dir, casse), store.InvalidProjectError);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'demo.md'), 'utf8'), avant,
    'le fichier d origine doit etre restaure a l identique');
});

test('saveProject refuse un identifiant de traversee et n ecrit aucun fichier', () => {
  const dir = tmpdir();
  const projet = projetDemo();
  projet.id = '../../evil';
  assert.throws(() => repo.saveProject(dir, projet), store.InvalidProjectError);
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'rien n a ete ecrit dans le dossier cible');
  const cheminTraversee = path.resolve(dir, '../../evil.md');
  assert.strictEqual(fs.existsSync(cheminTraversee), false,
    'rien n a ete ecrit au-dessus du dossier cible');
});

test('saveAll n ecrit rien du tout si un projet de la liste est invalide, meme les projets valides qui le precedent', () => {
  const dir = tmpdir();
  const valide = projetDemo();
  valide.id = 'valide';
  const invalide = projetDemo();
  invalide.id = '../../evil';
  assert.throws(() => repo.saveAll(dir, [valide, invalide]), store.InvalidProjectError);
  assert.strictEqual(fs.readdirSync(dir).length, 0,
    'aucun fichier ecrit, y compris celui du projet valide qui precede dans la liste');
});

// Regression (revue finale, point I4) : saveAll supprimait tout fichier .md
// absent de l instantane recu, y compris un fichier apparu entre la lecture et
// cette ecriture (par exemple un projet cree par l agent hebdomadaire pendant
// qu un cycle d ecriture du serveur etait en cours). Sans un troisieme
// parametre (idsConnus), un tel fichier est desormais toujours laisse intact.

test('saveAll ne supprime jamais un fichier apparu apres le chargement de l instantane', () => {
  const dir = tmpdir();
  const p1 = projetDemo(); p1.id = 'p1';
  repo.saveProject(dir, p1);
  const idsConnus = repo.loadAllSafe(dir).projects.map((p) => p.id);

  // Un second processus (par exemple l agent hebdomadaire, qui ne commite
  // jamais) cree un nouveau projet entre la lecture et l ecriture de ce
  // cycle-ci.
  const p2 = projetDemo(); p2.id = 'p2';
  repo.saveProject(dir, p2);

  // Le cycle en cours ne connait toujours que p1 (charge avant l apparition de
  // p2) : il sauvegarde une version modifiee de p1 seul, sans p2 dans la liste.
  const p1Modifie = Object.assign({}, p1, {prochaine_action: 'modifie'});
  repo.saveAll(dir, [p1Modifie], idsConnus);

  assert.strictEqual(fs.existsSync(path.join(dir, 'p2.md')), true,
    'le fichier apparu entre temps doit survivre a saveAll');
  const relus = repo.loadAll(dir);
  assert.strictEqual(relus.length, 2);
  assert.strictEqual(relus.find((p) => p.id === 'p1').prochaine_action, 'modifie');
  assert.strictEqual(relus.find((p) => p.id === 'p2').id, 'p2');
});

test('saveAll supprime un fichier connu au chargement et absent de la nouvelle liste (delete_project)', () => {
  const dir = tmpdir();
  const p1 = projetDemo(); p1.id = 'p1';
  const p2 = projetDemo(); p2.id = 'p2';
  repo.saveProject(dir, p1);
  repo.saveProject(dir, p2);
  const idsConnus = repo.loadAllSafe(dir).projects.map((p) => p.id);

  // p2 est supprime de la nouvelle liste : il etait bien connu au chargement,
  // donc son fichier doit disparaitre.
  repo.saveAll(dir, [p1], idsConnus);

  assert.strictEqual(fs.existsSync(path.join(dir, 'p2.md')), false,
    'un projet connu et retire de la liste doit toujours etre supprime');
  assert.strictEqual(fs.existsSync(path.join(dir, 'p1.md')), true);
});

test('saveAll ne supprime jamais rien quand idsConnus est omis', () => {
  const dir = tmpdir();
  const p1 = projetDemo(); p1.id = 'p1';
  const p2 = projetDemo(); p2.id = 'p2';
  repo.saveProject(dir, p1);
  repo.saveProject(dir, p2);

  repo.saveAll(dir, [p1]); // idsConnus omis : comportement sur par defaut

  assert.strictEqual(fs.existsSync(path.join(dir, 'p2.md')), true,
    'sans idsConnus, aucun fichier ne doit etre suppose supprimable');
});

test('commit reussi renvoie true et cree un commit verifiable', () => {
  const dir = depotGitTemporaire();
  fs.mkdirSync(path.join(dir, 'data'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'data', 'fichier.txt'), 'contenu');
  const ok = repo.commit(dir, 'ajout de fichier.txt');
  assert.strictEqual(ok, true);
  const sujet = execFileSync('git', ['log', '-1', '--format=%s'], {cwd: dir}).toString().trim();
  assert.strictEqual(sujet, 'ajout de fichier.txt');
  const compte = execFileSync('git', ['rev-list', '--count', 'HEAD'], {cwd: dir}).toString().trim();
  assert.strictEqual(compte, '1');
});

test('commit sans rien a committer renvoie false sans lever', () => {
  const dir = depotGitTemporaire();
  const ok = repo.commit(dir, 'rien a committer');
  assert.strictEqual(ok, false);
});

test('commit dans un dossier qui n est pas un depot git renvoie false sans lever', () => {
  const dir = tmpdir();
  const ok = repo.commit(dir, 'peu importe');
  assert.strictEqual(ok, false);
});

test('commit ne ramasse que le dossier data, jamais un fichier parasite a la racine', () => {
  const dir = depotGitTemporaire();
  fs.mkdirSync(path.join(dir, 'data'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'data', 'fichier.txt'), 'contenu de donnees');
  fs.writeFileSync(path.join(dir, 'parasite.txt'), 'travail en cours, ne doit pas partir');
  const ok = repo.commit(dir, 'ajout de donnees');
  assert.strictEqual(ok, true);
  const suivis = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {cwd: dir})
    .toString().trim().split('\n');
  assert.ok(suivis.includes('data/fichier.txt'), 'le fichier de donnees doit etre dans le commit');
  assert.ok(!suivis.includes('parasite.txt'), 'le fichier parasite ne doit pas etre dans le commit');
  const statut = execFileSync('git', ['status', '--porcelain'], {cwd: dir}).toString();
  assert.match(statut, /\?\? parasite\.txt/,
    'le fichier parasite doit rester non suivi apres le commit');
});
