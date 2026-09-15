'use strict';

// Outil de configuration : aide a trouver l'identifiant du fil « note a soi-meme »
// a coller dans le champ filNoteASoiMeme de data/config.json (tache 16, etape la
// plus obscure de l'installation : voir README.md).
//
// N'ecrit rien, n'envoie aucun message, ne modifie aucun fichier : il se contente
// d'interroger l'API Beeper locale en lecture (GET /v1/chats/search) et d'afficher
// les conversations dont le titre evoque une note a soi-meme, avec leur identifiant.
//
// Usage : npm run trouver-fil-notes
// Prerequis : Beeper Desktop lance sur ce poste, variable d'environnement
// BEEPER_TOKEN definie (voir README.md, section configuration).

const BASE = 'http://127.0.0.1:23373';
const DELAI_MS = 10000;

// Plusieurs mots-cles, plutot qu'un seul : une note a soi-meme peut porter des
// titres tres differents selon la messagerie et la langue de l'utilisateur.
// Les resultats des trois recherches sont fusionnes et deduplique par identifiant.
const MOTS_CLES = ['note', 'soi-meme', 'self', 'moi-meme'];

function jeton() {
  return process.env.BEEPER_TOKEN || '';
}

async function rechercher(motCle, token) {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
  let res;
  try {
    res = await fetch(BASE + '/v1/chats/search?query=' + encodeURIComponent(motCle), {
      signal: controle.signal,
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    });
  } catch (e) {
    const err = new Error('injoignable');
    err.cause = 'injoignable';
    throw err;
  } finally {
    clearTimeout(minuteur);
  }

  if (!res.ok) {
    const err = new Error('refus (statut ' + res.status + ')');
    err.cause = (res.status === 401 || res.status === 403) ? 'authentification' : 'refus';
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    const err = new Error('reponse illisible');
    err.cause = 'reponse_illisible';
    throw err;
  }
  return Array.isArray(data && data.items) ? data.items : [];
}

// Un item de conversation renvoye par Beeper peut porter plusieurs noms de champ
// selon la version de l'API (voir docs/beeper-observe.md, ou id est le champ
// canonique et chatID un alias deprecie conserve pour compatibilite). On affiche
// tout ce qui est disponible plutot que de parier sur un seul nom de champ.
function identifiant(item) {
  return item.id || item.chatID || '';
}

function titre(item) {
  return item.title || item.name || '(sans titre)';
}

function reseau(item) {
  return item.network || item.accountID || '';
}

// Beeper fait une recherche floue sur GET /v1/chats/search, pas une recherche
// stricte sur le seul titre : une recherche sur "note" remonte par exemple toute
// conversation dont un message contient ce mot. On filtre donc nous-memes sur le
// titre, pour ne garder que ce qui evoque vraiment une note a soi-meme.
const MOTIF_TITRE = /note[\s-]*(a|à)?[\s-]*soi|note to self|self[\s-]*note|moi[\s-]*m[eê]me/i;

function evoqueNoteASoiMeme(item) {
  return MOTIF_TITRE.test(titre(item));
}

async function main() {
  const token = jeton();
  if (!token) {
    console.log(
      "La variable d'environnement BEEPER_TOKEN n'est pas definie.\n\n" +
      'Pour la definir sous Windows (PowerShell), en remplacant <jeton> par votre ' +
      'jeton Beeper Desktop :\n' +
      '  [Environment]::SetEnvironmentVariable("BEEPER_TOKEN", "<jeton>", "User")\n' +
      'puis rouvrez le terminal pour que la variable soit prise en compte, et ' +
      'relancez : npm run trouver-fil-notes');
    process.exitCode = 1;
    return;
  }

  const trouves = new Map();
  let uneRechercheAReussi = false;
  let derniereErreur = null;

  for (const motCle of MOTS_CLES) {
    try {
      const items = await rechercher(motCle, token);
      uneRechercheAReussi = true;
      items.forEach((item) => {
        const id = identifiant(item);
        if (id && !trouves.has(id)) trouves.set(id, item);
      });
    } catch (e) {
      derniereErreur = e;
    }
  }

  if (!uneRechercheAReussi) {
    const cause = derniereErreur && derniereErreur.cause;
    if (cause === 'authentification') {
      console.log(
        'Beeper a refuse le jeton BEEPER_TOKEN (jeton absent ou perime).\n' +
        'Verifiez sa valeur, redefinissez-la si besoin, puis relancez ce script.');
    } else if (cause === 'injoignable') {
      console.log(
        "Beeper Desktop ne repond pas sur " + BASE + ".\n" +
        "Verifiez que l'application Beeper Desktop est bien lancee sur ce poste " +
        '(icone dans la barre des taches), puis relancez ce script.');
    } else {
      console.log(
        "Beeper Desktop n'a pas pu etre interroge (" +
        (derniereErreur ? derniereErreur.message : 'cause inconnue') + ').\n' +
        'Verifiez que Beeper Desktop est lance et que BEEPER_TOKEN est correct, ' +
        'puis relancez ce script.');
    }
    process.exitCode = 1;
    return;
  }

  if (trouves.size === 0) {
    console.log(
      "Aucune conversation trouvee pour les mots-cles essayes (" + MOTS_CLES.join(', ') + ").\n" +
      'Ouvrez Beeper Desktop, retrouvez votre fil de note a soi-meme a la main, et ' +
      "copiez son identifiant de conversation dans filNoteASoiMeme (data/config.json).");
    return;
  }

  const evocateurs = [...trouves.values()].filter(evoqueNoteASoiMeme);
  const afficher = (item) => {
    const id = identifiant(item);
    const rs = reseau(item);
    console.log('- ' + titre(item) + (rs ? ' [' + rs + ']' : '') + '\n' +
      '  identifiant : ' + id + '\n');
  };

  if (evocateurs.length) {
    console.log(
      'Conversation(s) dont le titre evoque une note a soi-meme. Copiez ' +
      "l'identifiant dans filNoteASoiMeme (data/config.json) :\n");
    evocateurs.forEach(afficher);
    if (trouves.size > evocateurs.length) {
      console.log(
        (trouves.size - evocateurs.length) + ' autre(s) resultat(s) moins probable(s) ' +
        'ont ete ecartes (titre ne semblant pas evoquer une note a soi-meme).');
    }
  } else {
    console.log(
      "Aucun titre ne ressemble clairement a une note a soi-meme parmi les " +
      trouves.size + ' conversation(s) trouvee(s) : les voici toutes, au cas ou ' +
      "votre fil porte un intitule different. Reperez le votre et copiez son " +
      "identifiant dans filNoteASoiMeme (data/config.json) :\n");
    trouves.forEach(afficher);
  }
}

main().catch((e) => {
  console.error("Echec inattendu de l'outil : " + e.message);
  process.exitCode = 1;
});
