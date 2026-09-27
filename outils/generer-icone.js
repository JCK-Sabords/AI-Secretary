'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Fabrique l'icone du raccourci, sans aucune dependance : le PNG et le
// conteneur ICO sont ecrits octet par octet, et le dessin est purement
// geometrique. Le depot n'a qu'une seule dependance (js-yaml) et ce n'est pas
// une icone qui doit en ajouter une seconde.
//
// Le motif reprend le tableau de bord : la barre verticale de gravite qui
// borde chaque ligne de projet, et les lignes d'une liste de taches. La plus
// haute est a la couleur d'accent, c'est la prochaine action. Les couleurs sont
// celles de l'identite « Nuit », reprises telles quelles de web/index.html.

const COULEURS = {
  fond: [0x1B, 0x1D, 0x24],      // --surface
  bord: [0x31, 0x34, 0x3E],      // --rule
  accent: [0xE2, 0xA0, 0x3F],    // --accent
  encre: [0xEC, 0xEA, 0xE5],     // --ink
  attenue: [0x8A, 0x8E, 0x99]    // --muted
};

// Rendu en suréchantillonnage : chaque pixel final est la moyenne de SS x SS
// points. C'est ce qui donne des bords francs mais lisses, sans moteur graphique.
const SS = 4;

function dansRectArrondi(x, y, gauche, haut, largeur, hauteur, rayon) {
  if (x < gauche || y < haut || x > gauche + largeur || y > haut + hauteur) return false;
  const dx = Math.max(gauche + rayon - x, 0, x - (gauche + largeur - rayon));
  const dy = Math.max(haut + rayon - y, 0, y - (haut + hauteur - rayon));
  return dx * dx + dy * dy <= rayon * rayon;
}

// Dessine l'icone a la taille demandee et renvoie un tampon RGBA.
function dessiner(taille) {
  const u = taille / 16;            // unite : le dessin est pense sur une grille de 16
  const pixels = Buffer.alloc(taille * taille * 4);

  // Geometrie, en unites de grille.
  const marge = 1 * u;
  const cote = taille - 2 * marge;
  const rayon = 3.2 * u;

  const barreX = marge + 2.35 * u;
  const barreLargeur = 1.15 * u;
  const barreHaut = marge + 3.15 * u;
  const barreBas = taille - marge - 3.15 * u;

  // Trois lignes de liste, la premiere a l'accent. Longueurs decroissantes :
  // c'est ce qui fait lire « une liste » plutot que « des traits ».
  const epaisseur = 1.15 * u;
  const lignes = [
    {y: 4.15 * u, longueur: 7.3 * u, couleur: COULEURS.accent},
    {y: 7.4 * u, longueur: 5.6 * u, couleur: COULEURS.encre},
    {y: 10.65 * u, longueur: 3.9 * u, couleur: COULEURS.attenue}
  ];
  const ligneX = marge + 5.4 * u;

  for (let py = 0; py < taille; py++) {
    for (let px = 0; px < taille; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          const c = couleurEn(x, y, {marge, cote, rayon, barreX, barreLargeur,
            barreHaut, barreBas, lignes, ligneX, epaisseur, u});
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * taille + px) * 4;
      if (a > 0) {
        // Moyenne ponderee par la couverture : les pixels de bord gardent la
        // teinte du motif et ne prennent que de la transparence.
        pixels[i] = Math.round(r / (a / 255));
        pixels[i + 1] = Math.round(g / (a / 255));
        pixels[i + 2] = Math.round(b / (a / 255));
        pixels[i + 3] = Math.round(a / n);
      }
    }
  }
  return pixels;
}

function couleurEn(x, y, G) {
  const taille = G.cote + 2 * G.marge;
  if (!dansRectArrondi(x, y, G.marge, G.marge, G.cote, G.cote, G.rayon)) return null;

  // Bord : un lisere d'une unite a l'interieur du contour.
  const ep = G.u * 0.55;
  const dedans = dansRectArrondi(x, y, G.marge + ep, G.marge + ep,
    G.cote - 2 * ep, G.cote - 2 * ep, Math.max(0, G.rayon - ep));
  if (!dedans) return COULEURS.bord;

  // Barre de gravite. Extremites arrondies comme les lignes : des bouts carres
  // durcissent le motif et se voient des la taille 32.
  if (dansRectArrondi(x, y, G.barreX, G.barreHaut, G.barreLargeur,
      G.barreBas - G.barreHaut, G.barreLargeur / 2)) {
    return COULEURS.accent;
  }

  // Lignes de la liste.
  for (const l of G.lignes) {
    if (dansRectArrondi(x, y, G.ligneX, l.y, l.longueur, G.epaisseur, G.epaisseur / 2)) {
      return l.couleur;
    }
  }
  return COULEURS.fond;
}

/* ---------- encodage PNG, sans dependance ---------- */

const TABLE_CRC = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function morceau(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length, 0);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps), 0);
  return Buffer.concat([longueur, corps, somme]);
}

function versPng(pixels, taille) {
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(taille, 0);
  entete.writeUInt32BE(taille, 4);
  entete[8] = 8;    // 8 bits par canal
  entete[9] = 6;    // RGBA
  entete[10] = 0;   // compression standard
  entete[11] = 0;   // filtrage standard
  entete[12] = 0;   // non entrelace

  // Une ligne de filtre 0 devant chaque rangee : le motif est geometrique et a
  // larges aplats, la compression est deja excellente sans filtrage predictif.
  const brut = Buffer.alloc((taille * 4 + 1) * taille);
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0;
    pixels.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    morceau('IHDR', entete),
    morceau('IDAT', zlib.deflateSync(brut, {level: 9})),
    morceau('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- conteneur ICO ---------- */

// Un ICO peut contenir des PNG tels quels depuis Windows Vista, ce qui evite
// d'avoir a produire des bitmaps DIB avec leur masque de transparence.
function versIco(images) {
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0);              // reserve
  entete.writeUInt16LE(1, 2);              // type 1 : icone
  entete.writeUInt16LE(images.length, 4);

  const entrees = Buffer.alloc(16 * images.length);
  let decalage = entete.length + entrees.length;
  images.forEach((img, i) => {
    const o = i * 16;
    entrees[o] = img.taille >= 256 ? 0 : img.taille;      // 0 signifie 256
    entrees[o + 1] = img.taille >= 256 ? 0 : img.taille;
    entrees[o + 2] = 0;                                   // palette : aucune
    entrees[o + 3] = 0;                                   // reserve
    entrees.writeUInt16LE(1, o + 4);                      // plans
    entrees.writeUInt16LE(32, o + 6);                     // bits par pixel
    entrees.writeUInt32LE(img.png.length, o + 8);
    entrees.writeUInt32LE(decalage, o + 12);
    decalage += img.png.length;
  });

  return Buffer.concat([entete, entrees].concat(images.map((i) => i.png)));
}

const TAILLES = [16, 24, 32, 48, 64, 128, 256];

function principal() {
  const sortie = path.join(__dirname, '..', 'web', 'secretariat.ico');
  const images = TAILLES.map((taille) => ({taille, png: versPng(dessiner(taille), taille)}));
  fs.writeFileSync(sortie, versIco(images));

  // Apercu a l'oeil, uniquement sur demande : c'est un fichier de controle, il
  // n'a pas a etre versionne a cote de l'icone qu'il sert a verifier.
  if (process.argv.includes('--apercu')) {
    const apercu = path.join(__dirname, '..', 'web', 'secretariat-apercu.png');
    fs.writeFileSync(apercu, versPng(dessiner(256), 256));
    console.log('apercu ecrit : ' + apercu);
  }

  console.log('icone ecrite : ' + sortie);
  console.log('tailles : ' + TAILLES.join(', '));
}

if (require.main === module) principal();

module.exports = {dessiner, versPng, versIco, crc32, TAILLES, COULEURS};
