'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./api');

const RACINE = path.join(__dirname, '..');
const CTX = {
  root: RACINE,
  dataDir: path.join(RACINE, 'data'),
  projectsDir: path.join(RACINE, 'data', 'projects')
};

// Amorce une installation neuve (tache 16 : rendre le depot installable par
// quelqu'un d'autre). data/ n'est plus versionne (voir .gitignore) : quelqu'un qui
// clone le depot puis lance le serveur ne doit jamais tomber sur un dashboard vide
// ou en erreur, mais sur un tableau de bord fonctionnel avec le projet d'exemple.
//
// Deux gestes, independants l'un de l'autre :
// - data/projects/ est toujours cree s'il manque (un dossier data/ existant mais
//   sans sous-dossier projects/ ne doit jamais faire planter la lecture) ;
// - si data/config.json manque, tout le contenu de data.exemple/ est recopie dans
//   data/ (config.json, people.md, projects/exemple.md) : c'est la seule condition
//   verifiee, pour ne jamais ecraser une installation existante, meme partielle
//   (un config.json deja present suffit a considerer l'installation comme faite).
function copierRecursif(source, cible) {
  fs.mkdirSync(cible, {recursive: true});
  fs.readdirSync(source, {withFileTypes: true}).forEach((entree) => {
    const src = path.join(source, entree.name);
    const dst = path.join(cible, entree.name);
    if (entree.isDirectory()) copierRecursif(src, dst);
    else fs.copyFileSync(src, dst);
  });
}

function amorcerInstallation(ctx) {
  fs.mkdirSync(ctx.projectsDir, {recursive: true});
  const configCible = path.join(ctx.dataDir, 'config.json');
  const dossierExemple = path.join(ctx.root, 'data.exemple');
  if (!fs.existsSync(configCible) && fs.existsSync(dossierExemple)) {
    copierRecursif(dossierExemple, ctx.dataDir);
    console.log(
      "Premiere installation detectee : data.exemple/ recopie dans data/. " +
      'Completez proprietaire et filNoteASoiMeme dans data/config.json (voir le README).');
  }
}
const PORT = 5556;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'};

// Defense contre les requetes croisees (revue finale, point C3). Une requete dite
// simple (formulaire HTML, ou fetch avec un Content-Type text/plain) echappe au
// controle prealable (preflight) du navigateur : n importe quel site visite dans
// le meme navigateur peut alors emettre une requete vers ce serveur local, avec
// les cookies et l acces reseau de la machine du proprietaire. Le serveur doit
// donc verifier lui-meme l origine et l hote, avant tout traitement, plutot que
// de compter sur le controle du navigateur.
const ORIGINES_LOCALES = new Set(['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT]);
const HOTES_LOCAUX = new Set(['127.0.0.1:' + PORT, 'localhost:' + PORT]);

// Une requete d ecriture (tout ce qui n est pas une simple lecture) doit toujours
// porter un corps JSON explicite. Ce n est pas seulement une question de format :
// un Content-Type text/plain permet justement a une requete croisee d echapper au
// preflight CORS, donc de ne jamais etre bloquee par le navigateur avant d
// atteindre ce serveur.
function requeteEcriture(methode) {
  return methode !== 'GET' && methode !== 'HEAD' && methode !== 'OPTIONS';
}

// Sur le meme modele que le refus 413 plus bas (corps trop volumineux) : la
// requete est detruite explicitement apres la reponse, plutot que laissee
// pendante, pour ne jamais compter sur le client pour vider un corps que ce
// serveur ne lira jamais.
function refuseCroisee(req, res, message) {
  res.writeHead(403, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify({erreur: message}));
  req.destroy();
}

// Taille maximale acceptee pour un corps de requete, en octets. Au-dela, la
// lecture est interrompue et le client recoit 413 : sans cette limite, un corps
// volumineux (ou un flux qui ne se termine jamais) ferait croitre la memoire du
// processus sans borne.
const TAILLE_MAX_CORPS = 1024 * 1024;

function estConfine(dossier, cible) {
  return cible === dossier || cible.startsWith(dossier + path.sep);
}

// Resout le fichier statique demande et verifie qu il reste bien contenu dans
// le dossier web/ resolu. Comparer par simple prefixe de chaine (startsWith sur
// le chemin du dossier web sans separateur final) est insuffisant : un dossier
// voisin partageant ce prefixe (ex. "web-prive") passerait le test a tort. On
// verifie donc l egalite exacte ou la presence du separateur de chemin, comme
// deja fait pour saveProject dans repo.js.
function fichierStatique(root, url) {
  const dossierWeb = path.resolve(root, 'web');
  const nom = url === '/' ? '/index.html' : url.split('?')[0];
  const cible = path.resolve(dossierWeb, '.' + nom);
  if (!estConfine(dossierWeb, cible) || !fs.existsSync(cible) || fs.statSync(cible).isDirectory()) {
    return null;
  }
  // La verification de confinement ci-dessus porte sur le chemin resolu par
  // simple concatenation : elle ne dejoue pas un lien symbolique depose sous
  // web/ et pointant en dehors. On resout donc les liens symboliques et on
  // refait la meme verification sur le resultat.
  const reel = fs.realpathSync(cible);
  if (!estConfine(dossierWeb, reel)) return null;
  return cible;
}

function createServer(ctx) {
  amorcerInstallation(ctx);
  return http.createServer((req, res) => {
    // Trois controles, avant tout autre traitement (voir revue finale, point C3).
    // Un en-tete Origin absent est laisse passer : les navigateurs ne l envoient
    // pas sur toute requete (par exemple une navigation simple, ou certaines
    // requetes same-origin), et son absence ne signale rien de croise a elle
    // seule ; c est l en-tete Host, verifie juste apres, qui porte le controle
    // qu aucune requete ne peut esquiver.
    const origine = req.headers['origin'];
    if (origine != null && !ORIGINES_LOCALES.has(origine)) {
      return refuseCroisee(req, res,
        "origine refusee : cette requete ne provient pas d'une page locale autorisee");
    }
    // Sans ce controle sur Host, une reassociation de nom de domaine (DNS
    // rebinding) ferait passer une page distante pour une page locale aux yeux
    // du navigateur (qui autoriserait alors la lecture de la reponse), alors que
    // ce serveur, lui, continuerait a repondre normalement : de quoi lire l etat
    // (donc les identifiants de conversation deja resolus), puis appeler la
    // route d envoi.
    const hote = String(req.headers['host'] || '').toLowerCase();
    if (!HOTES_LOCAUX.has(hote)) {
      return refuseCroisee(req, res,
        "hote refuse : cette requete ne vise pas 127.0.0.1:" + PORT + " ou localhost:" + PORT);
    }
    // Une requete simple avec un Content-Type text/plain echappe au preflight
    // CORS du navigateur : sans ce controle, le serveur analysait quand meme un
    // tel corps en JSON, ce qui rendait les deux controles ci-dessus a eux
    // seuls insuffisants pour une requete d ecriture.
    if (requeteEcriture(req.method)) {
      const typeContenu = String(req.headers['content-type'] || '').trim();
      if (!/^application\/json(;|$)/i.test(typeContenu)) {
        return refuseCroisee(req, res,
          "type de contenu refuse : application/json est requis pour une requete d'ecriture");
      }
    }

    // Les fragments sont accumules en Buffer, jamais concatenes a une chaine :
    // un decodage fragment par fragment corromprait silencieusement tout
    // caractere UTF-8 multioctet coupe entre deux paquets (accents francais,
    // JSON produit par un modele de langage). Le decodage final se fait en un
    // seul appel, une fois tous les octets reunis.
    const morceaux = [];
    let taille = 0;
    let tropVolumineux = false;

    req.on('data', (c) => {
      if (tropVolumineux) return;
      taille += c.length;
      if (taille > TAILLE_MAX_CORPS) {
        tropVolumineux = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({erreur: 'corps de requete trop volumineux'}));
        req.destroy();
        return;
      }
      morceaux.push(c);
    });

    req.on('end', async () => {
      if (tropVolumineux) return;
      if (req.url.startsWith('/api/')) {
        let body = null;
        if (morceaux.length) {
          try { body = JSON.parse(Buffer.concat(morceaux).toString('utf8')); }
          catch (e) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({erreur: 'JSON invalide'}));
          }
        }
        // Filet de securite : quoi qu il arrive dans l API (par exemple une
        // date mal formee qui echapperait a la validation), une exception ici
        // ne doit jamais faire tomber le serveur. Sans capture, une exception
        // levee dans ce gestionnaire async est un rejet de promesse non gere
        // qui termine le processus depuis Node 15.
        try {
          const r = await api.handle(req, body, ctx);
          res.writeHead(r.status, {'Content-Type': 'application/json; charset=utf-8'});
          return res.end(JSON.stringify(r.json));
        } catch (e) {
          console.error(e);
          res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
          return res.end(JSON.stringify({erreur: e.message}));
        }
      }
      // Meme filet pour le service de fichiers statiques : les appels de
      // systeme de fichiers y sont synchrones et peuvent lever (droits,
      // fichier disparu entre la verification et la lecture, etc.).
      try {
        const fichier = fichierStatique(ctx.root, req.url);
        if (!fichier) {
          res.writeHead(404); return res.end('introuvable');
        }
        res.writeHead(200, {'Content-Type': TYPES[path.extname(fichier)] || 'text/plain'});
        res.end(fs.readFileSync(fichier));
      } catch (e) {
        console.error(e);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({erreur: e.message}));
      }
    });
  });
}

if (require.main === module) {
  createServer(CTX).listen(PORT, '127.0.0.1', () => {
    console.log('Secretariat sur http://127.0.0.1:' + PORT);
  });
}

module.exports = {createServer, CTX};
