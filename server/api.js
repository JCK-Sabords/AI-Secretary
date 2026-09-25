'use strict';
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const repo = require('./repo');
const beeper = require('./beeper');
const people = require('./people');
const dictee = require('./dictee');
const sante = require('./sante');
const lancement = require('./lancement');
const devinerProjet = require('./deviner-projet');
const semaine = require('./semaine');

function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Forme affichable de la prochaine action deduite : la reference de la tache et
// son intitule, ou null si le projet n a aucune tache ouverte, auquel cas c est le
// champ texte `prochaine_action` du fichier qui prend le relais.
function prochaineActionAuto(p) {
  const t = store.prochaineAction(p);
  return t === null ? null : {ref: store.refOf(p, t), titre: t.titre, prio: t.prio};
}

function etat(ctx) {
  const today = ctx.today || aujourdhui();
  const {projects, errors} = repo.loadAllSafe(ctx.projectsDir);
  // Le repertoire des personnes doit se comporter exactement comme les projets :
  // une anomalie isolee ne fait pas tomber le reste de l etat, elle est fusionnee
  // dans le meme tableau errors pour que l interface les affiche de la meme facon.
  const {people: gens, errors: errorsPeople} = people.loadPeopleSafe(ctx.dataDir);
  // Meme garde-fou, projet par projet, pour le calcul de severite et de signaux
  // (revue finale, point C1) : chaque projet a deja passe la validation de
  // parseProject a ce stade, mais ce calcul reste isole par defense en profondeur.
  // Un projet dont le calcul fait lever rejoint errors avec un message qui le
  // nomme, plutot que de faire echouer GET /api/etat pour tout le portefeuille :
  // un seul fichier fautif ne doit jamais emporter la reponse entiere.
  const errorsCalcul = [];
  const projetsEnrichis = [];
  projects.forEach((p) => {
    try {
      projetsEnrichis.push(Object.assign({}, p, {
        severite: store.severity(p, today),
        signaux: store.signals(p, today),
        // Prochaine action deduite des taches (voir store.prochaineAction). Elle
        // est calculee ici, une seule fois, pour que le tableau de bord, l export
        // mobile et l agent hebdomadaire lisent tous la meme valeur plutot que de
        // la recalculer chacun de son cote.
        prochaine_action_auto: prochaineActionAuto(p)
      }));
    } catch (e) {
      errorsCalcul.push({fichier: p.id + '.md', message:
        'calcul des signaux en echec pour le projet ' + p.titre + ' (' + p.id + ') : ' + e.message});
    }
  });
  return {
    today,
    errors: errors.concat(errorsPeople).concat(errorsCalcul),
    people: gens,
    relances: people.relances(projects, gens, today),
    relancesBloquees: people.relancesBloquees(projects, gens, today),
    projects: projetsEnrichis
  };
}

function appliquer(ops, ctx) {
  const today = ctx.today || aujourdhui();
  const {projects, errors} = repo.loadAllSafe(ctx.projectsDir);
  if (errors.length) {
    return {status: 409, json: {applied: [], rejected: errors.map(
      (e) => 'fichier illisible : ' + e.fichier), etat: etat(ctx), commit: null}};
  }
  const res = store.applyOps(projects, ops, today);
  // commit vaut null quand aucune operation n a ete appliquee (donc aucun commit
  // tente), true ou false selon le resultat de repo.commit sinon. Cette distinction
  // permet a l appelant de differencier un commit non necessaire d un commit
  // reellement echoue (par exemple hors depot Git), alors que la donnee, elle,
  // a bien ete ecrite sur le disque dans les deux cas.
  let commitOk = null;
  if (res.applied.length) {
    // La liste des identifiants connus au chargement de cet instantane (avant
    // toute mutation par store.applyOps) est transmise a saveAll (revue finale,
    // point I4) : elle seule delimite ce que ce cycle d ecriture a le droit de
    // supprimer. Un fichier apparu entre-temps, absent de cette liste, ne peut
    // jamais etre efface par cet appel, meme s il n est pas dans res.projects.
    repo.saveAll(ctx.projectsDir, res.projects, projects.map((p) => p.id));
    commitOk = repo.commit(ctx.dataDir, 'data: ' + res.applied.join(' | '));
  }
  return {status: 200,
    json: {applied: res.applied, rejected: res.rejected, etat: etat(ctx), commit: commitOk}};
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

  if (req.method === 'POST' && url === '/api/dictee') {
    if (!body || typeof body.texte !== 'string' || body.texte.trim() === '') {
      return {status: 400, json: {erreur: 'corps invalide : le champ texte (chaine non vide) est requis'}};
    }
    let resultat;
    try {
      resultat = await dictee.dicter(body.texte, ctx);
    } catch (e) {
      // Comme reponseErreurBeeper pour Beeper : la cause n'est ici jamais traduite en
      // detail cote HTTP (toutes donnent 503, Claude etant simplement indisponible du
      // point de vue du client), mais le message reste lisible pour l'utilisateur.
      return {status: 503, json: {erreur:
        "Claude n'a pas pu etre interroge : " + (e && e.message ? e.message : 'erreur inconnue')}};
    }
    // Seule porte d'ecriture : les operations produites par Claude passent par
    // appliquer, donc par store.applyOps, exactement comme /api/ops. Le message
    // redige par Claude est ajoute a cote, sans jamais remplacer la validation.
    const res = appliquer(resultat.ops, ctx);
    res.json.message = resultat.message;
    return res;
  }

  // Les trois routes de sante (tache 15) : de simples controles, jamais une
  // ecriture ni un envoi. GET /api/sante/beeper et GET /api/sante/claude sont
  // gratuits et instantanes (etatBeeper, etatClaude) ; POST /api/sante/claude/test
  // est le seul des trois a vraiment lancer le binaire claude (testerClaude),
  // borne a 120 secondes cote sante.js. Aucune des trois ne peut echouer avec
  // une exception non geree : chaque fonction de server/sante.js renvoie
  // toujours {ok, etat, detail}, jamais une erreur levee.
  if (req.method === 'GET' && url === '/api/sante/beeper') {
    return {status: 200, json: await sante.etatBeeper()};
  }

  if (req.method === 'GET' && url === '/api/sante/claude') {
    return {status: 200, json: await sante.etatClaude()};
  }

  if (req.method === 'POST' && url === '/api/sante/claude/test') {
    return {status: 200, json: await sante.testerClaude()};
  }

  if (req.method === 'POST' && url === '/api/tache') {
    // Le corps doit etre un objet simple (ni nul, ni tableau, ni type primitif) et
    // porter soit ref (mise a jour), soit projet (creation). Sans cette garde, un
    // corps structurellement invalide (tableau, chaine, objet vide) passait le
    // simple test de verite ci-dessous et finissait deguise en operation add_task
    // refusee avec "projet inconnu : undefined", au lieu d etre rejete en 400.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {status: 400, json: {erreur: 'corps invalide : un objet est attendu'}};
    }
    if (!body.ref && !body.projet) {
      return {status: 400, json: {erreur:
        'corps invalide : le champ ref (mise a jour) ou projet (creation) est requis'}};
    }
    // Les champs litteraux (op, projet) sont fusionnes apres body.champs, jamais
    // avant : body.champs vient du corps de la requete (donc potentiellement d un
    // LLM ou d une dictee non fiable), et si l on fusionnait dans l autre sens un
    // champ nomme "op" ou "projet" dans body.champs ecraserait silencieusement
    // l intention de la route (creer une tache) par une operation arbitraire
    // (par exemple delete_project). L ordre ci-dessous garantit que cette route
    // ne peut produire qu une operation add_task ou update_task.
    const op = body.ref
      ? {op: 'update_task', ref: body.ref, champs: body.champs || {}}
      : Object.assign({}, body.champs || {}, {op: 'add_task', projet: body.projet});
    return appliquer([op], ctx);
  }

  if (req.method === 'DELETE' && url === '/api/tache') {
    if (!body || !body.ref) return {status: 400, json: {erreur: 'reference manquante'}};
    return appliquer([{op: 'delete_task', ref: body.ref}], ctx);
  }

  // Rapprochement avec la liste de taches WhatsApp, au lancement du tableau de
  // bord. Lecture seule : cette route ne retire et n'ajoute jamais rien, elle
  // dit seulement ce qu'il y aurait a faire. Les ecritures qui en decoulent
  // passent par /api/ops et /api/tache, apres un geste explicite dans la
  // fenetre de confirmation.
  if (req.method === 'GET' && url === '/api/lancement') {
    try {
      return {status: 200, json: await lancement.analyser(ctx)};
    } catch (e) {
      // Aucune panne de ce rapprochement ne doit empecher l'ouverture du
      // tableau de bord : l'interface recevra simplement un etat inactif.
      return {status: 200, json: {actif: false, raison: 'erreur', message: e.message}};
    }
  }

  // Devine le projet de rattachement de lignes encore inconnues. Separee de
  // /api/lancement parce qu'elle appelle Claude : la premiere fenetre, celle des
  // suppressions, ne doit pas attendre un modele de langage pour s'afficher.
  if (req.method === 'POST' && url === '/api/lancement/deviner') {
    if (!body || !Array.isArray(body.lignes)) {
      return {status: 400, json: {erreur: 'corps attendu : {lignes: []}'}};
    }
    const lignes = body.lignes
      .filter((l) => typeof l === 'string' && l.trim() !== '')
      .slice(0, devinerProjet.LIMITE_LIGNES);
    const {projects} = repo.loadAllSafe(ctx.projectsDir);
    const projets = projects.map((p) => ({id: p.id, titre: p.titre, domaine: p.domaine}));
    const propositions = await devinerProjet.deviner(
      lignes, projets, ctx && ctx.lancerClaude);
    return {status: 200, json: {propositions, projets}};
  }

  // Marque le message de liste comme traite, quelle que soit la reponse du
  // proprietaire. C'est ce qui fait qu'un « Retablir » n'est pas defait par la
  // prochaine ouverture, et que des lignes volontairement laissees de cote ne
  // reviennent pas a chaque fois.
  if (req.method === 'POST' && url === '/api/lancement/cloturer') {
    if (!body || typeof body.messageId !== 'string' || body.messageId.trim() === '') {
      return {status: 400, json: {erreur: 'corps attendu : {messageId: "..."}'}};
    }
    try {
      lancement.ecrireEtat(ctx.dataDir, body.messageId);
      return {status: 200, json: {ok: true}};
    } catch (e) {
      return {status: 500, json: {erreur: 'etat du rapprochement non enregistre'}};
    }
  }

  // Top 5 des projets de la semaine, etabli par Claude. Route separee de
  // /api/etat parce qu'elle peut prendre une trentaine de secondes : le tableau
  // de bord s'affiche sans elle et remplit le panneau a l'arrivee. Le resultat
  // est garde tant que le portefeuille ne bouge pas, pour ne pas depenser un
  // appel a chaque rechargement de page.
  if (req.method === 'GET' && url === '/api/semaine') {
    try {
      return {status: 200, json: await semaine.calculer(ctx)};
    } catch (e) {
      return {status: 200, json: {top: [], erreur: 'classement indisponible'}};
    }
  }

  if (req.method === 'GET' && url === '/api/comptes') {
    try {
      return {status: 200, json: {comptes: await beeper.comptes()}};
    } catch (e) {
      return reponseErreurBeeper(e);
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
      return reponseErreurBeeper(e);
    }
  }

  if (req.method === 'POST' && url === '/api/relance') {
    if (!body || !body.chatId || !body.texte || !body.ref) {
      return {status: 400, json: {erreur: 'chatId, texte et ref requis'}};
    }
    // Restreint la destination a une fiche resolue du repertoire (revue finale,
    // point I6) : sans ce controle, un appelant quelconque pouvait faire passer
    // n'importe quel identifiant de conversation ici, ce qui rendait le point
    // C3 exploitable jusqu'a l'envoi (lire l'etat pour recuperer un chatId,
    // puis appeler cette route avec).
    const gens = people.loadPeople(ctx.dataDir);
    const connue = gens.some((g) => g.chatId && g.chatId === body.chatId);
    if (!connue) {
      return {status: 403, json: {erreur:
        "destination refusee : cette conversation ne correspond a aucune fiche resolue du repertoire"}};
    }
    let envoi;
    try {
      envoi = await beeper.envoyer(body.chatId, body.texte);
    } catch (e) {
      return reponseErreurBeeper(e);
    }
    // Une relance envoyee doit etre memorisee sur le disque (revue finale,
    // point I3) : sans cela, un rechargement de la page la fait reapparaitre
    // comme due, et le meme message peut repartir une seconde fois. Passe
    // imperativement par appliquer, donc par store.applyOps, comme toute autre
    // ecriture. Le message est deja parti a ce stade : si la reference fournie
    // s'avere invalide, cette mise a jour est simplement rejetee (visible dans
    // etat.rejected via la cle etat ci-dessous), sans jamais faire echouer la
    // reponse de l'envoi lui-meme, deja effectif.
    const today = ctx.today || aujourdhui();
    const maj = appliquer([{op: 'update_task', ref: body.ref, champs: {
      derniere_relance: today, prochaine_relance: store.addDays(today, 7)}}], ctx);
    return {status: 200, json: Object.assign({}, envoi, {etat: maj.json.etat})};
  }

  if (req.method === 'POST' && url === '/api/personne') {
    if (!body || !body.id || !body.nom || !body.accountID || !body.participantID) {
      return {status: 400, json: {erreur: 'id, nom, accountID et participantID requis'}};
    }
    // Un contact n'est pas une conversation (voir docs/beeper-observe.md) : la
    // recherche de contacts donne un participantID par compte, il faut ouvrir la
    // conversation aupres de Beeper pour obtenir le chatID avant de figer la fiche.
    let chatId = '';
    try {
      chatId = (await beeper.ouvrirChat(body.accountID, body.participantID)).chatID;
    } catch (e) {
      // Meme traduction d erreur que les trois autres routes qui appellent Beeper
      // (GET /api/comptes, GET /api/contacts, POST /api/relance) : reponseErreurBeeper
      // distingue deja la cause authentification (401) des autres causes (503), pas
      // de raison d en reecrire une variante ici qui renverrait 503 dans tous les cas.
      return reponseErreurBeeper(e);
    }
    // Une conversation sans identifiant exploitable ne doit jamais etre figee
    // comme resolue : l etat persiste mentirait (personne "resolue" alors
    // qu elle est en realite injoignable). On refuse avant toute ecriture.
    if (typeof chatId !== 'string' || chatId.trim() === '') {
      return {status: 502, json: {erreur:
        "la messagerie n'a pas renvoye de conversation utilisable pour cette personne"}};
    }
    const gens = people.loadPeople(ctx.dataDir);
    const fiche = {id: body.id, nom: body.nom, accountID: body.accountID,
      reseau: body.reseau || body.accountID, participantID: body.participantID,
      chatId, resolu_le: ctx.today || aujourdhui()};
    const i = gens.findIndex((g) => g.id === body.id);
    if (i >= 0) gens[i] = fiche; else gens.push(fiche);
    people.savePeople(ctx.dataDir, gens);
    const commitOk = repo.commit(ctx.dataDir, 'data: contact ' + body.nom + ' resolu');
    return {status: 200, json: {etat: etat(ctx), commit: commitOk}};
  }

  if (req.method === 'POST' && url === '/api/recap') {
    return envoyerRecap(ctx);
  }

  return {status: 404, json: {erreur: 'route inconnue'}};
}

// Envoie le recap du jour au proprietaire, et uniquement a lui (revue finale,
// point C2). Cette route n'accepte aucun destinataire en parametre : elle lit le
// fichier data/history/AAAA-MM-JJ-recap.md du jour et l'envoie exclusivement au
// fil designe par filNoteASoiMeme dans data/config.json. C'est le remplacement
// mecanique de l'ancienne garantie purement declarative (un paragraphe de
// prompt) : l'agent hebdomadaire n'a plus aucun outil d'envoi (voir
// agent/run-weekly.ps1), c'est ce script qui appelle cette route une fois le
// modele termine, jamais le modele lui-meme.
async function envoyerRecap(ctx) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'config.json'), 'utf8'));
  } catch (e) {
    return {status: 500, json: {erreur:
      'configuration illisible : data/config.json (' + e.message + ')'}};
  }
  const fil = config && config.filNoteASoiMeme;
  if (typeof fil !== 'string' || fil.trim() === '') {
    return {status: 500, json: {erreur:
      'filNoteASoiMeme absent ou invalide dans data/config.json'}};
  }
  const today = ctx.today || aujourdhui();
  const fichierRecap = path.join(ctx.dataDir, 'history', today + '-recap.md');
  let contenu;
  try {
    contenu = fs.readFileSync(fichierRecap, 'utf8');
  } catch (e) {
    return {status: 404, json: {erreur:
      "aucun recap du jour a envoyer : " + today + '-recap.md introuvable'}};
  }
  try {
    return {status: 200, json: await beeper.envoyer(fil, contenu)};
  } catch (e) {
    return reponseErreurBeeper(e);
  }
}

// Traduit une erreur beeper.appel (voir server/beeper.js) en reponse HTTP :
// la cause authentification donne un 401 explicite (jeton a reconfigurer),
// toutes les autres causes (injoignable, refus, reponse_illisible) restent
// un 503 generique, Beeper etant simplement indisponible du point de vue
// du client. Factorise ici pour ne pas repeter cette traduction sur chacune
// des quatre routes qui appellent Beeper.
function reponseErreurBeeper(e) {
  if (e && e.cause === 'authentification') {
    return {status: 401, json: {erreur:
      'jeton Beeper absent ou refuse : il faut le reconfigurer'}};
  }
  return {status: 503, json: {erreur: 'Beeper ne repond pas'}};
}

module.exports = {handle, etat, aujourdhui, appliquer};
