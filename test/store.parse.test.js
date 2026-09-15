const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');

// Fixture propre au test, independante du fichier de donnees vivant
// data/projects/estimmo.md : ce dernier evolue au fil de l usage (ajout de
// taches depuis le tableau de bord), et une lecture directe ferait echouer
// cette suite sans aucune regression reelle. Contenu identique a la version
// d origine du fichier au moment ou ce test a ete ecrit.
const FIXTURE = `---
id: estimmo
prefixe: ES
titre: Estimmo
domaine: side
statut: actif
echeance: 2026-10-15
prochaine_action: Brancher le comparateur viager sur l'extension
jira: ''
dernier_n: 1
taches:
  - n: 1
    titre: Recaler le parsing des mutations DVF
    statut: en_cours
    responsable: moi
    echeance: 2026-09-12
    nature_echeance: dure
    prio: P2
    effort: M
    bloque_par: ''
    derniere_relance: ''
    prochaine_relance: ''
    maj_le: 2026-09-02
    note_blocage: ''
---
## Contexte
Extension Chrome d'estimation immobiliere, repo exemple/estimmo.
`;

test('parseProject lit les metadonnees du projet', () => {
  const p = store.parseProject(FIXTURE);
  assert.strictEqual(p.id, 'estimmo');
  assert.strictEqual(p.prefixe, 'ES');
  assert.strictEqual(p.domaine, 'side');
  assert.strictEqual(p.echeance, '2026-10-15');
  assert.strictEqual(p.taches.length, 1);
  assert.strictEqual(p.taches[0].n, 1);
  assert.strictEqual(p.taches[0].statut, 'en_cours');
});

test('parseProject conserve le corps du fichier', () => {
  const p = store.parseProject(FIXTURE);
  assert.match(p.contexte, /Extension Chrome/);
});

test('aller-retour parse puis serialise : sortie stable', () => {
  const p = store.parseProject(FIXTURE);
  const again = store.parseProject(store.serializeProject(p));
  assert.deepStrictEqual(again, p);
});

test('parseProject normalise en supprimant les champs inconnus', () => {
  const projectText = `---
id: test-normalization
prefixe: TN
titre: Test Normalization
domaine: side
champ_inconnu_projet: cette_valeur_disparait
taches:
  - n: 1
    titre: Tache 1
    statut: en_cours
    responsable: moi
    champ_inconnu_tache: cette_valeur_disparait_aussi
---
Contexte du projet`;

  const parsed = store.parseProject(projectText);

  // Les champs connus sont conserves
  assert.strictEqual(parsed.id, 'test-normalization');
  assert.strictEqual(parsed.prefixe, 'TN');
  assert.strictEqual(parsed.titre, 'Test Normalization');
  assert.strictEqual(parsed.taches[0].n, 1);
  assert.strictEqual(parsed.taches[0].titre, 'Tache 1');
  assert.strictEqual(parsed.taches[0].responsable, 'moi');

  // Les champs inconnus ont disparu
  assert.strictEqual(parsed.champ_inconnu_projet, undefined);
  assert.strictEqual(parsed.taches[0].champ_inconnu_tache, undefined);
});

test('parseProject rejette un YAML invalide', () => {
  assert.throws(
    () => store.parseProject('---\nid: [oups\n---\ncorps'),
    store.InvalidProjectError);
});

test('parseProject rejette un fichier sans frontmatter', () => {
  assert.throws(() => store.parseProject('juste du texte'), store.InvalidProjectError);
});

// Regression (revue finale, point C1) : maj_le manquait a CHAMPS_DATE, donc une
// date mal saisie a la main (par exemple au format francophone) n'etait jamais
// signalee au chargement, pour ne faire lever que bien plus tard le calcul du
// signal dormant (daysBetween), en emportant tout le portefeuille avec elle.

test('parseProject rejette un maj_le au format francophone (09/09/2026)', () => {
  const texte = `---
id: date-fr
prefixe: DF
titre: Date FR
domaine: side
taches:
  - n: 1
    titre: une tache
    statut: en_cours
    maj_le: 09/09/2026
---
`;
  assert.throws(() => store.parseProject(texte), store.InvalidProjectError);
});

test('parseProject accepte un maj_le au format AAAA-MM-JJ, ou vide', () => {
  const texte = `---
id: date-ok
prefixe: DO
titre: Date OK
domaine: side
taches:
  - n: 1
    titre: une tache
    statut: en_cours
    maj_le: 2026-09-09
  - n: 2
    titre: une autre
    statut: en_cours
    maj_le: ''
---
`;
  const p = store.parseProject(texte);
  assert.strictEqual(p.taches[0].maj_le, '2026-09-09');
  assert.strictEqual(p.taches[1].maj_le, '');
});
