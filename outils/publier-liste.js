'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config');
const sortante = require('../server/liste-sortante');

// Publie dans la conversation a soi-meme la liste de taches tenue a jour :
// toutes les taches ouvertes, classees par priorite, en libelles courts. C'est
// le sens retour de l'ingestion assuree par server/lancement.js.
//
// Rien n'est envoye si la liste deja presente dans la conversation designe
// exactement les memes taches dans le meme ordre. Lance toutes les heures par
// une tache planifiee, ce script reste donc silencieux tant que rien ne bouge.
//
// La destination est `filTachesWhatsApp` de data/config.json, jamais autre
// chose. Absente, le script ne fait rien et le dit : un utilisateur qui clone
// le projet ne doit envoyer aucun message sans l'avoir configure lui-meme.

const RACINE = path.join(__dirname, '..');
const DATA_DIR = path.join(RACINE, 'data');
const JOURNAL = path.join(DATA_DIR, 'history', 'liste-sortante.log');

function journaliser(ligne) {
  try {
    fs.mkdirSync(path.dirname(JOURNAL), {recursive: true});
    fs.appendFileSync(JOURNAL, '[' + new Date().toISOString() + '] ' + ligne + '\n', 'utf8');
  } catch (e) {
    // Un journal non ecrit ne doit pas faire echouer la publication.
  }
}

async function principal() {
  if (!config.lireConfig(DATA_DIR).filTachesWhatsApp) {
    const m = 'filTachesWhatsApp absent de data/config.json : rien a publier.';
    console.log(m);
    journaliser(m);
    return 0;
  }

  const ctx = {
    dataDir: DATA_DIR,
    projectsDir: path.join(DATA_DIR, 'projects'),
    root: RACINE
  };

  let r;
  try {
    r = await sortante.publier(ctx);
  } catch (e) {
    journaliser('echec inattendu : ' + e.message);
    console.error('echec : ' + e.message);
    return 1;
  }

  if (r.envoye) {
    const m = 'liste publiee, ' + r.lignes.length + ' taches';
    console.log(m);
    journaliser(m);
    return 0;
  }

  const m = 'rien envoye (' + r.raison + (r.message ? ' : ' + r.message : '') + ')';
  console.log(m);
  journaliser(m);
  // Une conversation non configuree, une liste inchangee ou un portefeuille
  // vide sont des situations normales, pas des echecs : la tache planifiee ne
  // doit pas apparaitre en erreur pour autant.
  return (r.raison === 'beeper_indisponible' || r.raison === 'envoi_echoue') ? 1 : 0;
}

principal().then((code) => { process.exitCode = code; });
