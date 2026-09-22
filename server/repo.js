'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const store = require('./store');

function fichiers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function loadAll(dir) {
  return fichiers(dir).map(
    (f) => store.parseProject(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function loadAllSafe(dir) {
  const projects = [];
  const errors = [];
  fichiers(dir).forEach((f) => {
    try {
      projects.push(store.parseProject(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch (e) {
      errors.push({fichier: f, message: e.message});
    }
  });
  return {projects, errors};
}

function saveProject(dir, project) {
  // Defense en profondeur (1/2) : l identifiant peut venir d une operation add_project
  // dont le JSON est produit par un LLM a partir d une dictee, donc une entree non
  // fiable. On refuse tout identifiant invalide avant la moindre ecriture sur le disque.
  if (!store.idValide(project.id)) {
    throw new store.InvalidProjectError(
      'identifiant de projet invalide : ' + JSON.stringify(project.id));
  }

  const cible = path.join(dir, project.id + '.md');

  // Defense en profondeur (2/2) : ceinture en plus des bretelles. Meme si idValide
  // ci-dessus a deja ecarte toute remontee de repertoire, on verifie que le chemin
  // resolu reste bien contenu dans le dossier cible resolu avant d ecrire quoi que
  // ce soit.
  const dirResolu = path.resolve(dir);
  const cibleResolue = path.resolve(cible);
  if (cibleResolue !== dirResolu && !cibleResolue.startsWith(dirResolu + path.sep)) {
    throw new store.InvalidProjectError(
      'chemin de projet hors du dossier cible : ' + JSON.stringify(project.id));
  }

  fs.mkdirSync(dir, {recursive: true});
  const ancien = fs.existsSync(cible) ? fs.readFileSync(cible, 'utf8') : null;
  const texte = store.serializeProject(project);
  fs.writeFileSync(cible, texte, 'utf8');
  try {
    store.parseProject(fs.readFileSync(cible, 'utf8'));
  } catch (e) {
    try {
      if (ancien === null) fs.unlinkSync(cible);
      else fs.writeFileSync(cible, ancien, 'utf8');
    } catch (e2) {
      // La restauration a echoue a son tour : l appelant doit savoir explicitement
      // que ce fichier precis est reste dans un etat corrompu et demande une
      // intervention manuelle, plutot que de ne voir remonter que l erreur de
      // restauration en perdant la cause d origine.
      throw new Error(
        'relecture du fichier ' + cible + ' echouee (' + e.message + '), et la ' +
        'restauration de ce fichier a egalement echoue (' + e2.message + ') : ' +
        'intervention manuelle requise sur ' + cible + '.');
    }
    throw e;
  }
}

// idsConnus : les identifiants de projet connus au moment ou l'instantane passe
// dans projects a ete charge (typiquement projects.map(p => p.id) juste apres
// repo.loadAllSafe, avant que store.applyOps ne mute une copie en memoire).
// Optionnel : omis, aucun fichier n'est jamais supprime (defaut sur, jamais sur
// une suppression).
//
// Sans cette liste (revue finale, point I4), saveAll supprimait tout fichier
// .md absent de projects, y compris un fichier apparu entre la lecture et cette
// ecriture (par exemple un projet cree par l'agent hebdomadaire, qui ne commite
// jamais, pendant qu'un cycle d'ecriture du serveur etait en cours) : ce fichier
// disparaissait sans trace, definitivement perdu. Desormais, seul un fichier
// deja connu au chargement et absent de projects (donc explicitement supprime,
// par delete_project) est efface ; un fichier inconnu de idsConnus est toujours
// laisse intact, quoi qu'il arrive.
function saveAll(dir, projects, idsConnus) {
  // Valide tout en memoire avant d ecrire quoi que ce soit sur le disque : si un
  // projet de la liste echoue, aucun fichier n est touche, pas meme ceux des
  // projets valides qui le precedent dans la liste.
  projects.forEach((p) => {
    store.parseProject(store.serializeProject(p));
    if (!store.idValide(p.id)) {
      throw new store.InvalidProjectError(
        'identifiant de projet invalide : ' + JSON.stringify(p.id));
    }
  });

  const connus = new Set(idsConnus || []);
  const gardes = new Set(projects.map((p) => p.id));
  projects.forEach((p) => saveProject(dir, p));
  fichiers(dir).forEach((f) => {
    const id = f.slice(0, -3); // retire l'extension .md
    if (connus.has(id) && !gardes.has(id)) fs.unlinkSync(path.join(dir, f));
  });
}

// Les donnees vivent dans leur propre depot Git, a l'interieur de data/, distinct
// du depot du code. Le depot du code est public et ignore data/ en entier : c'est
// ce qui permet de publier le logiciel sans jamais publier les projets ni les
// contacts de son proprietaire.
//
// Mais ignorer data/ dans le depot du code avait eu un effet de bord silencieux,
// constate le 22 septembre 2026 : le commit automatique visait data/ depuis la
// racine du code, ne ramassait donc plus rien, et plus aucune modification n'etait
// sauvegardee. Douze projets ajoutes entre-temps n'existaient qu'en un exemplaire.
// Le depot interne corrige cela : chaque ecriture y est commitee, localement, et
// il est cree au premier usage pour qu'une installation neuve en beneficie aussi.
function assurerDepot(dataDir) {
  if (fs.existsSync(path.join(dataDir, '.git'))) return;
  fs.mkdirSync(dataDir, {recursive: true});
  execFileSync('git', ['init', '-q'], {cwd: dataDir, stdio: 'ignore'});
  const ignore = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'history/run.log*\n', 'utf8');
  // Sans identite Git globale, git commit echoue. Dans ce seul cas, on pose une
  // identite locale neutre, propre a ce depot de donnees.
  let email = '';
  try {
    email = execFileSync('git', ['config', 'user.email'], {cwd: dataDir}).toString().trim();
  } catch (e) { email = ''; }
  if (!email) {
    execFileSync('git', ['config', 'user.name', 'Secretariat'], {cwd: dataDir, stdio: 'ignore'});
    execFileSync('git', ['config', 'user.email', 'secretariat@local'], {cwd: dataDir, stdio: 'ignore'});
  }
}

function commit(dataDir, message) {
  try {
    assurerDepot(dataDir);
    // Tout ce qui vit dans ce depot est de la donnee : un add complet est ici
    // legitime, contrairement a un add depuis la racine du code.
    execFileSync('git', ['add', '-A'], {cwd: dataDir, stdio: 'ignore'});
    execFileSync('git', ['commit', '-q', '-m', message], {cwd: dataDir, stdio: 'ignore'});
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {loadAll, loadAllSafe, saveProject, saveAll, commit};
