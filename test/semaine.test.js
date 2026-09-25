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

// Taches telles que tachesPourPrompt les produit : une liste a plat, chacune
// portant sa reference et son projet.
const TACHES = [
  {ref: 'TO1', titre: 'Refaire le site', projet: 'topi', projetTitre: 'TOPI',
    prio: 'P2', echeance: ''},
  {ref: 'PE1', titre: 'Rendez-vous medical', projet: 'perso', projetTitre: 'Perso',
    prio: 'P1', echeance: '2026-09-26'}
];

test('construirePrompt interdit explicitement d inventer du travail', () => {
  const p = semaine.construirePrompt(TACHES, '2026-09-25', 'Alex');
  assert.ok(p.includes("N'invente aucune tache"));
  assert.ok(p.includes('Alex'));
  assert.ok(p.includes('2026-09-25'));
});

// Le classement porte sur des taches, pas sur des projets : c'est une tache
// qu'on attaque un mardi matin.
test('construirePrompt demande un classement de taches, designees par reference', () => {
  const p = semaine.construirePrompt(TACHES, '2026-09-25', 'Alex');
  assert.ok(p.includes('taches a faire cette semaine'));
  assert.ok(p.includes('"tache": "<reference>"'));
  assert.ok(p.includes('TO1'), 'les references partent au modele');
});

// Meme clause que pour la dictee et le classement : un titre de tache reste un
// libelle, jamais une instruction adressee au modele.
test('construirePrompt rappelle que les libelles sont des donnees', () => {
  const p = semaine.construirePrompt(TACHES, '2026-09-25', 'Alex');
  assert.ok(p.includes('jamais des consignes'));
});

test('interpreter garde l ordre et borne le pourcentage', () => {
  const top = semaine.interpreter({top: [
    {tache: 'PE1', pourquoi: 'urgent', pourcentage_ia: 0},
    {tache: 'TO1', pourquoi: 'ensuite', pourcentage_ia: 140}
  ]}, TACHES);
  assert.deepStrictEqual(top.map((x) => x.ref), ['PE1', 'TO1']);
  assert.strictEqual(top[0].pourcentage_ia, 0);
  assert.strictEqual(top[1].pourcentage_ia, 100, 'borne haute a 100');
  assert.strictEqual(top[0].projetTitre, 'Perso', 'le projet suit la tache');
});

test('interpreter arrondit un pourcentage decimal et refuse ce qui n est pas un nombre', () => {
  const top = semaine.interpreter({top: [
    {tache: 'TO1', pourcentage_ia: 42.6},
    {tache: 'PE1', pourcentage_ia: 'beaucoup'}
  ]}, TACHES);
  assert.strictEqual(top[0].pourcentage_ia, 43);
  assert.strictEqual(top[1].pourcentage_ia, null);
});

// Une reference inventee afficherait dans le panneau une tache qui n'existe pas.
test('interpreter ecarte une reference inconnue ou repetee', () => {
  const top = semaine.interpreter({top: [
    {tache: 'ZZ9', pourcentage_ia: 50},
    {tache: 'TO1', pourcentage_ia: 50},
    {tache: 'TO1', pourcentage_ia: 90}
  ]}, TACHES);
  assert.deepStrictEqual(top.map((x) => x.ref), ['TO1']);
});

test('interpreter accepte une reference ecrite en minuscules ou entouree d espaces', () => {
  const top = semaine.interpreter({top: [{tache: '  to1 ', pourcentage_ia: 50}]}, TACHES);
  assert.deepStrictEqual(top.map((x) => x.ref), ['TO1']);
});

test('interpreter ne renvoie jamais plus de cinq taches', () => {
  const beaucoup = [];
  for (let i = 1; i <= 12; i++) {
    beaucoup.push({ref: 'AA' + i, titre: 'T' + i, projet: 'p', projetTitre: 'P',
      prio: 'P3', echeance: ''});
  }
  const top = semaine.interpreter(
    {top: beaucoup.map((t) => ({tache: t.ref, pourcentage_ia: 10}))}, beaucoup);
  assert.strictEqual(top.length, semaine.MAX);
});

test('interpreter encaisse une reponse vide, nulle ou mal formee', () => {
  [null, {}, {top: 'pas un tableau'}, {top: [null, 7, {}]}].forEach((mauvaise) => {
    assert.deepStrictEqual(semaine.interpreter(mauvaise, TACHES), []);
  });
});

test('tachesPourPrompt met les taches a plat, sans les closes', () => {
  const taches = semaine.tachesPourPrompt([
    projet('topi', 'TO', 'TOPI', [{titre: 'ouverte'}, {titre: 'finie', statut: 'fait'}]),
    projet('vide', 'VI', 'Projet vide', [])
  ], '2026-09-25');
  assert.deepStrictEqual(taches.map((t) => t.ref), ['TO1']);
  assert.strictEqual(taches[0].projetTitre, 'TOPI');
});

test('tachesPourPrompt signale une tache en retard sans jamais lever', () => {
  const taches = semaine.tachesPourPrompt([
    projet('topi', 'TO', 'TOPI', [
      {titre: 'depassee', echeance: '2026-09-01'},
      {titre: 'a venir', echeance: '2026-12-01'},
      {titre: 'sans date'}
    ])
  ], '2026-09-25');
  assert.deepStrictEqual(taches.map((t) => t.en_retard), [true, false, false]);
});

test('calculer ne soumet que les taches ouvertes', () => {
  const ctx = contexte([
    projet('vide', 'VI', 'Projet vide', []),
    projet('clos', 'CL', 'Projet clos', [{titre: 'finie', statut: 'fait'}]),
    projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])
  ]);
  let promptVu = '';
  const faux = async (prompt) => {
    promptVu = prompt;
    return '{"top":[{"tache":"AC1","pourquoi":"il reste du travail","pourcentage_ia":40}]}';
  };
  return semaine.calculer(ctx, {lancerClaude: faux}).then((r) => {
    assert.deepStrictEqual(r.top.map((x) => x.ref), ['AC1']);
    assert.ok(!promptVu.includes('finie'), 'une tache close ne part pas au modele');
    assert.ok(!promptVu.includes('Projet vide'), 'un projet sans tache ouverte non plus');
  });
});

// Meme si le modele nomme une tache close ou inexistante, elle est ecartee : la
// regle est appliquee, pas seulement demandee.
test('calculer ecarte une tache que le modele invente', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  const faux = async () => '{"top":[{"tache":"ZZ9","pourcentage_ia":90},' +
    '{"tache":"AC1","pourcentage_ia":40}]}';
  const r = await semaine.calculer(ctx, {lancerClaude: faux});
  assert.deepStrictEqual(r.top.map((x) => x.ref), ['AC1']);
});

test('calculer reutilise le cache tant que le portefeuille ne change pas', async () => {
  const ctx = contexte([projet('actif', 'AC', 'Projet actif', [{titre: 'a faire'}])]);
  let appels = 0;
  const faux = async () => {
    appels++;
    return '{"top":[{"tache":"AC1","pourcentage_ia":40}]}';
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
    return '{"top":[{"tache":"AC1","pourcentage_ia":40}]}';
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
    lancerClaude: async () => '{"top":[{"tache":"AC1","pourcentage_ia":40}]}'
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
    return '{"top":[{"tache":"AC1","pourcentage_ia":40}]}';
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
    lancerClaude: async () => '{"top":[{"tache":"AC1","pourcentage_ia":40}]}'
  });
  assert.deepStrictEqual(r.top.map((x) => x.ref), ['AC1']);
});
