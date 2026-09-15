const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');

const AUJ = '2026-09-06';

function projet(over) {
  return Object.assign({
    id: 'x', prefixe: 'XX', titre: 'X', domaine: 'side', statut: 'actif',
    echeance: '', prochaine_action: 'faire un truc', jira: '', dernier_n: 0,
    taches: [], contexte: ''
  }, over);
}
function tache(over) {
  return Object.assign({
    n: 1, titre: 't', statut: 'a_faire', responsable: 'moi', echeance: '',
    nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
    derniere_relance: '', prochaine_relance: '', maj_le: AUJ, note_blocage: ''
  }, over);
}

test('daysBetween compte les jours signes', () => {
  assert.strictEqual(store.daysBetween('2026-09-12', AUJ), 6);
  assert.strictEqual(store.daysBetween('2026-09-01', AUJ), -5);
  assert.strictEqual(store.daysBetween(AUJ, AUJ), 0);
});

test('daysBetween refuse une date mal formee', () => {
  assert.throws(() => store.daysBetween('', AUJ), Error);
  assert.throws(() => store.daysBetween(undefined, AUJ), Error);
  assert.throws(() => store.daysBetween('06/09/2026', AUJ), Error);
});

test('daysBetween traverse les mois, les annees et les annees bissextiles', () => {
  // de 2026-08-31 a 2026-09-01 : 1 jour d'ecart
  assert.strictEqual(store.daysBetween('2026-09-01', '2026-08-31'), 1);
  // de 2025-12-31 a 2026-01-01 : 1 jour d'ecart
  assert.strictEqual(store.daysBetween('2026-01-01', '2025-12-31'), 1);
  // de 2024-02-28 a 2024-03-01 : 2 jours, car 2024 est bissextile
  assert.strictEqual(store.daysBetween('2024-03-01', '2024-02-28'), 2);
  // de 2023-02-28 a 2023-03-01 : 1 jour
  assert.strictEqual(store.daysBetween('2023-03-01', '2023-02-28'), 1);
});

test('openTasks exclut fait et abandonne', () => {
  const p = projet({taches: [
    tache({n: 1, statut: 'fait'}), tache({n: 2, statut: 'abandonne'}),
    tache({n: 3, statut: 'en_cours'})]});
  assert.strictEqual(store.openTasks(p).length, 1);
});

test('signal 1 : relance due quand la date est atteinte', () => {
  const p = projet({taches: [tache({responsable: 'christian', prochaine_relance: AUJ})]});
  assert.strictEqual(store.signals(p, AUJ).relanceDue, true);
  const q = projet({taches: [tache({responsable: 'christian', prochaine_relance: '2026-09-20'})]});
  assert.strictEqual(store.signals(q, AUJ).relanceDue, false);
});

test('signal 2 : echeance a moins de 14 jours', () => {
  assert.strictEqual(store.signals(projet({echeance: '2026-09-15',
    taches: [tache({})]}), AUJ).echeanceProche, true);
  assert.strictEqual(store.signals(projet({echeance: '2026-09-25',
    taches: [tache({})]}), AUJ).echeanceProche, false);
  assert.strictEqual(store.signals(projet({echeance: '',
    taches: [tache({})]}), AUJ).echeanceProche, false);
});

test('signal 3 : prochaine action vide', () => {
  assert.strictEqual(store.signals(projet({prochaine_action: '',
    taches: [tache({})]}), AUJ).sansProchaineAction, true);
});

test('signal 4 : dormant si toutes les taches ouvertes depassent 30 jours', () => {
  const dort = projet({taches: [tache({n: 1, maj_le: '2026-07-01'}),
    tache({n: 2, maj_le: '2026-07-02'})]});
  assert.strictEqual(store.signals(dort, AUJ).dormant, true);
  const vivant = projet({taches: [tache({n: 1, maj_le: '2026-07-01'}),
    tache({n: 2, maj_le: '2026-09-04'})]});
  assert.strictEqual(store.signals(vivant, AUJ).dormant, false);
});

test('signal 5 : WIP eleve a partir de trois taches en cours', () => {
  const trois = projet({taches: [tache({n: 1, statut: 'en_cours'}),
    tache({n: 2, statut: 'en_cours'}), tache({n: 3, statut: 'en_cours'})]});
  assert.strictEqual(store.signals(trois, AUJ).wipEleve, true);
  const deux = projet({taches: [tache({n: 1, statut: 'en_cours'}),
    tache({n: 2, statut: 'en_cours'})]});
  assert.strictEqual(store.signals(deux, AUJ).wipEleve, false);
});

test('severity idle quand plus aucune tache ouverte', () => {
  assert.strictEqual(store.severity(projet({prochaine_action: '',
    taches: [tache({statut: 'fait'})]}), AUJ), 'idle');
});

test('severity crit prime sur warn', () => {
  const p = projet({prochaine_action: '', echeance: '2026-09-08',
    taches: [tache({responsable: 'christian', prochaine_relance: AUJ})]});
  assert.strictEqual(store.severity(p, AUJ), 'crit');
});

test('severity warn sur un signal secondaire seul', () => {
  assert.strictEqual(store.severity(projet({prochaine_action: '',
    taches: [tache({})]}), AUJ), 'warn');
});

test('severity ok quand aucun signal', () => {
  assert.strictEqual(store.severity(projet({taches: [tache({})]}), AUJ), 'ok');
});

test('signal 6 : echeance de projet depassee declenche en retard', () => {
  const p = projet({echeance: '2026-09-01', taches: [tache({})]});
  assert.strictEqual(store.signals(p, AUJ).enRetard, true);
  assert.strictEqual(store.severity(p, AUJ), 'retard');
});

test('signal 6 : tache ouverte a echeance dure depassee declenche en retard, meme sans echeance de projet', () => {
  const p = projet({echeance: '', taches: [
    tache({echeance: '2026-09-01', nature_echeance: 'dure'})]});
  assert.strictEqual(store.signals(p, AUJ).enRetard, true);
  assert.strictEqual(store.severity(p, AUJ), 'retard');
});

test('signal 6 : tache ouverte a echeance souhaitee depassee ne declenche pas en retard', () => {
  const p = projet({echeance: '', taches: [
    tache({echeance: '2026-09-01', nature_echeance: 'souhaitee'})]});
  assert.strictEqual(store.signals(p, AUJ).enRetard, false);
  assert.strictEqual(store.severity(p, AUJ), 'ok');
});

test('signal 6 : tache depassee mais au statut fait ne declenche pas en retard', () => {
  const p = projet({echeance: '', taches: [
    tache({echeance: '2026-09-01', nature_echeance: 'dure', statut: 'fait'}),
    tache({n: 2})]});
  assert.strictEqual(store.signals(p, AUJ).enRetard, false);
});

test('signal 6 : projet sans aucune tache ouverte reste idle meme avec echeance largement depassee', () => {
  const p = projet({echeance: '2026-01-01', taches: [tache({statut: 'fait'})]});
  assert.strictEqual(store.signals(p, AUJ).enRetard, false);
  assert.strictEqual(store.severity(p, AUJ), 'idle');
});

test('severity retard prime sur crit : un projet cumulant retard et relance due renvoie retard', () => {
  const p = projet({echeance: '2026-09-01', taches: [
    tache({responsable: 'christian', prochaine_relance: AUJ})]});
  assert.strictEqual(store.signals(p, AUJ).relanceDue, true);
  assert.strictEqual(store.signals(p, AUJ).enRetard, true);
  assert.strictEqual(store.severity(p, AUJ), 'retard');
});

test('signal 6 : une echeance qui tombe exactement aujourd hui n est pas un retard', () => {
  const p = projet({echeance: AUJ, taches: [tache({})]});
  assert.strictEqual(store.signals(p, AUJ).enRetard, false);
  assert.strictEqual(store.signals(p, AUJ).echeanceProche, true);
  assert.strictEqual(store.severity(p, AUJ), 'warn');
});
