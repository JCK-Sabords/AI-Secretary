'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const config = require('../server/config');
const exportMod = require('../server/export');

// Publie une copie en lecture seule et chiffree du tableau de bord sur un
// depot GitHub Pages dedie, distinct du depot du code et du depot des
// donnees. N'ecrit jamais le code d'acces dans le journal.
//
// Lit la section exportMobile de data/config.json ({code, depot}). Si elle
// est absente, ne fait rien et le dit : cette fonction est optionnelle, un
// utilisateur qui clone le projet ne doit rien publier sans l'avoir
// configuree explicitement.

const RACINE = path.join(__dirname, '..');
const DATA_DIR = path.join(RACINE, 'data');
const GABARIT = path.join(RACINE, 'web', 'mobile-gabarit.html');
const JOURNAL = path.join(DATA_DIR, 'history', 'export.log');
const MARQUEUR_DEBUT = '/*__PAQUET__*/null/*__FIN_PAQUET__*/';

function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

function journaliser(ligne) {
  fs.mkdirSync(path.dirname(JOURNAL), {recursive: true});
  const horodatage = new Date().toISOString();
  // Le code d'acces n'est jamais interpole dans les lignes journalisees par
  // cette fonction : seuls le depot, le resultat et d'eventuels messages
  // d'erreur (jamais construits a partir du code, ni a partir du contenu brut
  // de data/config.json) y figurent.
  fs.appendFileSync(JOURNAL, '[' + horodatage + '] ' + ligne + '\n', 'utf8');
}

function git(dir, args) {
  return execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

// Extrait "proprietaire/depot" d'une URL de remote git, quelle que soit sa
// forme (https://github.com/o/r.git, git@github.com:o/r.git, avec ou sans
// suffixe .git). Retourne null si l'URL ne pointe pas vers github.com.
function extraireProprietaireDepot(urlRemote) {
  if (!urlRemote) return null;
  const m = String(urlRemote).trim().match(/github\.com[/:]+([^/]+\/[^/.]+?)(\.git)?\/?$/i);
  return m ? m[1] : null;
}

function depotsEquivalents(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// Interroge le contenu racine d'un depot GitHub via `gh`, sans jamais le
// cloner. Retourne la liste des noms de fichiers/dossiers a la racine, ou un
// tableau vide si le depot est vide (premier export).
function listerFichiersDepot(depot) {
  let info;
  try {
    info = JSON.parse(execFileSync('gh', ['api', 'repos/' + depot], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  } catch (e) {
    throw new Error('impossible d\'interroger le depot cible via gh');
  }
  if (!info || info.size === 0) return [];
  const sortie = execFileSync('gh', ['api', 'repos/' + depot + '/contents/', '--jq', '[.[].name]'],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  return JSON.parse(sortie);
}

// Garde-fou avant tout push : refuse si le depot cible est le depot du
// logiciel lui-meme, ou s'il contient deja autre chose qu'un index.html
// (signe qu'il ne s'agit pas du depot de publication dedie). Un depot vide
// est accepte (tout premier export). `lister` est injectable pour les tests.
async function verifierDepotCible(depot, origineDepot, lister) {
  if (depotsEquivalents(depot, origineDepot)) {
    return {ok: false, raison: 'refus : le depot cible est le meme que le depot du logiciel (' + depot + ')'};
  }
  let fichiers;
  try {
    fichiers = await lister(depot);
  } catch (e) {
    return {ok: false, raison: 'refus : impossible de verifier le contenu du depot cible avant de publier (' + depot + ')'};
  }
  const autres = (fichiers || []).filter((f) => f !== 'index.html');
  if (autres.length > 0) {
    return {ok: false, raison: 'refus : le depot cible contient d\'autres fichiers que index.html (' + depot + ')'};
  }
  return {ok: true};
}

async function exporterMobile() {
  let brut;
  try {
    brut = fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8');
  } catch (e) {
    const msg = "export mobile ignore : data/config.json introuvable";
    journaliser(msg);
    return {publie: false, raison: msg};
  }
  let data;
  try {
    data = JSON.parse(brut);
  } catch (e) {
    // Le message d'erreur de JSON.parse peut recopier un extrait du fichier
    // fautif (et donc le code d'acces qu'il contient) : on ne le journalise
    // jamais, meme partiellement.
    const msg = 'export mobile ignore : data/config.json illisible';
    journaliser(msg);
    return {publie: false, raison: msg};
  }

  const section = data && data.exportMobile;
  if (!section || typeof section.code !== 'string' || !section.code || typeof section.depot !== 'string' || !section.depot) {
    const msg = 'export mobile ignore : section exportMobile absente ou incomplete dans data/config.json';
    journaliser(msg);
    return {publie: false, raison: msg};
  }

  let origineDepot = null;
  try {
    origineDepot = extraireProprietaireDepot(git(RACINE, ['remote', 'get-url', 'origin']));
  } catch (e) {
    origineDepot = null;
  }

  const verification = await verifierDepotCible(section.depot, origineDepot, listerFichiersDepot);
  if (!verification.ok) {
    journaliser(verification.raison);
    return {publie: false, raison: verification.raison};
  }

  const today = aujourdhui();
  const instantane = exportMod.construireInstantane(DATA_DIR, today);
  const paquet = exportMod.chiffrer(JSON.stringify(instantane), section.code);

  let gabarit;
  try {
    gabarit = fs.readFileSync(GABARIT, 'utf8');
  } catch (e) {
    const msg = 'export mobile en echec : gabarit web/mobile-gabarit.html introuvable';
    journaliser(msg);
    return {publie: false, raison: msg};
  }
  if (!gabarit.includes(MARQUEUR_DEBUT)) {
    const msg = 'export mobile en echec : marqueur de paquet absent du gabarit';
    journaliser(msg);
    return {publie: false, raison: msg};
  }
  const page = gabarit.replace(MARQUEUR_DEBUT, '/*__PAQUET__*/' + JSON.stringify(paquet) + '/*__FIN_PAQUET__*/');

  // Dossier de travail propre a l'export : un depot git flambant neuf,
  // initialise vide et ne contenant jamais que l'index.html genere. Le depot
  // cible n'est ni clone ni lu : rien de son contenu ne peut donc se
  // retrouver embarque dans l'index publie.
  const dossierTravail = fs.mkdtempSync(path.join(os.tmpdir(), 'secretariat-mobile-'));
  try {
    const url = 'https://github.com/' + section.depot + '.git';
    git(dossierTravail, ['init', '-q']);
    fs.writeFileSync(path.join(dossierTravail, 'index.html'), page, 'utf8');
    git(dossierTravail, ['add', 'index.html']);
    git(dossierTravail, ['-c', 'user.email=export-mobile@local', '-c', 'user.name=Export mobile',
      'commit', '-q', '-m', 'export : instantane chiffre du ' + today]);
    git(dossierTravail, ['remote', 'add', 'origin', url]);
    // Un seul commit ne doit jamais s accumuler : on ecrase la branche
    // principale distante avec ce commit unique et sans parent (push force),
    // plutot que d empiler un commit par passage horaire.
    git(dossierTravail, ['push', '--force', 'origin', 'HEAD:main']);
    const msg = 'export mobile publie avec succes sur ' + section.depot;
    journaliser(msg);
    return {publie: true, depot: section.depot};
  } catch (e) {
    const msg = 'export mobile en echec sur ' + section.depot + ' : ' + e.message.split('\n')[0];
    journaliser(msg);
    return {publie: false, raison: msg};
  } finally {
    fs.rmSync(dossierTravail, {recursive: true, force: true});
  }
}

if (require.main === module) {
  exporterMobile().then((res) => {
    if (!res.publie) {
      console.log(res.raison);
      process.exitCode = res.raison && res.raison.includes('ignore') ? 0 : 1;
    } else {
      console.log('Publie sur ' + res.depot);
    }
  }).catch((e) => {
    console.error('export mobile : erreur inattendue : ' + e.message);
    process.exitCode = 1;
  });
}

module.exports = {exporterMobile, verifierDepotCible, depotsEquivalents, extraireProprietaireDepot, listerFichiersDepot};
