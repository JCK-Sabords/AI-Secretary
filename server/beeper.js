'use strict';

const BASE = 'http://127.0.0.1:23373';
const DELAI_MS = 10000;

function config(opts) {
  return {
    base: (opts && opts.base) || BASE,
    token: (opts && opts.token) || process.env.BEEPER_TOKEN || ''
  };
}

function erreur(cause, message) {
  const e = new Error(message);
  e.cause = cause;
  return e;
}

// Distingue les causes d echec pour que l appelant puisse reagir differemment :
// - injoignable : Beeper n est pas lance, ou ne repond pas dans le delai imparti
// - authentification : jeton absent ou refuse par Beeper (401/403)
// - refus : Beeper a repondu par une autre erreur HTTP
// - reponse_illisible : le corps de la reponse n est pas du JSON exploitable
// Le message reste generique et ne contient jamais le jeton.
async function appel(chemin, init, opts) {
  const c = config(opts);
  if (!c.token) {
    throw erreur('authentification', 'jeton Beeper absent : configuration a verifier');
  }

  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
  let res;
  try {
    res = await fetch(c.base + chemin, Object.assign({}, init, {
      signal: controle.signal,
      headers: Object.assign({
        'Authorization': 'Bearer ' + c.token,
        'Content-Type': 'application/json'
      }, (init && init.headers) || {})
    }));
  } catch (e) {
    throw erreur('injoignable', 'Beeper injoignable : verifier que l application est lancee');
  } finally {
    clearTimeout(minuteur);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw erreur('authentification', 'Beeper a refuse le jeton (statut ' + res.status + ')');
    }
    throw erreur('refus', 'Beeper a refuse la requete (statut ' + res.status + ')');
  }

  try {
    return await res.json();
  } catch (e) {
    throw erreur('reponse_illisible', 'Beeper a renvoye une reponse illisible (pas du JSON)');
  }
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

// Derniers messages d une conversation, du plus recent au plus ancien.
//
// Beeper renvoie les messages tries par date croissante : on inverse ici, une
// fois, pour que tous les appelants raisonnent dans le meme sens. Le texte
// arrive en HTML des que le message porte une mise en forme (une liste a puces
// WhatsApp devient <ul><li>) : il est renvoye tel quel, son interpretation
// appartient a l appelant.
async function messages(chatID, limite, opts) {
  const n = Math.min(Math.max(Number(limite) || 20, 1), 100);
  const data = await appel('/v1/chats/' + encodeURIComponent(chatID) +
    '/messages?direction=before&limit=' + n, {method: 'GET'}, opts);
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((m) => ({
    id: String(m.id),
    timestamp: m.timestamp,
    type: m.type,
    texte: typeof m.text === 'string' ? m.text : '',
    deMoi: m.isSender === true,
    supprime: m.isDeleted === true
  })).sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

module.exports = {comptes, disponible, chercherContacts, ouvrirChat, envoyer,
  messages, BASE};
