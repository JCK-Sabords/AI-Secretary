'use strict';
const {execFile, spawn} = require('node:child_process');
const beeperReel = require('./beeper');
const {resoudreBinaireClaude: resoudreBinaireClaudeReel} = require('./dictee');

// Delai du controle gratuit (claude auth status) : une lecture locale, jamais
// un aller-retour reseau vers Claude, un delai court suffit largement.
const DELAI_AUTH_MS = 10000;

// Delai du vrai aller-retour (POST /api/sante/claude/test), aligne sur celui
// deja impose a la dictee (server/dictee.js, DELAI_MS) pour la meme raison :
// un aller-retour reel vers Claude peut prendre plusieurs dizaines de secondes.
const DELAI_TEST_MS = 120000;

function erreur(cause, message) {
  const e = new Error(message);
  e.cause = cause;
  return e;
}

/* ============================ etatBeeper ============================ */
// deps.comptes remplace beeper.comptes dans les tests (aucun opts : opts
// n est fourni que par les tests de beeper.js lui-meme, jamais ici). Ne leve
// jamais : toute erreur, connue ou non, est traduite en {ok:false, etat, detail}.
async function etatBeeper(deps) {
  const d = deps || {};
  const comptes = d.comptes || beeperReel.comptes;
  try {
    const liste = await comptes();
    const n = Array.isArray(liste) ? liste.length : 0;
    return {ok: true, etat: 'ok',
      detail: n + (n === 1 ? ' compte Beeper connecte' : ' comptes Beeper connectes')};
  } catch (e) {
    const cause = e && e.cause;
    if (cause === 'injoignable') {
      return {ok: false, etat: 'arrete',
        detail: 'Beeper Desktop ne repond pas : verifier qu il est bien lance sur ce poste'};
    }
    if (cause === 'authentification') {
      return {ok: false, etat: 'jeton',
        detail: 'Beeper a refuse le jeton : verifier ou reconfigurer BEEPER_TOKEN'};
    }
    return {ok: false, etat: 'erreur',
      detail: 'Beeper a repondu de facon inattendue : ' +
        (e && e.message ? e.message : 'erreur inconnue')};
  }
}

/* ============================ etatClaude ============================ */
// Controle gratuit et instantane : resolution du binaire (resoudreBinaireClaude,
// deja utilise par la dictee), puis lecture de `claude auth status`, dont la
// sortie est du JSON portant loggedIn, authMethod et subscriptionType. N ecrit
// rien, n envoie rien, ne lance jamais le vrai aller-retour (voir testerClaude
// plus bas pour celui-ci). deps.resoudreBinaireClaude et deps.executerAuthStatus
// permettent aux tests de ne jamais toucher au vrai binaire.
function executerAuthStatusReel(binaire) {
  return new Promise((resolve, reject) => {
    execFile(binaire, ['auth', 'status'], {timeout: DELAI_AUTH_MS, windowsHide: true},
      (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout == null ? '' : stdout).trim());
      });
  });
}

async function etatClaude(deps) {
  const d = deps || {};
  const resoudre = d.resoudreBinaireClaude || resoudreBinaireClaudeReel;
  const executer = d.executerAuthStatus || executerAuthStatusReel;
  const env = d.env || process.env;
  const plateforme = d.platform || process.platform;

  let binaire;
  try {
    binaire = resoudre(env, plateforme);
  } catch (e) {
    return {ok: false, etat: 'erreur',
      detail: 'impossible de localiser le binaire claude : ' +
        (e && e.message ? e.message : 'erreur inconnue')};
  }

  let sortie;
  try {
    sortie = await executer(binaire);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return {ok: false, etat: 'binaire_absent',
        detail: 'le binaire claude est introuvable sur ce poste : verifier son installation'};
    }
    return {ok: false, etat: 'erreur',
      detail: 'controle Claude en echec : ' + (e && e.message ? e.message : 'erreur inconnue')};
  }

  let data;
  try {
    data = JSON.parse(sortie);
  } catch (e) {
    return {ok: false, etat: 'erreur',
      detail: 'claude auth status a renvoye une reponse illisible (pas du JSON)'};
  }

  if (!data || typeof data !== 'object' || !data.loggedIn) {
    return {ok: false, etat: 'deconnecte',
      detail: "Claude n'est pas connecte : lancer claude dans un terminal et executer /login"};
  }

  const abonnement = typeof data.subscriptionType === 'string' && data.subscriptionType
    ? ' (' + data.subscriptionType + ')' : '';
  return {ok: true, etat: 'ok', detail: 'Claude est connecte' + abonnement};
}

/* ============================ testerClaude ============================ */
// Le vrai aller-retour, declenche par POST /api/sante/claude/test. Reprend
// obligatoirement le motif d agent/run-weekly.js : spawn, tableau d arguments
// fixe, prompt transmis par l entree standard (enfant.stdin.end). Le prompt ne
// passe jamais en argument positionnel : --tools est variadique et l avalerait
// s il le precedait immediatement, exactement le bug qui cassait la dictee
// (voir server/dictee.js, argumentsClaude). --tools '' interdit tout usage
// d outil : ce controle est un aller-retour texte pur, jamais un agent capable
// d agir, donc jamais bloque en attente d une approbation qu il ne peut recevoir.
//
// Sans effet de bord : n ecrit aucun fichier, n envoie aucun message. Non
// couvert par TDD (brief, etape 1) : lancer un vrai processus claude dans un
// test unitaire est lent et depend de l etat d authentification du poste ;
// verifie a la main a l etape 7.
function argumentsTest() {
  return ['-p', '--tools', ''];
}

function lancerTestReel(prompt, env, plateforme) {
  return new Promise((resolve, reject) => {
    const binaire = resoudreBinaireClaudeReel(env, plateforme);
    let fini = false;
    let sortie = '';
    const enfant = spawn(binaire, argumentsTest(), {windowsHide: true});

    const minuteur = setTimeout(() => {
      if (fini) return;
      fini = true;
      enfant.kill();
      reject(erreur('delai_depasse', "Claude n'a pas repondu dans le delai imparti (120 secondes)"));
    }, DELAI_TEST_MS);

    enfant.stdout.on('data', (c) => { sortie += c; });
    enfant.stderr.on('data', (c) => { sortie += c; });
    enfant.on('error', (e) => {
      if (fini) return;
      fini = true; clearTimeout(minuteur);
      if (e.code === 'ENOENT') {
        return reject(erreur('binaire_absent',
          'le binaire claude est introuvable sur ce poste : verifier son installation'));
      }
      reject(erreur('erreur', e.message));
    });
    enfant.on('close', (code) => {
      if (fini) return;
      fini = true; clearTimeout(minuteur);
      if (code !== 0) {
        return reject(erreur('erreur', 'Claude a renvoye un code de retour non nul (' + code + ')'));
      }
      resolve(sortie.trim());
    });

    enfant.stdin.end(prompt, 'utf8');
  });
}

async function testerClaude(ctx) {
  const c = ctx || {};
  const lanceur = c.lancerClaudeTest ||
    ((prompt) => lancerTestReel(prompt, c.env || process.env, c.platform || process.platform));
  const prompt = 'Reponds uniquement par le mot ok, sans rien ajouter autour.';
  try {
    const sortie = await lanceur(prompt);
    if (!sortie) {
      return {ok: false, etat: 'erreur', detail: "Claude n'a renvoye aucune reponse exploitable"};
    }
    return {ok: true, etat: 'ok', detail: 'aller-retour reussi : ' + sortie.slice(0, 200)};
  } catch (e) {
    const cause = (e && e.cause) || 'erreur';
    if (cause === 'binaire_absent') {
      return {ok: false, etat: 'binaire_absent',
        detail: 'le binaire claude est introuvable sur ce poste : verifier son installation'};
    }
    return {ok: false, etat: 'erreur',
      detail: 'Claude a echoue : ' + (e && e.message ? e.message : 'erreur inconnue')};
  }
}

module.exports = {etatBeeper, etatClaude, testerClaude};
