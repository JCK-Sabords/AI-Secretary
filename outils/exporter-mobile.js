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
  // d'erreur (jamais construits a partir du code) y figurent.
  fs.appendFileSync(JOURNAL, '[' + horodatage + '] ' + ligne + '\n', 'utf8');
}

function git(dir, args) {
  return execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
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
    const msg = 'export mobile ignore : data/config.json illisible (' + e.message + ')';
    journaliser(msg);
    return {publie: false, raison: msg};
  }

  const section = data && data.exportMobile;
  if (!section || typeof section.code !== 'string' || !section.code || typeof section.depot !== 'string' || !section.depot) {
    const msg = 'export mobile ignore : section exportMobile absente ou incomplete dans data/config.json';
    journaliser(msg);
    return {publie: false, raison: msg};
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

  // Dossier de travail propre a l'export, distinct du depot du code (RACINE)
  // et du depot des donnees (DATA_DIR) : un clone frais a chaque passage,
  // supprime ensuite, pour ne jamais faire fuiter d'autre contenu.
  const dossierTravail = fs.mkdtempSync(path.join(os.tmpdir(), 'secretariat-mobile-'));
  try {
    const url = 'https://github.com/' + section.depot + '.git';
    git(dossierTravail, ['clone', '--depth', '1', url, '.']);
    // Nouveau commit toujours sans parent (orphelin) : le clone recupere le
    // dernier index.html publie pour permettre la comparaison de contenu
    // ci-dessous, mais l historique de commits precedent n est jamais repris.
    // Sans cela, un simple push --force sur une branche clonee empile un
    // commit de plus a chaque passage (le nouveau commit garde l ancien pour
    // parent), exactement l accumulation horaire que ce depot doit eviter.
    const indexPrecedent = path.join(dossierTravail, 'index.html');
    const contenuPrecedent = fs.existsSync(indexPrecedent) ? fs.readFileSync(indexPrecedent, 'utf8') : null;
    if (contenuPrecedent === page) {
      const msg = 'export mobile : aucun changement, rien a publier (' + section.depot + ')';
      journaliser(msg);
      return {publie: false, raison: msg};
    }
    git(dossierTravail, ['checkout', '--orphan', 'export-du-jour']);
    fs.writeFileSync(indexPrecedent, page, 'utf8');
    git(dossierTravail, ['add', 'index.html']);
    git(dossierTravail, ['-c', 'user.email=export-mobile@local', '-c', 'user.name=Export mobile',
      'commit', '-m', 'export : instantane chiffre du ' + today]);
    // Un seul commit ne doit jamais s accumuler : on ecrase la branche
    // principale distante avec ce commit unique et sans parent (push force),
    // plutot que d empiler un commit par passage horaire.
    git(dossierTravail, ['push', '--force', 'origin', 'export-du-jour:main']);
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

module.exports = {exporterMobile};
