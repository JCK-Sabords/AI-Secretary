'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dictee = require('../server/dictee');
const repo = require('../server/repo');
const api = require('../server/api');

/* ============================ construirePrompt ============================ */

function projetsExemple() {
  return [{id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side',
    statut: 'actif', echeance: '', prochaine_action: '', jira: '', dernier_n: 1,
    taches: [{n: 1, titre: 'contacter le notaire', statut: 'a_faire', responsable: 'moi',
      echeance: '', nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
      derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''}]}];
}

function personnesExemple() {
  return [{id: 'bruno', nom: 'Bruno Martin'}];
}

test('construirePrompt contient la demande de l utilisateur, la date du jour et les six operations', () => {
  const texte = 'ajoute une tache sur Estimmo : relancer le notaire, P2, pour le 20 septembre';
  const p = dictee.construirePrompt(projetsExemple(), personnesExemple(), texte, '2026-09-07', 'Alex');
  assert.ok(p.includes(texte), 'le prompt doit contenir la demande telle quelle');
  assert.ok(p.includes('2026-09-07'), 'le prompt doit contenir la date du jour');
  assert.ok(p.includes('add_task'), 'le prompt doit enumerer add_task');
  assert.ok(p.includes('update_task'), 'le prompt doit enumerer update_task');
  assert.ok(p.includes('delete_task'), 'le prompt doit enumerer delete_task');
  assert.ok(p.includes('add_project'), 'le prompt doit enumerer add_project');
  assert.ok(p.includes('update_project'), 'le prompt doit enumerer update_project');
  assert.ok(p.includes('delete_project'), 'le prompt doit enumerer delete_project');
});

// Le proprietaire n'est plus ecrit en dur dans construirePrompt (tache 16) : la
// fonction reste pure et prend le nom en parametre, pour que le depot soit
// installable par quelqu'un d'autre sans toucher au code.
test('construirePrompt cite le nom du proprietaire fourni en parametre', () => {
  const p1 = dictee.construirePrompt(
    projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.ok(p1.includes('Alex'), 'le prompt doit citer le proprietaire fourni');
  const p2 = dictee.construirePrompt(
    projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Dominique');
  assert.ok(p2.includes('Dominique'),
    'un autre proprietaire fourni doit apparaitre a son tour, la fonction est pure');
  assert.ok(!p2.includes('Alex'), 'le prompt ne doit jamais citer un nom non fourni');
});

test('construirePrompt interdit explicitement toute autre operation', () => {
  const p = dictee.construirePrompt(projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.match(p, /interdit|jamais/i);
});

test('construirePrompt liste les identifiants de personnes disponibles', () => {
  const p = dictee.construirePrompt(projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.ok(p.includes('bruno'), 'le prompt doit citer les identifiants de personnes');
});

test('construirePrompt embarque l etat serialise des projets (identifiant et titre)', () => {
  const p = dictee.construirePrompt(projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.ok(p.includes('estimmo'));
  assert.ok(p.includes('Estimmo'));
});

// Regression (revue finale, point I5) : la regle de confidentialite pro
// figurait deja dans CLAUDE.md et dans le prompt de l'agent hebdomadaire, mais
// pas dans celui-ci, ou domaine pro n'apparaissait que comme valeur fermee.

test('construirePrompt rappelle la regle de confidentialite pro (titre, statut, echeance uniquement)', () => {
  const p = dictee.construirePrompt(projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.match(p, /\bpro\b/i);
  assert.match(p, /detail metier/i);
  assert.match(p, /titre/i);
  assert.match(p, /statut/i);
  assert.match(p, /echeance/i);
});

test('construirePrompt demande une reponse uniquement en JSON {ops, message}', () => {
  const p = dictee.construirePrompt(projetsExemple(), personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.ok(p.includes('"ops"'));
  assert.ok(p.includes('"message"'));
});

// Regression (revue du 2026-09-07) : construirePrompt serialisait tout le
// portefeuille sans limite, alors que le prompt part comme argument unique de
// ligne de commande. On reduit d'abord ce qui est envoye, avant de borner.

test('construirePrompt n inclut pas le corps de contexte des projets', () => {
  const projets = projetsExemple();
  projets[0].contexte = 'notes privees et tres longues sur ce projet';
  const p = dictee.construirePrompt(projets, personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.ok(!p.includes('notes privees et tres longues'));
});

test('construirePrompt n inclut pas les taches deja closes (fait, abandonne)', () => {
  const projets = projetsExemple();
  projets[0].taches.push(
    {n: 2, titre: 'tache terminee', statut: 'fait', responsable: 'moi', echeance: '',
     nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
     derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''},
    {n: 3, titre: 'tache abandonnee', statut: 'abandonne', responsable: 'moi', echeance: '',
     nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
     derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''});
  const p = dictee.construirePrompt(projets, personnesExemple(), 'salut', '2026-09-07', 'Alex');
  assert.ok(!p.includes('tache terminee'));
  assert.ok(!p.includes('tache abandonnee'));
  assert.ok(p.includes('contacter le notaire'), 'la tache ouverte doit rester presente');
});

// Le portefeuille volumineux ci-dessous ne tiendrait pas sous la limite si les
// projets sans tache ouverte (contexte volumineux, taches toutes fait) n'etaient
// pas retires en priorite : ce test verifie a la fois la limite et la priorite.
test('construirePrompt reste sous la limite de taille sur un portefeuille volumineux', () => {
  function projetFerme(i) {
    return {id: 'ferme' + i, prefixe: 'F' + i, titre: 'Projet ferme ' + i, domaine: 'side',
      statut: 'actif', echeance: '', prochaine_action: '', jira: '', dernier_n: 1,
      contexte: 'vieilles notes '.repeat(80),
      taches: [{n: 1, titre: 'ancienne tache', statut: 'fait', responsable: 'moi', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '', maj_le: '2026-01-01', note_blocage: ''}]};
  }
  function projetActif(i) {
    return {id: 'actif' + i, prefixe: 'A' + i, titre: 'Projet actif ' + i, domaine: 'side',
      statut: 'actif', echeance: '', prochaine_action: 'faire', jira: '', dernier_n: 1,
      contexte: '',
      taches: [{n: 1, titre: 'tache ouverte ' + i, statut: 'a_faire', responsable: 'moi',
        echeance: '', nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''}]};
  }
  const projets = [];
  for (let i = 0; i < 500; i++) projets.push(projetFerme(i));
  for (let i = 0; i < 3; i++) projets.push(projetActif(i));
  const texte = 'ajoute une tache sur Projet actif 1 : verifier le dossier';
  const p = dictee.construirePrompt(projets, personnesExemple(), texte, '2026-09-07', 'Alex');
  assert.ok(p.length <= 24000, 'le prompt doit rester sous la limite (' + p.length + ' caracteres)');
  assert.ok(p.includes(texte), 'le prompt doit toujours contenir la demande de l utilisateur');
  assert.match(p, /tronque/, 'le prompt doit signaler explicitement la troncature');
  assert.ok(p.includes('actif1'), 'un projet avec tache ouverte doit rester dans la liste');
});

/* ============================ extraireJson ============================ */

test('extraireJson lit un JSON seul', () => {
  const r = dictee.extraireJson('{"ops":[{"op":"add_task","projet":"demo"}],"message":"fait"}');
  assert.deepStrictEqual(r.ops, [{op: 'add_task', projet: 'demo'}]);
  assert.strictEqual(r.message, 'fait');
});

test('extraireJson retrouve le JSON entoure de texte libre', () => {
  const sortie = "Bien sur, voici ce que je propose :\n" +
    '{"ops":[{"op":"delete_project","projet":"demo"}],"message":"projet supprime"}' +
    '\nDis-moi si ca ne convient pas.';
  const r = dictee.extraireJson(sortie);
  assert.deepStrictEqual(r.ops, [{op: 'delete_project', projet: 'demo'}]);
  assert.strictEqual(r.message, 'projet supprime');
});

test('extraireJson retrouve le JSON dans un bloc de code Markdown', () => {
  const sortie = 'Voici le resultat :\n```json\n{"ops":[],"message":"rien a faire"}\n```\nMerci.';
  const r = dictee.extraireJson(sortie);
  assert.deepStrictEqual(r.ops, []);
  assert.strictEqual(r.message, 'rien a faire');
});

test('extraireJson renvoie un tableau ops vide quand la cle est absente', () => {
  const r = dictee.extraireJson('{"message":"aucune operation"}');
  assert.deepStrictEqual(r.ops, []);
  assert.strictEqual(r.message, 'aucune operation');
});

test('extraireJson leve une erreur en francais sur une sortie sans JSON exploitable', () => {
  assert.throws(() => dictee.extraireJson('desole, je ne comprends pas cette demande.'),
    /JSON/);
});

// Regression (revue du 2026-09-07) : extraireJson ne retenait que le tout premier
// bloc d'accolades equilibre. Un exemple ecrit avant la vraie reponse (frequent
// chez un modele de langage) faisait alors reussir la dictee en silence, sans rien
// appliquer et sans avertir l'utilisateur : plus trompeur qu'une erreur franche.

test('extraireJson ignore un exemple JSON qui precede la vraie reponse', () => {
  const sortie = 'voici un exemple : {"exemple": true} et voici le resultat : ' +
    '{"ops":[{"op":"add_task","projet":"demo"}],"message":"tache ajoutee"}';
  const r = dictee.extraireJson(sortie);
  assert.deepStrictEqual(r.ops, [{op: 'add_task', projet: 'demo'}]);
  assert.strictEqual(r.message, 'tache ajoutee');
});

test('extraireJson retient la premiere reponse valide quand deux se suivent', () => {
  const sortie = '{"ops":[{"op":"add_task","projet":"un"}],"message":"premiere"} ' +
    '{"ops":[{"op":"add_task","projet":"deux"}],"message":"seconde"}';
  const r = dictee.extraireJson(sortie);
  assert.deepStrictEqual(r.ops, [{op: 'add_task', projet: 'un'}]);
  assert.strictEqual(r.message, 'premiere');
});

test('extraireJson ignore un bloc non pertinent suivi d un bloc valide dans un bloc de code Markdown', () => {
  const sortie = 'Voici le resultat :\n```json\n{"exemple": true} ' +
    '{"ops":[],"message":"rien a faire"}\n```\nMerci.';
  const r = dictee.extraireJson(sortie);
  assert.deepStrictEqual(r.ops, []);
  assert.strictEqual(r.message, 'rien a faire');
});

/* ============================ traiterSortieProcessus ============================ */
/* Fonction pure isolant la traduction du resultat brut d'execFile : chaque cas est
   teste avec des objets err/stdout fabriques a la main, sans jamais lancer de
   processus, reel ou factice. */

test('traiterSortieProcessus leve une cause binaire_absent quand execFile signale ENOENT', () => {
  assert.throws(() => dictee.traiterSortieProcessus({code: 'ENOENT'}, ''),
    (e) => { assert.strictEqual(e.cause, 'binaire_absent'); return true; });
});

test('traiterSortieProcessus leve une cause delai_depasse quand le processus a ete tue', () => {
  assert.throws(() => dictee.traiterSortieProcessus({killed: true, signal: 'SIGTERM'}, ''),
    (e) => { assert.strictEqual(e.cause, 'delai_depasse'); return true; });
});

// Regression (revue du 2026-09-07) : un depassement de maxBuffer (sortie trop
// volumineuse) tombait auparavant dans la meme cause delai_depasse qu'un vrai
// depassement de delai, alors que Node distingue les deux (voir le code
// ERR_CHILD_PROCESS_STDIO_MAXBUFFER, sans killed ni signal, verifie a la main).
test('traiterSortieProcessus leve une cause sortie_trop_volumineuse distincte, quand la sortie depasse maxBuffer', () => {
  assert.throws(
    () => dictee.traiterSortieProcessus({code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'}, ''),
    (e) => {
      assert.strictEqual(e.cause, 'sortie_trop_volumineuse');
      assert.notStrictEqual(e.cause, 'delai_depasse');
      assert.match(e.message, /volumineuse/);
      return true;
    });
});

test('traiterSortieProcessus leve une cause echec sur un code de retour non nul', () => {
  assert.throws(() => dictee.traiterSortieProcessus({code: 1, killed: false}, ''),
    (e) => { assert.strictEqual(e.cause, 'echec'); return true; });
});

test('traiterSortieProcessus leve une cause sortie_vide quand stdout est vide ou blanc', () => {
  assert.throws(() => dictee.traiterSortieProcessus(null, '   \n'),
    (e) => { assert.strictEqual(e.cause, 'sortie_vide'); return true; });
});

test('traiterSortieProcessus renvoie la sortie nettoyee quand tout va bien', () => {
  const r = dictee.traiterSortieProcessus(null, '  {"ops":[],"message":"ok"}  \n');
  assert.strictEqual(r, '{"ops":[],"message":"ok"}');
});

/* ============================ argumentsClaude ============================ */
/* Regression (revue du 2026-09-07) : claude -p etait lance sans TTY interactif et
   sans aucune restriction sur l'usage d'outils. Si le modele avait demande a en
   utiliser un, le processus n'aurait eu aucun moyen de recevoir une approbation.
   --tools "" (verifie dans `claude -p --help`, version installee sur ce poste) est
   documente pour desactiver tous les outils, ce qui rend impossible toute demande
   d'approbation : il n'existe plus rien a approuver. Fonction pure : ne lance
   jamais le vrai binaire. */

test('argumentsClaude interdit explicitement l usage de tout outil (--tools "")', () => {
  const args = dictee.argumentsClaude('un prompt');
  const i = args.indexOf('--tools');
  assert.notStrictEqual(i, -1, '--tools doit etre present');
  assert.strictEqual(args[i + 1], '', '--tools doit desactiver tous les outils (valeur vide)');
});

test('argumentsClaude conserve -p et transmet le prompt tel quel', () => {
  const args = dictee.argumentsClaude('un prompt avec des "guillemets"');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('un prompt avec des "guillemets"'));
});

/* Regression (constatee en conditions reelles le 2026-09-15) : la forme
   ['-p', '--tools', '', prompt] echouait avec "Input must be provided either
   through stdin or as a prompt argument". `--tools` est variadique : il avalait le
   prompt comme un nom d'outil. Le prompt doit preceder tout drapeau variadique. */
test('argumentsClaude place le prompt avant --tools, qui est variadique', () => {
  const prompt = 'ajoute une tache sur Estimmo';
  const args = dictee.argumentsClaude(prompt);
  assert.ok(args.indexOf(prompt) < args.indexOf('--tools'),
    'le prompt doit preceder --tools, sinon il est avale comme nom d outil');
  assert.strictEqual(args[args.indexOf('-p') + 1], prompt,
    'le prompt doit suivre immediatement -p');
});

/* ============================ resoudreBinaireClaude ============================ */

test('resoudreBinaireClaude renvoie "claude" tel quel hors Windows', () => {
  assert.strictEqual(dictee.resoudreBinaireClaude({PATH: '/usr/bin'}, 'linux'), 'claude');
});

test('resoudreBinaireClaude retrouve l executable reference par le shim .cmd sur Windows (chemin litteral)', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-shim-'));
  const exeFictif = path.join(dossier, 'claude-reel.exe');
  fs.writeFileSync(exeFictif, '');
  fs.writeFileSync(path.join(dossier, 'claude.cmd'),
    '@ECHO off\r\n"' + exeFictif + '"   %*\r\n');
  const r = dictee.resoudreBinaireClaude({PATH: dossier}, 'win32');
  assert.strictEqual(r, exeFictif);
});

// Reproduit fidelement le shim tel que genere par npm sur ce poste (verifie a la
// main dans AppData\Roaming\npm\claude.cmd) : il ne reference jamais un chemin
// litteral, mais la variable de commande %dp0% (equivalent a %~dp0, deja terminee
// par un antislash). C'est ce cas reel, pas le chemin litteral ci-dessus, qui a
// echoue lors de la verification manuelle avant ce correctif.
test('resoudreBinaireClaude resout %dp0% comme le fait le shim reel genere par npm', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-shim-dp0-'));
  const sousDossier = path.join(dossier, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
  fs.mkdirSync(sousDossier, {recursive: true});
  const exeFictif = path.join(sousDossier, 'claude.exe');
  fs.writeFileSync(exeFictif, '');
  fs.writeFileSync(path.join(dossier, 'claude.cmd'),
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\n' +
    'SETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
  const r = dictee.resoudreBinaireClaude({PATH: dossier}, 'win32');
  assert.ok(fs.existsSync(r), 'le chemin resolu doit exister reellement sur le disque : ' + r);
  assert.match(r, /claude\.exe$/);
});

test('resoudreBinaireClaude se rabat sur "claude.exe" quand aucun shim n est trouve sur Windows', () => {
  const dossierVide = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-shim-vide-'));
  const r = dictee.resoudreBinaireClaude({PATH: dossierVide}, 'win32');
  assert.strictEqual(r, 'claude.exe');
});

/* ============================ dicter ============================ */
/* dicter est teste avec un faux lanceur injecte via ctx.lancerClaude : aucun de ces
   tests ne lance jamais le vrai binaire claude, ni aucun processus. */

function contexteProjet() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-dictee-'));
  const projectsDir = path.join(root, 'data', 'projects');
  repo.saveProject(projectsDir, {id: 'estimmo', prefixe: 'ES', titre: 'Estimmo',
    domaine: 'side', statut: 'actif', echeance: '', prochaine_action: '', jira: '',
    dernier_n: 0, contexte: '', taches: []});
  return {root, projectsDir, dataDir: path.join(root, 'data'), today: '2026-09-07'};
}

test('dicter construit le prompt a partir de l etat reel puis renvoie ops et message du faux lanceur', async () => {
  const ctx = contexteProjet();
  let promptVu = null;
  ctx.lancerClaude = async (prompt) => {
    promptVu = prompt;
    return '{"ops":[{"op":"add_task","projet":"estimmo","titre":"relancer le notaire"}],' +
      '"message":"tache ajoutee"}';
  };
  const r = await dictee.dicter('ajoute une tache sur Estimmo : relancer le notaire', ctx);
  assert.deepStrictEqual(r.ops,
    [{op: 'add_task', projet: 'estimmo', titre: 'relancer le notaire'}]);
  assert.strictEqual(r.message, 'tache ajoutee');
  assert.ok(promptVu.includes('estimmo'), 'le prompt vu par le faux lanceur doit citer le projet reel');
  assert.ok(promptVu.includes('ajoute une tache sur Estimmo'));
});

test('dicter propage l erreur causee quand le faux lanceur echoue', async () => {
  const ctx = contexteProjet();
  ctx.lancerClaude = async () => {
    const e = new Error("le binaire claude est introuvable sur ce poste");
    e.cause = 'binaire_absent';
    throw e;
  };
  await assert.rejects(() => dictee.dicter('salut', ctx),
    (e) => { assert.strictEqual(e.cause, 'binaire_absent'); return true; });
});

test('dicter propage l erreur d extraireJson quand le faux lanceur renvoie une sortie sans JSON', async () => {
  const ctx = contexteProjet();
  ctx.lancerClaude = async () => 'je ne sais pas repondre a cela.';
  await assert.rejects(() => dictee.dicter('salut', ctx), /JSON/);
});

/* ============================ POST /api/dictee ============================ */
/* Meme regle que pour dicter : ctx.lancerClaude est toujours un faux lanceur ici,
   jamais le vrai binaire claude. Ces tests verifient que la route passe bien par
   appliquer (donc par store.applyOps), et rien d'autre. */

function cheminEstimmo(ctx) {
  return path.join(ctx.projectsDir, 'estimmo.md');
}

test('POST /api/dictee renvoie 400 et n ecrit rien quand le corps n a pas de texte', async () => {
  const ctx = contexteProjet();
  const avant = fs.readFileSync(cheminEstimmo(ctx));
  const r = await api.handle({method: 'POST', url: '/api/dictee'}, {}, ctx);
  assert.strictEqual(r.status, 400);
  assert.ok(fs.readFileSync(cheminEstimmo(ctx)).equals(avant));
});

test('POST /api/dictee renvoie 400 sur un texte vide ou uniquement des espaces', async () => {
  const ctx = contexteProjet();
  for (const texte of ['', '   ']) {
    const r = await api.handle({method: 'POST', url: '/api/dictee'}, {texte}, ctx);
    assert.strictEqual(r.status, 400, 'attendu pour ' + JSON.stringify(texte));
  }
});

test('POST /api/dictee applique les operations renvoyees par Claude et ecrit sur le disque', async () => {
  const ctx = contexteProjet();
  ctx.lancerClaude = async () => JSON.stringify({
    ops: [{op: 'add_task', projet: 'estimmo', titre: 'relancer le notaire', prio: 'P2',
      echeance: '2026-09-20'}],
    message: "j'ai ajoute la tache relancer le notaire sur Estimmo"
  });
  const r = await api.handle({method: 'POST', url: '/api/dictee'}, {texte: 'ajoute une tache'}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.applied.length, 1);
  assert.strictEqual(r.json.message, "j'ai ajoute la tache relancer le notaire sur Estimmo");
  const relu = repo.loadAll(ctx.projectsDir);
  assert.strictEqual(relu[0].taches.length, 1);
  assert.strictEqual(relu[0].taches[0].titre, 'relancer le notaire');
  assert.strictEqual(relu[0].taches[0].prio, 'P2');
  assert.strictEqual(relu[0].taches[0].echeance, '2026-09-20');
});

test('POST /api/dictee renvoie 503 et n ecrit rien quand Claude ne peut pas etre interroge', async () => {
  const ctx = contexteProjet();
  const avant = fs.readFileSync(cheminEstimmo(ctx));
  ctx.lancerClaude = async () => {
    const e = new Error('le binaire claude est introuvable sur ce poste');
    e.cause = 'binaire_absent';
    throw e;
  };
  const r = await api.handle({method: 'POST', url: '/api/dictee'}, {texte: 'salut'}, ctx);
  assert.strictEqual(r.status, 503);
  assert.match(r.json.erreur, /Claude/);
  assert.ok(fs.readFileSync(cheminEstimmo(ctx)).equals(avant));
});

test('POST /api/dictee ne cree aucune voie d ecriture privilegiee : une operation non autorisee reste rejetee', async () => {
  const ctx = contexteProjet();
  const avant = fs.readFileSync(cheminEstimmo(ctx));
  ctx.lancerClaude = async () => JSON.stringify({
    ops: [{op: 'send_message', to: 'bruno', texte: 'salut'}],
    message: "j'ai envoye le message"
  });
  const r = await api.handle({method: 'POST', url: '/api/dictee'}, {texte: 'envoie un message'}, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.applied.length, 0);
  assert.strictEqual(r.json.rejected.length, 1);
  assert.match(r.json.rejected[0], /non autorisee/);
  assert.ok(fs.readFileSync(cheminEstimmo(ctx)).equals(avant));
});
