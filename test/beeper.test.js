const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const beeper = require('../server/beeper');

function bouchon(routes) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let brut = '';
      req.on('data', (c) => { brut += c; });
      req.on('end', () => {
        const chemin = req.url.split('?')[0];
        const fn = routes[req.method + ' ' + chemin];
        if (!fn) { res.writeHead(404); return res.end('{}'); }
        const out = fn(req, brut ? JSON.parse(brut) : null, req.url);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(out));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function adresse(s) { return 'http://127.0.0.1:' + s.address().port; }

// Bouchon minimal qui repond toujours la meme chose (statut + corps brut),
// quelle que soit la route appelee. Sert a simuler les reponses d erreur ou
// non-JSON de Beeper, que le bouchon "routes" ci-dessus (toujours 200, toujours
// JSON) ne peut pas produire.
function bouchonStatut(statut, corpsBrut, typeContenu) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(statut, {'Content-Type': typeContenu || 'application/json'});
        res.end(corpsBrut);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('comptes lit le tableau nu renvoye par Beeper', async () => {
  const s = await bouchon({
    'GET /v1/accounts': () => ([
      {accountID: 'whatsapp', network: 'WhatsApp', status: 'connected', bridge: {}, user: {}},
      {accountID: 'telegram', network: 'Telegram', status: 'connected', bridge: {}, user: {}}
    ])
  });
  const res = await beeper.comptes({base: adresse(s), token: 'x'});
  assert.deepStrictEqual(res, [
    {accountID: 'whatsapp', network: 'WhatsApp', status: 'connected'},
    {accountID: 'telegram', network: 'Telegram', status: 'connected'}
  ]);
  s.close();
});

test('chercherContacts normalise les trois champs reels', async () => {
  let vueUrl = null;
  const s = await bouchon({
    'GET /v1/accounts/whatsapp/contacts': (req, body, url) => {
      vueUrl = url;
      return {items: [{id: '33600000000', phoneNumber: '+33600000000',
        fullName: 'Martin B.'}]};
    }
  });
  const res = await beeper.chercherContacts('whatsapp', 'Martin',
    {base: adresse(s), token: 'x'});
  assert.deepStrictEqual(res, [{id: '33600000000', nom: 'Martin B.',
    telephone: '+33600000000', accountID: 'whatsapp'}]);
  assert.match(vueUrl, /query=Martin/);
  s.close();
});

test('ouvrirChat demande une conversation individuelle', async () => {
  let vu = null;
  const s = await bouchon({
    'POST /v1/chats': (req, body) => { vu = body; return {id: 'chat-1'}; }
  });
  const r = await beeper.ouvrirChat('whatsapp', '33600000000',
    {base: adresse(s), token: 'x'});
  assert.strictEqual(r.chatID, 'chat-1');
  assert.strictEqual(vu.accountID, 'whatsapp');
  assert.strictEqual(vu.type, 'single');
  assert.deepStrictEqual(vu.participantIDs, ['33600000000']);
  s.close();
});

test('envoyer transmet le texte et le jeton', async () => {
  let vu = null;
  const s = await bouchon({
    'POST /v1/chats/chat-1/messages': (req, body) => {
      vu = {auth: req.headers.authorization, body};
      return {chatID: 'chat-1', pendingMessageID: 'p-9'};
    }
  });
  const r = await beeper.envoyer('chat-1', 'coucou', {base: adresse(s), token: 'secret'});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pendingMessageID, 'p-9');
  assert.strictEqual(vu.auth, 'Bearer secret');
  assert.strictEqual(vu.body.text, 'coucou');
  s.close();
});

test('envoyer remonte une erreur quand Beeper ne repond pas', async () => {
  await assert.rejects(
    () => beeper.envoyer('chat-1', 'coucou', {base: 'http://127.0.0.1:1', token: 'x'}),
    /Beeper injoignable/);
});

test('un statut 401 leve une erreur de cause authentification, sans le jeton dans le message', async () => {
  const jeton = 'secret-tres-prive';
  const s = await bouchonStatut(401, '{}');
  await assert.rejects(
    () => beeper.comptes({base: adresse(s), token: jeton}),
    (e) => {
      assert.strictEqual(e.cause, 'authentification');
      assert.ok(!e.message.includes(jeton), 'le message ne doit jamais contenir le jeton');
      return true;
    });
  s.close();
});

test('un statut 500 leve une erreur de cause refus', async () => {
  const s = await bouchonStatut(500, '{}');
  await assert.rejects(
    () => beeper.comptes({base: adresse(s), token: 'x'}),
    (e) => { assert.strictEqual(e.cause, 'refus'); return true; });
  s.close();
});

test('un port injoignable leve une erreur de cause injoignable', async () => {
  await assert.rejects(
    () => beeper.comptes({base: 'http://127.0.0.1:1', token: 'x'}),
    (e) => { assert.strictEqual(e.cause, 'injoignable'); return true; });
});

test('un corps qui n est pas du JSON leve une erreur de cause reponse_illisible', async () => {
  const s = await bouchonStatut(200, 'ceci n est pas du JSON', 'text/plain');
  await assert.rejects(
    () => beeper.comptes({base: adresse(s), token: 'x'}),
    (e) => { assert.strictEqual(e.cause, 'reponse_illisible'); return true; });
  s.close();
});

test('disponible renvoie true quand le bouchon repond normalement', async () => {
  const s = await bouchon({'GET /v1/accounts': () => ([])});
  assert.strictEqual(await beeper.disponible({base: adresse(s), token: 'x'}), true);
  s.close();
});

test('disponible renvoie false quand le port est injoignable', async () => {
  assert.strictEqual(
    await beeper.disponible({base: 'http://127.0.0.1:1', token: 'x'}), false);
});

test('disponible renvoie false quand le statut est 401', async () => {
  const s = await bouchonStatut(401, '{}');
  assert.strictEqual(await beeper.disponible({base: adresse(s), token: 'x'}), false);
  s.close();
});

test('disponible renvoie false quand le corps n est pas du JSON', async () => {
  const s = await bouchonStatut(200, 'ceci n est pas du JSON', 'text/plain');
  assert.strictEqual(await beeper.disponible({base: adresse(s), token: 'x'}), false);
  s.close();
});

test('chercherContacts laisse traverser intact un nom accentue avec espace', async () => {
  const nomComplet = 'Amélie Léger écrit à René';
  const s = await bouchon({
    'GET /v1/accounts/whatsapp/contacts': () => ({items: [{id: '1',
      phoneNumber: '', fullName: nomComplet}]})
  });
  const res = await beeper.chercherContacts('whatsapp', 'Rene', {base: adresse(s), token: 'x'});
  assert.strictEqual(res[0].nom, nomComplet);
  s.close();
});

test('envoyer laisse traverser intact un texte accentue jusqu au corps recu par le bouchon', async () => {
  const texte = "Ça sent le café : l'échéance approche à Noël, prévoir un rendez-vous.";
  let corpsRecu = null;
  const s = await bouchon({
    'POST /v1/chats/chat-1/messages': (req, body) => {
      corpsRecu = body;
      return {chatID: 'chat-1', pendingMessageID: 'p-1'};
    }
  });
  await beeper.envoyer('chat-1', texte, {base: adresse(s), token: 'x'});
  assert.strictEqual(corpsRecu.text, texte);
  s.close();
});
