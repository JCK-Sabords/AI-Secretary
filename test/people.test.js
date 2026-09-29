const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const people = require('../server/people');

const AUJ = '2026-09-06';

function tmpdata() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'secretaire-p-'));
  fs.mkdirSync(path.join(d, 'projects'), {recursive: true});
  return d;
}
function annuaire() {
  return [{id: 'bruno', nom: 'Bruno Martin', accountID: 'whatsapp',
    reseau: 'WhatsApp', participantID: '33600000000', chatId: 'chat-1',
    resolu_le: '2026-09-01'}];
}
function projetAvecDelegue(over) {
  return [{
    id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
    echeance: '', prochaine_action: 'faire', jira: '', dernier_n: 1, contexte: '',
    taches: [Object.assign({
      n: 2, titre: 'Relire la note de valeur',
      responsable: 'bruno', echeance: '2026-09-09', nature_echeance: 'dure',
      prio: 'P1', effort: 'S', bloque_par: '', derniere_relance: '',
      prochaine_relance: AUJ, maj_le: '2026-08-24', note_blocage: ''
    }, over)]
  }];
}

test('loadPeople renvoie un tableau vide si le fichier manque', () => {
  assert.deepStrictEqual(people.loadPeople(tmpdata()), []);
});

test('savePeople puis loadPeople fait un aller-retour fidele', () => {
  const d = tmpdata();
  people.savePeople(d, annuaire());
  assert.deepStrictEqual(people.loadPeople(d), annuaire());
});

test('relances retient une tache deleguee dont la date est atteinte', () => {
  const r = people.relances(projetAvecDelegue({}), annuaire(), AUJ);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].ref, 'ES2');
  assert.strictEqual(r[0].personne.nom, 'Bruno Martin');
  assert.strictEqual(r[0].attente, 13, 'jours ecoules depuis maj_le');
  assert.match(r[0].texte, /Bruno/);
  assert.match(r[0].texte, /Relire la note de valeur/);
});

test('relances ignore une date future et une tache dont je suis responsable', () => {
  assert.strictEqual(people.relances(projetAvecDelegue({prochaine_relance: '2026-09-20'}), annuaire(), AUJ).length, 0);
  assert.strictEqual(people.relances(projetAvecDelegue({responsable: 'moi'}), annuaire(), AUJ).length, 0);
});

test('relances ignore une personne absente du repertoire', () => {
  const r = people.relances(projetAvecDelegue({responsable: 'inconnu'}), annuaire(), AUJ);
  assert.strictEqual(r.length, 0);
});

test('relances ignore un contact dont la conversation n est pas resolue', () => {
  const sansChat = [Object.assign({}, annuaire()[0], {chatId: ''})];
  assert.strictEqual(people.relances(projetAvecDelegue({}), sansChat, AUJ).length, 0);
});

test('relances ignore sans lever une personne dont le nom est vide', () => {
  const sansNom = [Object.assign({}, annuaire()[0], {nom: ''})];
  assert.doesNotThrow(() => {
    assert.strictEqual(people.relances(projetAvecDelegue({}), sansNom, AUJ).length, 0);
  });
});

test('loadPeopleSafe renvoie une liste et des erreurs vides si le fichier manque', () => {
  const r = people.loadPeopleSafe(tmpdata());
  assert.deepStrictEqual(r.people, []);
  assert.deepStrictEqual(r.errors, []);
});

test('loadPeopleSafe traite un fichier vide comme un repertoire sans personne', () => {
  const d = tmpdata();
  fs.writeFileSync(path.join(d, 'people.md'), '', 'utf8');
  const r = people.loadPeopleSafe(d);
  assert.deepStrictEqual(r.people, []);
  assert.deepStrictEqual(r.errors, []);
});

test('loadPeopleSafe signale un YAML casse sans lever', () => {
  const d = tmpdata();
  fs.writeFileSync(d + '/people.md', 'id: [oups\n', 'utf8');
  const r = people.loadPeopleSafe(d);
  assert.deepStrictEqual(r.people, []);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].fichier, 'people.md');
  assert.match(r.errors[0].message, /YAML/);
});

test('loadPeopleSafe signale un contenu qui n est pas une liste', () => {
  const d = tmpdata();
  fs.writeFileSync(d + '/people.md', 'id: bruno\nnom: Bruno\n', 'utf8');
  const r = people.loadPeopleSafe(d);
  assert.deepStrictEqual(r.people, []);
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0].message, /liste/);
});

test('loadPeopleSafe ecarte une entree sans nom et garde les autres', () => {
  const d = tmpdata();
  const contenu = annuaire().concat([{id: 'sans-nom', accountID: 'whatsapp',
    reseau: 'WhatsApp', participantID: '1', chatId: 'chat-2', resolu_le: '2026-09-01'}]);
  people.savePeople(d, contenu);
  const r = people.loadPeopleSafe(d);
  assert.strictEqual(r.people.length, 1);
  assert.strictEqual(r.people[0].id, 'bruno');
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0].message, /nom/);
});

test('loadPeopleSafe ecarte une entree sans id et garde les autres', () => {
  const d = tmpdata();
  const contenu = annuaire().concat([{nom: 'Sans Id', accountID: 'whatsapp',
    reseau: 'WhatsApp', participantID: '1', chatId: 'chat-2', resolu_le: '2026-09-01'}]);
  people.savePeople(d, contenu);
  const r = people.loadPeopleSafe(d);
  assert.strictEqual(r.people.length, 1);
  assert.strictEqual(r.people[0].id, 'bruno');
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0].message, /identifiant/);
});

/* ============================ relancesBloquees ============================ */
/* relances et relancesBloquees doivent rester exactement complementaires : une
   tache qui serait une relance due (au sens du signal relanceDue de store.js)
   tombe toujours dans l'une des deux listes, jamais dans les deux, jamais dans
   aucune des deux. */

test('relancesBloquees signale contact_inconnu quand le responsable est absent du repertoire', () => {
  const b = people.relancesBloquees(projetAvecDelegue({responsable: 'inconnu'}), annuaire(), AUJ);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].ref, 'ES2');
  assert.strictEqual(b[0].raison, 'contact_inconnu');
  assert.strictEqual(b[0].responsable, 'inconnu');
  assert.strictEqual(b[0].projetId, 'estimmo');
  assert.strictEqual(b[0].projetTitre, 'Estimmo');
  assert.strictEqual(b[0].tacheTitre, 'Relire la note de valeur');
});

test('relancesBloquees signale conversation_non_resolue quand la fiche existe mais sans chatId', () => {
  const sansChat = [Object.assign({}, annuaire()[0], {chatId: ''})];
  const b = people.relancesBloquees(projetAvecDelegue({}), sansChat, AUJ);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].ref, 'ES2');
  assert.strictEqual(b[0].raison, 'conversation_non_resolue');
});

test('relancesBloquees ne produit rien pour une fiche resolue, qui produit bien une relance normale', () => {
  const projets = projetAvecDelegue({});
  const b = people.relancesBloquees(projets, annuaire(), AUJ);
  assert.strictEqual(b.length, 0);
  assert.strictEqual(people.relances(projets, annuaire(), AUJ).length, 1);
});

// Asymetrie assumee : un contact non resolu est une action a mener tout de
// suite. Le signaler seulement le jour de l'echeance ferait decouvrir le
// probleme au moment precis ou l'on comptait envoyer.
test('relancesBloquees signale un contact non resolu avant meme la date de relance', () => {
  const projets = projetAvecDelegue({responsable: 'inconnu', prochaine_relance: '2026-09-20'});
  const b = people.relancesBloquees(projets, annuaire(), AUJ);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].raison, 'contact_inconnu');
  // Elle n'est ni envoyable ni programmee : son contact n'existe pas.
  assert.strictEqual(people.relances(projets, annuaire(), AUJ).length, 0);
  assert.strictEqual(people.relancesAVenir(projets, annuaire(), AUJ).length, 0);
});

/* ---------- relances programmees ---------- */

// Le silence signale par l'utilisateur : une tache deleguee, datee, au contact
// resolu, n'apparaissait nulle part jusqu'au jour dit. Rien ne distinguait
// « programmee » de « oubliee ».
test('relancesAVenir rend les relances pretes mais pas encore dues', () => {
  const projets = projetAvecDelegue({prochaine_relance: '2026-09-20'});
  const a = people.relancesAVenir(projets, annuaire(), AUJ);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].prochaine_relance, '2026-09-20');
  assert.ok(a[0].dansJours > 0, 'le delai restant doit etre positif');
  assert.ok(a[0].texte, 'le brouillon est deja pret');
});

// Une relance est dans une liste ou dans l'autre, jamais dans les deux.
test('relancesAVenir et relances ne se recouvrent jamais', () => {
  const due = projetAvecDelegue({prochaine_relance: AUJ});
  assert.strictEqual(people.relances(due, annuaire(), AUJ).length, 1);
  assert.strictEqual(people.relancesAVenir(due, annuaire(), AUJ).length, 0);

  const aVenir = projetAvecDelegue({prochaine_relance: '2026-09-20'});
  assert.strictEqual(people.relances(aVenir, annuaire(), AUJ).length, 0);
  assert.strictEqual(people.relancesAVenir(aVenir, annuaire(), AUJ).length, 1);
});

test('relancesAVenir ignore une tache sans date de relance', () => {
  const projets = projetAvecDelegue({prochaine_relance: ''});
  assert.strictEqual(people.relancesAVenir(projets, annuaire(), AUJ).length, 0);
});

/* ---------- une tache deleguee figure toujours au panneau ---------- */

// Deleguer une tache sans programmer de relance la faisait disparaitre de la
// vue : ni dans « Ma semaine », qui ne montre que ce qu'on fait soi-meme, ni
// dans les relances, qui exigeaient une date. Absence de date vaut desormais
// « a relancer des maintenant ».
test('relances retient une tache deleguee sans date de relance', () => {
  const projets = projetAvecDelegue({prochaine_relance: ''});
  const r = people.relances(projets, annuaire(), AUJ);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].dansJours, 0, 'elle est due, pas programmee');
});

test('relancesAVenir ne retient pas une tache sans date, qui est due', () => {
  const projets = projetAvecDelegue({prochaine_relance: ''});
  assert.strictEqual(people.relancesAVenir(projets, annuaire(), AUJ).length, 0);
});

test('une tache deleguee sans date signale quand meme son contact casse', () => {
  const projets = projetAvecDelegue({responsable: 'inconnu', prochaine_relance: ''});
  const b = people.relancesBloquees(projets, annuaire(), AUJ);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].raison, 'contact_inconnu');
});

// L'invariant qui compte desormais : aucune tache confiee a quelqu'un d'autre ne
// doit tomber dans aucune des trois listes.
test('toute tache deleguee figure dans exactement une des trois listes', () => {
  const gens = annuaire().concat([
    {id: 'sans-chat', nom: 'Sans Chat', accountID: 'whatsapp', reseau: 'WhatsApp',
      participantID: '2', chatId: '', resolu_le: ''}
  ]);
  const tache = (n, extra) => Object.assign({
    n, titre: 't' + n, responsable: 'bruno', echeance: '',
    nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
    derniere_relance: '', prochaine_relance: '', maj_le: '2026-08-01', note_blocage: ''
  }, extra);
  const projets = [{
    id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
    echeance: '', prochaine_action: '', jira: '', dernier_n: 6, contexte: '',
    taches: [
      tache(1),                                              // sans date, resolue
      tache(2, {prochaine_relance: AUJ}),                    // due
      tache(3, {prochaine_relance: '2026-12-01'}),           // programmee
      tache(4, {responsable: 'inconnu'}),                    // contact inconnu
      tache(5, {responsable: 'sans-chat'}),                  // conversation non resolue
      tache(6, {responsable: 'moi'})                         // pas deleguee
    ]
  }];
  const dans = []
    .concat(people.relances(projets, gens, AUJ).map((r) => r.ref))
    .concat(people.relancesAVenir(projets, gens, AUJ).map((r) => r.ref))
    .concat(people.relancesBloquees(projets, gens, AUJ).map((r) => r.ref));

  ['ES1', 'ES2', 'ES3', 'ES4', 'ES5'].forEach((ref) => {
    assert.strictEqual(dans.filter((r) => r === ref).length, 1,
      ref + ' doit figurer dans exactement une liste');
  });
  assert.ok(!dans.includes('ES6'), 'une tache dont je suis responsable n y figure jamais');
});

/* ---------- redaction du brouillon ---------- */

// « M. BAREC agent Immo » donnait « Salut M. ».
test('nomAppel saute un titre de civilite', () => {
  assert.strictEqual(people.nomAppel('M. BAREC agent Immo'), 'BAREC');
  assert.strictEqual(people.nomAppel('Mme Dupont'), 'Dupont');
  assert.strictEqual(people.nomAppel('Dr. House'), 'House');
  assert.strictEqual(people.nomAppel('Christian Kourajian'), 'Christian');
});

test('nomAppel ne rend jamais une salutation vide', () => {
  assert.strictEqual(people.nomAppel('M.'), 'M.');
  assert.strictEqual(people.nomAppel(''), '');
  assert.strictEqual(people.nomAppel('   '), '');
  assert.strictEqual(people.nomAppel(null), '');
});

// Un brouillon part au nom du proprietaire : une date au format machine dedans
// se remarque.
test('dateFr ecrit la date en francais, jamais au format machine', () => {
  assert.strictEqual(people.dateFr('2026-10-05'), '5 oct.');
  assert.strictEqual(people.dateFr('2026-01-09'), '9 janv.');
  assert.strictEqual(people.dateFr(''), '');
  assert.strictEqual(people.dateFr('pas une date'), 'pas une date');
});

test('le brouillon ne contient ni date machine ni anciennete vide de sens', () => {
  const projets = projetAvecDelegue({prochaine_relance: AUJ, echeance: '2026-10-05'});
  const texte = people.relances(projets, annuaire(), AUJ)[0].texte;
  assert.ok(!texte.includes('2026-10-05'), 'la date doit etre en francais');
  assert.match(texte, /5 oct\./);
  assert.ok(!texte.includes('il y a 0 jours'));
  assert.ok(!texte.includes('depuis 0 jours'));
  assert.ok(!texte.includes('depuis 1 jours'));
});

test('relancesBloquees ignore une tache dont le responsable est moi', () => {
  const projets = projetAvecDelegue({responsable: 'moi'});
  assert.strictEqual(people.relancesBloquees(projets, annuaire(), AUJ).length, 0);
});

test('relances et relancesBloquees sont exactement complementaires sur un portefeuille mixte', () => {
  const gens = annuaire().concat([
    {id: 'sans-chat', nom: 'Sans Chat', accountID: 'whatsapp', reseau: 'WhatsApp',
      participantID: '2', chatId: '', resolu_le: ''}
  ]);
  const projets = [{
    id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
    echeance: '', prochaine_action: 'faire', jira: '', dernier_n: 6, contexte: '',
    taches: [
      // due, resolue : rejoint relances
      {n: 1, titre: 'a', responsable: 'bruno', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // due, contact inconnu : rejoint bloquees
      {n: 2, titre: 'b', responsable: 'inconnu', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // due, conversation non resolue : rejoint bloquees
      {n: 3, titre: 'c', responsable: 'sans-chat', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // pas encore due, mais responsable absent du repertoire : bloquee des
      // maintenant, parce que resoudre le contact est une action a mener avant
      // la date, pas le jour dit
      {n: 4, titre: 'd', responsable: 'inconnu', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '2026-09-20', maj_le: '2026-08-01', note_blocage: ''},
      // due, responsable inconnu : bloquee, comme ES2
      {n: 5, titre: 'e', responsable: 'inconnu', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // moi : ni l'une ni l'autre
      {n: 6, titre: 'f', responsable: 'moi', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''}
    ]
  }];
  const relancesDues = people.relances(projets, gens, AUJ);
  const bloquees = people.relancesBloquees(projets, gens, AUJ);
  const refsRelances = relancesDues.map((r) => r.ref).sort();
  const refsBloquees = bloquees.map((b) => b.ref).sort();
  // aucune tache dans les deux listes
  assert.deepStrictEqual(refsRelances.filter((r) => refsBloquees.includes(r)), []);
  // La complementarite se verifie sur les taches dont la relance est due : une
  // tache due tombe toujours dans l'une des deux listes, jamais dans les deux,
  // jamais dans aucune. Les bloquees peuvent en plus porter des taches pas
  // encore dues, dont le contact est a resoudre des maintenant.
  const dues = projets[0].taches.filter((t) =>
    t.responsable !== 'moi' && t.prochaine_relance && t.prochaine_relance <= AUJ)
    .map((t) => 'ES' + t.n);
  const couvertes = refsRelances.concat(refsBloquees);
  dues.forEach((ref) => {
    assert.strictEqual(couvertes.filter((r) => r === ref).length, 1,
      ref + ' doit apparaitre dans exactement une des deux listes');
  });
  assert.strictEqual(relancesDues.length, 1);
  assert.deepStrictEqual(refsBloquees, ['ES2', 'ES3', 'ES4', 'ES5']);
});

test('loadPeopleSafe garde la premiere occurrence en cas de doublon d id et le signale', () => {
  const d = tmpdata();
  const premiere = annuaire()[0];
  const doublon = Object.assign({}, premiere, {nom: 'Autre Nom', chatId: 'chat-9'});
  people.savePeople(d, [premiere, doublon]);
  const r = people.loadPeopleSafe(d);
  assert.strictEqual(r.people.length, 1);
  assert.strictEqual(r.people[0].nom, 'Bruno Martin', 'la premiere occurrence est conservee');
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0].message, /double/);
});
