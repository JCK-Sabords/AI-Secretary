'use strict';

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store.js');
const repo = require('./repo.js');
const beeper = require('./beeper.js');
const liste = require('./liste-whatsapp.js');
const config = require('./config.js');

// Rapprochement effectue a chaque ouverture du tableau de bord entre la liste de
// taches tenue dans la conversation WhatsApp a soi-meme et le portefeuille.
//
// Ce module decide quoi proposer ; il n'ecrit jamais dans les projets. Les
// suppressions et les creations passent par applyOps comme toute autre ecriture,
// depuis les routes d'API, et seulement apres une reponse explicite du
// proprietaire dans la fenetre de confirmation. Rien n'est retire du
// portefeuille sur la seule foi d'un message.

const FICHIER_ETAT = 'liste-whatsapp.json';

function cheminEtat(dataDir) {
  return path.join(dataDir, 'history', FICHIER_ETAT);
}

// Etat de traitement : identifiant du dernier message de liste deja soumis au
// proprietaire. Il evite deux comportements penibles. D'abord reproposer a
// chaque ouverture la meme suppression apres un « Retablir », ce qui reviendrait
// a ignorer sa reponse. Ensuite reproposer des taches qu'il a volontairement
// laissees de cote en fermant la fenetre.
function lireEtat(dataDir) {
  try {
    const brut = fs.readFileSync(cheminEtat(dataDir), 'utf8');
    const o = JSON.parse(brut);
    return {dernierMessageTraite: String(o.dernierMessageTraite || '')};
  } catch (e) {
    // Fichier absent au premier lancement, ou illisible : on repart d'un etat
    // vide plutot que de faire echouer l'ouverture du tableau de bord.
    return {dernierMessageTraite: ''};
  }
}

function ecrireEtat(dataDir, messageId) {
  const dossier = path.join(dataDir, 'history');
  fs.mkdirSync(dossier, {recursive: true});
  fs.writeFileSync(cheminEtat(dataDir), JSON.stringify(
    {dernierMessageTraite: String(messageId), traiteLe: new Date().toISOString()},
    null, 2) + '\n', 'utf8');
}

// Taches ouvertes de tout le portefeuille, a plat, pour le rapprochement.
function tachesOuvertes(projects) {
  const out = [];
  projects.forEach((p) => {
    store.openTasks(p).forEach((t) => out.push({projet: p, tache: t}));
  });
  return out;
}

// Analyse le fil et renvoie ce qu'il y a a proposer. Ne modifie rien.
//
// Les cas ou il n'y a rien a proposer sont distingues par `raison`, pour que
// l'interface puisse rester silencieuse sans masquer une panne : « non
// configure » et « Beeper injoignable » ne sont pas la meme chose qu'« aucun
// changement depuis la derniere fois ».
async function analyser(ctx, opts) {
  const conf = config.lireConfig(ctx.dataDir);
  const chatID = conf.filTachesWhatsApp || '';
  if (!chatID) return {actif: false, raison: 'non_configure'};

  // ctx.lireMessages permet d'injecter un faux lecteur dans les tests : aucun
  // test ne parle a Beeper, et aucun ne depend d'une conversation reelle.
  const lire = (ctx && ctx.lireMessages) || beeper.messages;
  let msgs;
  try {
    msgs = await lire(chatID, 40, opts);
  } catch (e) {
    return {actif: false, raison: 'beeper_indisponible', message: e.message};
  }

  // Seuls les messages que le proprietaire s'est envoyes a lui-meme comptent, et
  // seuls ceux qui sont effectivement une liste de taches.
  const listes = msgs
    .filter((m) => m.deMoi && !m.supprime)
    .map((m) => ({id: m.id, timestamp: m.timestamp, lignes: liste.extraireListe(m.texte)}))
    .filter((m) => m.lignes !== null);

  if (listes.length === 0) return {actif: false, raison: 'aucune_liste'};

  const courante = listes[0];
  const etat = lireEtat(ctx.dataDir);
  if (etat.dernierMessageTraite === courante.id) {
    return {actif: false, raison: 'deja_traite', messageId: courante.id};
  }

  const {projects} = repo.loadAllSafe(ctx.projectsDir);
  const ouvertes = tachesOuvertes(projects);

  // Suppressions : une ligne disparue entre l'avant-derniere liste et la
  // derniere. Sans liste precedente (premier message de liste du fil), il n'y a
  // aucune disparition a constater, seulement des taches a creer.
  const precedente = listes[1] || null;
  const retirees = precedente
    ? liste.lignesRetirees(precedente.lignes, courante.lignes)
    : [];

  const aRetirer = [];
  retirees.forEach((ligne) => {
    const m = liste.apparier(ligne, ouvertes);
    // Une ligne disparue qui ne correspond a aucune tache ouverte n'appelle
    // aucune action : elle n'a jamais existe dans le portefeuille, ou elle y est
    // deja close.
    if (m === null) return;
    aRetirer.push({
      ref: store.refOf(m.projet, m.tache),
      titre: m.tache.titre,
      projet: m.projet.titre,
      projetId: m.projet.id,
      ligne
    });
  });

  // Creations : une ligne de la liste courante qui ne correspond a aucune tache
  // ouverte. Les lignes qu'on vient de proposer a la suppression en sont exclues
  // par construction, puisqu'elles ne sont plus dans la liste courante.
  const aAjouter = liste.lignesInconnues(courante.lignes, ouvertes)
    .map((ligne) => ({ligne}));

  return {
    actif: true,
    messageId: courante.id,
    messageLe: courante.timestamp,
    comparaisonAvec: precedente ? precedente.id : null,
    aRetirer,
    aAjouter,
    projets: projects.map((p) => ({id: p.id, titre: p.titre, domaine: p.domaine}))
  };
}

module.exports = {analyser, lireEtat, ecrireEtat, tachesOuvertes, FICHIER_ETAT};
