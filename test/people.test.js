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
      n: 2, titre: 'Relire la note de valeur', statut: 'bloque',
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

test('relances ignore une tache faite, une date future, et moi-meme', () => {
  assert.strictEqual(people.relances(projetAvecDelegue({statut: 'fait'}), annuaire(), AUJ).length, 0);
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

test('relancesBloquees ignore une tache dont la date de relance n est pas atteinte', () => {
  const projets = projetAvecDelegue({responsable: 'inconnu', prochaine_relance: '2026-09-20'});
  assert.strictEqual(people.relancesBloquees(projets, annuaire(), AUJ).length, 0);
  assert.strictEqual(people.relances(projets, annuaire(), AUJ).length, 0);
});

test('relancesBloquees ignore une tache au statut fait', () => {
  const projets = projetAvecDelegue({responsable: 'inconnu', statut: 'fait'});
  assert.strictEqual(people.relancesBloquees(projets, annuaire(), AUJ).length, 0);
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
      {n: 1, titre: 'a', statut: 'bloque', responsable: 'bruno', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // due, contact inconnu : rejoint bloquees
      {n: 2, titre: 'b', statut: 'bloque', responsable: 'inconnu', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // due, conversation non resolue : rejoint bloquees
      {n: 3, titre: 'c', statut: 'bloque', responsable: 'sans-chat', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // pas encore due : ni l'une ni l'autre
      {n: 4, titre: 'd', statut: 'bloque', responsable: 'inconnu', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '2026-09-20', maj_le: '2026-08-01', note_blocage: ''},
      // fait : ni l'une ni l'autre
      {n: 5, titre: 'e', statut: 'fait', responsable: 'inconnu', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P2', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: AUJ, maj_le: '2026-08-01', note_blocage: ''},
      // moi : ni l'une ni l'autre
      {n: 6, titre: 'f', statut: 'bloque', responsable: 'moi', echeance: '',
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
  const tachesOuvertesDeleguesDues = projets[0].taches.filter((t) =>
    t.statut !== 'fait' && t.statut !== 'abandonne' && t.responsable !== 'moi' &&
    t.prochaine_relance && t.prochaine_relance <= AUJ).length;
  assert.strictEqual(relancesDues.length + bloquees.length, tachesOuvertesDeleguesDues);
  assert.strictEqual(relancesDues.length, 1);
  assert.strictEqual(bloquees.length, 2);
  assert.deepStrictEqual(refsBloquees, ['ES2', 'ES3']);
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
