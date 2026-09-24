const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../server/api');
const repo = require('../server/repo');
const beeper = require('../server/beeper');
const people = require('../server/people');

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
  // La prochaine action est deduite des taches, elle n est plus saisie : le
  // projet porte une seule tache ouverte, c est donc elle, et le signal
  // sansProchaineAction ne peut pas se declencher.
  assert.strictEqual(r.json.projects[0].signaux.sansProchaineAction, false);
  assert.deepStrictEqual(r.json.projects[0].prochaine_action_auto,
    {ref: 'DE1', titre: 'a', prio: 'P3'});
  assert.strictEqual(r.json.today, '2026-09-06');
});

test('GET /api/etat remonte les fichiers illisibles', async () => {
  const ctx = contexte();
  fs.writeFileSync(path.join(ctx.projectsDir, 'casse.md'), '---\nid: [oups\n---\n');
  const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.json.errors.length, 1);
});

test('GET /api/etat range dans errors un fichier de projet a la date mal formee, sans exception', async () => {
  const ctx = contexte();
  fs.writeFileSync(path.join(ctx.projectsDir, 'date-cassee.md'),
    '---\nid: date-cassee\nprefixe: DC\necheance: PAS-UNE-DATE\ntaches: []\n---\n');
  const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.errors.length, 1);
  assert.match(r.json.errors[0].fichier, /date-cassee\.md/);
  assert.strictEqual(r.json.projects.length, 1, 'le projet demo reste charge normalement');
});

test('GET /api/etat range un people.md casse dans errors sans faire tomber la reponse', async () => {
  const ctx = contexte();
  fs.mkdirSync(ctx.dataDir, {recursive: true});
  fs.writeFileSync(path.join(ctx.dataDir, 'people.md'), 'id: [oups\n', 'utf8');
  fs.writeFileSync(path.join(ctx.projectsDir, 'casse.md'), '---\nid: [oups\n---\n');
  const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.projects.length, 1, 'le projet demo reste charge normalement');
  assert.strictEqual(r.json.errors.length, 2, 'erreurs projets et people fusionnees');
  assert.ok(r.json.errors.some((e) => e.fichier === 'people.md'));
  assert.ok(r.json.errors.some((e) => e.fichier === 'casse.md'));
});

// Regression (revue finale, point C1) : le calcul de severite et de signaux
// n'etait pas isole projet par projet. Un projet dont ce calcul fait lever ne
// doit plus emporter GET /api/etat pour tout le portefeuille : il rejoint errors
// avec un message qui le nomme, et les autres projets continuent d'etre servis.

test('GET /api/etat isole un projet dont le calcul de severite fait lever, sans emporter les autres', async () => {
  const ctx = contexte();
  repo.saveProject(ctx.projectsDir, {id: 'autre', prefixe: 'AU', titre: 'Autre',
    domaine: 'side', statut: 'actif', echeance: '', prochaine_action: 'faire',
    jira: '', dernier_n: 0, contexte: '', taches: []});
  const store = require('../server/store');
  const original = store.severity;
  store.severity = (p, today) => {
    if (p.id === 'demo') throw new Error('erreur simulee de calcul');
    return original(p, today);
  };
  try {
    const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.projects.length, 1, 'seul le projet sain reste dans projects');
    assert.strictEqual(r.json.projects[0].id, 'autre');
    assert.strictEqual(r.json.errors.length, 1);
    assert.match(r.json.errors[0].message, /demo/);
    assert.match(r.json.errors[0].fichier, /demo\.md/);
  } finally {
    store.severity = original;
  }
});

test('une route inconnue renvoie 404', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'GET', url: '/api/nimporte'}, null, ctx);
  assert.strictEqual(r.status, 404);
});

test('GET /api/comptes renvoie 401 (et pas 503) quand beeper.comptes signale une cause authentification', async () => {
  const ctx = contexte();
  // On substitue temporairement beeper.comptes pour simuler la cause
  // authentification sans dependre d un vrai Beeper ni d un bouchon HTTP :
  // c est le moyen le plus simple qui n ajoute aucune dependance et ne
  // touche pas au code de production au-dela de la traduction demandee.
  const original = beeper.comptes;
  beeper.comptes = async () => {
    const e = new Error('jeton refuse');
    e.cause = 'authentification';
    throw e;
  };
  try {
    const r = await api.handle({method: 'GET', url: '/api/comptes'}, null, ctx);
    assert.strictEqual(r.status, 401);
  } finally {
    beeper.comptes = original;
  }
});

test('GET /api/etat gagne les cles people et relances', async () => {
  const ctx = contexte();
  people.savePeople(ctx.dataDir, [{id: 'bruno', nom: 'Bruno Martin',
    accountID: 'whatsapp', reseau: 'WhatsApp', participantID: '33600000000',
    chatId: 'chat-1', resolu_le: '2026-09-01'}]);
  await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'a relancer', statut: 'bloque',
      responsable: 'bruno', prochaine_relance: '2026-09-06'}}, ctx);

  const r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.people.length, 1);
  assert.strictEqual(r.json.people[0].id, 'bruno');
  assert.strictEqual(r.json.relances.length, 1);
  assert.strictEqual(r.json.relances[0].personne.nom, 'Bruno Martin');
});

test('GET /api/etat gagne la cle relancesBloquees et reflete l etat du repertoire', async () => {
  const ctx = contexte();
  // Aucune fiche pour ce responsable : la tache doit apparaitre bloquee, avec la
  // raison contact_inconnu, et non dans relances.
  await api.handle({method: 'POST', url: '/api/tache'},
    {projet: 'demo', champs: {titre: 'a relancer', statut: 'bloque',
      responsable: 'bruno', prochaine_relance: '2026-09-06'}}, ctx);

  let r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.relances.length, 0);
  assert.strictEqual(r.json.relancesBloquees.length, 1);
  assert.strictEqual(r.json.relancesBloquees[0].raison, 'contact_inconnu');
  assert.strictEqual(r.json.relancesBloquees[0].responsable, 'bruno');

  // Une fois la fiche resolue (avec chatId), la tache doit quitter les bloquees
  // et rejoindre les relances : reflete bien l etat courant du repertoire.
  people.savePeople(ctx.dataDir, [{id: 'bruno', nom: 'Bruno Martin',
    accountID: 'whatsapp', reseau: 'WhatsApp', participantID: '33600000000',
    chatId: 'chat-1', resolu_le: '2026-09-01'}]);

  r = await api.handle({method: 'GET', url: '/api/etat'}, null, ctx);
  assert.strictEqual(r.json.relances.length, 1);
  assert.strictEqual(r.json.relancesBloquees.length, 0);
});

/* ============================ POST /api/relance ============================ */
/* Revue finale, points I6 et I3. beeper.envoyer est toujours substitue ici :
   aucun message reel n est envoye, meme en verifiant cette route. */

function ctxAvecDelegue() {
  const ctx = contexte();
  repo.saveProject(ctx.projectsDir, {id: 'estimmo', prefixe: 'ES', titre: 'Estimmo',
    domaine: 'side', statut: 'actif', echeance: '', prochaine_action: 'faire',
    jira: '', dernier_n: 1, contexte: '',
    taches: [{n: 1, titre: 'relancer le notaire', statut: 'bloque',
      responsable: 'bruno', echeance: '', nature_echeance: 'souhaitee',
      prio: 'P2', effort: 'M', bloque_par: '', derniere_relance: '',
      prochaine_relance: '2026-09-01', maj_le: '2026-08-01', note_blocage: ''}]});
  people.savePeople(ctx.dataDir, [{id: 'bruno', nom: 'Bruno Martin',
    accountID: 'whatsapp', reseau: 'WhatsApp', participantID: '33600000000',
    chatId: 'chat-1', resolu_le: '2026-09-01'}]);
  return ctx;
}

test('POST /api/relance refuse (403) une conversation qui ne correspond a aucune fiche resolue', async () => {
  const ctx = ctxAvecDelegue();
  const original = beeper.envoyer;
  let appele = false;
  beeper.envoyer = async () => { appele = true; return {ok: true}; };
  try {
    const r = await api.handle({method: 'POST', url: '/api/relance'},
      {chatId: 'chat-invente-par-l-appelant', texte: 'salut', ref: 'ES1'}, ctx);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(appele, false,
      'Beeper ne doit jamais etre appele pour une destination non resolue');
  } finally {
    beeper.envoyer = original;
  }
});

test('POST /api/relance envoie a une conversation resolue et memorise la relance sur le disque (I3)', async () => {
  const ctx = ctxAvecDelegue();
  const original = beeper.envoyer;
  let vu = null;
  beeper.envoyer = async (chatID, texte) => {
    vu = {chatID, texte};
    return {ok: true, chatID, pendingMessageID: 'p-1'};
  };
  try {
    const r = await api.handle({method: 'POST', url: '/api/relance'},
      {chatId: 'chat-1', texte: 'salut Bruno', ref: 'ES1'}, ctx);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(vu.chatID, 'chat-1');
    assert.strictEqual(vu.texte, 'salut Bruno');
    // Index explicite par id, jamais [0] : fichiers() (repo.js) trie
    // alphabetiquement, et demo.md precede estimmo.md.
    const relu = repo.loadAll(ctx.projectsDir).find((p) => p.id === 'estimmo').taches[0];
    assert.strictEqual(relu.derniere_relance, ctx.today,
      'derniere_relance doit prendre la date du jour apres un envoi reussi');
    assert.strictEqual(relu.prochaine_relance, '2026-09-13',
      'prochaine_relance doit etre repoussee de sept jours');
  } finally {
    beeper.envoyer = original;
  }
});

test('POST /api/relance renvoie 400 si chatId, texte ou ref manque', async () => {
  const ctx = ctxAvecDelegue();
  const corpsIncomplets = [
    {texte: 'x', ref: 'ES1'},
    {chatId: 'chat-1', ref: 'ES1'},
    {chatId: 'chat-1', texte: 'x'}
  ];
  for (const corps of corpsIncomplets) {
    const r = await api.handle({method: 'POST', url: '/api/relance'}, corps, ctx);
    assert.strictEqual(r.status, 400, 'attendu pour ' + JSON.stringify(corps));
  }
});

test('POST /api/personne ouvre la conversation via Beeper et fige la fiche', async () => {
  const ctx = contexte();
  const original = beeper.ouvrirChat;
  let vuAccountID = null;
  let vuParticipantID = null;
  beeper.ouvrirChat = async (accountID, participantID) => {
    vuAccountID = accountID;
    vuParticipantID = participantID;
    return {chatID: 'chat-nouveau'};
  };
  try {
    const r = await api.handle({method: 'POST', url: '/api/personne'},
      {id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
        participantID: '33600000000'}, ctx);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(vuAccountID, 'whatsapp');
    assert.strictEqual(vuParticipantID, '33600000000');
    const gens = people.loadPeople(ctx.dataDir);
    assert.strictEqual(gens.length, 1);
    assert.strictEqual(gens[0].chatId, 'chat-nouveau');
    assert.strictEqual(gens[0].resolu_le, ctx.today);
    assert.strictEqual(r.json.etat.people[0].chatId, 'chat-nouveau');
  } finally {
    beeper.ouvrirChat = original;
  }
});

test('POST /api/personne renvoie 400 si un champ requis manque', async () => {
  const ctx = contexte();
  const r = await api.handle({method: 'POST', url: '/api/personne'},
    {id: 'bruno', nom: 'Bruno Martin'}, ctx);
  assert.strictEqual(r.status, 400);
});

test('POST /api/personne renvoie 401 (et pas 503) quand ouvrirChat signale authentification', async () => {
  const ctx = contexte();
  const original = beeper.ouvrirChat;
  beeper.ouvrirChat = async () => {
    const e = new Error('jeton refuse');
    e.cause = 'authentification';
    throw e;
  };
  try {
    const r = await api.handle({method: 'POST', url: '/api/personne'},
      {id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
        participantID: '33600000000'}, ctx);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(people.loadPeople(ctx.dataDir).length, 0,
      'aucune fiche ne doit etre ecrite quand Beeper refuse le jeton');
  } finally {
    beeper.ouvrirChat = original;
  }
});

test('POST /api/personne renvoie 503 (et pas 401) quand Beeper est injoignable', async () => {
  const ctx = contexte();
  const original = beeper.ouvrirChat;
  beeper.ouvrirChat = async () => {
    const e = new Error('Beeper injoignable : verifier que l application est lancee');
    e.cause = 'injoignable';
    throw e;
  };
  try {
    const r = await api.handle({method: 'POST', url: '/api/personne'},
      {id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
        participantID: '33600000000'}, ctx);
    assert.strictEqual(r.status, 503);
  } finally {
    beeper.ouvrirChat = original;
  }
});

test('POST /api/personne renvoie 502 et n ecrit rien si Beeper ne renvoie pas de chatID exploitable', async () => {
  const ctx = contexte();
  const original = beeper.ouvrirChat;
  beeper.ouvrirChat = async () => ({chatID: ''});
  try {
    const r = await api.handle({method: 'POST', url: '/api/personne'},
      {id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
        participantID: '33600000000'}, ctx);
    assert.strictEqual(r.status, 502);
    assert.ok(r.json.erreur);
    assert.strictEqual(fs.existsSync(path.join(ctx.dataDir, 'people.md')), false,
      'aucun fichier ne doit etre ecrit quand la conversation renvoyee est vide');
  } finally {
    beeper.ouvrirChat = original;
  }
});

/* ============================ POST /api/recap ============================ */
/* Revue finale, point C2 : cette route est le seul chemin d'envoi du recap
   hebdomadaire, et la destination y est fixee uniquement par data/config.json,
   jamais par l'appelant. beeper.envoyer est toujours substitue ici : aucun de
   ces tests n'envoie de message reel, meme en verifiant cette route. */

function ecrireConfig(ctx, filNoteASoiMeme) {
  fs.mkdirSync(ctx.dataDir, {recursive: true});
  fs.writeFileSync(path.join(ctx.dataDir, 'config.json'),
    JSON.stringify({filNoteASoiMeme}), 'utf8');
}

function ecrireRecap(ctx, contenu) {
  const dossier = path.join(ctx.dataDir, 'history');
  fs.mkdirSync(dossier, {recursive: true});
  fs.writeFileSync(path.join(dossier, ctx.today + '-recap.md'), contenu, 'utf8');
}

test('POST /api/recap envoie le contenu du recap du jour au fil configure, et rien d autre', async () => {
  const ctx = contexte();
  ecrireConfig(ctx, '!fil-note-a-soi-meme:beeper.com');
  ecrireRecap(ctx, '# Recap du 6 septembre\n\nRien a signaler.\n');
  const original = beeper.envoyer;
  let vuChatId = null;
  let vuTexte = null;
  beeper.envoyer = async (chatID, texte) => {
    vuChatId = chatID;
    vuTexte = texte;
    return {ok: true, chatID, pendingMessageID: 'p-1'};
  };
  try {
    const r = await api.handle({method: 'POST', url: '/api/recap'}, null, ctx);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(vuChatId, '!fil-note-a-soi-meme:beeper.com');
    assert.match(vuTexte, /Rien a signaler/);
  } finally {
    beeper.envoyer = original;
  }
});

test('POST /api/recap ignore tout destinataire fourni par l appelant : seul filNoteASoiMeme compte', async () => {
  const ctx = contexte();
  ecrireConfig(ctx, '!fil-legitime:beeper.com');
  ecrireRecap(ctx, 'contenu du recap');
  const original = beeper.envoyer;
  let vuChatId = null;
  beeper.envoyer = async (chatID, texte) => { vuChatId = chatID; return {ok: true, chatID}; };
  try {
    // Un corps malveillant portant un autre destinataire est entierement ignore :
    // cette route ne lit jamais body, la destination vient uniquement de la
    // configuration sur le disque.
    await api.handle({method: 'POST', url: '/api/recap'},
      {chatId: '!chat-choisi-par-l-appelant:beeper.com', texte: 'autre chose'}, ctx);
    assert.strictEqual(vuChatId, '!fil-legitime:beeper.com');
  } finally {
    beeper.envoyer = original;
  }
});

test('POST /api/recap renvoie 404 sans appeler Beeper quand aucun recap du jour n existe', async () => {
  const ctx = contexte();
  ecrireConfig(ctx, '!fil:beeper.com');
  const original = beeper.envoyer;
  let appele = false;
  beeper.envoyer = async () => { appele = true; return {ok: true}; };
  try {
    const r = await api.handle({method: 'POST', url: '/api/recap'}, null, ctx);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(appele, false, 'Beeper ne doit jamais etre appele sans recap a envoyer');
  } finally {
    beeper.envoyer = original;
  }
});

test('POST /api/recap renvoie 500 quand data/config.json est absent ou sans filNoteASoiMeme', async () => {
  const ctx = contexte();
  ecrireRecap(ctx, 'contenu');
  const r1 = await api.handle({method: 'POST', url: '/api/recap'}, null, ctx);
  assert.strictEqual(r1.status, 500, 'config.json absent');

  fs.mkdirSync(ctx.dataDir, {recursive: true});
  fs.writeFileSync(path.join(ctx.dataDir, 'config.json'), JSON.stringify({}), 'utf8');
  const r2 = await api.handle({method: 'POST', url: '/api/recap'}, null, ctx);
  assert.strictEqual(r2.status, 500, 'filNoteASoiMeme absent de la configuration');
});

test('POST /api/personne expose la cle commit dans une reponse reussie', async () => {
  const ctx = contexte();
  const original = beeper.ouvrirChat;
  beeper.ouvrirChat = async () => ({chatID: 'chat-nouveau'});
  try {
    const r = await api.handle({method: 'POST', url: '/api/personne'},
      {id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
        participantID: '33600000000'}, ctx);
    assert.strictEqual(r.status, 200);
    assert.ok('commit' in r.json, 'la cle commit doit etre presente');
    assert.ok(r.json.commit === true || r.json.commit === false || r.json.commit === null);
  } finally {
    beeper.ouvrirChat = original;
  }
});
