# Agent secrétaire - plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un système local de pilotage de projets à deux niveaux, avec un dashboard éditable, une dictée en langage naturel, et un agent hebdomadaire qui produit un récap et prépare les relances via Beeper.

**Architecture:** Les fichiers Markdown de `data/projects/` sont la source de vérité. `store.js` concentre toute la logique métier en fonctions pures et testables. `server.js` sert le dashboard, lit et écrit les fichiers, et relaie l'API Beeper locale. L'agent hebdomadaire est un `claude -p` lancé par le Planificateur de tâches Windows.

**Tech Stack:** Node 24 (`node:test`, `node:http`, `node:fs`), `js-yaml` comme unique dépendance, HTML et JavaScript sans framework, PowerShell pour la planification, API HTTP locale de Beeper Desktop.

**Spec de référence :** `docs/superpowers/specs/2026-09-06-agent-secretaire-design.md`
**Maquette de référence :** https://claude.ai/code/artifact/47473be2-231d-4632-a97a-f5ce37431c23

## Global Constraints

- **Jamais de tiret cadratin**, le caractère Unicode `U+2014`, dans aucun fichier produit : code, commentaires, documentation, texte d'interface, messages de commit. Utiliser `-`, `:`, `,`, `(` ou `·`.
- **Une seule dépendance npm :** `js-yaml`. Aucune autre, ni en production ni en test.
- **Tests avec `node:test` natif.** Pas de Jest, pas de Vitest.
- **Le serveur n'écoute que sur `127.0.0.1`,** port `5556`.
- **Le jeton Beeper vient de `process.env.BEEPER_TOKEN`.** Jamais écrit dans le dépôt.
- **Aucun message sortant sans clic humain explicite.** Aucun chemin de code ne doit permettre à un LLM de déclencher un envoi.
- **Ne jamais `git push`** sans demande explicite de l'utilisateur.
- **Langue de l'interface et de la documentation : français.**
- **Dates au format ISO `AAAA-MM-JJ`** dans les fichiers, affichées « 15 oct. » dans l'interface.
- **Identité visuelle « Nuit »,** verrouillée. Tokens en Task 9, à ne pas réinventer.

---

### Task 1: Socle du projet et aller-retour de parsing

**Files:**
- Create: `package.json`
- Create: `server/store.js`
- Create: `data/projects/estimmo.md`
- Test: `test/store.parse.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `parseProject(text) -> Project`, `serializeProject(project) -> string`, `InvalidProjectError`.
  `Project = {id, prefixe, titre, domaine, statut, echeance, prochaine_action, jira, taches: Task[], contexte}`.
  `Task = {n, titre, statut, responsable, echeance, nature_echeance, prio, effort, bloque_par, derniere_relance, prochaine_relance, maj_le, note_blocage}`.

- [ ] **Step 1: Créer le package.json et installer js-yaml**

```json
{
  "name": "secretaire",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test test/",
    "start": "node server/server.js"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  }
}
```

Run: `npm install`
Expected: `added 1 package`

- [ ] **Step 2: Créer le fichier projet de référence**

`data/projects/estimmo.md` :

```markdown
---
id: estimmo
prefixe: ES
titre: Estimmo
domaine: side
statut: actif
echeance: 2026-10-15
prochaine_action: Brancher le comparateur viager sur l'extension
jira: ''
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
Extension Chrome d'estimation immobiliere, repo <compte-github>/estimmo.
```

- [ ] **Step 3: Écrire le test qui échoue**

`test/store.parse.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../server/store');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '..', 'data', 'projects', 'estimmo.md'), 'utf8');

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

test('aller-retour parse puis serialise sans perte', () => {
  const p = store.parseProject(FIXTURE);
  const again = store.parseProject(store.serializeProject(p));
  assert.deepStrictEqual(again, p);
});

test('parseProject rejette un YAML invalide', () => {
  assert.throws(
    () => store.parseProject('---\nid: [oups\n---\ncorps'),
    store.InvalidProjectError);
});

test('parseProject rejette un fichier sans frontmatter', () => {
  assert.throws(() => store.parseProject('juste du texte'), store.InvalidProjectError);
});
```

- [ ] **Step 4: Lancer le test et vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL, `Cannot find module '../server/store'`

- [ ] **Step 5: Écrire l'implémentation minimale**

`server/store.js` :

```js
'use strict';
const yaml = require('js-yaml');

class InvalidProjectError extends Error {}

const TASK_FIELDS = ['n', 'titre', 'statut', 'responsable', 'echeance',
  'nature_echeance', 'prio', 'effort', 'bloque_par', 'derniere_relance',
  'prochaine_relance', 'maj_le', 'note_blocage'];

const TASK_DEFAULTS = {
  titre: '', statut: 'a_faire', responsable: 'moi', echeance: '',
  nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
  derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''
};

const PROJECT_DEFAULTS = {
  id: '', prefixe: '', titre: '', domaine: 'side', statut: 'actif',
  echeance: '', prochaine_action: '', jira: ''
};

function parseProject(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new InvalidProjectError('frontmatter absent');

  let meta;
  try {
    meta = yaml.load(m[1]);
  } catch (e) {
    throw new InvalidProjectError('YAML illisible : ' + e.message);
  }
  if (!meta || typeof meta !== 'object') throw new InvalidProjectError('frontmatter vide');
  if (!meta.id) throw new InvalidProjectError('champ id manquant');

  const project = Object.assign({}, PROJECT_DEFAULTS);
  Object.keys(PROJECT_DEFAULTS).forEach((k) => {
    if (meta[k] != null) project[k] = meta[k];
  });

  project.taches = (meta.taches || []).map((raw) => {
    if (typeof raw.n !== 'number') throw new InvalidProjectError('tache sans numero');
    const t = Object.assign({n: raw.n}, TASK_DEFAULTS);
    TASK_FIELDS.forEach((k) => { if (raw[k] != null) t[k] = raw[k]; });
    return t;
  });

  project.contexte = m[2].replace(/\s+$/, '');
  return project;
}

function serializeProject(project) {
  const meta = {};
  Object.keys(PROJECT_DEFAULTS).forEach((k) => { meta[k] = project[k]; });
  meta.taches = project.taches.map((t) => {
    const out = {};
    TASK_FIELDS.forEach((k) => { out[k] = t[k]; });
    return out;
  });
  const front = yaml.dump(meta, {lineWidth: -1, quotingType: "'", forceQuotes: false});
  return '---\n' + front + '---\n' + project.contexte + '\n';
}

module.exports = {InvalidProjectError, parseProject, serializeProject,
  TASK_FIELDS, TASK_DEFAULTS, PROJECT_DEFAULTS};
```

- [ ] **Step 6: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 5 tests

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/store.js data/projects/estimmo.md test/store.parse.test.js
git commit -m "feat(store): parse et serialise un fichier projet sans perte"
```

---

### Task 2: Préfixes uniques et numérotation monotone

**Files:**
- Modify: `server/store.js`
- Test: `test/store.refs.test.js`

**Interfaces:**
- Consumes: `Project`, `Task` de Task 1.
- Produces: `refOf(project, task) -> string`, `parseRef(ref) -> {prefixe, n} | null`,
  `findByRef(projects, ref) -> {project, task} | null`,
  `nextTaskNumber(project) -> number`,
  `allocatePrefix(titre, taken) -> string` où `taken` est un tableau de préfixes déjà pris.

- [ ] **Step 1: Écrire le test qui échoue**

`test/store.refs.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');

const projets = [
  {id: 'estimmo', prefixe: 'ES', taches: [{n: 1}, {n: 4}]},
  {id: 'cabinet', prefixe: 'CA', taches: [{n: 2}]}
];

test('refOf concatene le prefixe et le numero', () => {
  assert.strictEqual(store.refOf(projets[0], {n: 4}), 'ES4');
});

test('parseRef accepte la casse et les espaces', () => {
  assert.deepStrictEqual(store.parseRef(' es4 '), {prefixe: 'ES', n: 4});
  assert.strictEqual(store.parseRef('bricole'), null);
  assert.strictEqual(store.parseRef('4'), null);
});

test('findByRef retrouve la tache', () => {
  const hit = store.findByRef(projets, 'CA2');
  assert.strictEqual(hit.project.id, 'cabinet');
  assert.strictEqual(hit.task.n, 2);
  assert.strictEqual(store.findByRef(projets, 'ES9'), null);
  assert.strictEqual(store.findByRef(projets, 'ZZ1'), null);
});

test('nextTaskNumber ne reattribue jamais un numero supprime', () => {
  const p = {taches: [{n: 1}, {n: 4}]};
  assert.strictEqual(store.nextTaskNumber(p), 5);
  p.taches = [{n: 1}];
  assert.strictEqual(store.nextTaskNumber(p), 5,
    'le maximum doit rester connu meme apres suppression');
});

test('nextTaskNumber vaut 1 sur un projet vide', () => {
  assert.strictEqual(store.nextTaskNumber({taches: []}), 1);
});

test('allocatePrefix prend les deux premieres lettres', () => {
  assert.strictEqual(store.allocatePrefix('Estimmo', []), 'ES');
});

test('allocatePrefix evite les collisions', () => {
  assert.strictEqual(store.allocatePrefix('Estimation', ['ES']), 'ET');
  assert.strictEqual(store.allocatePrefix('Estimmo', ['ES', 'ET', 'EI', 'EM', 'EO']), 'E1');
});

test('allocatePrefix ignore accents et espaces', () => {
  assert.strictEqual(store.allocatePrefix("Écoles à Paris", []), 'EC');
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/store.refs.test.js`
Expected: FAIL, `store.refOf is not a function`

- [ ] **Step 3: Écrire l'implémentation**

Le compteur ne peut pas être recalculé depuis les tâches restantes, sinon un numéro supprimé serait réattribué. Il est donc porté par le projet dans le champ `dernier_n`, et `nextTaskNumber` retombe sur le maximum des tâches quand le champ est absent, ce qui rend les fichiers existants compatibles.

Ajouter `dernier_n: 0` à `PROJECT_DEFAULTS` dans `server/store.js`, puis ajouter avant `module.exports` :

```js
function refOf(project, task) {
  return project.prefixe + task.n;
}

function parseRef(ref) {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(String(ref == null ? '' : ref).trim());
  return m ? {prefixe: m[1].toUpperCase(), n: Number(m[2])} : null;
}

function findByRef(projects, ref) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  for (const project of projects) {
    if (project.prefixe !== parsed.prefixe) continue;
    const task = project.taches.find((t) => t.n === parsed.n);
    if (task) return {project, task};
  }
  return null;
}

function nextTaskNumber(project) {
  const maxVu = (project.taches || []).reduce((m, t) => Math.max(m, t.n), 0);
  return Math.max(project.dernier_n || 0, maxVu) + 1;
}

function allocatePrefix(titre, taken) {
  const pris = new Set((taken || []).map((p) => p.toUpperCase()));
  const lettres = String(titre)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z]/g, '');
  if (!lettres) return unique('X', pris);
  const tete = lettres[0];
  for (let i = 1; i < lettres.length; i++) {
    const essai = tete + lettres[i];
    if (!pris.has(essai)) return essai;
  }
  return unique(tete, pris);
}

function unique(tete, pris) {
  for (let i = 1; i < 100; i++) {
    const essai = tete + i;
    if (!pris.has(essai)) return essai;
  }
  throw new Error('impossible d attribuer un prefixe');
}
```

Étendre `module.exports` avec `refOf, parseRef, findByRef, nextTaskNumber, allocatePrefix`.

- [ ] **Step 4: Adapter le test d'aller-retour de Task 1**

`dernier_n` entre dans le frontmatter, donc la fixture doit le porter. Ajouter `dernier_n: 1` dans `data/projects/estimmo.md`, juste après `jira: ''`.

- [ ] **Step 5: Lancer tous les tests**

Run: `npm test`
Expected: PASS, 15 tests

- [ ] **Step 6: Commit**

```bash
git add server/store.js test/store.refs.test.js data/projects/estimmo.md
git commit -m "feat(store): references stables et prefixes de projet sans collision"
```

---

### Task 3: Les cinq signaux et la gravité

**Files:**
- Modify: `server/store.js`
- Test: `test/store.signaux.test.js`

**Interfaces:**
- Consumes: `Project` de Task 1.
- Produces: `daysBetween(iso, today) -> number`, `openTasks(project) -> Task[]`,
  `signals(project, today) -> {relanceDue, echeanceProche, sansProchaineAction, dormant, wipEleve}`,
  `severity(project, today) -> 'idle' | 'crit' | 'warn' | 'ok'`.
  `today` est toujours une chaîne ISO passée en paramètre, jamais `new Date()` dans la logique.

- [ ] **Step 1: Écrire le test qui échoue**

`test/store.signaux.test.js` :

```js
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

test('openTasks exclut fait et abandonne', () => {
  const p = projet({taches: [
    tache({n: 1, statut: 'fait'}), tache({n: 2, statut: 'abandonne'}),
    tache({n: 3, statut: 'en_cours'})]});
  assert.strictEqual(store.openTasks(p).length, 1);
});

test('signal 1 : relance due quand la date est atteinte', () => {
  const p = projet({taches: [tache({responsable: 'bruno', prochaine_relance: AUJ})]});
  assert.strictEqual(store.signals(p, AUJ).relanceDue, true);
  const q = projet({taches: [tache({responsable: 'bruno', prochaine_relance: '2026-09-20'})]});
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
    taches: [tache({responsable: 'bruno', prochaine_relance: AUJ})]});
  assert.strictEqual(store.severity(p, AUJ), 'crit');
});

test('severity warn sur un signal secondaire seul', () => {
  assert.strictEqual(store.severity(projet({prochaine_action: '',
    taches: [tache({})]}), AUJ), 'warn');
});

test('severity ok quand aucun signal', () => {
  assert.strictEqual(store.severity(projet({taches: [tache({})]}), AUJ), 'ok');
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/store.signaux.test.js`
Expected: FAIL, `store.daysBetween is not a function`

- [ ] **Step 3: Écrire l'implémentation**

Ajouter dans `server/store.js` :

```js
function daysBetween(iso, today) {
  const a = Date.UTC(...iso.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  const b = Date.UTC(...today.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  return Math.round((a - b) / 86400000);
}

function openTasks(project) {
  return (project.taches || []).filter(
    (t) => t.statut !== 'fait' && t.statut !== 'abandonne');
}

function signals(project, today) {
  const ouvertes = openTasks(project);
  return {
    relanceDue: ouvertes.some(
      (t) => t.responsable !== 'moi' && t.prochaine_relance &&
             daysBetween(t.prochaine_relance, today) <= 0),
    echeanceProche: !!project.echeance &&
      daysBetween(project.echeance, today) >= 0 &&
      daysBetween(project.echeance, today) < 14,
    sansProchaineAction: !project.prochaine_action,
    dormant: ouvertes.length > 0 &&
      ouvertes.every((t) => !!t.maj_le && daysBetween(t.maj_le, today) < -30),
    wipEleve: ouvertes.filter((t) => t.statut === 'en_cours').length >= 3
  };
}

function severity(project, today) {
  if (openTasks(project).length === 0) return 'idle';
  const s = signals(project, today);
  if (s.relanceDue) return 'crit';
  if (s.echeanceProche || s.sansProchaineAction || s.dormant || s.wipEleve) return 'warn';
  return 'ok';
}
```

Étendre `module.exports` avec `daysBetween, openTasks, signals, severity`.

- [ ] **Step 4: Lancer tous les tests**

Run: `npm test`
Expected: PASS, 26 tests

- [ ] **Step 5: Commit**

```bash
git add server/store.js test/store.signaux.test.js
git commit -m "feat(store): les cinq signaux et le calcul de gravite"
```

---

### Task 4: Validation et application des opérations de la dictée

**Files:**
- Modify: `server/store.js`
- Test: `test/store.ops.test.js`

**Interfaces:**
- Consumes: `findByRef`, `nextTaskNumber`, `allocatePrefix` de Task 2.
- Produces: `applyOps(projects, ops, today) -> {projects, applied: string[], rejected: string[]}`.
  `applied` contient une ligne lisible par opération réussie, `rejected` une raison par opération refusée.
  La fonction ne mute pas `projects`, elle renvoie un nouveau tableau.

- [ ] **Step 1: Écrire le test qui échoue**

`test/store.ops.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');

const AUJ = '2026-09-06';

function base() {
  return [{
    id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
    echeance: '2026-10-15', prochaine_action: 'faire', jira: '', dernier_n: 2, contexte: '',
    taches: [
      {n: 1, titre: 'a', statut: 'a_faire', responsable: 'moi', echeance: '',
       nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
       derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''}
    ]
  }];
}

test('add_task cree une tache et avance le compteur', () => {
  const r = store.applyOps(base(), [{op: 'add_task', projet: 'estimmo',
    titre: 'relancer le notaire', prio: 'P2', echeance: '2026-09-20'}], AUJ);
  const p = r.projects[0];
  assert.strictEqual(p.taches.length, 2);
  assert.strictEqual(p.taches[1].n, 3, 'le compteur repart de dernier_n');
  assert.strictEqual(p.taches[1].prio, 'P2');
  assert.strictEqual(p.taches[1].maj_le, AUJ);
  assert.strictEqual(p.dernier_n, 3);
  assert.strictEqual(r.applied.length, 1);
});

test('update_task ne touche que les champs fournis', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ES1',
    champs: {statut: 'bloque'}}], AUJ);
  const t = r.projects[0].taches[0];
  assert.strictEqual(t.statut, 'bloque');
  assert.strictEqual(t.titre, 'a');
  assert.strictEqual(t.maj_le, AUJ);
});

test('delete_task retire la tache sans liberer le numero', () => {
  const r = store.applyOps(base(), [{op: 'delete_task', ref: 'ES1'}], AUJ);
  assert.strictEqual(r.projects[0].taches.length, 0);
  assert.strictEqual(store.nextTaskNumber(r.projects[0]), 3);
});

test('add_project attribue un prefixe libre', () => {
  const r = store.applyOps(base(), [{op: 'add_project', id: 'estimation',
    titre: 'Estimation', domaine: 'perso'}], AUJ);
  const nouveau = r.projects.find((p) => p.id === 'estimation');
  assert.strictEqual(nouveau.prefixe, 'ET');
  assert.strictEqual(nouveau.taches.length, 0);
});

test('une operation inconnue est refusee sans casser les autres', () => {
  const r = store.applyOps(base(), [
    {op: 'lance_les_missiles'},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

test('une reference inexistante est refusee', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ZZ9',
    champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

test('une valeur hors domaine est refusee', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ES1',
    champs: {statut: 'peut_etre'}}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects[0].taches[0].statut, 'a_faire');
});

test('applyOps ne mute pas le tableau recu', () => {
  const avant = base();
  store.applyOps(avant, [{op: 'delete_task', ref: 'ES1'}], AUJ);
  assert.strictEqual(avant[0].taches.length, 1);
});

test('aucune operation ne peut envoyer un message', () => {
  const r = store.applyOps(base(), [{op: 'send_message', to: 'bruno',
    text: 'coucou'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/store.ops.test.js`
Expected: FAIL, `store.applyOps is not a function`

- [ ] **Step 3: Écrire l'implémentation**

Ajouter dans `server/store.js` :

```js
const DOMAINES = {
  statut: ['a_faire', 'en_cours', 'bloque', 'fait', 'abandonne'],
  nature_echeance: ['dure', 'souhaitee'],
  prio: ['P1', 'P2', 'P3', 'P4'],
  effort: ['S', 'M', 'L']
};
const CHAMPS_TACHE = ['titre', 'statut', 'responsable', 'echeance',
  'nature_echeance', 'prio', 'effort', 'bloque_par', 'derniere_relance',
  'prochaine_relance', 'note_blocage'];
const CHAMPS_PROJET = ['titre', 'domaine', 'echeance', 'prochaine_action', 'statut', 'jira'];

function champsInvalides(champs) {
  const mauvais = [];
  Object.keys(champs || {}).forEach((k) => {
    if (DOMAINES[k] && !DOMAINES[k].includes(champs[k])) {
      mauvais.push(k + '=' + champs[k]);
    }
  });
  return mauvais;
}

function applyOps(projects, ops, today) {
  let etat = JSON.parse(JSON.stringify(projects));
  const applied = [];
  const rejected = [];

  (ops || []).forEach((o) => {
    const op = o && o.op;
    try {
      if (op === 'add_task') {
        const p = etat.find((x) => x.id === o.projet || x.prefixe === o.projet);
        if (!p) return rejected.push('projet inconnu : ' + o.projet);
        const champs = {};
        CHAMPS_TACHE.forEach((k) => { if (o[k] != null) champs[k] = o[k]; });
        if (o.responsable != null) champs.responsable = o.responsable;
        const mauvais = champsInvalides(champs);
        if (mauvais.length) return rejected.push('valeurs refusees : ' + mauvais.join(', '));
        const n = nextTaskNumber(p);
        const t = Object.assign({n}, TASK_DEFAULTS, champs, {maj_le: today});
        p.taches.push(t);
        p.dernier_n = n;
        applied.push('+ ' + p.prefixe + n + '  ' + t.titre);

      } else if (op === 'update_task') {
        const hit = findByRef(etat, o.ref);
        if (!hit) return rejected.push('reference inconnue : ' + o.ref);
        const champs = {};
        CHAMPS_TACHE.forEach((k) => {
          if (o.champs && o.champs[k] != null) champs[k] = o.champs[k];
        });
        const mauvais = champsInvalides(champs);
        if (mauvais.length) return rejected.push('valeurs refusees : ' + mauvais.join(', '));
        if (!Object.keys(champs).length) return rejected.push('aucun champ a modifier');
        Object.assign(hit.task, champs, {maj_le: today});
        if (hit.task.statut !== 'bloque') hit.task.note_blocage = '';
        applied.push('~ ' + o.ref.toUpperCase() + '  ' + Object.keys(champs).join(', '));

      } else if (op === 'delete_task') {
        const hit = findByRef(etat, o.ref);
        if (!hit) return rejected.push('reference inconnue : ' + o.ref);
        hit.project.dernier_n = Math.max(hit.project.dernier_n || 0, hit.task.n);
        hit.project.taches = hit.project.taches.filter((t) => t.n !== hit.task.n);
        applied.push('- ' + o.ref.toUpperCase());

      } else if (op === 'add_project') {
        if (!o.id) return rejected.push('projet sans identifiant');
        if (etat.some((x) => x.id === o.id)) return rejected.push('projet deja present : ' + o.id);
        const champs = {};
        CHAMPS_PROJET.forEach((k) => { if (o[k] != null) champs[k] = o[k]; });
        const p = Object.assign({}, PROJECT_DEFAULTS, champs, {
          id: o.id,
          titre: o.titre || o.id,
          prefixe: allocatePrefix(o.titre || o.id, etat.map((x) => x.prefixe)),
          dernier_n: 0, taches: [], contexte: ''
        });
        etat.push(p);
        applied.push('+ projet ' + p.titre + ' (' + p.prefixe + ')');

      } else if (op === 'update_project') {
        const p = etat.find((x) => x.id === o.projet || x.prefixe === o.projet);
        if (!p) return rejected.push('projet inconnu : ' + o.projet);
        CHAMPS_PROJET.forEach((k) => {
          if (o.champs && o.champs[k] != null) p[k] = o.champs[k];
        });
        applied.push('~ projet ' + p.titre);

      } else if (op === 'delete_project') {
        const p = etat.find((x) => x.id === o.projet || x.prefixe === o.projet);
        if (!p) return rejected.push('projet inconnu : ' + o.projet);
        etat = etat.filter((x) => x !== p);
        applied.push('- projet ' + p.titre);

      } else {
        rejected.push('operation non autorisee : ' + op);
      }
    } catch (e) {
      rejected.push('operation en echec : ' + (op || 'inconnue'));
    }
  });

  return {projects: etat, applied, rejected};
}
```

Étendre `module.exports` avec `applyOps, DOMAINES`.

- [ ] **Step 4: Lancer tous les tests**

Run: `npm test`
Expected: PASS, 37 tests

- [ ] **Step 5: Commit**

```bash
git add server/store.js test/store.ops.test.js
git commit -m "feat(store): validation stricte des operations de la dictee"
```

---

### Task 5: Écriture sûre sur disque et commit automatique

**Files:**
- Create: `server/repo.js`
- Test: `test/repo.test.js`

**Interfaces:**
- Consumes: `parseProject`, `serializeProject`, `InvalidProjectError` de Task 1.
- Produces: `loadAll(dir) -> Project[]`, `saveProject(dir, project)`, `saveAll(dir, projects)`,
  `commit(cwd, message)`. `saveProject` relit ce qu'elle vient d'écrire et restaure le fichier
  d'origine si la relecture échoue.

- [ ] **Step 1: Écrire le test qui échoue**

`test/repo.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/repo.test.js`
Expected: FAIL, `Cannot find module '../server/repo'`

- [ ] **Step 3: Écrire l'implémentation**

`server/repo.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const store = require('./store');

function fichiers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function loadAll(dir) {
  return fichiers(dir).map(
    (f) => store.parseProject(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function loadAllSafe(dir) {
  const projects = [];
  const errors = [];
  fichiers(dir).forEach((f) => {
    try {
      projects.push(store.parseProject(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch (e) {
      errors.push({fichier: f, message: e.message});
    }
  });
  return {projects, errors};
}

function saveProject(dir, project) {
  fs.mkdirSync(dir, {recursive: true});
  const cible = path.join(dir, project.id + '.md');
  const ancien = fs.existsSync(cible) ? fs.readFileSync(cible, 'utf8') : null;
  const texte = store.serializeProject(project);
  fs.writeFileSync(cible, texte, 'utf8');
  try {
    store.parseProject(fs.readFileSync(cible, 'utf8'));
  } catch (e) {
    if (ancien === null) fs.unlinkSync(cible);
    else fs.writeFileSync(cible, ancien, 'utf8');
    throw e;
  }
}

function saveAll(dir, projects) {
  const gardes = new Set(projects.map((p) => p.id + '.md'));
  projects.forEach((p) => saveProject(dir, p));
  fichiers(dir).forEach((f) => {
    if (!gardes.has(f)) fs.unlinkSync(path.join(dir, f));
  });
}

function commit(cwd, message) {
  try {
    execFileSync('git', ['add', '-A'], {cwd, stdio: 'ignore'});
    execFileSync('git', ['commit', '-q', '-m', message], {cwd, stdio: 'ignore'});
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {loadAll, loadAllSafe, saveProject, saveAll, commit};
```

- [ ] **Step 4: Lancer tous les tests**

Run: `npm test`
Expected: toute la suite est verte, aucun test en echec

- [ ] **Step 5: Commit**

```bash
git add server/repo.js test/repo.test.js
git commit -m "feat(repo): ecriture verifiee sur disque et commit automatique"
```

---

### Task 6: Serveur local et routes de lecture

**Files:**
- Create: `server/server.js`
- Create: `server/api.js`
- Create: `web/index.html`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `repo.loadAllSafe`, `store.severity`, `store.signals`.
- Produces: `api.handle(req, body, ctx) -> {status, json}` où `ctx = {dataDir, projectsDir, root}`.
  Routes de lecture : `GET /api/etat` renvoie `{projects, errors, today}`, chaque projet enrichi de
  `severite` et `signaux`.
  `server.js` expose `createServer(ctx)` pour que les tests n'ouvrent pas de port.

- [ ] **Step 1: Écrire le test qui échoue**

`test/api.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../server/api');
const repo = require('../server/repo');

function contexte() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-api-'));
  const projectsDir = path.join(root, 'data', 'projects');
  repo.saveProject(projectsDir, {id: 'demo', prefixe: 'DE', titre: 'Demo',
    domaine: 'side', statut: 'actif', echeance: '2026-09-10',
    prochaine_action: '', jira: '', dernier_n: 1, contexte: '',
    taches: [{n: 1, titre: 'a', statut: 'en_cours', responsable: 'moi', echeance: '',
      nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
      derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01',
      note_blocage: ''}]});
  return {root, projectsDir, dataDir: path.join(root, 'data'), today: '2026-09-06'};
}

test('GET /api/etat renvoie les projets enrichis', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.projects.length, 1);
  assert.strictEqual(r.json.projects[0].severite, 'warn');
  assert.strictEqual(r.json.projects[0].signaux.sansProchaineAction, true);
  assert.strictEqual(r.json.today, '2026-09-06');
});

test('GET /api/etat remonte les fichiers illisibles', async () => {
  const ctx = contexte();
  fs.writeFileSync(path.join(ctx.projectsDir, 'casse.md'), '---\nid: [oups\n---\n');
  const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.json.errors.length, 1);
});

test('une route inconnue renvoie 404', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'GET', url: '/api/nimporte'}, null, ctx);
  assert.strictEqual(r.status, 404);
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/api.test.js`
Expected: FAIL, `Cannot find module '../server/api'`

- [ ] **Step 3: Écrire api.js**

`server/api.js` :

```js
'use strict';
const store = require('./store');
const repo = require('./repo');

function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function etat(ctx) {
  const today = ctx.today || aujourdhui();
  const {projects, errors} = repo.loadAllSafe(ctx.projectsDir);
  return {
    today,
    errors,
    projects: projects.map((p) => Object.assign({}, p, {
      severite: store.severity(p, today),
      signaux: store.signals(p, today)
    }))
  };
}

async function handle(req, body, ctx) {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/etat') {
    return {status: 200, json: etat(ctx)};
  }
  return {status: 404, json: {erreur: 'route inconnue'}};
}

module.exports = {handle, etat, aujourdhui};
```

- [ ] **Step 4: Écrire server.js**

`server/server.js` :

```js
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./api');

const RACINE = path.join(__dirname, '..');
const CTX = {
  root: RACINE,
  dataDir: path.join(RACINE, 'data'),
  projectsDir: path.join(RACINE, 'data', 'projects')
};
const PORT = 5556;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'};

function createServer(ctx) {
  return http.createServer((req, res) => {
    let brut = '';
    req.on('data', (c) => { brut += c; });
    req.on('end', async () => {
      if (req.url.startsWith('/api/')) {
        let body = null;
        if (brut) {
          try { body = JSON.parse(brut); }
          catch (e) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({erreur: 'JSON invalide'}));
          }
        }
        const r = await api.handle(req, body, ctx);
        res.writeHead(r.status, {'Content-Type': 'application/json; charset=utf-8'});
        return res.end(JSON.stringify(r.json));
      }
      const nom = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const fichier = path.join(ctx.root, 'web', path.normalize(nom).replace(/^[/\\]+/, ''));
      if (!fichier.startsWith(path.join(ctx.root, 'web')) || !fs.existsSync(fichier)) {
        res.writeHead(404); return res.end('introuvable');
      }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(fichier)] || 'text/plain'});
      res.end(fs.readFileSync(fichier));
    });
  });
}

if (require.main === module) {
  createServer(CTX).listen(PORT, '127.0.0.1', () => {
    console.log('Secretariat sur http://127.0.0.1:' + PORT);
  });
}

module.exports = {createServer, CTX};
```

- [ ] **Step 5: Créer une page d'attente**

`web/index.html`, remplacé intégralement en Task 9 :

```html
<title>Secrétariat particulier</title>
<p>Le serveur répond. Le dashboard arrive en Task 9.</p>
```

- [ ] **Step 6: Lancer les tests**

Run: `npm test`
Expected: toute la suite est verte, aucun test en echec

- [ ] **Step 7: Vérifier le serveur à la main**

Run: `npm start` dans un terminal, puis dans un autre :
`curl http://127.0.0.1:5556/api/etat`
Expected: un JSON contenant `"id":"estimmo"` et `"severite"`. Arrêter le serveur ensuite.

- [ ] **Step 8: Commit**

```bash
git add server/server.js server/api.js web/index.html test/api.test.js
git commit -m "feat(server): serveur local sur 127.0.0.1 et route de lecture de l etat"
```

---

### Task 7: Routes d'écriture

**Files:**
- Modify: `server/api.js`
- Test: `test/api.ecriture.test.js`

**Interfaces:**
- Consumes: `store.applyOps`, `repo.saveAll`, `repo.commit`, `api.etat`.
- Produces: trois routes, toutes passant par `applyOps` pour n'avoir qu'un seul chemin de
  validation :
  `POST /api/ops` corps `{ops: [...]}` renvoie `{applied, rejected, etat}`.
  `POST /api/tache` corps `{projet, champs}` crée ou met à jour.
  `DELETE /api/tache` corps `{ref}`.

- [ ] **Step 1: Écrire le test qui échoue**

`test/api.ecriture.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/api.ecriture.test.js`
Expected: FAIL, le statut vaut 404 au lieu de 200

- [ ] **Step 3: Écrire l'implémentation**

Remplacer la fonction `handle` de `server/api.js` par :

```js
function appliquer(ops, ctx) {
  const today = ctx.today || aujourdhui();
  const {projects, errors} = repo.loadAllSafe(ctx.projectsDir);
  if (errors.length) {
    return {status: 409, json: {applied: [], rejected: errors.map(
      (e) => 'fichier illisible : ' + e.fichier), etat: etat(ctx)}};
  }
  const res = store.applyOps(projects, ops, today);
  if (res.applied.length) {
    repo.saveAll(ctx.projectsDir, res.projects);
    repo.commit(ctx.root, 'data: ' + res.applied.join(' | '));
  }
  return {status: 200, json: {applied: res.applied, rejected: res.rejected, etat: etat(ctx)}};
}

async function handle(req, body, ctx) {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/etat') {
    return {status: 200, json: etat(ctx)};
  }

  if (req.method === 'POST' && url === '/api/ops') {
    if (!body || !Array.isArray(body.ops)) {
      return {status: 400, json: {erreur: 'corps attendu : {ops: []}'}};
    }
    return appliquer(body.ops, ctx);
  }

  if (req.method === 'POST' && url === '/api/tache') {
    if (!body) return {status: 400, json: {erreur: 'corps manquant'}};
    const op = body.ref
      ? {op: 'update_task', ref: body.ref, champs: body.champs || {}}
      : Object.assign({op: 'add_task', projet: body.projet}, body.champs || {});
    return appliquer([op], ctx);
  }

  if (req.method === 'DELETE' && url === '/api/tache') {
    if (!body || !body.ref) return {status: 400, json: {erreur: 'reference manquante'}};
    return appliquer([{op: 'delete_task', ref: body.ref}], ctx);
  }

  return {status: 404, json: {erreur: 'route inconnue'}};
}
```

Ajouter `appliquer` à `module.exports`.

- [ ] **Step 4: Lancer tous les tests**

Run: `npm test`
Expected: toute la suite est verte, aucun test en echec

- [ ] **Step 5: Commit**

```bash
git add server/api.js test/api.ecriture.test.js
git commit -m "feat(api): routes d ecriture passant toutes par la validation d operations"
```

---

### Task 8: Client Beeper

**Files:**
- Create: `server/beeper.js`
- Modify: `server/api.js`
- Test: `test/beeper.test.js`

**Interfaces:**
- Consumes: `process.env.BEEPER_TOKEN`.
- Produces:
  `comptes(opts) -> Promise<Compte[]>` avec `Compte = {accountID, network, status}`,
  `chercherContacts(accountID, query, opts) -> Promise<Contact[]>` avec
  `Contact = {id, nom, telephone, accountID}`,
  `ouvrirChat(accountID, participantID, opts) -> Promise<{chatID}>`,
  `envoyer(chatID, texte, opts) -> Promise<{ok, chatID, pendingMessageID}>`,
  `disponible(opts) -> Promise<boolean>`.
  `opts` vaut `{base, token}` et n'est fourni que par les tests.
  Routes ajoutées : `GET /api/comptes`, `GET /api/contacts?compte=...&nom=...`,
  `POST /api/relance` corps `{chatId, texte}`.

**L'API a déjà été observée.** Le relevé fait foi : `docs/beeper-observe.md`. Ne pas
retourner interroger Beeper, ne pas supposer d'autres routes. Points essentiels :

- Toutes les routes sont préfixées `/v1`, jamais `/v0`.
- `GET /v1/accounts` renvoie **un tableau nu**, pas un objet enveloppe.
- `GET /v1/accounts/{accountID}/contacts?query=...` renvoie `{items: [{id, phoneNumber,
  fullName}]}`. Le paramètre `query` est requis. Il n'y a **ni chatID ni network** dans
  un contact : un contact n'est pas une conversation.
- `POST /v1/chats` corps `{accountID, type: "single", participantIDs: [id]}` ouvre ou
  retrouve la conversation et donne son `chatID`.
- `POST /v1/chats/{chatID}/messages` corps `{text: "..."}` renvoie
  `{chatID, pendingMessageID}`. L'envoi est asynchrone : la réponse confirme la prise
  en compte, pas la remise.

- [ ] **Step 1: Écrire le test contre un serveur bouchonné**

`test/beeper.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const beeper = require('../server/beeper');

function bouchon(routes) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let brut = '';
      req.on('data', (c) => { brut += c; });
      req.on('end', () => {
        const chemin = req.url.split('?')[0];
        const fn = routes[req.method + ' ' + chemin];
        if (!fn) { res.writeHead(404); return res.end('{}'); }
        const out = fn(req, brut ? JSON.parse(brut) : null, req.url);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(out));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function adresse(s) { return 'http://127.0.0.1:' + s.address().port; }

test('comptes lit le tableau nu renvoye par Beeper', async () => {
  const s = await bouchon({
    'GET /v1/accounts': () => ([
      {accountID: 'whatsapp', network: 'WhatsApp', status: 'connected', bridge: {}, user: {}},
      {accountID: 'telegram', network: 'Telegram', status: 'connected', bridge: {}, user: {}}
    ])
  });
  const res = await beeper.comptes({base: adresse(s), token: 'x'});
  assert.deepStrictEqual(res, [
    {accountID: 'whatsapp', network: 'WhatsApp', status: 'connected'},
    {accountID: 'telegram', network: 'Telegram', status: 'connected'}
  ]);
  s.close();
});

test('chercherContacts normalise les trois champs reels', async () => {
  let vueUrl = null;
  const s = await bouchon({
    'GET /v1/accounts/whatsapp/contacts': (req, body, url) => {
      vueUrl = url;
      return {items: [{id: '33600000000', phoneNumber: '+33600000000',
        fullName: 'Martin J-C'}]};
    }
  });
  const res = await beeper.chercherContacts('whatsapp', 'Martin',
    {base: adresse(s), token: 'x'});
  assert.deepStrictEqual(res, [{id: '33600000000', nom: 'Martin J-C',
    telephone: '+33600000000', accountID: 'whatsapp'}]);
  assert.match(vueUrl, /query=Martin/);
  s.close();
});

test('ouvrirChat demande une conversation individuelle', async () => {
  let vu = null;
  const s = await bouchon({
    'POST /v1/chats': (req, body) => { vu = body; return {id: 'chat-1'}; }
  });
  const r = await beeper.ouvrirChat('whatsapp', '33600000000',
    {base: adresse(s), token: 'x'});
  assert.strictEqual(r.chatID, 'chat-1');
  assert.strictEqual(vu.accountID, 'whatsapp');
  assert.strictEqual(vu.type, 'single');
  assert.deepStrictEqual(vu.participantIDs, ['33600000000']);
  s.close();
});

test('envoyer transmet le texte et le jeton', async () => {
  let vu = null;
  const s = await bouchon({
    'POST /v1/chats/chat-1/messages': (req, body) => {
      vu = {auth: req.headers.authorization, body};
      return {chatID: 'chat-1', pendingMessageID: 'p-9'};
    }
  });
  const r = await beeper.envoyer('chat-1', 'coucou', {base: adresse(s), token: 'secret'});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pendingMessageID, 'p-9');
  assert.strictEqual(vu.auth, 'Bearer secret');
  assert.strictEqual(vu.body.text, 'coucou');
  s.close();
});

test('envoyer remonte une erreur quand Beeper ne repond pas', async () => {
  await assert.rejects(
    () => beeper.envoyer('chat-1', 'coucou', {base: 'http://127.0.0.1:1', token: 'x'}),
    /Beeper injoignable/);
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/beeper.test.js`
Expected: FAIL, `Cannot find module '../server/beeper'`

- [ ] **Step 3: Écrire le client**

`server/beeper.js` :

```js
'use strict';

const BASE = 'http://127.0.0.1:23373';

function config(opts) {
  return {
    base: (opts && opts.base) || BASE,
    token: (opts && opts.token) || process.env.BEEPER_TOKEN || ''
  };
}

async function appel(chemin, init, opts) {
  const c = config(opts);
  let res;
  try {
    res = await fetch(c.base + chemin, Object.assign({}, init, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + c.token,
        'Content-Type': 'application/json'
      }, (init && init.headers) || {})
    }));
  } catch (e) {
    throw new Error('Beeper injoignable : ' + e.message);
  }
  if (!res.ok) throw new Error('Beeper a refuse : ' + res.status);
  return res.json();
}

async function comptes(opts) {
  const data = await appel('/v1/accounts', {method: 'GET'}, opts);
  return (Array.isArray(data) ? data : []).map((a) => ({
    accountID: a.accountID, network: a.network, status: a.status
  }));
}

async function disponible(opts) {
  try { await comptes(opts); return true; }
  catch (e) { return false; }
}

async function chercherContacts(accountID, query, opts) {
  const data = await appel('/v1/accounts/' + encodeURIComponent(accountID) +
    '/contacts?query=' + encodeURIComponent(query), {method: 'GET'}, opts);
  return (data.items || []).map((c) => ({
    id: c.id, nom: c.fullName, telephone: c.phoneNumber || '', accountID
  }));
}

async function ouvrirChat(accountID, participantID, opts) {
  const data = await appel('/v1/chats', {method: 'POST', body: JSON.stringify({
    accountID, type: 'single', participantIDs: [participantID]
  })}, opts);
  return {chatID: data.id || data.chatID};
}

async function envoyer(chatID, texte, opts) {
  const data = await appel('/v1/chats/' + encodeURIComponent(chatID) + '/messages',
    {method: 'POST', body: JSON.stringify({text: texte})}, opts);
  return {ok: true, chatID: data.chatID, pendingMessageID: data.pendingMessageID};
}

module.exports = {comptes, disponible, chercherContacts, ouvrirChat, envoyer, BASE};
```

- [ ] **Step 4: Brancher les routes serveur**

Ajouter `const beeper = require('./beeper');` en tête de `server/api.js`, puis ces
routes dans `handle`, avant le `return {status: 404, ...}` final :

```js
  if (req.method === 'GET' && url === '/api/comptes') {
    try {
      return {status: 200, json: {comptes: await beeper.comptes()}};
    } catch (e) {
      return {status: 503, json: {erreur: e.message}};
    }
  }

  if (req.method === 'GET' && url === '/api/contacts') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const compte = q.get('compte');
    const nom = q.get('nom');
    if (!compte || !nom) return {status: 400, json: {erreur: 'compte et nom requis'}};
    try {
      return {status: 200, json: {contacts: await beeper.chercherContacts(compte, nom)}};
    } catch (e) {
      return {status: 503, json: {erreur: e.message}};
    }
  }

  if (req.method === 'POST' && url === '/api/relance') {
    if (!body || !body.chatId || !body.texte) {
      return {status: 400, json: {erreur: 'chatId et texte requis'}};
    }
    try {
      return {status: 200, json: await beeper.envoyer(body.chatId, body.texte)};
    } catch (e) {
      return {status: 503, json: {erreur: e.message}};
    }
  }
```

- [ ] **Step 5: Lancer tous les tests**

Run: `npm test`
Expected: toute la suite est verte, aucun test en echec

- [ ] **Step 6: Vérifier contre le vrai Beeper, en lecture seule**

Beeper doit tourner et `BEEPER_TOKEN` être défini.

Run: `node -e "require('./server/beeper').comptes().then(c=>console.log(c.length,'comptes')).catch(e=>console.log('ECHEC',e.message))"`
Expected: `6 comptes`

Run: `node -e "require('./server/beeper').chercherContacts('whatsapp','Martin').then(r=>console.log(r.length,'contacts, premier champ nom :',!!r[0].nom))"`
Expected: un nombre de contacts non nul et `true`

Ne pas appeler `envoyer` ici : cela expédierait un vrai message.

- [ ] **Step 7: Commit**

```bash
git add server/beeper.js server/api.js test/beeper.test.js
git commit -m "feat(beeper): client v1 conforme a l API observee"
```

---

### Task 9: Répertoire de personnes et file de relances

**Files:**
- Create: `server/people.js`
- Create: `data/people.md`
- Modify: `server/api.js`
- Test: `test/people.test.js`

**Interfaces:**
- Consumes: `store.openTasks`, `store.daysBetween`, `store.refOf`,
  `beeper.chercherContacts`, `beeper.ouvrirChat`.
- Produces: `loadPeople(dataDir) -> Person[]`, `savePeople(dataDir, gens)`,
  `relances(projects, gens, today) -> Relance[]`.

```
Person  = {id, nom, accountID, reseau, participantID, chatId, resolu_le}
Relance = {ref, projetId, projetTitre, tacheTitre, echeance, personne, attente, texte}
```

Une personne n'est joignable que lorsque `chatId` est renseigné. La recherche de
contacts donne un `participantID` par compte, et il faut ouvrir la conversation pour
obtenir le `chatId` : voir `docs/beeper-observe.md`.

`GET /api/etat` gagne les clés `people` et `relances`.
Nouvelle route `POST /api/personne` corps `{id, nom, accountID, participantID}` : elle
ouvre la conversation via Beeper pour obtenir le `chatId`, puis fige la fiche.

`data/people.md` porte une liste YAML simple, sans frontmatter. Le nom de fichier vient
de la spec, son contenu est du YAML pur.

- [ ] **Step 1: Créer le répertoire initial**

`data/people.md` :

```yaml
- id: bruno
  nom: Bruno Martin
  accountID: whatsapp
  reseau: WhatsApp
  participantID: ''
  chatId: ''
  resolu_le: ''
```

- [ ] **Step 2: Écrire le test qui échoue**

`test/people.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const people = require('../server/people');

const AUJ = '2026-09-06';

function tmpdata() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-p-'));
  fs.mkdirSync(path.join(d, 'projects'), {recursive: true});
  return d;
}
function annuaire() {
  return [{id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
    reseau: 'WhatsApp', participantID: '33600000000', chatId: 'chat-1',
    resolu_le: '2026-09-01'}];
}
function projetAvecDelegue(over) {
  return [{
    id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
    echeance: '', prochaine_action: 'faire', jira: '', dernier_n: 1, contexte: '',
    taches: [Object.assign({
      n: 2, titre: 'Relire la note de valeur', statut: 'bloque',
      responsable: 'bruno', echeance: '2026-09-09', nature_echeance: 'dure',
      prio: 'P1', effort: 'S', bloque_par: '', derniere_relance: '',
      prochaine_relance: AUJ, maj_le: '2026-08-24', note_blocage: ''
    }, over)]
  }];
}

test('loadPeople renvoie un tableau vide si le fichier manque', () => {
  assert.deepStrictEqual(people.loadPeople(tmpdata()), []);
});

test('savePeople puis loadPeople fait un aller-retour fidele', () => {
  const d = tmpdata();
  people.savePeople(d, annuaire());
  assert.deepStrictEqual(people.loadPeople(d), annuaire());
});

test('relances retient une tache deleguee dont la date est atteinte', () => {
  const r = people.relances(projetAvecDelegue({}), annuaire(), AUJ);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].ref, 'ES2');
  assert.strictEqual(r[0].personne.nom, 'Bruno Martin');
  assert.strictEqual(r[0].attente, 13, 'jours ecoules depuis maj_le');
  assert.match(r[0].texte, /Bruno/);
  assert.match(r[0].texte, /Relire la note de valeur/);
});

test('relances ignore une tache faite, une date future, et moi-meme', () => {
  assert.strictEqual(people.relances(projetAvecDelegue({statut: 'fait'}), annuaire(), AUJ).length, 0);
  assert.strictEqual(people.relances(projetAvecDelegue({prochaine_relance: '2026-09-20'}), annuaire(), AUJ).length, 0);
  assert.strictEqual(people.relances(projetAvecDelegue({responsable: 'moi'}), annuaire(), AUJ).length, 0);
});

test('relances ignore une personne absente du repertoire', () => {
  const r = people.relances(projetAvecDelegue({responsable: 'inconnu'}), annuaire(), AUJ);
  assert.strictEqual(r.length, 0);
});

test('relances ignore un contact dont la conversation n est pas resolue', () => {
  const sansChat = [Object.assign({}, annuaire()[0], {chatId: ''})];
  assert.strictEqual(people.relances(projetAvecDelegue({}), sansChat, AUJ).length, 0);
});
```

- [ ] **Step 3: Lancer le test et vérifier qu'il échoue**

Run: `node --test test/people.test.js`
Expected: FAIL, `Cannot find module '../server/people'`

- [ ] **Step 4: Écrire l'implémentation**

`server/people.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const store = require('./store');

function fichier(dataDir) {
  return path.join(dataDir, 'people.md');
}

function loadPeople(dataDir) {
  const f = fichier(dataDir);
  if (!fs.existsSync(f)) return [];
  const data = yaml.load(fs.readFileSync(f, 'utf8'));
  return Array.isArray(data) ? data : [];
}

function savePeople(dataDir, gens) {
  fs.mkdirSync(dataDir, {recursive: true});
  fs.writeFileSync(fichier(dataDir), yaml.dump(gens, {lineWidth: -1}), 'utf8');
}

function texteRelance(personne, projet, tache, attente) {
  const prenom = personne.nom.split(' ')[0];
  const quand = tache.echeance ? " d'ici le " + tache.echeance : ' cette semaine';
  return 'Salut ' + prenom + ", j'espere que tout roule.\n\n" +
    'Je reviens vers toi sur « ' + tache.titre + ' » (' + projet.titre + '), cale il y a ' +
    attente + ' jours.\nTu penses pouvoir me donner un point' + quand + ' ? ' +
    "Si c'est bloque quelque part, dis-le moi et on ajuste.\n\nMerci !";
}

function relances(projects, gens, today) {
  const par = {};
  gens.forEach((g) => { par[g.id] = g; });
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      if (t.responsable === 'moi') return;
      if (!t.prochaine_relance) return;
      if (store.daysBetween(t.prochaine_relance, today) > 0) return;
      const personne = par[t.responsable];
      if (!personne || !personne.chatId) return;
      const attente = t.maj_le ? -store.daysBetween(t.maj_le, today) : 0;
      out.push({
        ref: store.refOf(p, t), projetId: p.id, projetTitre: p.titre,
        tacheTitre: t.titre, echeance: t.echeance, personne, attente,
        texte: texteRelance(personne, p, t, attente)
      });
    });
  });
  return out;
}

module.exports = {loadPeople, savePeople, relances};
```

- [ ] **Step 5: Enrichir l'état et ajouter la résolution de contact**

Dans `server/api.js`, ajouter `const people = require('./people');` en tête, puis
remplacer le corps de `etat` :

```js
function etat(ctx) {
  const today = ctx.today || aujourdhui();
  const {projects, errors} = repo.loadAllSafe(ctx.projectsDir);
  const gens = people.loadPeople(ctx.dataDir);
  return {
    today,
    errors,
    people: gens,
    relances: people.relances(projects, gens, today),
    projects: projects.map((p) => Object.assign({}, p, {
      severite: store.severity(p, today),
      signaux: store.signals(p, today)
    }))
  };
}
```

Ajouter la route de résolution dans `handle`, avant le `return {status: 404, ...}` :

```js
  if (req.method === 'POST' && url === '/api/personne') {
    if (!body || !body.id || !body.nom || !body.accountID || !body.participantID) {
      return {status: 400, json: {erreur: 'id, nom, accountID et participantID requis'}};
    }
    let chatId = '';
    try {
      chatId = (await beeper.ouvrirChat(body.accountID, body.participantID)).chatID;
    } catch (e) {
      return {status: 503, json: {erreur: e.message}};
    }
    const gens = people.loadPeople(ctx.dataDir);
    const fiche = {id: body.id, nom: body.nom, accountID: body.accountID,
      reseau: body.reseau || body.accountID, participantID: body.participantID,
      chatId, resolu_le: ctx.today || aujourdhui()};
    const i = gens.findIndex((g) => g.id === body.id);
    if (i >= 0) gens[i] = fiche; else gens.push(fiche);
    people.savePeople(ctx.dataDir, gens);
    repo.commit(ctx.root, 'data: contact ' + body.nom + ' resolu');
    return {status: 200, json: {etat: etat(ctx)}};
  }
```

- [ ] **Step 6: Lancer tous les tests**

Run: `npm test`
Expected: toute la suite est verte, aucun test en echec

- [ ] **Step 7: Commit**

```bash
git add server/people.js server/api.js data/people.md test/people.test.js
git commit -m "feat(people): repertoire des contacts et file de relances calculee"
```

---

### Task 10: Le dashboard

**Files:**
- Modify: `web/index.html`
- Test: vérification manuelle dans le navigateur, décrite en Step 5

**Interfaces:**
- Consumes: `GET /api/etat`, `POST /api/tache`, `DELETE /api/tache`, `POST /api/ops`,
  `POST /api/relance`.
- Produces: le dashboard complet. Page unique, sans dépendance, sans étape de build.

- [ ] **Step 1: Reprendre la maquette validée**

La maquette Nuit publiée sur https://claude.ai/code/artifact/47473be2-231d-4632-a97a-f5ce37431c23
est la référence de mise en page et de style. En reprendre intégralement le bloc `<style>`, la
structure HTML et les fonctions de rendu.

Tokens à ne pas réinventer :

```
--paper:#14151A  --surface:#1B1D24  --surface-2:#22252E  --sunken:#101116
--ink:#ECEAE5    --ink-2:#A9A79F    --muted:#77746C
--rule:#31343E   --rule-soft:#282B33
--accent:#E2A03F --accent-soft:rgba(226,160,63,.13) --on-accent:#14151A
--ok:#5FAE7C     --warn:#D9A038     --crit:#E2705C
```

Polices : Bricolage Grotesque 800 en titrage, Figtree en texte, Martian Mono en données,
chargées depuis `fonts.googleapis.com`.

- [ ] **Step 2: Remplacer les données en dur par l'API**

Dans la maquette, `projects` et `people` sont des littéraux. Les supprimer et charger l'état :

```js
var etat = {projects: [], today: '', errors: []};

async function charger() {
  const r = await fetch('/api/etat');
  etat = await r.json();
  if (etat.errors.length) {
    toast(etat.errors.length + ' fichier(s) illisible(s), edition bloquee');
  }
  renderAll();
}

async function envoyerOps(ops) {
  const r = await fetch('/api/ops', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ops})
  });
  const data = await r.json();
  if (data.etat) etat = data.etat;
  renderAll();
  if (data.rejected.length) toast(data.rejected[0]);
  else if (data.applied.length) {
    toast(data.applied.length + (data.applied.length > 1
      ? ' changements appliques' : ' changement applique'));
  }
  return data;
}
```

Toutes les fonctions de rendu lisent désormais `etat.projects` et `etat.today`. Remplacer chaque
appel à `days(x)` par `daysBetween(x, etat.today)`, avec la même implémentation que
`store.daysBetween`, pour que l'affichage et le serveur calculent les mêmes jours.

- [ ] **Step 3: Brancher l'édition et l'ajout**

`saveEditor` envoie au serveur au lieu de muter un tableau local :

```js
async function saveEditor(projetId, n) {
  const titre = document.getElementById('e-titre').value.trim();
  if (!titre) { document.getElementById('e-titre').focus(); return toast('Il faut un intitule'); }
  const champs = {
    titre,
    statut: document.getElementById('e-st').value,
    responsable: document.getElementById('e-resp').value,
    echeance: document.getElementById('e-ech').value,
    nature_echeance: document.getElementById('e-nat').value,
    prio: document.getElementById('e-prio').value,
    effort: document.getElementById('e-eff').value
  };
  const p = etat.projects.find((x) => x.id === projetId);
  await envoyerOps([n === 0
    ? Object.assign({op: 'add_task', projet: projetId}, champs)
    : {op: 'update_task', ref: p.prefixe + n, champs}]);
  editing = null;
  renderAll();
}
```

Le bouton Supprimer envoie `{op: 'delete_task', ref: prefixe + n}` par la même fonction.

- [ ] **Step 4: Brancher l'envoi de relance**

Le panneau « Relances a valider » n'est plus calcule dans la page : il rend `etat.relances`,
deja compose par le serveur en Task 9, chaque entree portant `personne`, `texte` et `ref`. Le
menu deroulant Responsable du formulaire de tache se remplit depuis `etat.people`, plus
l'entree `moi`.

Le bouton d'envoi du tiroir appelle `POST /api/relance` avec `personne.chatId` et le texte de la
zone d'edition. Il n'affiche « transmise a Beeper » que sur reponse `ok` : l'envoi est
asynchrone, la reponse confirme la prise en compte, pas la remise. Sur 401, afficher que le
jeton Beeper est refuse et qu'il faut le reconfigurer. Sur 503, afficher que Beeper ne repond
pas et laisser la relance en attente, bouton actif.

**La zone de dictee reste presente mais desactivee dans cette tache**, avec la mention qu'elle
arrive a la tache suivante. La maquette l'alimentait par `claude.use('sample')`, une capacite
qui n'existe que dans un artifact publie et qui est absente d'une page servie par le serveur
local. La Task 10 bis la rebranche sur une vraie route.

- [ ] **Step 5: Vérifier dans le navigateur**

Run: `npm start`, puis ouvrir `http://127.0.0.1:5556`

Vérifier, dans cet ordre :
1. Le projet Estimmo apparaît avec son liseré de gravité.
2. Le clic sur la ligne déplie la tâche ES1.
3. Le clic sur ES1 ouvre le formulaire, changer la priorité en P1, Enregistrer.
4. `cat data/projects/estimmo.md` montre `prio: P1`.
5. `git log --oneline -1` montre un commit `data: ~ ES1  prio`.
6. « Ajouter une tâche » crée ES2, et le fichier porte `dernier_n: 2`.
7. Supprimer ES2, puis en recréer une : elle porte ES3, jamais ES2.

- [ ] **Step 6: Commit**

```bash
git add web/index.html
git commit -m "feat(web): dashboard branche sur l API, identite Nuit"
```

---

### Task 10 bis: Dictee en langage naturel

**Files:**
- Create: `server/dictee.js`
- Modify: `server/api.js`
- Modify: `web/index.html`
- Test: `test/dictee.test.js`

**Interfaces:**
- Consumes: `store.applyOps`, `api.appliquer`.
- Produces: `construirePrompt(projects, people, texte, today) -> string`,
  `extraireJson(sortie) -> {ops, message}`, `dicter(texte, ctx) -> Promise<{ops, message}>`.
  Route ajoutee : `POST /api/dictee` corps `{texte}`, reponse
  `{message, applied, rejected, commit, etat}`.

Pourquoi cette tache existe. La maquette validee alimentait la dictee par `claude.use('sample')`,
une capacite disponible uniquement dans un artifact publie sur claude.ai. La page est ici servie
par le serveur local : cette capacite n'existe pas. La voie conforme a la spec, qui prevoit
d'utiliser le compte Claude de l'utilisateur, est de lancer le binaire `claude` deja installe et
authentifie sur le poste.

Le serveur construit un prompt contenant l'etat courant des projets et la demande, lance
`claude -p <prompt>` en processus fils, recupere la sortie, en extrait le JSON, et passe les
operations a `appliquer`, donc a `applyOps`. Le point de validation unique reste inchange : la
dictee ne cree aucune voie d'ecriture privilegiee.

- [ ] **Step 1: Ecrire les tests des fonctions pures**

`test/dictee.test.js` teste `construirePrompt` et `extraireJson` sans lancer aucun processus.

`construirePrompt` doit produire un texte contenant l'etat serialise des projets, la liste des
identifiants de personnes disponibles, la date du jour, la demande de l'utilisateur, et la
consigne de repondre uniquement par un objet JSON de la forme
`{"ops": [...], "message": "..."}`. Il doit enumerer les six operations autorisees et leurs
champs, et interdire explicitement toute autre operation. Teste que le prompt contient bien la
demande de l'utilisateur, la date, et au moins les mots `add_task` et `delete_project`.

`extraireJson` doit retrouver l'objet JSON dans une sortie qui peut le contenir seul, entoure de
texte, ou dans un bloc de code Markdown. Elle renvoie `{ops, message}` avec `ops` toujours un
tableau, meme absent de la reponse. Une sortie sans JSON exploitable leve une erreur en francais.
Teste les quatre cas.

- [ ] **Step 2: Lancer les tests et verifier qu'ils echouent**

Run: `node --test test/dictee.test.js`
Expected: FAIL, `Cannot find module '../server/dictee'`

- [ ] **Step 3: Ecrire `server/dictee.js`**

Le lancement du processus utilise `execFile` de `node:child_process`, jamais `exec`, et passe le
prompt en argument de tableau pour qu'aucun shell n'interprete le texte de l'utilisateur.
Impose un delai maximal de 120 secondes et une taille de sortie maximale raisonnable. Une sortie
vide, un code de retour non nul, un depassement de delai, ou un binaire `claude` introuvable
donnent chacun une erreur portant une propriete `cause` en francais, sur le modele deja en place
dans `server/beeper.js`.

- [ ] **Step 4: Brancher la route**

`POST /api/dictee` valide que le corps porte un `texte` chaine non vide, sinon 400. Elle appelle
`dicter`, puis passe les operations obtenues a `appliquer`, et renvoie le `message` redige par
Claude a cote de `applied`, `rejected`, `commit` et `etat`. Une erreur de `dicter` donne un 503
avec un message en francais expliquant que Claude n'a pas pu etre interroge.

Ajoute un test verifiant qu'un corps sans `texte` donne 400 et qu'aucune ecriture n'a lieu.

- [ ] **Step 5: Rebrancher la zone de dictee du tableau de bord**

Retire l'appel a `claude.use('sample')` et tout le code qui en depend. La zone envoie desormais
son texte a `POST /api/dictee`, affiche « Je regarde... » pendant l'attente, puis le message
renvoye et la liste des operations appliquees. En cas d'erreur, affiche le message du serveur.
La zone est active des le chargement, sans test de disponibilite prealable.

- [ ] **Step 6: Verifier a la main**

Run: `npm start`, ouvrir `http://127.0.0.1:5556`, dicter `ajoute une tache sur Estimmo : relancer
le notaire, P2, pour le 20 septembre`, et verifier que la tache apparait et que le fichier
`data/projects/estimmo.md` la contient.

- [ ] **Step 7: Commit**

```bash
git add server/dictee.js server/api.js web/index.html test/dictee.test.js
git commit -m "feat(dictee): dictee en langage naturel via le binaire claude local"
```

---

### Task 11: Agent hebdomadaire

**Files:**
- Create: `agent/weekly-recap.md`
- Create: `agent/run-weekly.ps1`
- Create: `data/history/.gitkeep`

**Interfaces:**
- Consumes: `data/projects/`, le serveur MCP Beeper, `data/history/.last-ingest`.
- Produces: `data/history/AAAA-MM-JJ-recap.md` et un message Beeper.

- [ ] **Step 1: Écrire le prompt de l'agent**

`agent/weekly-recap.md` :

```markdown
Tu es le secretaire du proprietaire. Nous sommes mardi, il est 17h.

## Ce que tu dois faire, dans cet ordre

1. Lis tous les fichiers de `data/projects/`.

2. Ingestion des notes. Lis le fichier `data/history/.last-ingest` : il contient un curseur
   Beeper opaque, ou rien au premier passage. Via le serveur MCP Beeper, lis les messages du fil
   note a soi-meme designe dans `data/config.json`, avec `direction: after` et ce curseur. Au
   premier passage, sans curseur, ne remonte pas plus loin que les sept derniers jours.
   Transforme chaque message en tache dans le projet qui convient, en editant le fichier
   Markdown. Si le projet n est pas evident, cree la tache dans le projet dont le titre est le
   plus proche et signale le dans le recap. Ecris ensuite dans `.last-ingest` la valeur de
   `newestCursor` renvoyee par Beeper. C est ce curseur, et non une marque posee sur les
   messages, qui garantit qu une note n est ingeree qu une fois.

3. Calcule les cinq signaux sur chaque projet, avec les regles exactes de
   `docs/superpowers/specs/2026-09-06-agent-secretaire-design.md`, section 5.

4. Ecris `data/history/AAAA-MM-JJ-recap.md` avec ces sections :
   - Ce qui a bouge depuis le recap precedent
   - Echeances a moins de 14 jours
   - Projets sans prochaine action
   - Projets dormants depuis plus de 30 jours
   - Relances proposees : une par tache deleguee dont la prochaine relance est atteinte, avec
     le texte que tu proposes d envoyer

5. Envoie le recap au proprietaire sur Beeper, en un seul message, via le serveur MCP.

## Regles

- N envoie AUCUN message a une autre personne que le proprietaire. Les relances vers des tiers
  attendent une validation dans le dashboard. Tu les rediges, tu ne les envoies pas.
- N ecris jamais le caractere tiret cadratin.
- Pour les projets de domaine `pro`, ne developpe aucun detail metier : titre, statut,
  echeance et reference Jira uniquement.
- Si Beeper ne repond pas, ecris quand meme le fichier de recap et arrete toi la.
```

- [ ] **Step 2: Écrire le script de lancement**

`agent/run-weekly.ps1` :

```powershell
$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot
Set-Location $racine

$journal = Join-Path $racine "data\history\run.log"
$prompt  = Get-Content -Raw (Join-Path $PSScriptRoot "weekly-recap.md")

"$(Get-Date -Format o) demarrage" | Add-Content -Encoding utf8 $journal
try {
  claude -p $prompt --permission-mode acceptEdits 2>&1 |
    Add-Content -Encoding utf8 $journal
  "$(Get-Date -Format o) termine" | Add-Content -Encoding utf8 $journal
} catch {
  "$(Get-Date -Format o) echec : $_" | Add-Content -Encoding utf8 $journal
}
```

- [ ] **Step 3: Créer la configuration et le dossier d'historique**

`data/config.json` :

```json
{
  "filNoteASoiMeme": "",
  "commentaire": "Renseigner l identifiant du fil Beeper servant de note a soi-meme, releve avec la commande de l etape 4."
}
```

Run: `mkdir -p data/history && touch data/history/.gitkeep`

- [ ] **Step 4: Désigner le fil de notes**

Run: `curl -s -H "Authorization: Bearer $BEEPER_TOKEN" "http://127.0.0.1:23373/v1/chats/search?query=note"`

Repérer le fil de note à soi-même et reporter son identifiant dans `filNoteASoiMeme`.

- [ ] **Step 5: Tester l'agent à la main avant de le planifier**

Run: `powershell -ExecutionPolicy Bypass -File agent/run-weekly.ps1`

Expected: un fichier apparaît dans `data/history/`, contenant les cinq sections. Vérifier
qu'aucun message n'est parti vers un tiers en consultant les conversations dans Beeper.

- [ ] **Step 6: Planifier le mardi 17h**

```bash
schtasks /create /tn "Secretariat - recap hebdo" /sc WEEKLY /d TUE /st 17:00 /f /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File <dossier du depot>\agent\run-weekly.ps1"
```

Vérifier : `schtasks /query /tn "Secretariat - recap hebdo"`

- [ ] **Step 7: Commit**

```bash
git add agent/ data/config.json data/history/.gitkeep
git commit -m "feat(agent): recap hebdomadaire du mardi 17h"
```

---

### Task 12: Documentation

**Files:**
- Create: `CLAUDE.md`
- Create: `README.md`
- Create: `FEATURES.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la documentation d'usage.

- [ ] **Step 1: Écrire CLAUDE.md**

C'est le fichier que Claude Code lit quand l'utilisateur dicte des tâches depuis le terminal.
Il doit contenir : le format exact d'un fichier projet avec un exemple complet, la règle des
références à deux lettres, la règle de non-réattribution des numéros, la liste des valeurs
autorisées pour chaque champ, la règle du tiret cadratin, la règle pro, et l'interdiction
d'envoyer un message à un tiers sans validation humaine.

Ajouter la convention de documentation, reprise du projet `planner` : à chaque évolution
fonctionnelle, mettre à jour `README.md` et ajouter une itération numérotée dans `FEATURES.md`.

- [ ] **Step 2: Écrire README.md**

Sections : ce que fait le système, démarrage (`npm install` puis `npm start`, ouvrir
`http://127.0.0.1:5556`), les trois portes d'entrée, le rôle du récap du mardi, la variable
`BEEPER_TOKEN`, et où trouver la spec.

- [ ] **Step 3: Écrire FEATURES.md**

Une section « Itération 1 » listant ce que couvre cette première livraison, avec la date.

- [ ] **Step 4: Vérifier l'absence de tiret cadratin dans tout le dépôt**

Run: `grep -rn "$(printf '\xe2\x80\x94')" --include="*.md" --include="*.js" --include="*.html" --include="*.ps1" .`
Expected: aucune sortie

- [ ] **Step 5: Lancer la suite complète**

Run: `npm test`
Expected: toute la suite est verte, aucun test en echec

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md FEATURES.md
git commit -m "docs: conventions de saisie, demarrage et journal des iterations"
```
