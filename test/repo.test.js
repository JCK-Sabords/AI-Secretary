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
  const dataDir = tmpdir();
  fs.writeFileSync(path.join(dataDir, 'fichier.txt'), 'contenu');
  const ok = repo.commit(dataDir, 'ajout de fichier.txt');
  assert.strictEqual(ok, true);
  const sujet = execFileSync('git', ['log', '-1', '--format=%s'], {cwd: dataDir}).toString().trim();
  assert.strictEqual(sujet, 'ajout de fichier.txt');
  const compte = execFileSync('git', ['rev-list', '--count', 'HEAD'], {cwd: dataDir}).toString().trim();
  assert.strictEqual(compte, '1');
});

test('commit cree le depot de donnees au premier usage', () => {
  const dataDir = tmpdir();
  assert.strictEqual(fs.existsSync(path.join(dataDir, '.git')), false);
  fs.writeFileSync(path.join(dataDir, 'projet.md'), 'x');
  repo.commit(dataDir, 'premier commit');
  assert.strictEqual(fs.existsSync(path.join(dataDir, '.git')), true,
    'une installation neuve doit obtenir son depot de donnees sans rien faire');
});

test('commit sans rien a committer renvoie false sans lever', () => {
  const dataDir = tmpdir();
  fs.writeFileSync(path.join(dataDir, 'fichier.txt'), 'contenu');
  repo.commit(dataDir, 'premier');
  const ok = repo.commit(dataDir, 'rien de neuf');
  assert.strictEqual(ok, false);
});

test('commit sur un dossier vide ne leve pas et initialise le depot', () => {
  const dataDir = tmpdir();
  // La creation du depot y depose un .gitignore : il y a donc bien quelque chose
  // a commiter, et le premier commit reussit.
  assert.doesNotThrow(() => repo.commit(dataDir, 'dossier vide'));
  assert.strictEqual(fs.existsSync(path.join(dataDir, '.git')), true);
});

// Regression du 22 septembre 2026. Le depot du code ignore data/, pour que les
// donnees ne soient jamais publiees. Le commit automatique visait data/ depuis
// la racine du code et ne ramassait donc plus rien : plus aucune modification
// n'etait sauvegardee, sans aucun message d'erreur. Ce test reproduit exactement
// cette configuration et exige que les donnees soient bel et bien versionnees.
test('les donnees sont sauvegardees meme quand le depot du code ignore data/', () => {
  const codeDir = depotGitTemporaire();
  fs.writeFileSync(path.join(codeDir, '.gitignore'), 'data/\n');
  const dataDir = path.join(codeDir, 'data');
  fs.mkdirSync(path.join(dataDir, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(dataDir, 'projects', 'projet.md'), 'donnee a sauvegarder');

  const ok = repo.commit(dataDir, 'modification de tache');
  assert.strictEqual(ok, true, 'le commit de donnees doit reussir');

  const suivis = execFileSync('git', ['ls-files'], {cwd: dataDir}).toString();
  assert.match(suivis, /projects\/projet\.md/, 'la donnee doit etre versionnee dans le depot interne');

  const statutCode = execFileSync('git', ['status', '--porcelain'], {cwd: codeDir}).toString();
  assert.doesNotMatch(statutCode, /data/,
    'le depot du code ne doit toujours rien voir de data/, sans quoi les donnees partiraient au push');
});

test('commit ne ramasse jamais un fichier situe hors du dossier de donnees', () => {
  const racine = tmpdir();
  const dataDir = path.join(racine, 'data');
  fs.mkdirSync(dataDir, {recursive: true});
  fs.writeFileSync(path.join(dataDir, 'fichier.txt'), 'donnee');
  fs.writeFileSync(path.join(racine, 'parasite.txt'), 'travail en cours');
  assert.strictEqual(repo.commit(dataDir, 'ajout de donnees'), true);
  const suivis = execFileSync('git', ['ls-files'], {cwd: dataDir}).toString().trim().split('\n');
  assert.ok(suivis.includes('fichier.txt'));
  assert.ok(!suivis.some((f) => f.includes('parasite')), 'rien hors de data/ ne doit etre commite');
});

test('loadAll et loadAllSafe trient par ordre croissant puis par id a egalite', () => {
  const dir = tmpdir();
  repo.saveProject(dir, Object.assign(projetDemo(), {id: 'zebre', ordre: 1}));
  repo.saveProject(dir, Object.assign(projetDemo(), {id: 'alpha', ordre: 1}));
  repo.saveProject(dir, Object.assign(projetDemo(), {id: 'beta', ordre: 0}));

  const parOrdre = repo.loadAll(dir).map((p) => p.id);
  assert.deepStrictEqual(parOrdre, ['beta', 'alpha', 'zebre']);

  const parOrdreSafe = repo.loadAllSafe(dir).projects.map((p) => p.id);
  assert.deepStrictEqual(parOrdreSafe, ['beta', 'alpha', 'zebre']);
});
