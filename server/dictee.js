'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const repo = require('./repo');
const people = require('./people');
const config = require('./config');

// Delai maximal accorde au binaire claude, et taille maximale de sortie acceptee.
// Au-dela de l'un ou l'autre, l'appel est considere en echec (voir traiterSortieProcessus).
const DELAI_MS = 120000;
const TAILLE_MAX_SORTIE = 2 * 1024 * 1024;

// Taille maximale du prompt (voir construirePrompt) : au-dela, des projets sont
// retires du portefeuille envoye. Le prompt part comme argument unique de la ligne
// de commande lancant claude (voir lancerClaudeReel), et Windows borne la longueur
// d'une ligne de commande ; le portefeuille est trivial aujourd'hui mais grossira.
const LIMITE_PROMPT = 24000;

function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Sur le modele exact de server/beeper.js : chaque cause d'echec est distincte,
// portee par une propriete cause en francais, pour que l'appelant (route API) puisse
// traduire chacune en reponse HTTP lisible sans avoir a inspecter le message.
function erreur(cause, message) {
  const e = new Error(message);
  e.cause = cause;
  return e;
}

// Allege un projet avant de l'envoyer dans le prompt : retire le corps de contexte
// (texte libre, parfois long, qu'aucune des six operations ne lit ni ne modifie) et
// les taches deja closes (fait, abandonne), qu'aucune operation courante ne cible
// non plus. Les autres champs (id, prefixe, titre, domaine, statut, echeance,
// prochaine_action, jira, dernier_n) sont conserves tels quels.
function allegerProjetPourPrompt(p) {
  const allege = Object.assign({}, p);
  delete allege.contexte;
  allege.taches = (p.taches || []).filter(
    (t) => t.statut !== 'fait' && t.statut !== 'abandonne');
  return allege;
}

// Construit le texte envoye a Claude : l'etat courant (projets et personnes), la
// date du jour, la demande de l'utilisateur, et la consigne stricte de repondre en
// JSON. Fonction pure : ne touche ni au disque ni au reseau, ne lance aucun processus.
// proprietaire est le nom lu dans data/config.json (voir server/config.js) : cette
// fonction ne va jamais le chercher elle-meme, pour rester pure et testable (tache 16,
// rendre le depot installable par quelqu'un d'autre sans nom propre en dur).
//
// Le portefeuille envoye est d'abord allege (voir allegerProjetPourPrompt), puis, si
// le prompt depasse encore LIMITE_PROMPT caracteres, des projets entiers en sont
// retires, en commencant par ceux qui n'ont plus aucune tache ouverte apres allegement
// (les moins utiles a une dictee, qui porte sur des taches a mener). Le prompt
// signale alors explicitement cette troncature, pour qu'aucun identifiant absent de
// la liste recue ne soit invente par le modele.
function construirePrompt(projects, people, texte, today, proprietaire) {
  const gens = people || [];
  const idsPersonnes = gens.map((p) => p.id);
  const listePersonnes = idsPersonnes.length
    ? idsPersonnes.join(', ')
    : '(aucune personne enregistree, utiliser "moi")';

  const projetsAllumes = (projects || []).map(allegerProjetPourPrompt);
  let tronque = false;

  const assembler = () => {
    const etatSerialise = JSON.stringify({today, projects: projetsAllumes, people: gens}, null, 2);
    const lignes = [
      "Tu es l'agent de dictee du secretariat particulier de " + proprietaire + '.',
      "Tu transformes une demande en francais en une liste d'operations sur des projets et des taches.",
      '',
      "Etat courant des projets et des personnes connues, au format JSON :",
      etatSerialise,
      ''
    ];
    if (tronque) {
      lignes.push(
        "Attention : ce portefeuille a ete tronque pour tenir dans la taille maximale d'une " +
          "requete. N'invente jamais un identifiant de projet ou de tache absent de la liste " +
          'ci-dessus.',
        ''
      );
    }
    lignes.push(
      'Personnes disponibles (identifiants a reutiliser tels quels pour le champ responsable) : ' +
        listePersonnes,
      'Date du jour : ' + today,
      '',
      "Demande de l'utilisateur a transformer en operations : " + texte,
      '',
      'Tu ne peux produire que les six operations suivantes, chacune avec exactement ces champs :',
      '- add_task : {op, projet, titre, statut, responsable, echeance, nature_echeance, prio, ' +
        'effort, bloque_par, derniere_relance, prochaine_relance, note_blocage}',
      '- update_task : {op, ref, champs: {les memes champs de tache que ci-dessus, ' +
        'uniquement ceux a modifier}}',
      '- delete_task : {op, ref}',
      '- add_project : {op, id, titre, domaine, echeance, prochaine_action, jira, statut}',
      '- update_project : {op, projet, champs: {titre, domaine, echeance, prochaine_action, ' +
        'statut, jira}}',
      '- delete_project : {op, projet}',
      '',
      'La prochaine action d un projet n est pas a saisir : elle est deduite de ses taches ' +
        '(la tache ouverte la plus prioritaire). Le champ prochaine_action ne sert que pour ' +
        'un projet qui ne porte encore aucune tache. Quand on te demande de changer la ' +
        'prochaine action d un projet qui a des taches, agis sur les taches (priorite ou ' +
        'creation), pas sur ce champ.',
      '',
      'Valeurs fermees a respecter strictement : statut de tache parmi a_faire, en_cours, bloque, ' +
        'fait, abandonne ; nature_echeance parmi dure, souhaitee ; prio parmi P1, P2, P3, P4 ; ' +
        'effort parmi S, M, L ; domaine de projet parmi side, perso, pro. Les dates sont au ' +
        'format AAAA-MM-JJ ou une chaine vide.',
      '',
      // Meme clause que celle deja imposee au prompt de l'agent hebdomadaire
      // (agent/weekly-recap.md) : cote dictee, domaine ne figurait jusqu'ici qu'en
      // valeur fermee, sans jamais rappeler la regle de confidentialite qui va avec.
      // Une dictee portant sur un projet pro ecrivait alors du detail metier sans
      // retenue, dans une tache comme dans le message de reponse.
      "Regle de confidentialite imperative : pour un projet du domaine pro, n'ecris jamais de " +
        "detail metier, ni dans une tache que tu crees ou modifies ni dans le champ message de ta " +
        "reponse. Limite-toi au titre, au statut et a l'echeance ; aucune prochaine action " +
        "detaillee, aucune note de blocage, aucun contenu au-dela d'un intitule minimal. C'est une " +
        "donnee employeur sur un disque personnel.",
      '',
      "Toute operation autre que ces six est interdite : ne propose jamais autre chose, meme si la " +
        "demande semble le suggerer. Ces operations ne font jamais que lire et ecrire des donnees : " +
        "tu ne peux jamais envoyer de message a qui que ce soit.",
      '',
      'Reponds uniquement par un objet JSON de la forme {"ops": [...], "message": "..."}, sans texte ' +
        "autour et sans bloc de code. Le champ message resume en une phrase, en francais, ce que tu " +
        "as fait ou pourquoi tu n'as rien pu faire."
    );
    return lignes.join('\n');
  };

  let prompt = assembler();
  while (prompt.length > LIMITE_PROMPT) {
    const idx = projetsAllumes.findIndex((p) => (p.taches || []).length === 0);
    if (idx === -1) break;
    projetsAllumes.splice(idx, 1);
    tronque = true;
    prompt = assembler();
  }
  return prompt;
}

// Cherche tous les objets JSON syntaxiquement equilibres dans texte, en ignorant les
// accolades rencontrees a l'interieur d'une chaine JSON. Contrairement a une
// premiere version qui ne retenait que le tout premier bloc, celle-ci les retrouve
// tous, dans l'ordre : un modele qui ecrit un exemple avant sa vraie reponse (ou
// plusieurs reponses a la suite) laisse alors extraireJson choisir, plutot que de
// se figer sur le premier venu. Renvoie un tableau (eventuellement vide) de
// sous-textes ; une ouverture jamais refermee arrete la recherche a cet endroit,
// sans faire perdre les blocs deja trouves avant elle.
function extraireBlocsEquilibres(texte) {
  const blocs = [];
  let position = 0;
  while (position < texte.length) {
    const debut = texte.indexOf('{', position);
    if (debut === -1) break;
    let profondeur = 0;
    let dansChaine = false;
    let echappement = false;
    let fin = -1;
    for (let i = debut; i < texte.length; i++) {
      const c = texte[i];
      if (dansChaine) {
        if (echappement) echappement = false;
        else if (c === '\\') echappement = true;
        else if (c === '"') dansChaine = false;
        continue;
      }
      if (c === '"') { dansChaine = true; continue; }
      if (c === '{') profondeur++;
      else if (c === '}') {
        profondeur--;
        if (profondeur === 0) { fin = i; break; }
      }
    }
    if (fin === -1) break;
    blocs.push(texte.slice(debut, fin + 1));
    position = fin + 1;
  }
  return blocs;
}

const MOTIF_BLOC_CODE = /```(?:json)?\s*([\s\S]*?)```/i;

// Retrouve l'objet JSON dans la sortie de Claude, que ce texte soit du JSON seul,
// du JSON entoure de texte libre, ou du JSON dans un bloc de code Markdown. Fonction
// pure. Renvoie toujours {ops, message}, ops etant toujours un tableau (meme absent
// de la reponse). Leve une erreur en francais si aucun JSON exploitable n'est trouve :
// la sortie d'un modele de langage n'est jamais garantie, cette fonction ne doit
// jamais laisser passer une exception non maitrisee vers l'appelant.
//
// Parmi tous les blocs equilibres trouves (voir extraireBlocsEquilibres), le choix
// se fait dans cet ordre : le premier qui s'analyse en JSON et porte une cle ops ou
// message (la vraie reponse, meme precedee d'un exemple qui n'en porte aucune) ;
// a defaut, le dernier bloc qui s'analyse tout court (un modele termine plus souvent
// par sa reponse que par un exemple) ; sinon, echec.
function extraireJson(sortie) {
  const texte = typeof sortie === 'string' ? sortie : '';
  const motifBloc = MOTIF_BLOC_CODE.exec(texte);
  const candidats = [];
  if (motifBloc) candidats.push(motifBloc[1]);
  candidats.push(texte);

  const enResultat = (data) => ({
    ops: Array.isArray(data.ops) ? data.ops : [],
    message: typeof data.message === 'string' ? data.message : ''
  });

  for (const candidat of candidats) {
    const analysables = [];
    for (const bloc of extraireBlocsEquilibres(candidat)) {
      let data;
      try {
        data = JSON.parse(bloc);
      } catch (e) {
        continue;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      analysables.push(data);
      if (Object.prototype.hasOwnProperty.call(data, 'ops') ||
          Object.prototype.hasOwnProperty.call(data, 'message')) {
        return enResultat(data);
      }
    }
    if (analysables.length) return enResultat(analysables[analysables.length - 1]);
  }
  throw new Error(
    "reponse de Claude illisible : aucun objet JSON exploitable n'a ete trouve dans la sortie");
}

// Traduit le resultat brut d'execFile (err, stdout) en sortie exploitable ou en
// erreur causee, sans jamais toucher au disque ni au reseau : fonction pure, isolee
// pour pouvoir tester chaque cas d'echec (binaire absent, delai depasse, sortie trop
// volumineuse, code non nul, sortie vide) sans jamais lancer de vrai processus.
function traiterSortieProcessus(err, stdout) {
  if (err) {
    if (err.code === 'ENOENT') {
      throw erreur('binaire_absent',
        "le binaire claude est introuvable sur ce poste : verifier son installation");
    }
    // Distinct de delai_depasse ci-dessous : Node tue aussi le processus quand la
    // sortie depasse maxBuffer (TAILLE_MAX_SORTIE), mais ce n'est jamais un
    // depassement de delai. Node porte alors ce code precis (jamais killed/signal
    // sur cette version), a verifier avant le cas general killed/signal.
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw erreur('sortie_trop_volumineuse',
        "Claude a produit une sortie trop volumineuse (limite de 2 Mo depassee)");
    }
    if (err.killed || err.signal) {
      throw erreur('delai_depasse',
        "Claude n'a pas repondu dans le delai imparti (120 secondes)");
    }
    throw erreur('echec', 'Claude a renvoye un code de retour non nul (' + err.code + ')');
  }
  const sortie = String(stdout == null ? '' : stdout).trim();
  if (!sortie) {
    throw erreur('sortie_vide', "Claude n'a renvoye aucune sortie exploitable");
  }
  return sortie;
}

const MOTIF_EXE = /"([^"]+\.exe)"/;

// Resout le binaire a lancer. Sur les systemes non Windows, le nom simple "claude"
// suffit : le shim installe par npm y est directement executable et execFile peut le
// lancer sans shell. Sur Windows, npm installe un shim .cmd, que Node refuse de lancer
// directement sans passer par cmd.exe (protection interne a Node, coherente avec
// l'interdiction de shell: true ici) : on retrouve alors le vrai executable .exe que ce
// shim invoque, en lisant ce fichier local (jamais le texte de l'utilisateur).
function resoudreBinaireClaude(env, plateforme) {
  if (plateforme !== 'win32') return 'claude';
  const chemins = String((env && env.PATH) || (env && env.Path) || '').split(path.delimiter);
  for (const dossier of chemins) {
    if (!dossier) continue;
    const shim = path.join(dossier, 'claude.cmd');
    try {
      if (!fs.existsSync(shim)) continue;
      const contenu = fs.readFileSync(shim, 'utf8');
      const m = MOTIF_EXE.exec(contenu);
      if (!m) continue;
      // Le shim genere par npm reference son propre dossier via la variable de
      // commande %dp0% (equivalent a %~dp0, deja terminee par un antislash),
      // jamais un chemin litteral : sans cette substitution, fs.existsSync sur
      // la chaine brute "%dp0%\..." echoue toujours et le binaire reel n'est
      // jamais trouve.
      const cible = m[1].replace(/%dp0%/i, path.dirname(shim) + path.sep);
      if (fs.existsSync(cible)) return cible;
    } catch (e) {
      continue;
    }
  }
  return 'claude.exe';
}

// Construit les arguments passes au binaire claude. Fonction pure, isolee pour
// pouvoir verifier son contenu sans jamais lancer de vrai processus.
//
// --tools "" est documente par `claude -p --help` (version installee sur ce poste,
// verifiee avant ce correctif, jamais devinee) : "Specify the list of available
// tools from the built-in set. Use "" to disable all tools [...]". On ne veut ici
// qu'une transformation de texte (prompt en JSON), jamais un agent capable d'agir :
// sans aucun outil disponible, le modele ne peut jamais en demander l'usage, donc
// le processus ne peut jamais rester bloque en attente d'une approbation qu'il n'a
// aucun moyen de recevoir (execFile ne fournit pas de TTY interactif). C'est un
// effet du meme flag, pas une seconde option a ajouter : sans outil, il n'existe
// tout simplement plus rien a approuver.
function argumentsClaude(prompt) {
  // L'ordre compte. `--tools` est un parametre variadique de la ligne de commande :
  // place juste apres lui, le prompt est avale comme s'il etait un nom d'outil, et
  // le binaire echoue avec "Input must be provided either through stdin or as a
  // prompt argument". Le prompt doit donc passer AVANT tout drapeau variadique.
  return ['-p', prompt, '--tools', ''];
}

function lancerClaudeReel(prompt) {
  const binaire = resoudreBinaireClaude(process.env, process.platform);
  return new Promise((resolve, reject) => {
    execFile(binaire, argumentsClaude(prompt), {
      timeout: DELAI_MS,
      maxBuffer: TAILLE_MAX_SORTIE,
      windowsHide: true
    }, (err, stdout) => {
      try {
        resolve(traiterSortieProcessus(err, stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Construit le prompt a partir de l'etat courant (lu comme etat() le fait, sans
// passer par lui pour eviter une dependance circulaire avec api.js), lance Claude,
// puis extrait les operations. N'ecrit jamais rien : la seule porte d'ecriture reste
// store.applyOps, appelee par l'appelant via api.appliquer. ctx.lancerClaude permet
// d'injecter un faux lanceur dans les tests, sans jamais executer le vrai binaire.
async function dicter(texte, ctx) {
  const today = (ctx && ctx.today) || aujourdhui();
  const {projects} = repo.loadAllSafe(ctx.projectsDir);
  const {people: gens} = people.loadPeopleSafe(ctx.dataDir);
  const {proprietaire} = config.lireConfig(ctx.dataDir);
  const prompt = construirePrompt(projects, gens, texte, today, proprietaire);
  const lanceur = (ctx && ctx.lancerClaude) || lancerClaudeReel;
  const sortie = await lanceur(prompt);
  return extraireJson(sortie);
}

module.exports = {construirePrompt, extraireJson, dicter, lancerClaudeReel,
  traiterSortieProcessus, resoudreBinaireClaude, argumentsClaude};
