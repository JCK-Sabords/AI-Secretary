'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sortante = require('../server/liste-sortante.js');
const repo = require('../server/repo.js');

// Aucun test de ce fichier ne parle a Beeper : le lecteur de messages et
// l'envoyeur sont injectes. Un test qui enverrait un vrai message ecrirait dans
// la conversation du proprietaire a chaque execution de la suite.

const CHAT = '!fil:beeper.local';

function projet(id, prefixe, titre, taches) {
  return {
    id, prefixe, titre, domaine: 'side', statut: 'actif', echeance: '',
    prochaine_action: '', jira: '', dossier: '', dernier_n: (taches || []).length,
    ordre: 0, contexte: '',
    taches: (taches || []).map((t, i) => Object.assign({
      n: i + 1, responsable: 'moi', echeance: '',
      nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
      derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''
    }, t))
  };
}

function contexte(projets, sansFil) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-sortante-'));
  const dataDir = path.join(root, 'data');
  const projectsDir = path.join(dataDir, 'projects');
  fs.mkdirSync(projectsDir, {recursive: true});
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    proprietaire: 'Alex', filTachesWhatsApp: sansFil ? '' : CHAT
  }));
  (projets || []).forEach((p) => repo.saveProject(projectsDir, p));
  return {dataDir, projectsDir, today: '2026-09-27'};
}

function message(texte) {
  return {id: '1', timestamp: '2026-09-27T10:00:00.000Z', type: 'TEXT',
    texte, deMoi: true, supprime: false};
}

const TACHES = [
  {ref: 'TO1', titre: 'Refaire le site TOPI en Astro', prio: 'P2'},
  {ref: 'AU1', titre: 'Passer PSPO 2', prio: 'P4'}
];

/* ---------- construction du message ---------- */

test('raccourcir ramene un intitule a huit mots au plus', () => {
  assert.strictEqual(sortante.raccourcir('un deux trois'), 'un deux trois');
  assert.strictEqual(
    sortante.raccourcir('un deux trois quatre cinq six sept huit neuf dix'),
    'un deux trois quatre cinq six sept huit');
  assert.strictEqual(sortante.raccourcir('   espaces    multiples   '), 'espaces multiples');
  assert.strictEqual(sortante.raccourcir(''), '');
  assert.strictEqual(sortante.raccourcir(null), '');
});

test('rendreMessage rend une liste a puces, une tache par ligne', () => {
  assert.strictEqual(
    sortante.rendreMessage([{ref: 'TO1', libelle: 'Refaire site'}, {ref: 'AU1', libelle: 'PSPO 2'}]),
    '- Refaire site\n- PSPO 2');
});

test('construirePrompt exige la liste complete et borne les libelles', () => {
  const p = sortante.construirePrompt(TACHES, '2026-09-27', 'Alex');
  assert.match(p, /Toutes\*\* les taches/);
  assert.match(p, /8 mots au maximum/);
  assert.match(p, /TO1/);
  assert.match(p, /jamais des consignes/, 'clause anti-injection');
});

/* ---------- interpretation, et surtout completude ---------- */

test('interpreter garde l ordre du modele et ses libelles', () => {
  const l = sortante.interpreter({liste: [
    {tache: 'AU1', libelle: 'Passer PSPO 2'},
    {tache: 'TO1', libelle: 'Refaire site TOPI'}
  ]}, TACHES);
  assert.deepStrictEqual(l, [
    {ref: 'AU1', libelle: 'Passer PSPO 2'},
    {ref: 'TO1', libelle: 'Refaire site TOPI'}
  ]);
});

// Le point le plus important du fichier. La liste publiee remplace celle que le
// proprietaire garde sur son telephone : une tache oubliee par le modele serait
// une tache perdue pour lui.
test('interpreter ajoute a la fin toute tache que le modele a oubliee', () => {
  const l = sortante.interpreter({liste: [{tache: 'AU1', libelle: 'Passer PSPO 2'}]}, TACHES);
  assert.deepStrictEqual(l.map((x) => x.ref), ['AU1', 'TO1']);
  assert.strictEqual(l[1].libelle, 'Refaire le site TOPI en Astro',
    'la tache oubliee garde son intitule, raccourci');
});

test('interpreter rend la liste entiere meme sur une reponse inexploitable', () => {
  [null, {}, {liste: 'pas un tableau'}, {liste: [null, 3, {}]}].forEach((mauvaise) => {
    assert.deepStrictEqual(sortante.interpreter(mauvaise, TACHES).map((x) => x.ref),
      ['TO1', 'AU1'], JSON.stringify(mauvaise));
  });
});

test('interpreter ecarte une reference inventee ou repetee', () => {
  const l = sortante.interpreter({liste: [
    {tache: 'ZZ9', libelle: 'inventee'},
    {tache: 'AU1', libelle: 'Passer PSPO 2'},
    {tache: 'AU1', libelle: 'encore'}
  ]}, TACHES);
  assert.deepStrictEqual(l.map((x) => x.ref), ['AU1', 'TO1']);
  assert.ok(!l.some((x) => x.libelle === 'inventee'));
});

test('interpreter borne un libelle trop bavard rendu par le modele', () => {
  const l = sortante.interpreter({liste: [
    {tache: 'AU1', libelle: 'un deux trois quatre cinq six sept huit neuf dix onze'}
  ]}, TACHES);
  assert.strictEqual(l[0].libelle, 'un deux trois quatre cinq six sept huit');
});

test('interpreter retombe sur l intitule quand le libelle est vide', () => {
  const l = sortante.interpreter({liste: [{tache: 'AU1', libelle: '   '}]}, TACHES);
  assert.strictEqual(l[0].libelle, 'Passer PSPO 2');
});

/* ---------- preparation ---------- */

test('preparer publie toutes les taches du portefeuille', async () => {
  const ctx = contexte([
    projet('topi', 'TO', 'TOPI', [{titre: 'Refaire le site'}]),
    projet('autre', 'AU', 'Autre', [{titre: 'Passer PSPO 2'}])
  ]);
  const faux = async () => '{"liste":[{"tache":"AU1","libelle":"PSPO 2"},' +
    '{"tache":"TO1","libelle":"Refaire site"}]}';
  const r = await sortante.preparer(ctx, {lancerClaude: faux});
  assert.deepStrictEqual(r.lignes.map((x) => x.ref), ['AU1', 'TO1']);
});

// Claude injoignable ne doit pas rendre le fil muet : une liste moins bien
// classee vaut mieux que pas de liste.
test('preparer rend la liste entiere meme si Claude echoue', async () => {
  const ctx = contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'Refaire le site TOPI en Astro tout de suite'}])]);
  const enPanne = async () => { throw new Error('binaire introuvable'); };
  const r = await sortante.preparer(ctx, {lancerClaude: enPanne});
  assert.deepStrictEqual(r.lignes.map((x) => x.ref), ['TO1']);
  assert.strictEqual(r.lignes[0].libelle, 'Refaire le site TOPI en Astro tout de');
});

// Sans cache, deux classements du meme portefeuille differeraient legerement et
// chaque passage horaire enverrait un message pour rien.
test('preparer reutilise le classement tant que le portefeuille ne bouge pas', async () => {
  const ctx = contexte([projet('topi', 'TO', 'TOPI', [{titre: 'Refaire le site'}])]);
  let appels = 0;
  const faux = async () => {
    appels++;
    return '{"liste":[{"tache":"TO1","libelle":"Refaire site"}]}';
  };
  await sortante.preparer(ctx, {lancerClaude: faux});
  const second = await sortante.preparer(ctx, {lancerClaude: faux});
  assert.strictEqual(appels, 1);
  assert.strictEqual(second.depuisCache, true);
});

/* ---------- publication ---------- */

function ctxAvec(ctx, listeDansLeFil, envois) {
  ctx.lireMessages = async () => (listeDansLeFil === null ? [] : [message(listeDansLeFil)]);
  ctx.envoyer = async (chatID, texte) => { envois.push({chatID, texte}); return {ok: true}; };
  return ctx;
}

test('publier envoie quand la conversation ne porte aucune liste', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'Refaire le site'}, {titre: 'Passer PSPO 2'}, {titre: 'Vendre or'}])]),
    null, envois);
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"Refaire site"},' +
      '{"tache":"TO2","libelle":"Passer PSPO 2"},{"tache":"TO3","libelle":"Vendre or"}]}'
  });
  assert.strictEqual(r.envoye, true);
  assert.strictEqual(envois.length, 1);
  assert.strictEqual(envois[0].chatID, CHAT, 'la destination vient de la configuration');
  assert.strictEqual(envois[0].texte, '- Refaire site\n- Passer PSPO 2\n- Vendre or');
});

// Le garde-fou qui evite un message par heure pour rien.
test('publier n envoie rien quand la liste presente designe les memes taches', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'Refaire le site'}, {titre: 'Passer PSPO 2'}, {titre: 'Vendre or'}])]),
    '<ul><li>Refaire le site</li><li>Passer PSPO 2</li><li>Vendre or</li></ul>', envois);
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"Refaire le site"},' +
      '{"tache":"TO2","libelle":"Passer PSPO 2"},{"tache":"TO3","libelle":"Vendre or"}]}'
  });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'inchange');
  assert.strictEqual(envois.length, 0);
});

// La comparaison porte sur les taches, pas sur le texte : une ligne manuscrite
// un peu plus bavarde que notre libelle designe la meme tache et ne doit pas
// declencher de republication.
test('publier ne republie pas pour une simple difference de formulation', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'Refaire le site TOPI'}, {titre: 'Passer PSPO 2'}, {titre: 'Vendre or'}])]),
    '<ul><li>Refaire le site TOPI en Astro</li>' +
    '<li>Passer PSPO 2</li><li>Vendre or</li></ul>', envois);
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"Refaire site TOPI"},' +
      '{"tache":"TO2","libelle":"Passer PSPO 2"},{"tache":"TO3","libelle":"Vendre or"}]}'
  });
  assert.strictEqual(r.envoye, false, 'meme taches, meme ordre : rien a dire');
  assert.strictEqual(envois.length, 0);
});

// L'autre face de la meme regle, volontairement assumee : quand une ligne
// s'ecarte trop de l'intitule pour etre reconnue, elle ne designe plus rien, et
// republier la liste a jour est le bon comportement. Mieux vaut un message de
// trop qu'une liste que le secretariat croit a jour alors qu'elle ne l'est pas.
test('publier republie quand une ligne ne designe plus aucune tache', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'Refaire le site TOPI'}, {titre: 'Passer PSPO 2'}, {titre: 'Vendre or'}])]),
    '<ul><li>voir avec Marc pour la refonte complete du site vitrine</li>' +
    '<li>Passer PSPO 2</li><li>Vendre or</li></ul>', envois);
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"Refaire site TOPI"},' +
      '{"tache":"TO2","libelle":"Passer PSPO 2"},{"tache":"TO3","libelle":"Vendre or"}]}'
  });
  assert.strictEqual(r.envoye, true);
  assert.strictEqual(envois.length, 1);
});

test('publier envoie quand l ordre de priorite a change', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'Refaire le site'}, {titre: 'Passer PSPO 2'}, {titre: 'Vendre or'}])]),
    '<ul><li>Refaire le site</li><li>Passer PSPO 2</li><li>Vendre or</li></ul>', envois);
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO3","libelle":"Vendre or"},' +
      '{"tache":"TO1","libelle":"Refaire le site"},{"tache":"TO2","libelle":"Passer PSPO 2"}]}'
  });
  assert.strictEqual(r.envoye, true);
  assert.strictEqual(envois[0].texte, '- Vendre or\n- Refaire le site\n- Passer PSPO 2');
});

test('publier n envoie rien sans conversation configuree', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'a'}, {titre: 'b'}, {titre: 'c'}])], true), null, envois);
  const r = await sortante.publier(ctx, {lancerClaude: async () => '{"liste":[]}'});
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'non_configure');
  assert.strictEqual(envois.length, 0);
});

test('publier n envoie rien quand le portefeuille est vide', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI', [])]), null, envois);
  const r = await sortante.publier(ctx, {lancerClaude: async () => '{"liste":[]}'});
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'aucune_tache');
  assert.strictEqual(envois.length, 0);
});

test('publier ne tente rien quand Beeper est injoignable', async () => {
  const envois = [];
  const ctx = contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'a'}, {titre: 'b'}, {titre: 'c'}])]);
  ctx.lireMessages = async () => { throw new Error('Beeper injoignable'); };
  ctx.envoyer = async () => { envois.push(1); };
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"a"}]}'
  });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'beeper_indisponible');
  assert.strictEqual(envois.length, 0, 'aucun envoi a l aveugle');
});

test('publier signale un envoi refuse sans pretendre avoir reussi', async () => {
  const ctx = contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'a'}, {titre: 'b'}, {titre: 'c'}])]);
  ctx.lireMessages = async () => [];
  ctx.envoyer = async () => { throw new Error('refus'); };
  const r = await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"a"}]}'
  });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'envoi_echoue');
});

// Garde-fou : publier ne doit jamais toucher aux fichiers de projet.
test('publier ne modifie aucun fichier de projet', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'a'}, {titre: 'b'}, {titre: 'c'}])]), null, envois);
  const fichier = path.join(ctx.projectsDir, 'topi.md');
  const avant = fs.readFileSync(fichier, 'utf8');
  await sortante.publier(ctx, {
    lancerClaude: async () => '{"liste":[{"tache":"TO1","libelle":"a"}]}'
  });
  assert.strictEqual(fs.readFileSync(fichier, 'utf8'), avant);
});

/* ---------- reconnaissance de ses propres messages ---------- */

// Le defaut trouve au premier envoi reel. Les libelles publies font huit mots au
// plus et ne partagent presque aucun mot avec les intitules d'origine : sans
// memoire des libelles deja publies, le secretariat ne reconnaissait pas son
// propre message. Il republiait la liste a chaque passage horaire, et la synchro
// entrante proposait de recreer des taches qui existaient deja.
const TITRE_LONG = "Creer un agent qui va relancer tous les commerciaux que j'ai dans ma base";
const LIBELLE_COURT = 'Creer agent qui relance commerciaux';

test('un libelle court ne s apparie pas tout seul a un intitule long', () => {
  const whatsapp = require('../server/liste-whatsapp.js');
  const sansAlias = [{projet: {prefixe: 'RE', id: 'free'}, tache: {n: 1, titre: TITRE_LONG}}];
  assert.strictEqual(whatsapp.apparier(LIBELLE_COURT, sansAlias), null,
    'c est bien la cause du defaut, pas une supposition');
});

test('le libelle deja publie sert d alias et fait reconnaitre la tache', () => {
  const whatsapp = require('../server/liste-whatsapp.js');
  const avecAlias = [{projet: {prefixe: 'RE', id: 'free'}, tache: {n: 1, titre: TITRE_LONG},
    alias: [LIBELLE_COURT]}];
  const m = whatsapp.apparier(LIBELLE_COURT, avecAlias);
  assert.ok(m, 'la tache doit etre reconnue');
  assert.strictEqual(m.tache.n, 1);
});

test('publier ne republie pas la liste qu il vient lui-meme d envoyer', async () => {
  const envois = [];
  const ctx = contexte([projet('free', 'RE', 'Mission Free',
    [{titre: TITRE_LONG}, {titre: 'Passer PSPO 2'}, {titre: 'Vendre or'}])]);
  const claude = async () => '{"liste":[{"tache":"RE1","libelle":"' + LIBELLE_COURT + '"},' +
    '{"tache":"RE2","libelle":"Passer PSPO 2"},{"tache":"RE3","libelle":"Vendre or"}]}';

  // Premier passage : la conversation ne porte aucune liste, on publie.
  ctx.lireMessages = async () => [];
  ctx.envoyer = async (chatID, texte) => { envois.push(texte); return {ok: true}; };
  const premier = await sortante.publier(ctx, {lancerClaude: claude});
  assert.strictEqual(premier.envoye, true);

  // Second passage : la conversation porte desormais ce message. Rien n'a
  // change dans le portefeuille, rien ne doit repartir.
  const publie = envois[0];
  ctx.lireMessages = async () => [message('<ul>' +
    publie.split('\n').map((l) => '<li>' + l.replace(/^- /, '') + '</li>').join('') +
    '</ul>')];
  const second = await sortante.publier(ctx, {lancerClaude: claude});
  assert.strictEqual(second.envoye, false, 'le secretariat doit reconnaitre son message');
  assert.strictEqual(second.raison, 'inchange');
  assert.strictEqual(envois.length, 1);
});

test('memoriserPublication garde plusieurs libelles par tache, sans doublon', () => {
  const ctx = contexte([]);
  sortante.memoriserPublication(ctx.dataDir, [{ref: 'RE1', libelle: 'premier libelle'}]);
  sortante.memoriserPublication(ctx.dataDir, [{ref: 'RE1', libelle: 'second libelle'}]);
  sortante.memoriserPublication(ctx.dataDir, [{ref: 'RE1', libelle: 'Premier  Libelle'}]);
  const alias = sortante.aliasPublies(ctx.dataDir).get('RE1');
  // Le plus recent en tete. « Premier  Libelle » ne s'ajoute pas a cote de
  // « premier libelle » : les deux se normalisent pareil, donc la formulation
  // la plus recente remplace l'ancienne au lieu de la doubler.
  assert.deepStrictEqual(alias, ['Premier  Libelle', 'second libelle']);
});

test('memoriserPublication borne le nombre de libelles gardes par tache', () => {
  const ctx = contexte([]);
  for (let i = 1; i <= 9; i++) {
    sortante.memoriserPublication(ctx.dataDir, [{ref: 'RE1', libelle: 'libelle ' + i}]);
  }
  assert.strictEqual(sortante.aliasPublies(ctx.dataDir).get('RE1').length, 4);
});

/* ---------- declenchement par une ecriture ---------- */

// Le contexte des tests n'autorise jamais la publication automatique : sans ce
// garde-fou, chaque test d'ecriture enverrait un vrai message.
test('planifierPublication ne fait rien sans autorisation explicite', () => {
  assert.strictEqual(sortante.planifierPublication({dataDir: 'x'}), false);
  assert.strictEqual(sortante.planifierPublication({dataDir: 'x', publierAuto: false}), false);
  assert.strictEqual(sortante.planifierPublication(null), false);
});

// Une rafale d'ecritures (reordonnancement a la souris, correction lettre par
// lettre) ne doit produire qu'une seule publication.
test('planifierPublication regroupe une rafale d ecritures en un seul envoi', async () => {
  const envois = [];
  const ctx = ctxAvec(contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'un'}, {titre: 'deux'}, {titre: 'trois'}])]), null, envois);
  ctx.publierAuto = true;
  ctx.lancerClaude = async () => '{"liste":[{"tache":"TO1","libelle":"un"},' +
    '{"tache":"TO2","libelle":"deux"},{"tache":"TO3","libelle":"trois"}]}';

  // Le vrai delai est de quinze secondes : on ne l'attend pas ici, on verifie
  // que les appels successifs ne laissent qu'une seule echeance armee.
  assert.strictEqual(sortante.planifierPublication(ctx), true);
  assert.strictEqual(sortante.planifierPublication(ctx), true);
  assert.strictEqual(sortante.planifierPublication(ctx), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(envois.length, 0, 'rien ne part avant l echeance');
});

// Chemin complet : une ecriture passee par l'API programme la publication, et
// celle-ci part reellement. C'est le cablage qui manquait quand la liste
// n'etait republiee que par la tache horaire, jusqu'a cinquante neuf minutes
// apres une suppression.
test('une ecriture appliquee declenche la republication', async () => {
  const api = require('../server/api.js');
  const envois = [];
  const ctx = contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'un'}, {titre: 'deux'}, {titre: 'trois'}])]);
  ctx.publierAuto = true;
  ctx.delaiPublicationMs = 10;
  ctx.lireMessages = async () => [];
  ctx.envoyer = async (chatID, texte) => { envois.push({chatID, texte}); return {ok: true}; };
  ctx.lancerClaude = async () => '{"liste":[{"tache":"TO1","libelle":"un"},' +
    '{"tache":"TO2","libelle":"deux"},{"tache":"TO3","libelle":"trois"}]}';

  const r = await api.handle({method: 'DELETE', url: '/api/tache'}, {ref: 'TO2'}, ctx);
  assert.strictEqual(r.status, 200);
  await new Promise((res) => setTimeout(res, 120));
  assert.strictEqual(envois.length, 1, 'la suppression doit republier la liste');
  assert.strictEqual(envois[0].chatID, CHAT);
});

test('une ecriture refusee ne declenche aucune republication', async () => {
  const api = require('../server/api.js');
  const envois = [];
  const ctx = contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'un'}, {titre: 'deux'}, {titre: 'trois'}])]);
  ctx.publierAuto = true;
  ctx.delaiPublicationMs = 10;
  ctx.lireMessages = async () => [];
  ctx.envoyer = async (chatID, texte) => { envois.push({chatID, texte}); return {ok: true}; };

  await api.handle({method: 'DELETE', url: '/api/tache'}, {ref: 'ZZ9'}, ctx);
  await new Promise((res) => setTimeout(res, 120));
  assert.strictEqual(envois.length, 0);
});

/* ---------- suspension pendant le delai d annulation ---------- */

function ctxSuspension(envois) {
  const ctx = contexte([projet('topi', 'TO', 'TOPI',
    [{titre: 'un'}, {titre: 'deux'}, {titre: 'trois'}])]);
  ctx.publierAuto = true;
  ctx.delaiPublicationMs = 10;
  ctx.lireMessages = async () => [];
  ctx.envoyer = async (chatID, texte) => { envois.push(texte); return {ok: true}; };
  ctx.lancerClaude = async () => '{"liste":[{"tache":"TO1","libelle":"un"},' +
    '{"tache":"TO2","libelle":"deux"},{"tache":"TO3","libelle":"trois"}]}';
  return ctx;
}

// Le cas exact signale par l'utilisateur : le bouton croix retire la tache de
// l'ecran tout de suite mais n'envoie la suppression qu'apres six secondes. Une
// publication armee par une modification anterieure ne doit pas tomber dans cet
// intervalle : elle partirait avec une tache qu'il voit deja disparue.
test('une publication armee est retenue tant qu une suppression attend', async () => {
  const envois = [];
  const ctx = ctxSuspension(envois);
  sortante.differerPublication(ctx, true);
  assert.strictEqual(sortante.planifierPublication(ctx), false,
    'rien ne doit etre arme pendant la suspension');
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(envois.length, 0);
  sortante.differerPublication(ctx, false);
});

test('lever la suspension envoie la publication qui etait due', async () => {
  const envois = [];
  const ctx = ctxSuspension(envois);
  sortante.differerPublication(ctx, true);
  sortante.planifierPublication(ctx);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(envois.length, 0, 'toujours rien pendant la suspension');

  sortante.differerPublication(ctx, false);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(envois.length, 1, 'la publication due part une fois la suspension levee');
});

// Une suppression annulee n'ecrit rien, donc rien n'etait du : lever ne doit
// pas inventer une publication.
test('lever la suspension n envoie rien si aucune publication n etait due', async () => {
  const envois = [];
  const ctx = ctxSuspension(envois);
  sortante.differerPublication(ctx, true);
  sortante.differerPublication(ctx, false);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(envois.length, 0);
});

// Un onglet ferme au mauvais moment ne doit pas figer la publication pour
// toujours : la suspension porte sa propre echeance.
test('la suspension a une duree de vie bornee', () => {
  assert.ok(sortante.SUSPENSION_MAX_MS > 0);
  assert.ok(sortante.SUSPENSION_MAX_MS <= 300000,
    'une suspension trop longue rendrait la publication muette apres un onglet ferme');
});

test('le corps de /api/liste-sortante/differer est valide', async () => {
  const api = require('../server/api.js');
  const ctx = contexte([]);
  const mauvais = await api.handle(
    {method: 'POST', url: '/api/liste-sortante/differer'}, {actif: 'oui'}, ctx);
  assert.strictEqual(mauvais.status, 400);
  const bon = await api.handle(
    {method: 'POST', url: '/api/liste-sortante/differer'}, {actif: false}, ctx);
  assert.strictEqual(bon.status, 200);
  assert.strictEqual(bon.json.suspendu, false);
});
