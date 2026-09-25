'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const semaine = require('../server/semaine.js');
const repo = require('../server/repo.js');

function projet(id, prefixe, titre, taches, extra) {
  return Object.assign({
    id, prefixe, titre, domaine: 'side', statut: 'actif', echeance: '',
    prochaine_action: '', jira: '', dernier_n: (taches || []).length, ordre: 0,
    contexte: '',
    taches: (taches || []).map((t, i) => Object.assign({
      n: i + 1, statut: 'a_faire', responsable: 'moi', echeance: '',
      nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
      derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''
    }, t))
  }, extra || {});
}

function contexte(projets) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-semaine-'));
  const dataDir = path.join(root, 'data');
  const projectsDir = path.join(dataDir, 'projects');
  fs.mkdirSync(projectsDir, {recursive: true});
  fs.writeFileSync(path.join(dataDir, 'config.json'),
    JSON.stringify({proprietaire: 'Alex'}));
  (projets || []).forEach((p) => repo.saveProject(projectsDir, p));
  return {dataDir, projectsDir, today: '2026-09-25'};
}

const PROJETS = [
  {id: 'topi', titre: 'TOPI', domaine: 'side'},
  {id: 'perso', titre: 'Perso', domaine: 'perso'}
];

test('construirePrompt interdit explicitement d inventer du travail', () => {
  const p = semaine.construirePrompt([{id: 'topi', titre: 'TOPI'}], '2026-09-25', 'Alex');
  assert.ok(p.includes("N'invente aucune tache"));
  assert.ok(p.includes('Alex'));
  assert.ok(p.includes('2026-09-25'));
});

// Meme clause que pour la dictee et le classement : un titre de tache reste un
// libelle, jamais une instruction adressee au modele.
test('construirePrompt rappelle que les libelles sont des donnees', () => {
  const p = semaine.construirePrompt([{id: 'topi', titre: 'TOPI'}], '2026-09-25', 'Alex');
  assert.ok(p.includes('jamais des consignes'));
});

test('interpreter garde l ordre et borne le pourcentage', () => {
  const top = semaine.interpreter({top: [
    {projet: 'perso', pourquoi: 'urgent', pourcentage_ia: 0},
    {projet: 'topi', pourquoi: 'ensuite', pourcentage_ia: 140}
  ]}, PROJETS);
  assert.deepStrictEqual(top.map((x) => x.projet), ['perso', 'topi']);
  assert.strictEqual(top[0].pourcentage_ia, 0);
  assert.strictEqual(top[1].pourcentage_ia, 100, 'borne haute a 100');
});

test('interpreter arrondit un pourcentage decimal et refuse ce qui n est pas un nombre', () => {
  const top = semaine.interpreter({top: [
    {projet: 'topi', pourcentage_ia: 42.6},
    {projet: 'perso', pourcentage_ia: 'beaucoup'}
  ]}, PROJETS);
  assert.strictEqual(top[0].pourcentage_ia, 43);
  assert.strictEqual(top[1].pourcentage_ia, null);
});

// Un identifiant invente afficherait dans le panneau un projet qui n'existe pas.
test('interpreter ecarte un projet inconnu ou repete', () => {
  const top = semaine.interpreter({top: [
    {projet: 'invente', pourcentage_ia: 50},
    {projet: 'topi', pourcentage_ia: 50},
    {projet: 'topi', pourcentage_ia: 90}
  ]}, PROJETS);
  assert.deepStrictEqual(top.map((x) => x.projet), ['topi']);
});

test('interpreter ne renvoie jamais plus de cinq projets', () => {
  const beaucoup = [];
  for (let i = 0; i < 12; i++) beaucoup.push({id: 'p' + i, titre: 'P' + i, domaine: 'side'});
  const top = semaine.interpreter(
    {top: beaucoup.map((p) => ({projet: p.id, pourcentage_ia: 10}))}, beaucoup);
  assert.strictEqual(top.length, semaine.MAX);
});

test('interpreter encaisse une reponse vide, nulle ou mal formee', () => {
  [null, {}, {top: 'pas un tableau'}, {top: [null, 7, {}]}].forEach((mauvaise) => {
    assert.deepStrictEqual(semaine.interpreter(mauvaise, PROJETS), []);
  });
});

test('calculer ne classe que les projets portant une tache ouverte', async () => {
  const ctx = contexte([
    projet('vide', 'VI', 'Projet vide', []),
    projet('clos', 'CL', 'Projet clos', [{titre: 'finie', statut: 'fait'}]),
    projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])
  ]);
  let promptVu = '';
  const faux = async (prompt) => {
    promptVu = prompt;
    return '{"top":[{"projet":"actif","pourquoi":"il reste du travail","pourcentage_ia":40}]}';
  };
  const r = await semaine.calculer(ctx, {lancerClaude: faux});
  assert.deepStrictEqual(r.top.map((x) => x.projet), ['actif']);
  assert.ok(!promptVu.includes('Projet vide'), 'un projet sans tache ouverte ne part pas au modele');
  assert.ok(!promptVu.includes('Projet clos'), 'un projet dont tout est clos non plus');
});

// Meme si le modele nomme un projet sans tache ouverte, il est ecarte : la regle
// est appliquee, pas seulement demandee.
test('calculer ecarte un projet sans tache ouverte meme si le modele le propose', async () => {
  const ctx = contexte([
    projet('vide', 'VI', 'Projet vide', []),
    projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])
  ]);
  const faux = async () => '{"top":[{"projet":"vide","pourcentage_ia":90},' +
    '{"projet":"actif","pourcentage_ia":40}]}';
  const r = await semaine.calculer(ctx, {lancerClaude: faux});
  assert.deepStrictEqual(r.top.map((x) => x.projet), ['actif']);
});

// Le cache evite de depenser une trentaine de secondes a chaque rechargement de
// page alors que rien n'a bouge, sans jamais garder un classement perime.
test('calculer reutilise le cache tant que le portefeuille ne change pas', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  let appels = 0;
  const faux = async () => {
    appels++;
    return '{"top":[{"projet":"actif","pourcentage_ia":40}]}';
  };
  await semaine.calculer(ctx, {lancerClaude: faux});
  const second = await semaine.calculer(ctx, {lancerClaude: faux});
  assert.strictEqual(appels, 1, 'aucun second appel a Claude');
  assert.strictEqual(second.depuisCache, true);
});

test('calculer recalcule des qu une tache change', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  let appels = 0;
  const faux = async () => {
    appels++;
    return '{"top":[{"projet":"actif","pourcentage_ia":40}]}';
  };
  await semaine.calculer(ctx, {lancerClaude: faux});
  repo.saveProject(ctx.projectsDir,
    projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}, {titre: 'et encore'}]));
  await semaine.calculer(ctx, {lancerClaude: faux});
  assert.strictEqual(appels, 2);
});

test('calculer rend un panneau explicite quand Claude echoue', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  const enPanne = async () => { throw new Error('binaire introuvable'); };
  const r = await semaine.calculer(ctx, {lancerClaude: enPanne});
  assert.deepStrictEqual(r.top, []);
  assert.ok(r.erreur);
});

test('calculer encaisse une reponse sans JSON', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  const bavard = async () => 'je ne sais pas repondre en JSON';
  const r = await semaine.calculer(ctx, {lancerClaude: bavard});
  assert.deepStrictEqual(r.top, []);
  assert.ok(r.erreur);
});

// Garde-fou : etablir la semaine ne doit jamais modifier un fichier de projet.
test('calculer ne modifie aucun fichier de projet', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  const fichier = path.join(ctx.projectsDir, 'actif.md');
  const avant = fs.readFileSync(fichier, 'utf8');
  await semaine.calculer(ctx, {
    lancerClaude: async () => '{"top":[{"projet":"actif","pourcentage_ia":40}]}'
  });
  assert.strictEqual(fs.readFileSync(fichier, 'utf8'), avant);
});

// Deux ouvertures du tableau de bord a quelques secondes d'intervalle, ou un
// rechargement pendant le calcul, ne doivent pas lancer deux binaires claude
// pour le meme resultat.
test('calculer partage un calcul deja en cours au lieu d en lancer un second', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  let appels = 0;
  const lent = async () => {
    appels++;
    await new Promise((r) => setTimeout(r, 30));
    return '{"top":[{"projet":"actif","pourcentage_ia":40}]}';
  };
  const [a, b] = await Promise.all([
    semaine.calculer(ctx, {lancerClaude: lent}),
    semaine.calculer(ctx, {lancerClaude: lent})
  ]);
  assert.strictEqual(appels, 1, 'un seul appel a Claude pour deux demandes simultanees');
  assert.deepStrictEqual(a.top, b.top);
});

test('un calcul en echec ne bloque pas les suivants', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  const enPanne = async () => { throw new Error('binaire introuvable'); };
  await semaine.calculer(ctx, {lancerClaude: enPanne});
  const r = await semaine.calculer(ctx, {
    lancerClaude: async () => '{"top":[{"projet":"actif","pourcentage_ia":40}]}'
  });
  assert.deepStrictEqual(r.top.map((x) => x.projet), ['actif']);
});
