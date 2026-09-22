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
  echeance: '', prochaine_action: '', jira: '', dernier_n: 0, ordre: 0
};

function parseProject(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new InvalidProjectError('frontmatter absent');

  let meta;
  try {
    meta = yaml.load(m[1], {schema: yaml.JSON_SCHEMA});
  } catch (e) {
    throw new InvalidProjectError('YAML illisible : ' + e.message);
  }
  if (!meta || typeof meta !== 'object') throw new InvalidProjectError('frontmatter vide');
  if (!meta.id) throw new InvalidProjectError('champ id manquant');

  const project = Object.assign({}, PROJECT_DEFAULTS);
  Object.keys(PROJECT_DEFAULTS).forEach((k) => {
    if (meta[k] != null) project[k] = meta[k];
  });
  // Meme regle de format de date que celle deja appliquee dans applyOps : soit la
  // chaine vide, soit AAAA-MM-JJ exact. Une date mal saisie a la main (fichier
  // modifie hors de l API) doit etre signalee ici, au chargement, plutot que de
  // faire lever daysBetween bien plus tard et d emporter tout le serveur avec elle.
  if (dateInvalide(project.echeance)) {
    throw new InvalidProjectError(
      'date invalide pour echeance : ' + JSON.stringify(project.echeance));
  }

  project.taches = (meta.taches || []).map((raw) => {
    if (typeof raw.n !== 'number') throw new InvalidProjectError('tache sans numero');
    const t = Object.assign({n: raw.n}, TASK_DEFAULTS);
    TASK_FIELDS.forEach((k) => { if (raw[k] != null) t[k] = raw[k]; });
    CHAMPS_DATE.forEach((k) => {
      if (dateInvalide(t[k])) {
        throw new InvalidProjectError(
          'date invalide pour ' + k + ' (tache ' + t.n + ') : ' + JSON.stringify(t[k]));
      }
    });
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
  const tete = lettres ? lettres[0] : 'X';

  if (lettres) {
    for (let i = 1; i < lettres.length; i++) {
      const essai = tete + lettres[i];
      if (!pris.has(essai)) return essai;
    }
  }

  for (let c = 65; c <= 90; c++) {
    const essai = tete + String.fromCharCode(c);
    if (!pris.has(essai)) return essai;
  }

  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const essai = String.fromCharCode(a) + String.fromCharCode(b);
      if (!pris.has(essai)) return essai;
    }
  }

  throw new Error('impossible d attribuer un prefixe');
}

function daysBetween(iso, today) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (typeof iso !== 'string' || !datePattern.test(iso)) {
    throw new Error(`Date invalide pour iso: ${JSON.stringify(iso)}`);
  }
  if (typeof today !== 'string' || !datePattern.test(today)) {
    throw new Error(`Date invalide pour today: ${JSON.stringify(today)}`);
  }

  const a = Date.UTC(...iso.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  const b = Date.UTC(...today.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  return Math.round((a - b) / 86400000);
}

// Ajoute n jours (positif ou negatif) a une date AAAA-MM-JJ, en UTC comme
// daysBetween, pour ne jamais deriver d'un fuseau horaire local. Utilisee pour
// reporter prochaine_relance de sept jours apres un envoi reussi (voir I3, revue
// finale).
function addDays(iso, n) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof iso !== 'string' || !datePattern.test(iso)) {
    throw new Error(`Date invalide pour iso: ${JSON.stringify(iso)}`);
  }
  const [an, mois, jour] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(an, mois - 1, jour + n));
  const p = (v) => String(v).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
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
    wipEleve: ouvertes.filter((t) => t.statut === 'en_cours').length >= 3,
    // Signal 6, en retard : fait acquis (echeance depassee), distinct d une relance
    // due qui reste une action a mener. Seule une echeance de tache de nature
    // "dure" compte ici, une echeance "souhaitee" n est qu une intention.
    enRetard: ouvertes.length > 0 && (
      (!!project.echeance && daysBetween(project.echeance, today) < 0) ||
      ouvertes.some((t) => t.nature_echeance === 'dure' && !!t.echeance &&
        daysBetween(t.echeance, today) < 0))
  };
}

function severity(project, today) {
  if (openTasks(project).length === 0) return 'idle';
  const s = signals(project, today);
  if (s.enRetard) return 'retard';
  if (s.relanceDue) return 'crit';
  if (s.echeanceProche || s.sansProchaineAction || s.dormant || s.wipEleve) return 'warn';
  return 'ok';
}

const DOMAINES = {
  statut: ['a_faire', 'en_cours', 'bloque', 'fait', 'abandonne'],
  nature_echeance: ['dure', 'souhaitee'],
  prio: ['P1', 'P2', 'P3', 'P4'],
  effort: ['S', 'M', 'L']
};

// Domaines fermes propres aux champs de projet. Un projet porte lui aussi un champ
// statut et (a la difference d une tache) un champ domaine, mais avec des valeurs
// disjointes de celles ci-dessus : ce jeu remplace entierement DOMAINES quand
// champsInvalides est appele pour add_project/update_project, il ne s'y ajoute pas,
// pour ne jamais valider le statut d'un projet contre les valeurs de statut d'une tache.
const DOMAINES_PROJET = {
  domaine: ['side', 'perso', 'pro'],
  statut: ['actif', 'en_pause', 'termine', 'abandonne']
};
const CHAMPS_TACHE = ['titre', 'statut', 'responsable', 'echeance',
  'nature_echeance', 'prio', 'effort', 'bloque_par', 'derniere_relance',
  'prochaine_relance', 'note_blocage'];
const CHAMPS_PROJET = ['titre', 'domaine', 'echeance', 'prochaine_action', 'statut', 'jira'];

// Champs date : chaine vide (pas de date) ou format AAAA-MM-JJ exact, rien d'autre.
// Ces quatre champs de tache et le champ echeance de projet partagent la regle.
// maj_le y figure au meme titre que les trois autres (revue finale, point C1) :
// sans lui, une date mal saisie a la main (par exemple au format francophone
// 09/09/2026) passait le chargement sans etre signalee, pour ne faire lever que
// bien plus tard le calcul du signal dormant (daysBetween), et avec lui tout le
// portefeuille servi par GET /api/etat.
const CHAMPS_DATE = ['echeance', 'derniere_relance', 'prochaine_relance', 'maj_le'];
const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Identifiant de projet : sert a construire un nom de fichier (voir repo.js), donc
// exclut toute possibilite de remontee de repertoire (../), de separateur (/, \) ou
// de caractere qui sortirait du nom de fichier attendu. Minuscules, chiffres,
// tiret et underscore uniquement, 1 a 64 caracteres.
const FORMAT_ID = /^[a-z0-9][a-z0-9_-]*$/;

function idValide(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 64 && FORMAT_ID.test(id);
}

function dateInvalide(valeur) {
  return typeof valeur !== 'string' || (valeur !== '' && !FORMAT_DATE.test(valeur));
}

function champsInvalides(champs, domaines) {
  const referentiel = domaines || DOMAINES;
  const mauvais = [];
  Object.keys(champs || {}).forEach((k) => {
    const v = champs[k];
    if (referentiel[k]) {
      if (!referentiel[k].includes(v)) mauvais.push(k + '=' + v);
    } else if (CHAMPS_DATE.includes(k)) {
      if (dateInvalide(v)) mauvais.push(k + '=' + v);
    } else if (k !== 'n' && typeof v !== 'string') {
      mauvais.push(k + '=' + v);
    }
  });
  return mauvais;
}

// Applique une liste d'operations structurees a une copie de projects. Seule porte
// d'ecriture du systeme : valide chaque operation avant de la muter, et aucune
// operation absente de la liste ci-dessous ne peut s'executer (donc aucune ne peut
// envoyer de message a qui que ce soit).
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
        // note_blocage n'est efface que si le statut fait explicitement partie des
        // champs modifies par cette operation et que sa nouvelle valeur n'est plus
        // bloque : une operation qui ne touche pas au statut laisse la note intacte.
        if (Object.prototype.hasOwnProperty.call(champs, 'statut') && champs.statut !== 'bloque') {
          champs.note_blocage = '';
        }
        Object.assign(hit.task, champs, {maj_le: today});
        applied.push('~ ' + o.ref.toUpperCase() + '  ' + Object.keys(champs).join(', '));

      } else if (op === 'delete_task') {
        const hit = findByRef(etat, o.ref);
        if (!hit) return rejected.push('reference inconnue : ' + o.ref);
        hit.project.dernier_n = Math.max(hit.project.dernier_n || 0, hit.task.n);
        hit.project.taches = hit.project.taches.filter((t) => t.n !== hit.task.n);
        applied.push('- ' + o.ref.toUpperCase());

      } else if (op === 'add_project') {
        if (!idValide(o.id)) {
          return rejected.push('identifiant de projet invalide : ' + JSON.stringify(o.id));
        }
        if (etat.some((x) => x.id === o.id)) return rejected.push('projet deja present : ' + o.id);
        const champs = {};
        CHAMPS_PROJET.forEach((k) => { if (o[k] != null) champs[k] = o[k]; });
        // Meme validation que les autres operations (voir add_task, update_task,
        // update_project) : sans ce garde-fou, un domaine ou un statut de projet hors
        // liste fermee, ou une echeance mal formee, n'etait rejete que bien plus tard
        // par la relecture de repo.saveAll, en 500 brut plutot qu'en refus propre.
        const mauvais = champsInvalides(champs, DOMAINES_PROJET);
        if (mauvais.length) return rejected.push('valeurs refusees : ' + mauvais.join(', '));
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
        const champs = {};
        CHAMPS_PROJET.forEach((k) => {
          if (o.champs && o.champs[k] != null) champs[k] = o.champs[k];
        });
        const mauvais = champsInvalides(champs, DOMAINES_PROJET);
        if (mauvais.length) return rejected.push('valeurs refusees : ' + mauvais.join(', '));
        // Alignee sur update_task (revue finale, correction mineure) : un objet de
        // champs vide n a rien a appliquer. Sans ce garde-fou, l operation
        // rejoignait quand meme applied, declenchait une sauvegarde et un commit
        // qui echouait faute de contenu, et la page annoncait un changement qui
        // n avait pas eu lieu.
        if (!Object.keys(champs).length) return rejected.push('aucun champ a modifier');
        Object.assign(p, champs);
        applied.push('~ projet ' + p.titre);

      } else if (op === 'reorder_projects') {
        const ids = Array.isArray(o.ids) ? o.ids : null;
        if (!ids) return rejected.push('liste ids manquante');
        const existants = etat.map((x) => x.id);
        const memeEnsemble = ids.length === existants.length &&
          new Set(ids).size === ids.length &&
          existants.every((id) => ids.includes(id));
        if (!memeEnsemble) {
          return rejected.push('reorder_projects : la liste doit etre une permutation exacte des projets existants');
        }
        ids.forEach((id, i) => {
          etat.find((x) => x.id === id).ordre = i;
        });
        applied.push('= ordre des projets');

      } else if (op === 'reorder_tasks') {
        const p = etat.find((x) => x.id === o.projet || x.prefixe === o.projet);
        if (!p) return rejected.push('projet inconnu : ' + o.projet);
        const ordre = Array.isArray(o.ordre) ? o.ordre : null;
        if (!ordre) return rejected.push('liste ordre manquante');
        const existants = p.taches.map((t) => t.n);
        const memeEnsemble = ordre.length === existants.length &&
          new Set(ordre).size === ordre.length &&
          existants.every((n) => ordre.includes(n));
        if (!memeEnsemble) {
          return rejected.push('reorder_tasks : la liste doit etre une permutation exacte des taches du projet');
        }
        p.taches = ordre.map((n) => p.taches.find((t) => t.n === n));
        applied.push('= ordre des taches de ' + p.prefixe);

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

module.exports = {InvalidProjectError, parseProject, serializeProject,
  TASK_FIELDS, TASK_DEFAULTS, PROJECT_DEFAULTS,
  refOf, parseRef, findByRef, nextTaskNumber, allocatePrefix,
  daysBetween, addDays, openTasks, signals, severity,
  applyOps, DOMAINES, DOMAINES_PROJET, idValide};
