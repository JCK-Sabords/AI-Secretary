'use strict';
const crypto = require('node:crypto');
const store = require('./store');
const repo = require('./repo');
const people = require('./people');

// Parametres de derivation de cle, partages avec le gabarit navigateur
// (WebCrypto), qui doit reproduire exactement ces memes valeurs pour
// pouvoir dechiffrer le paquet cote client.
const PBKDF2_ITERATIONS = 600000;
const SEL_OCTETS = 16;
const IV_OCTETS = 12;

// Construit un instantane du tableau de bord, pret a afficher en lecture
// seule sur telephone. Reutilise les fonctions existantes de store, repo et
// people sans dupliquer leur logique metier (calcul de severite, signaux,
// relances...).
//
// Retire systematiquement tout identifiant de contact : une personne n'y
// figure que par son nom. Ni chatId, ni participantID, ni accountID
// n'apparaissent nulle part, ni dans un repertoire de personnes, ni dans les
// relances. La configuration (fil de notes, code d'acces) n'y figure pas
// non plus : cette fonction ne lit jamais data/config.json.
function construireInstantane(dataDir, today) {
  const projectsDir = require('node:path').join(dataDir, 'projects');
  const {projects} = repo.loadAllSafe(projectsDir);
  const {people: gens} = people.loadPeopleSafe(dataDir);

  const projetsEnrichis = projects.map((p) => {
    let severite = null;
    let signaux = [];
    try {
      severite = store.severity(p, today);
      signaux = store.signals(p, today);
    } catch (e) {
      // Un projet dont le calcul echoue est tout de meme publie, sans
      // severite ni signaux, plutot que de faire echouer tout l'export.
    }
    return {
      id: p.id,
      titre: p.titre,
      domaine: p.domaine,
      statut: p.statut,
      echeance: p.echeance,
      prochaine_action: p.prochaine_action,
      severite,
      signaux,
      taches: store.openTasks(p).map((t) => ({
        ref: store.refOf(p, t),
        titre: t.titre,
        statut: t.statut,
        echeance: t.echeance,
        nature_echeance: t.nature_echeance,
        prio: t.prio
      }))
    };
  });

  // Ma semaine : les taches ouvertes dont moi je porte la charge, echeance
  // la plus proche d'abord, sur le meme modele que le tableau de bord web.
  const maSemaine = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => {
      if (t.responsable !== 'moi') return;
      maSemaine.push({
        ref: store.refOf(p, t), projetTitre: p.titre, titre: t.titre,
        echeance: t.echeance, nature_echeance: t.nature_echeance
      });
    });
  });
  maSemaine.sort((a, b) => (a.echeance || '9999-99-99').localeCompare(b.echeance || '9999-99-99'));

  // Relances : seul le nom de la personne est conserve, jamais son
  // identifiant de conversation.
  const relances = people.relances(projects, gens, today).map((r) => ({
    ref: r.ref, projetTitre: r.projetTitre, tacheTitre: r.tacheTitre,
    echeance: r.echeance, attente: r.attente, nom: r.personne.nom
  }));
  const relancesBloquees = people.relancesBloquees(projects, gens, today).map((r) => ({
    ref: r.ref, projetTitre: r.projetTitre, tacheTitre: r.tacheTitre,
    echeance: r.echeance, raison: r.raison
  }));

  return {
    today,
    genereLe: new Date().toISOString(),
    maSemaine,
    relances,
    relancesBloquees,
    projects: projetsEnrichis
  };
}

// Chiffre un texte avec un code. Derivation de cle par PBKDF2-SHA256
// (sel aleatoire de 16 octets, 600000 iterations), chiffrement AES-256-GCM
// (IV aleatoire de 12 octets). Le paquet renvoye porte tout ce qu'il faut
// pour dechiffrer sauf le code lui-meme : sel, iv, texte chiffre + etiquette
// d'authentification, nombre d'iterations, tout encode en base64.
function chiffrer(texte, code) {
  const sel = crypto.randomBytes(SEL_OCTETS);
  const iv = crypto.randomBytes(IV_OCTETS);
  const cle = crypto.pbkdf2Sync(code, sel, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', cle, iv);
  const chiffre = Buffer.concat([cipher.update(texte, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sel: sel.toString('base64'),
    iv: iv.toString('base64'),
    texte: chiffre.toString('base64'),
    etiquette: tag.toString('base64'),
    iterations: PBKDF2_ITERATIONS
  };
}

// Dechiffre un paquet produit par chiffrer(). Utilise par les tests pour
// verifier l'aller-retour sans dupliquer WebCrypto en Node.
function dechiffrer(paquet, code) {
  const sel = Buffer.from(paquet.sel, 'base64');
  const iv = Buffer.from(paquet.iv, 'base64');
  const chiffre = Buffer.from(paquet.texte, 'base64');
  const tag = Buffer.from(paquet.etiquette, 'base64');
  const cle = crypto.pbkdf2Sync(code, sel, paquet.iterations, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', cle, iv);
  decipher.setAuthTag(tag);
  const clair = Buffer.concat([decipher.update(chiffre), decipher.final()]);
  return clair.toString('utf8');
}

module.exports = {construireInstantane, chiffrer, dechiffrer, PBKDF2_ITERATIONS};
