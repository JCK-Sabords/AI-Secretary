'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sante = require('../server/sante');

// Ces deux fonctions sont les seules sondes du dashboard sur les deux
// dependances externes du systeme (Beeper Desktop, binaire claude). Chacune
// est testee ici uniquement via des dependances injectees (deps.comptes,
// deps.executerAuthStatus, deps.resoudreBinaireClaude) : aucun de ces tests
// ne touche jamais ni au vrai Beeper ni au vrai binaire claude.

/* ============================ etatBeeper ============================ */

test('etatBeeper renvoie ok et mentionne le nombre de comptes connectes quand tout va bien', async () => {
  const r = await sante.etatBeeper({comptes: async () => ([
    {accountID: 'whatsapp', network: 'WhatsApp', status: 'connected'},
    {accountID: 'telegram', network: 'Telegram', status: 'connected'}
  ])});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etat, 'ok');
  assert.match(r.detail, /2/, 'le detail doit mentionner le nombre de comptes connectes');
});

test('etatBeeper renvoie ok avec un detail coherent quand un seul compte est connecte', async () => {
  const r = await sante.etatBeeper({comptes: async () => ([{accountID: 'whatsapp'}])});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etat, 'ok');
  assert.match(r.detail, /1/);
});

test('etatBeeper renvoie l etat arrete quand Beeper est injoignable', async () => {
  const r = await sante.etatBeeper({comptes: async () => {
    const e = new Error('Beeper injoignable');
    e.cause = 'injoignable';
    throw e;
  }});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'arrete');
  assert.match(r.detail, /Beeper/);
});

test('etatBeeper renvoie l etat jeton quand l authentification est refusee', async () => {
  const r = await sante.etatBeeper({comptes: async () => {
    const e = new Error('jeton refuse');
    e.cause = 'authentification';
    throw e;
  }});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'jeton');
  assert.match(r.detail, /jeton/i);
});

test('etatBeeper renvoie l etat erreur sur un refus HTTP quelconque', async () => {
  const r = await sante.etatBeeper({comptes: async () => {
    const e = new Error('refus');
    e.cause = 'refus';
    throw e;
  }});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'erreur');
});

test('etatBeeper renvoie l etat erreur sur une reponse illisible', async () => {
  const r = await sante.etatBeeper({comptes: async () => {
    const e = new Error('reponse illisible');
    e.cause = 'reponse_illisible';
    throw e;
  }});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'erreur');
});

test('etatBeeper ne leve jamais, meme sur une erreur sans cause connue', async () => {
  const r = await sante.etatBeeper({comptes: async () => { throw new Error('boum'); }});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'erreur');
});

/* ============================ etatClaude ============================ */

test('etatClaude renvoie ok quand claude auth status confirme la connexion', async () => {
  const r = await sante.etatClaude({
    resoudreBinaireClaude: () => 'claude.exe',
    executerAuthStatus: async () => JSON.stringify(
      {loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro'})
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etat, 'ok');
});

test('etatClaude transmet au controle le binaire resolu par resoudreBinaireClaude', async () => {
  let binaireVu = null;
  await sante.etatClaude({
    resoudreBinaireClaude: () => 'C:\\chemin\\vers\\claude.exe',
    executerAuthStatus: async (binaire) => {
      binaireVu = binaire;
      return JSON.stringify({loggedIn: true});
    }
  });
  assert.strictEqual(binaireVu, 'C:\\chemin\\vers\\claude.exe');
});

test('etatClaude renvoie l etat deconnecte et indique la commande a lancer quand loggedIn est faux', async () => {
  const r = await sante.etatClaude({
    resoudreBinaireClaude: () => 'claude.exe',
    executerAuthStatus: async () => JSON.stringify({loggedIn: false})
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'deconnecte');
  assert.match(r.detail, /claude/i);
  assert.match(r.detail, /login/i);
});

test('etatClaude renvoie l etat binaire_absent quand le binaire claude est introuvable (ENOENT)', async () => {
  const r = await sante.etatClaude({
    resoudreBinaireClaude: () => 'claude.exe',
    executerAuthStatus: async () => {
      const e = new Error('introuvable');
      e.code = 'ENOENT';
      throw e;
    }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'binaire_absent');
  assert.match(r.detail, /installation|introuvable/i);
});

test('etatClaude renvoie l etat erreur quand la sortie de claude auth status n est pas du JSON', async () => {
  const r = await sante.etatClaude({
    resoudreBinaireClaude: () => 'claude.exe',
    executerAuthStatus: async () => 'ceci n est pas du JSON'
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'erreur');
});

test('etatClaude renvoie l etat erreur sur un echec inattendu du controle, sans jamais lever', async () => {
  const r = await sante.etatClaude({
    resoudreBinaireClaude: () => 'claude.exe',
    executerAuthStatus: async () => { throw new Error('panne inattendue'); }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.etat, 'erreur');
});
