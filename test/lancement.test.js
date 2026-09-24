'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lancement = require('../server/lancement.js');
const repo = require('../server/repo.js');

const CHAT = '!fil:beeper.local';

function contexte(projets, configExtra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-lancement-'));
  const dataDir = path.join(root, 'data');
  const projectsDir = path.join(dataDir, 'projects');
  fs.mkdirSync(projectsDir, {recursive: true});
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(Object.assign(
    {proprietaire: 'Alex', filNoteASoiMeme: '', filTachesWhatsApp: CHAT}, configExtra || {})));
  (projets || []).forEach((p) => repo.saveProject(projectsDir, p));
  return {root, dataDir, projectsDir};
}

function projet(id, prefixe, titre, taches) {
  return {
    id, prefixe, titre, domaine: 'side', statut: 'actif', echeance: '',
    prochaine_action: '', jira: '', dernier_n: (taches || []).length, ordre: 0,
    contexte: '',
    taches: (taches || []).map((t, i) => Object.assign({
      n: i + 1, statut: 'a_faire', responsable: 'moi', echeance: '',
      nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
      derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''
    }, t))
  };
}

// Faux lecteur de messages : rend la meme forme que beeper.messages, du plus
// recent au plus ancien.
function messages(liste) {
  return async () => liste.map((m, i) => Object.assign({
    id: String(100 - i), timestamp: '2026-09-2' + (9 - i) + 'T10:00:00.000Z',
    type: 'TEXT', deMoi: true, supprime: false
  }, m));
}

function ul(lignes) {
  return '<ul>' + lignes.map((l) => '<li>' + l + '</li>').join('') + '</ul>';
}

test('analyser est inactif quand aucun fil n est configure', async () => {
  const ctx = contexte([], {filTachesWhatsApp: ''});
  const r = await lancement.analyser(ctx);
  assert.strictEqual(r.actif, false);
  assert.strictEqual(r.raison, 'non_configure');
});

test('analyser reste inactif, sans lever, quand Beeper est injoignable', async () => {
  const ctx = contexte([]);
  ctx.lireMessages = async () => { throw new Error('Beeper injoignable'); };
  const r = await lancement.analyser(ctx);
  assert.strictEqual(r.actif, false);
  assert.strictEqual(r.raison, 'beeper_indisponible');
});

test('analyser repere les taches faites et les taches a creer', async () => {
  const ctx = contexte([
    projet('topi', 'TO', 'TOPI', [{titre: 'TOPI FAM - faire page presse'}]),
    projet('autre', 'AU', 'Autre', [{titre: 'Passer PSPO 2'}])
  ]);
  ctx.lireMessages = messages([
    {texte: ul(['Passer PSPO 2', 'vendre BTC', 'Organiser anniversaire'])},
    {texte: ul(['Passer PSPO 2', 'TOPI FAM - faire page presse - 21 sept',
      'vendre BTC', 'Organiser anniversaire'])}
  ]);

  const r = await lancement.analyser(ctx);
  assert.strictEqual(r.actif, true);
  assert.deepStrictEqual(r.aRetirer.map((x) => x.ref), ['TO1']);
  assert.strictEqual(r.aRetirer[0].projet, 'TOPI');
  assert.deepStrictEqual(r.aAjouter.map((x) => x.ligne),
    ['vendre BTC', 'Organiser anniversaire']);
});

// Une ligne disparue qui ne correspond a aucune tache du portefeuille ne doit
// rien declencher : elle n'y a jamais ete, ou elle y est deja close.
test('analyser ignore une ligne disparue qui ne correspond a aucune tache', async () => {
  const ctx = contexte([projet('autre', 'AU', 'Autre', [{titre: 'Passer PSPO 2'}])]);
  ctx.lireMessages = messages([
    {texte: ul(['Passer PSPO 2', 'vendre or', 'vendre BTC'])},
    {texte: ul(['Passer PSPO 2', 'vendre or', 'vendre BTC', 'acheter un manteau'])}
  ]);
  const r = await lancement.analyser(ctx);
  assert.deepStrictEqual(r.aRetirer, []);
});

// Les messages qui ne sont pas des listes (un lien, une note) sont ignores : la
// comparaison doit porter sur les deux dernieres vraies listes, meme si un autre
// message s'est glisse entre elles.
test('analyser compare les deux dernieres listes en ignorant les autres messages', async () => {
  const ctx = contexte([projet('autre', 'AU', 'Autre', [{titre: 'Passer PSPO 2'}])]);
  ctx.lireMessages = messages([
    {texte: ul(['vendre or', 'vendre BTC', 'Organiser anniversaire'])},
    {texte: 'https://exemple.test/page'},
    {texte: ul(['Passer PSPO 2', 'vendre or', 'vendre BTC', 'Organiser anniversaire'])}
  ]);
  const r = await lancement.analyser(ctx);
  assert.deepStrictEqual(r.aRetirer.map((x) => x.ref), ['AU1']);
});

test('analyser ne propose aucune suppression quand il n existe qu une seule liste', async () => {
  const ctx = contexte([projet('autre', 'AU', 'Autre', [{titre: 'Passer PSPO 2'}])]);
  ctx.lireMessages = messages([{texte: ul(['vendre or', 'vendre BTC', 'Organiser anniversaire'])}]);
  const r = await lancement.analyser(ctx);
  assert.strictEqual(r.actif, true);
  assert.deepStrictEqual(r.aRetirer, []);
  assert.strictEqual(r.comparaisonAvec, null);
});

test('analyser est inactif quand le fil ne contient aucune liste', async () => {
  const ctx = contexte([]);
  ctx.lireMessages = messages([{texte: 'Coherence cardiaque avant repas'}]);
  const r = await lancement.analyser(ctx);
  assert.strictEqual(r.actif, false);
  assert.strictEqual(r.raison, 'aucune_liste');
});

// Le coeur de l'idempotence : une fois le message traite, quelle qu'ait ete la
// reponse du proprietaire, la meme proposition ne revient pas a l'ouverture
// suivante. Sans cela, un « Retablir » serait defait a chaque lancement.
test('analyser ne repropose pas un message deja traite', async () => {
  const ctx = contexte([projet('topi', 'TO', 'TOPI', [{titre: 'TOPI FAM - faire page presse'}])]);
  ctx.lireMessages = messages([
    {texte: ul(['Passer PSPO 2', 'vendre BTC', 'Organiser anniversaire'])},
    {texte: ul(['Passer PSPO 2', 'TOPI FAM - faire page presse',
      'vendre BTC', 'Organiser anniversaire'])}
  ]);

  const premier = await lancement.analyser(ctx);
  assert.strictEqual(premier.actif, true);
  assert.strictEqual(premier.aRetirer.length, 1);

  lancement.ecrireEtat(ctx.dataDir, premier.messageId);

  const second = await lancement.analyser(ctx);
  assert.strictEqual(second.actif, false);
  assert.strictEqual(second.raison, 'deja_traite');
});

test('lireEtat repart d un etat vide sur un fichier absent ou illisible', () => {
  const ctx = contexte([]);
  assert.deepStrictEqual(lancement.lireEtat(ctx.dataDir), {dernierMessageTraite: ''});
  fs.mkdirSync(path.join(ctx.dataDir, 'history'), {recursive: true});
  fs.writeFileSync(path.join(ctx.dataDir, 'history', lancement.FICHIER_ETAT), 'pas du json');
  assert.deepStrictEqual(lancement.lireEtat(ctx.dataDir), {dernierMessageTraite: ''});
});

// Garde-fou : ce module propose, il n'ecrit jamais dans les projets. Un fichier
// de projet modifie par une simple analyse serait une regression grave.
test('analyser ne modifie aucun fichier de projet', async () => {
  const ctx = contexte([projet('topi', 'TO', 'TOPI', [{titre: 'TOPI FAM - faire page presse'}])]);
  ctx.lireMessages = messages([
    {texte: ul(['Passer PSPO 2', 'vendre BTC', 'Organiser anniversaire'])},
    {texte: ul(['Passer PSPO 2', 'TOPI FAM - faire page presse',
      'vendre BTC', 'Organiser anniversaire'])}
  ]);
  const fichier = path.join(ctx.projectsDir, 'topi.md');
  const avant = fs.readFileSync(fichier, 'utf8');
  await lancement.analyser(ctx);
  assert.strictEqual(fs.readFileSync(fichier, 'utf8'), avant);
});
