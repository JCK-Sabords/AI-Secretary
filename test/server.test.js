const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {createServer} = require('../server/server');

// Demarre un serveur reel sur le port 0 (choisi par le systeme) et fournit de
// quoi faire de vraies requetes HTTP et l arreter proprement en fin de test.
function demarrer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-srv-'));
  const projectsDir = path.join(root, 'data', 'projects');
  fs.mkdirSync(projectsDir, {recursive: true});
  const webDir = path.join(root, 'web');
  fs.mkdirSync(webDir, {recursive: true});

  const ctx = {root, dataDir: path.join(root, 'data'), projectsDir, today: '2026-09-06'};
  const server = createServer(ctx);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        root, projectsDir, webDir, port,
        fermer: () => new Promise((r) => server.close(r))
      });
    });
  });
}

// Depuis le controle d en-tete Host ajoute au point C3 (revue finale), toute
// requete doit porter un Host correspondant au port reellement configure du
// serveur (127.0.0.1:5556 ou localhost:5556), meme quand le serveur de test,
// lui, ecoute sur un port choisi par le systeme (port 0) pour permettre
// l isolation entre tests. Le Host est donc toujours force ici a la valeur
// attendue, plutot que laisse au comportement par defaut de http.request (qui
// l aurait deduit du port reel de connexion).
function requete(port, options, corps) {
  return new Promise((resolve, reject) => {
    const entetes = Object.assign({Host: '127.0.0.1:5556'}, options && options.headers);
    const req = http.request({host: '127.0.0.1', port, ...options, headers: entetes}, (res) => {
      const morceaux = [];
      res.on('data', (c) => morceaux.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        corps: Buffer.concat(morceaux).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (corps != null) req.write(corps);
    req.end();
  });
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('une date mal formee dans un fichier de projet n arrete pas le serveur', async () => {
  const {projectsDir, port, fermer} = await demarrer();
  try {
    fs.writeFileSync(path.join(projectsDir, 'date-cassee.md'),
      '---\nid: date-cassee\nprefixe: DC\necheance: PAS-UNE-DATE\ntaches: []\n---\n');

    const r1 = await requete(port, {method: 'GET', path: '/api/etat'});
    assert.strictEqual(r1.status, 200);
    const json1 = JSON.parse(r1.corps);
    assert.strictEqual(json1.errors.length, 1);
    assert.match(json1.errors[0].fichier, /date-cassee\.md/);

    // Le serveur doit rester debout : une seconde requete aboutit encore.
    const r2 = await requete(port, {method: 'GET', path: '/api/etat'});
    assert.strictEqual(r2.status, 200);
  } finally {
    await fermer();
  }
});

test('un corps de requete trop volumineux recoit 413 et le serveur reste debout', async () => {
  const {port, fermer} = await demarrer();
  try {
    // Un peu au-dela de la limite de 1 Mo (le serveur coupe la lecture avec
    // req.destroy des que la limite est franchie ; un depassement trop large
    // laisserait des octets non lus dans le tampon reseau et provoquerait une
    // reinitialisation TCP brutale cote client plutot qu une reponse propre,
    // ce qui n est pas ce que ce test cherche a observer).
    const corps = Buffer.alloc(1024 * 1024 + 20000, 'a');
    // Host:5556 et Content-Type: application/json sont requis depuis le controle
    // ajoute au point C3 (revue finale) : sans eux, cette requete d ecriture
    // serait refusee en 403 avant meme d atteindre le controle de taille que ce
    // test cherche a observer.
    const entete = 'POST /api/etat HTTP/1.1\r\nHost: 127.0.0.1:5556\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: ' + corps.length + '\r\nConnection: close\r\n\r\n';

    const socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('error', reject);
    });
    socket.write(entete);
    socket.write(corps);

    let brut = Buffer.alloc(0);
    await new Promise((resolve, reject) => {
      socket.on('data', (c) => { brut = Buffer.concat([brut, c]); });
      socket.on('end', resolve);
      socket.on('error', reject);
    });

    const reponse = brut.toString('utf8');
    assert.match(reponse, /413/);
    assert.match(reponse, /corps de requete trop volumineux/);

    // Le serveur doit rester debout : une requete normale aboutit encore.
    const r2 = await requete(port, {method: 'GET', path: '/api/etat'});
    assert.strictEqual(r2.status, 200, 'le serveur repond encore apres le corps trop volumineux');
  } finally {
    await fermer();
  }
});

test('un corps JSON accentue est recu intact meme coupe en plusieurs fragments', async () => {
  const {port, fermer} = await demarrer();
  const original = JSON.parse;
  let capture = null;
  // On intercepte JSON.parse le temps de la requete pour observer exactement la
  // chaine que le serveur lui a soumise, sans dependre d une route qui la
  // renverrait telle quelle (aucune route de l API ne le fait).
  JSON.parse = function espion(s, ...reste) {
    capture = s;
    return original.call(JSON, s, ...reste);
  };
  try {
    const texte = "Ça sent le café : l'échéance approche à Noël, prévoir un rendez-vous.";
    const attendu = JSON.stringify({texte});
    const octets = Buffer.from(attendu, 'utf8');

    // On coupe volontairement au milieu d une sequence UTF-8 multioctet : au
    // premier octet dont le bit de tete indique un caractere sur plusieurs
    // octets (0xC0-0xFF), pour separer ce caractere entre deux fragments.
    let coupure = -1;
    for (let i = 0; i < octets.length; i++) {
      if (octets[i] >= 0xC0) { coupure = i + 1; break; }
    }
    assert.ok(coupure > 0 && coupure < octets.length,
      'le texte de test doit contenir un caractere multioctet a couper');

    const socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('error', reject);
    });
    // Meme raison qu au test precedent : Host:5556 et Content-Type: application/json
    // sont requis depuis le controle du point C3 (revue finale).
    const entete = 'POST /api/quelconque HTTP/1.1\r\nHost: 127.0.0.1:5556\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: ' + octets.length + '\r\nConnection: close\r\n\r\n';
    socket.write(entete);
    socket.write(octets.subarray(0, coupure));
    await attendre(20);
    socket.write(octets.subarray(coupure));

    let brut = Buffer.alloc(0);
    await new Promise((resolve, reject) => {
      socket.on('data', (c) => { brut = Buffer.concat([brut, c]); });
      socket.on('end', resolve);
      socket.on('error', reject);
    });

    assert.strictEqual(capture, attendu,
      'le JSON soumis au parseur doit correspondre exactement au texte envoye, ' +
      'meme coupe au milieu d un caractere accentue');
    const reponse = brut.toString('utf8');
    assert.match(reponse, /route inconnue/);
  } finally {
    JSON.parse = original;
    await fermer();
  }
});

test('une requete statique visant un repertoire renvoie 404', async () => {
  const {webDir, port, fermer} = await demarrer();
  try {
    fs.mkdirSync(path.join(webDir, 'dossier'));
    const r = await requete(port, {method: 'GET', path: '/dossier'});
    assert.strictEqual(r.status, 404);
  } finally {
    await fermer();
  }
});

test('une tentative de traversee par double barre oblique de tete renvoie 404', async () => {
  const {root, port, fermer} = await demarrer();
  try {
    fs.writeFileSync(path.join(root, 'hors-web.txt'), 'secret');
    const r = await requete(port, {method: 'GET', path: '//../hors-web.txt'});
    assert.strictEqual(r.status, 404);
  } finally {
    await fermer();
  }
});

/* ============================ amorcage d une installation neuve ============================ */
/* Tache 16 : data/ n est plus versionne. createServer doit toujours creer
   data/projects/ s il manque, et s il n existe pas encore de data/config.json,
   recopier data.exemple/ pour qu un depot fraichement clone offre un tableau de
   bord fonctionnel des le premier lancement, jamais une erreur ni un dashboard
   vide. */

function racineAvecExemple() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-boot-'));
  fs.mkdirSync(path.join(root, 'web'), {recursive: true});
  const exemple = path.join(root, 'data.exemple');
  fs.mkdirSync(path.join(exemple, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(exemple, 'config.json'),
    JSON.stringify({proprietaire: '', filNoteASoiMeme: ''}), 'utf8');
  fs.writeFileSync(path.join(exemple, 'people.md'), '[]\n', 'utf8');
  fs.writeFileSync(path.join(exemple, 'projects', 'exemple.md'),
    '---\nid: exemple\nprefixe: EX\ntaches: []\n---\n', 'utf8');
  return root;
}

test('createServer cree data/projects si ce dossier manque, sans toucher a un config.json existant', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-boot-'));
  fs.mkdirSync(path.join(root, 'web'), {recursive: true});
  fs.mkdirSync(path.join(root, 'data'), {recursive: true});
  fs.writeFileSync(path.join(root, 'data', 'config.json'),
    JSON.stringify({proprietaire: 'Deja Configure'}), 'utf8');
  const ctx = {root, dataDir: path.join(root, 'data'),
    projectsDir: path.join(root, 'data', 'projects'), today: '2026-09-06'};
  const {createServer} = require('../server/server');
  const server = createServer(ctx);
  try {
    assert.ok(fs.existsSync(ctx.projectsDir), 'data/projects doit etre cree');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'));
    assert.strictEqual(config.proprietaire, 'Deja Configure',
      'un config.json deja present ne doit jamais etre ecrase');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('createServer recopie data.exemple/ dans data/ quand data/config.json manque', async () => {
  const root = racineAvecExemple();
  const ctx = {root, dataDir: path.join(root, 'data'),
    projectsDir: path.join(root, 'data', 'projects'), today: '2026-09-06'};
  const {createServer} = require('../server/server');
  const server = createServer(ctx);
  try {
    assert.ok(fs.existsSync(path.join(root, 'data', 'config.json')),
      'config.json doit avoir ete recopie depuis data.exemple/');
    assert.ok(fs.existsSync(path.join(root, 'data', 'people.md')));
    assert.ok(fs.existsSync(path.join(root, 'data', 'projects', 'exemple.md')));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('un dashboard fraichement amorce repond avec le projet d exemple via GET /api/etat', async () => {
  const root = racineAvecExemple();
  const ctx = {root, dataDir: path.join(root, 'data'),
    projectsDir: path.join(root, 'data', 'projects'), today: '2026-09-06'};
  const {createServer} = require('../server/server');
  const server = createServer(ctx);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const r = await requete(port, {method: 'GET', path: '/api/etat'});
    assert.strictEqual(r.status, 200);
    const json = JSON.parse(r.corps);
    assert.strictEqual(json.projects.length, 1);
    assert.strictEqual(json.projects[0].id, 'exemple');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

/* ============================ point C3 : defense croisee ============================ */
/* Le relecteur a reellement supprime le projet Estimmo depuis une origine
   etrangere, via une requete simple (Content-Type text/plain) qui echappe au
   preflight CORS du navigateur. Ces quatre tests couvrent les trois refus
   ajoutes (Origin, Host, Content-Type) et confirment qu une requete locale
   normale continue de passer. */

test('C3 : une origine etrangere est refusee (403), meme sur une simple lecture', async () => {
  const {port, fermer} = await demarrer();
  try {
    const r = await requete(port, {method: 'GET', path: '/api/etat',
      headers: {Origin: 'https://site-malveillant.example'}});
    assert.strictEqual(r.status, 403);
    assert.match(JSON.parse(r.corps).erreur, /origine/);
  } finally {
    await fermer();
  }
});

test('C3 : un hote autre que 127.0.0.1:5556 ou localhost:5556 est refuse (403)', async () => {
  const {port, fermer} = await demarrer();
  try {
    const r = await requete(port, {method: 'GET', path: '/api/etat',
      headers: {Host: 'site-malveillant.example'}});
    assert.strictEqual(r.status, 403);
    assert.match(JSON.parse(r.corps).erreur, /hote/);
  } finally {
    await fermer();
  }
});

test('C3 : une requete d ecriture en Content-Type text/plain est refusee (403), reproduction de l attaque du relecteur', async () => {
  const {port, fermer} = await demarrer();
  try {
    // Reproduit exactement le scenario du relecteur : une requete simple (donc
    // sans preflight CORS cote navigateur), Content-Type text/plain, corps JSON
    // qui aurait ete analyse comme tel avant ce correctif.
    const r = await requete(port, {method: 'POST', path: '/api/ops',
      headers: {'Content-Type': 'text/plain', Origin: 'https://site-malveillant.example'}},
      JSON.stringify({ops: [{op: 'delete_project', projet: 'estimmo'}]}));
    assert.strictEqual(r.status, 403);
    assert.match(JSON.parse(r.corps).erreur, /origine|contenu/);
  } finally {
    await fermer();
  }
});

test('C3 : une requete locale normale (bon hote, bon Content-Type) passe toujours', async () => {
  const {port, fermer} = await demarrer();
  try {
    const r = await requete(port, {method: 'POST', path: '/api/ops',
      headers: {'Content-Type': 'application/json'}}, JSON.stringify({ops: []}));
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.corps).applied, []);
  } finally {
    await fermer();
  }
});
