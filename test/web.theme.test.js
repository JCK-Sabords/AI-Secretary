'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Deux habillages partagent une seule feuille de style : `nuit` (l'origine) et
// `jour`. Tout ce qui les distingue tient en jetons. Ces tests gardent cette
// propriete, parce qu'elle ne se voit pas : une couleur ecrite en dur passe
// inapercue en nuit et donne, en jour, du texte sombre sur fond sombre a un
// endroit ou personne ne regarde.

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

test('les deux habillages sont declares', () => {
  const css = feuilleDeStyle();
  assert.ok(css.includes(BASE), 'nuit est la base');
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

// La romaine a ete retenue pour les deux habillages. Si un habillage se
// remettait a redefinir une police, les deux ne se distingueraient plus
// seulement par leurs couleurs et ce fichier ne garderait plus rien.
test('l habillage jour ne touche qu aux couleurs', () => {
  jetons(bloc('[data-theme="jour"]')).forEach((n) => {
    assert.doesNotMatch(n, /^--(display|titre|body|mono)/,
      n + ' ne devrait pas changer dans un habillage qui ne change que la lumiere');
  });
});

// Toute couleur doit vivre dans un bloc d'habillage. Ailleurs, elle echappe au
// changement de theme.
test('aucune couleur n est ecrite en dur hors des habillages', () => {
  let css = feuilleDeStyle();
  [BASE, '[data-theme="jour"]'].forEach((sel) => {
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
  assert.strictEqual((s.match(/\['nuit', 'jour'\]/g) || []).length, 2);
});

function chargerThemeValide() {
  const m = /function themeValide\(nom\)\{[\s\S]*?\n\}/.exec(source());
  assert.ok(m, 'themeValide doit exister');
  return new Function("var THEMES = ['nuit', 'jour'];\n" + m[0] +
    '\nreturn themeValide;')();
}

test('un habillage inconnu retombe sur la nuit', () => {
  const themeValide = chargerThemeValide();
  assert.strictEqual(themeValide('nuit'), 'nuit');
  assert.strictEqual(themeValide('jour'), 'jour');
  // Stockage bricole a la main, faute de frappe, ou choix `nuit-serif` retenu
  // du temps ou les deux titrages etaient proposes : aucun ne doit laisser la
  // page sans jetons. Pour `nuit-serif`, retomber sur `nuit` ne change rien a
  // l'ecran, puisque la nuit porte desormais cette meme romaine.
  ['nuit-serif', 'clair', '', null, undefined, 'NUIT', 'jour ', 42].forEach((mauvais) => {
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

test('le selecteur propose les deux habillages et porte un nom', () => {
  const s = source();
  const sel = /<select id="theme"[\s\S]*?<\/select>/.exec(s);
  assert.ok(sel, 'le selecteur doit exister');
  ['nuit', 'jour'].forEach((t) => {
    assert.ok(sel[0].includes('value="' + t + '"'), t + ' doit etre proposable');
  });
  assert.ok(!sel[0].includes('nuit-serif'),
    'l habillage retire ne doit plus etre proposable');
  assert.match(s, /<label class="sr-only" for="theme">/,
    'un selecteur sans texte visible doit garder une etiquette lisible');
});

/* ---------- largeur et respiration ---------- */

// Le tableau de bord tient sur presque toute la largeur de la fenetre. Une
// colonne figee au milieu laissait deux bandes vides sur un ecran large, et le
// portefeuille, qui est un tableau a sept colonnes, y etait comprime.
test('le conteneur suit la largeur de la fenetre', () => {
  const declarations = bloc('.wrap{');
  assert.match(declarations, /padding\s*:\s*0 clamp\(/,
    'la marge laterale doit suivre la fenetre, pas une valeur fixe');
  const plafond = /max-width\s*:\s*(\d+)px/.exec(declarations);
  assert.ok(plafond, 'un plafond doit rester, pour les tres grands ecrans');
  assert.ok(Number(plafond[1]) >= 1600,
    'un plafond de ' + plafond[1] + 'px reproduirait la colonne etroite');
});

// La typographie retenue est une romaine, choisie apres comparaison. Le jeton
// est unique : le titrage de toute la page en depend.
test('le titrage est en romaine', () => {
  const base = bloc(BASE);
  assert.match(base, /--display\s*:\s*"Newsreader"/);
  assert.match(base, /--titre\s*:\s*"Newsreader"/);
  // La police abandonnee ne doit plus etre telechargee : la requete serait
  // payee a chaque chargement sans que rien ne s'en serve.
  assert.ok(!source().includes('Bricolage'),
    'la police abandonnee ne doit plus etre chargee');
});
