'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Valeurs de repli explicites : ce module ne leve jamais, meme sur un fichier
// absent, illisible ou un dossier inexistant. proprietaire vaut alors "l'utilisateur"
// (utilise tel quel dans les prompts, voir server/dictee.js), et filNoteASoiMeme une
// chaine vide (aucun fil de notes configure, l'agent hebdomadaire s'arrete alors sur
// une erreur explicite plutot que d'ecrire quelque part au hasard).
const REPLI = {proprietaire: "l'utilisateur", filNoteASoiMeme: '', filTachesWhatsApp: ''};

function fichier(dataDir) {
  return path.join(dataDir, 'config.json');
}

function lireConfig(dataDir) {
  let brut;
  try {
    brut = fs.readFileSync(fichier(dataDir), 'utf8');
  } catch (e) {
    return Object.assign({}, REPLI);
  }
  let data;
  try {
    data = JSON.parse(brut);
  } catch (e) {
    return Object.assign({}, REPLI);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return Object.assign({}, REPLI);
  }
  return {
    proprietaire: typeof data.proprietaire === 'string' && data.proprietaire.trim() !== ''
      ? data.proprietaire : REPLI.proprietaire,
    filNoteASoiMeme: typeof data.filNoteASoiMeme === 'string'
      ? data.filNoteASoiMeme : REPLI.filNoteASoiMeme,
    // Conversation a soi-meme ou est tenue la liste de taches manuscrite. Vide
    // par defaut : le rapprochement au lancement est alors simplement inactif,
    // et rien n'est propose. C'est une conversation distincte de
    // filNoteASoiMeme, qui sert aux notes en prose ingerees par l'agent.
    filTachesWhatsApp: typeof data.filTachesWhatsApp === 'string'
      ? data.filTachesWhatsApp : REPLI.filTachesWhatsApp
  };
}

// Remplace toutes les occurrences du marqueur {{PROPRIETAIRE}} par le nom fourni.
// Fonction pure, utilisee par agent/run-weekly.js pour personnaliser le gabarit
// agent/weekly-recap.md juste avant d'envoyer le prompt sur l'entree standard du
// binaire claude (tache 16 : rendre le depot installable sans nom propre en dur).
const MARQUEUR_PROPRIETAIRE = '{{PROPRIETAIRE}}';

function substituerProprietaire(gabarit, proprietaire) {
  return gabarit.split(MARQUEUR_PROPRIETAIRE).join(proprietaire);
}

module.exports = {lireConfig, substituerProprietaire};
