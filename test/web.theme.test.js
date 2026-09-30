'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Trois habillages partagent une seule feuille de style : `nuit` (l'origine),
// `nuit-serif` et `jour`. Tout ce qui les distingue tient en jetons. Ces tests
// gardent cette propriete, parce qu'elle ne se voit pas : une couleur ecrite en
// dur passe inapercue en nuit et donne, en jour, du texte sombre sur fond
// sombre a un endroit ou personne ne regarde.

function source() {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
}

function feuilleDeStyle() {
  const m = /<style>([\s\S]*?)<\/style>/.exec(source());
  assert.ok(m, 'la feuille de style doit exister');
  return m[1];
}

// Contenu d'un bloc de declarations, par son selecteur.
function bloc(selecteur) {
  const css = feuilleDeStyle();
  const i = css.indexOf(selecteur);
  assert.notStrictEqual(i, -1, 'le bloc ' + selecteur + ' doit exister');
  const debut = css.indexOf('{', i);
  const fin = css.indexOf('}', debut);
  assert.ok(debut !== -1 && fin !== -1);
  return css.slice(debut + 1, fin);
}

function jetons(texte) {
  const noms = [];
  const motif = /(--[a-z0-9-]+)\s*:/g;
  let m;
  while ((m = motif.exec(texte)) !== null) noms.push(m[1]);
  return noms;
}

const BASE = ':root, [data-theme="nuit"]';

test('les trois habillages sont declares', () => {
  const css = feuilleDeStyle();
  assert.ok(css.includes(BASE), 'nuit est la base');
  assert.ok(css.includes('[data-theme="nuit-serif"]'));
  assert.ok(css.includes('[data-theme="jour"]'));
});

// Sans color-scheme, le navigateur dessine les ascenseurs et les champs natifs
// dans le mauvais sens : des controles sombres sur une page claire.
test('chaque habillage annonce son sens au navigateur', () => {
  assert.match(bloc(BASE), /color-scheme\s*:\s*dark/);
  assert.match(bloc('[data-theme="jour"]'), /color-scheme\s*:\s*light/);
});

// Le point qui compte : un jeton de couleur que `jour` oublierait garderait sa
// valeur de nuit et disparaitrait sur le fond ivoire.
test('l habillage jour redefinit toutes les couleurs de la base', () => {
  const estCouleur = (n) => !/^--(display|body|titre|mono|sc-label)/.test(n);
  const couleursBase = jetons(bloc(BASE)).filter(estCouleur);
  const couleursJour = jetons(bloc('[data-theme="jour"]'));
  const oubliees = couleursBase.filter((n) => couleursJour.indexOf(n) === -1);
  assert.deepStrictEqual(oubliees, [],
    'jetons de couleur non redefinis en jour : ' + oubliees.join(', '));
  assert.ok(couleursBase.length >= 18, 'la base doit porter tous les jetons');
});

test('l habillage nuit serif ne touche qu a la typographie', () => {
  const noms = jetons(bloc('[data-theme="nuit-serif"]'));
  assert.ok(noms.length > 0);
  noms.forEach((n) => {
    assert.match(n, /^--(display|titre)/,
      n + ' ne devrait pas changer dans un habillage qui ne change que la voix');
  });
});

// Toute couleur doit vivre dans un bloc d'habillage. Ailleurs, elle echappe au
// changement de theme.
test('aucune couleur n est ecrite en dur hors des habillages', () => {
  let css = feuilleDeStyle();
  [BASE, '[data-theme="nuit-serif"]', '[data-theme="jour"]'].forEach((sel) => {
    const i = css.indexOf(sel);
    const fin = css.indexOf('}', css.indexOf('{', i));
    css = css.slice(0, i) + css.slice(fin + 1);
  });
  const restantes = css.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/g) || [];
  assert.deepStrictEqual(restantes, [],
    'couleurs hors habillage : ' + restantes.join(', '));
});

/* ---------- pose de l'habillage ---------- */

// Applique depuis le script principal, l'habillage arriverait apres la premiere
// peinture : la page clignoterait en nuit avant de passer en jour.
test('l habillage est pose dans le head, avant le premier rendu', () => {
  const s = source();
  const iInit = s.indexOf('<script data-theme-init>');
  const iStyle = s.indexOf('<style>');
  assert.notStrictEqual(iInit, -1, 'le script de pose doit exister');
  assert.ok(iInit < iStyle, 'il doit preceder la feuille de style');
  assert.ok(s.indexOf('<body') === -1 || iInit < s.indexOf('<body'));
});

// Les deux scripts doivent nommer la meme cle et la meme liste, sinon le choix
// retenu au rechargement ne serait pas celui qui a ete enregistre.
test('le script de pose et le script principal s accordent', () => {
  const s = source();
  assert.strictEqual((s.match(/secretariat-theme/g) || []).length, 2);
  assert.strictEqual((s.match(/\['nuit', 'nuit-serif', 'jour'\]/g) || []).length, 2);
});

function chargerThemeValide() {
  const m = /function themeValide\(nom\)\{[\s\S]*?\n\}/.exec(source());
  assert.ok(m, 'themeValide doit exister');
  return new Function("var THEMES = ['nuit', 'nuit-serif', 'jour'];\n" + m[0] +
    '\nreturn themeValide;')();
}

test('un habillage inconnu retombe sur la nuit', () => {
  const themeValide = chargerThemeValide();
  assert.strictEqual(themeValide('nuit'), 'nuit');
  assert.strictEqual(themeValide('nuit-serif'), 'nuit-serif');
  assert.strictEqual(themeValide('jour'), 'jour');
  // Stockage bricole a la main, version anterieure, faute de frappe : aucun ne
  // doit laisser la page sans jetons.
  ['clair', '', null, undefined, 'NUIT', 'jour ', 42].forEach((mauvais) => {
    assert.strictEqual(themeValide(mauvais), 'nuit', JSON.stringify(mauvais));
  });
});

// Un stockage indisponible (navigation privee, site bloque) ne doit pas
// empecher la page de s'afficher.
test('la lecture et l ecriture du choix sont protegees', () => {
  const s = source();
  const init = /<script data-theme-init>[\s\S]*?<\/script>/.exec(s);
  assert.ok(init);
  assert.match(init[0], /try\s*\{[\s\S]*localStorage[\s\S]*catch/);
  const appliquer = /function appliquerTheme\(nom\)\{[\s\S]*?\n\}/.exec(s);
  assert.ok(appliquer);
  assert.match(appliquer[0], /try\s*\{[\s\S]*setItem[\s\S]*catch/);
});

test('le selecteur propose les trois habillages et porte un nom', () => {
  const s = source();
  const sel = /<select id="theme"[\s\S]*?<\/select>/.exec(s);
  assert.ok(sel, 'le selecteur doit exister');
  ['nuit', 'nuit-serif', 'jour'].forEach((t) => {
    assert.ok(sel[0].includes('value="' + t + '"'), t + ' doit etre proposable');
  });
  assert.match(s, /<label class="sr-only" for="theme">/,
    'un selecteur sans texte visible doit garder une etiquette lisible');
});
