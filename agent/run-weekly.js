'use strict';

// Lanceur de l'agent hebdomadaire.
//
// Pourquoi Node et non PowerShell. Le premier passage reel du 15 septembre 2026 a
// echoue deux fois pour la meme raison de fond : PowerShell est un mauvais
// intermediaire entre un long texte et un processus.
//
//   1. Le prompt etait passe en argument de ligne de commande. PowerShell mutile
//      les chaines multilignes en construisant la ligne de commande native : le
//      modele a recu un prompt tronque net au milieu d'une phrase et a repondu
//      qu'il manquait le contenu. Ici le prompt passe par l'entree standard, donc
//      il n'existe plus aucune ligne de commande a mutiler, ni de limite de
//      longueur a atteindre.
//   2. L'envoi du recap partait via Invoke-RestMethod sans en-tete Content-Type.
//      Le garde-fou anti-CSRF du serveur refuse toute ecriture dont le type de
//      contenu n'est pas application/json : la requete revenait en 403. Ici les
//      en-tetes sont poses explicitement.
//
// Ce script n'envoie jamais de message lui-meme : il appelle POST /api/recap, une
// route qui fixe seule sa destination depuis data/config.json.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {resoudreBinaireClaude} = require('../server/dictee');
const config = require('../server/config');

const RACINE = path.join(__dirname, '..');
const DOSSIER_DATA = path.join(RACINE, 'data');
const DOSSIER_JOURNAL = path.join(RACINE, 'data', 'history');
const JOURNAL = path.join(DOSSIER_JOURNAL, 'run.log');
const JOURNAL_PRECEDENT = path.join(DOSSIER_JOURNAL, 'run.log.1');
const TAILLE_MAX_JOURNAL = 1024 * 1024;
const DELAI_MS = 15 * 60 * 1000;
const PORT = 5556;

const OUTILS_LECTURE = [
  'Edit', 'Write',
  'mcp__beeper__search', 'mcp__beeper__get_accounts', 'mcp__beeper__get_chat',
  'mcp__beeper__search_chats', 'mcp__beeper__list_messages',
  'mcp__beeper__search_messages', 'mcp__beeper__search_docs'
].join(',');

function horodatage() {
  return new Date().toISOString();
}

function journaliser(ligne) {
  fs.appendFileSync(JOURNAL, horodatage() + ' ' + ligne + '\n', 'utf8');
}

function preparerJournal() {
  fs.mkdirSync(DOSSIER_JOURNAL, {recursive: true});
  if (fs.existsSync(JOURNAL) && fs.statSync(JOURNAL).size > TAILLE_MAX_JOURNAL) {
    fs.renameSync(JOURNAL, JOURNAL_PRECEDENT);
  }
}

// Le prompt part par l'entree standard : aucun argument positionnel, donc aucun
// risque qu'un drapeau variadique comme --allowed-tools l'avale au passage.
function lancerAgent(prompt) {
  return new Promise((resolve) => {
    const binaire = resoudreBinaireClaude(process.env, process.platform);
    const enfant = spawn(binaire, [
      '-p',
      '--permission-mode', 'acceptEdits',
      '--allowed-tools', OUTILS_LECTURE
    ], {cwd: RACINE, windowsHide: true});

    let sortie = '';
    let fini = false;
    const minuteur = setTimeout(() => {
      if (!fini) { fini = true; enfant.kill(); resolve({sortie, cause: 'delai_depasse'}); }
    }, DELAI_MS);

    enfant.stdout.on('data', (c) => { sortie += c; });
    enfant.stderr.on('data', (c) => { sortie += c; });
    enfant.on('error', (e) => {
      if (fini) return;
      fini = true; clearTimeout(minuteur);
      resolve({sortie, cause: 'binaire_injoignable : ' + e.message});
    });
    enfant.on('close', (code) => {
      if (fini) return;
      fini = true; clearTimeout(minuteur);
      resolve({sortie, cause: code === 0 ? null : 'code de retour ' + code});
    });

    enfant.stdin.end(prompt, 'utf8');
  });
}

function envoyerRecap() {
  return new Promise((resolve) => {
    const corps = '{}';
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/recap', method: 'POST',
      headers: {
        'Host': '127.0.0.1:' + PORT,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corps)
      }
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({status: res.statusCode, corps: b}));
    });
    req.on('error', (e) => resolve({status: 0, corps: e.message}));
    req.end(corps);
  });
}

async function main() {
  preparerJournal();
  journaliser('demarrage');

  const gabarit = fs.readFileSync(path.join(__dirname, 'weekly-recap.md'), 'utf8');
  // Le marqueur {{PROPRIETAIRE}} du gabarit est substitue ici, juste avant l'envoi
  // sur l'entree standard, par le nom lu dans data/config.json (tache 16 : rendre
  // le depot installable par quelqu'un d'autre, sans nom propre en dur dans le
  // prompt).
  const {proprietaire} = config.lireConfig(DOSSIER_DATA);
  const prompt = config.substituerProprietaire(gabarit, proprietaire);
  journaliser('prompt transmis par entree standard : ' + prompt.length + ' caracteres');

  const r = await lancerAgent(prompt);
  if (r.sortie.trim()) {
    fs.appendFileSync(JOURNAL, r.sortie.trim() + '\n', 'utf8');
  }
  if (r.cause) {
    journaliser('agent en echec : ' + r.cause);
    return;
  }
  journaliser('agent termine');

  const envoi = await envoyerRecap();
  if (envoi.status === 200) {
    journaliser('recap envoye : ' + envoi.corps.slice(0, 300));
  } else {
    journaliser('envoi du recap echoue : HTTP ' + envoi.status + ' ' + envoi.corps.slice(0, 300));
  }
}

main().catch((e) => {
  try { journaliser('echec inattendu : ' + e.message); } catch (rien) { /* journal inaccessible */ }
  process.exitCode = 1;
});
