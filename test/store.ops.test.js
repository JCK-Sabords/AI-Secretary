const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');

const AUJ = '2026-09-06';

function base() {
  return [{
    id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
    echeance: '2026-10-15', prochaine_action: 'faire', jira: '', dernier_n: 2, contexte: '',
    taches: [
      {n: 1, titre: 'a', statut: 'a_faire', responsable: 'moi', echeance: '',
       nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
       derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''}
    ]
  }];
}

test('add_task cree une tache et avance le compteur', () => {
  const r = store.applyOps(base(), [{op: 'add_task', projet: 'estimmo',
    titre: 'relancer le notaire', prio: 'P2', echeance: '2026-09-20'}], AUJ);
  const p = r.projects[0];
  assert.strictEqual(p.taches.length, 2);
  assert.strictEqual(p.taches[1].n, 3, 'le compteur repart de dernier_n');
  assert.strictEqual(p.taches[1].prio, 'P2');
  assert.strictEqual(p.taches[1].maj_le, AUJ);
  assert.strictEqual(p.dernier_n, 3);
  assert.strictEqual(r.applied.length, 1);
});

test('update_task ne touche que les champs fournis', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ES1',
    champs: {statut: 'bloque'}}], AUJ);
  const t = r.projects[0].taches[0];
  assert.strictEqual(t.statut, 'bloque');
  assert.strictEqual(t.titre, 'a');
  assert.strictEqual(t.maj_le, AUJ);
});

test('delete_task retire la tache sans liberer le numero', () => {
  const r = store.applyOps(base(), [{op: 'delete_task', ref: 'ES1'}], AUJ);
  assert.strictEqual(r.projects[0].taches.length, 0);
  assert.strictEqual(store.nextTaskNumber(r.projects[0]), 3);
});

test('add_project attribue un prefixe libre', () => {
  const r = store.applyOps(base(), [{op: 'add_project', id: 'estimation',
    titre: 'Estimation', domaine: 'perso'}], AUJ);
  const nouveau = r.projects.find((p) => p.id === 'estimation');
  assert.strictEqual(nouveau.prefixe, 'ET');
  assert.strictEqual(nouveau.taches.length, 0);
});

test('une operation inconnue est refusee sans casser les autres', () => {
  const r = store.applyOps(base(), [
    {op: 'lance_les_missiles'},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

test('une reference inexistante est refusee', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ZZ9',
    champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

test('une valeur hors domaine est refusee', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ES1',
    champs: {statut: 'peut_etre'}}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects[0].taches[0].statut, 'a_faire');
});

test('applyOps ne mute pas le tableau recu', () => {
  const avant = base();
  store.applyOps(avant, [{op: 'delete_task', ref: 'ES1'}], AUJ);
  assert.strictEqual(avant[0].taches.length, 1);
});

test('aucune operation ne peut envoyer un message', () => {
  const r = store.applyOps(base(), [{op: 'send_message', to: 'christian',
    text: 'coucou'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

test('update_task ne touche pas note_blocage quand le statut n est pas modifie', () => {
  // Regression (ajustee suite a la revue du 2026-09-07) : le test verifiait a l'origine
  // qu'un update_task passant statut de 'bloque' a 'en_cours' laissait note_blocage
  // intact. C'est exactement le cas que la decision produit retenue en revue demande
  // desormais d'effacer (statut explicitement modifie, nouvelle valeur != 'bloque') :
  // garder l'ancienne assertion contredirait donc la regle. L'intention d'origine du
  // test (une operation ne touche pas aux champs qu'elle ne fournit pas) reste testee
  // ici en modifiant un champ autre que statut.
  const projets = base();
  projets[0].taches[0].statut = 'bloque';
  projets[0].taches[0].note_blocage = 'attente devis notaire';
  const r = store.applyOps(projets, [{op: 'update_task', ref: 'ES1',
    champs: {prio: 'P1'}}], AUJ);
  const t = r.projects[0].taches[0];
  assert.strictEqual(t.statut, 'bloque');
  assert.strictEqual(t.note_blocage, 'attente devis notaire');
});

test('note_blocage est efface quand le statut passe explicitement de bloque a autre chose', () => {
  const projets = base();
  projets[0].taches[0].statut = 'bloque';
  projets[0].taches[0].note_blocage = 'attente devis notaire';
  const r = store.applyOps(projets, [{op: 'update_task', ref: 'ES1',
    champs: {statut: 'en_cours'}}], AUJ);
  const t = r.projects[0].taches[0];
  assert.strictEqual(t.statut, 'en_cours');
  assert.strictEqual(t.note_blocage, '');
});

test('note_blocage est conserve quand l operation ne modifie pas le statut', () => {
  const projets = base();
  projets[0].taches[0].statut = 'bloque';
  projets[0].taches[0].note_blocage = 'attente devis notaire';
  const r = store.applyOps(projets, [{op: 'update_task', ref: 'ES1',
    champs: {responsable: 'christian'}}], AUJ);
  const t = r.projects[0].taches[0];
  assert.strictEqual(t.statut, 'bloque');
  assert.strictEqual(t.note_blocage, 'attente devis notaire');
});

test('une date mal formee est refusee sur add_task, sans effet de bord', () => {
  const r = store.applyOps(base(), [
    {op: 'add_task', projet: 'estimmo', titre: 'x', prochaine_relance: 'la semaine prochaine'},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1, 'seule la seconde operation est appliquee');
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /prochaine_relance/);
  assert.match(r.rejected[0], /la semaine prochaine/);
  assert.strictEqual(r.projects[0].taches.length, 1, 'aucune tache ajoutee');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1', 'les autres operations continuent');
});

test('une date mal formee est refusee sur update_task, sans effet de bord', () => {
  const r = store.applyOps(base(), [
    {op: 'update_task', ref: 'ES1', champs: {derniere_relance: '06/09/2026'}},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /derniere_relance/);
  assert.strictEqual(r.projects[0].taches[0].derniere_relance, '', 'la date invalide n a pas ete ecrite');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

test('une date mal formee est refusee sur update_project, sans effet de bord', () => {
  const r = store.applyOps(base(), [
    {op: 'update_project', projet: 'estimmo', champs: {echeance: '15 octobre'}},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /echeance/);
  assert.strictEqual(r.projects[0].echeance, '2026-10-15', 'l echeance du projet n a pas change');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

test('la chaine vide reste acceptee comme absence de date', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ES1',
    champs: {echeance: '', derniere_relance: '', prochaine_relance: ''}}], AUJ);
  assert.strictEqual(r.rejected.length, 0);
  const t = r.projects[0].taches[0];
  assert.strictEqual(t.echeance, '');
  assert.strictEqual(t.derniere_relance, '');
  assert.strictEqual(t.prochaine_relance, '');
});

test('un identifiant de projet qui n est pas une chaine est refuse', () => {
  const r = store.applyOps(base(), [{op: 'add_project', id: {oups: true}, titre: 'Piege'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects.length, 1, 'aucun projet ajoute');
});

test('une valeur de type objet sur un champ de texte est refusee', () => {
  const r = store.applyOps(base(), [{op: 'update_task', ref: 'ES1',
    champs: {note_blocage: {texte: 'piege'}}}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects[0].taches[0].note_blocage, '');
});

test('add_project refuse un identifiant de remontee de repertoire, sans bloquer les autres operations', () => {
  const r = store.applyOps(base(), [
    {op: 'add_project', id: '../../evil', titre: 'Piege'},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1, 'la seconde operation s applique quand meme');
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /\.\.\/\.\.\/evil/);
  assert.strictEqual(r.projects.length, 1, 'aucun projet ajoute');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

test('add_project refuse un identifiant contenant une barre oblique', () => {
  const r = store.applyOps(base(), [{op: 'add_project', id: 'sous/dossier', titre: 'Piege'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects.length, 1);
});

test('add_project refuse un identifiant avec une majuscule', () => {
  const r = store.applyOps(base(), [{op: 'add_project', id: 'Majuscule', titre: 'Piege'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects.length, 1);
});

test('add_project refuse un identifiant de plus de 64 caracteres', () => {
  const r = store.applyOps(base(), [
    {op: 'add_project', id: 'a'.repeat(65), titre: 'Piege'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.projects.length, 1);
});

// Regression (revue du 2026-09-07) : add_project n'appelait pas champsInvalides,
// contrairement aux autres operations. Une date, un domaine ou un statut de projet
// hors liste fermee etait alors accepte dans applied, pour n'echouer que plus tard,
// en 500 brut, a la relecture par repo.saveAll.

test('add_project avec une echeance mal formee est refuse, sans bloquer les autres operations', () => {
  const r = store.applyOps(base(), [
    {op: 'add_project', id: 'estimation', titre: 'Estimation', echeance: 'pas-une-date'},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1, 'seule la seconde operation est appliquee');
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /echeance/);
  assert.strictEqual(r.projects.length, 1, 'aucun projet ajoute');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1', 'les autres operations continuent');
});

test('add_project avec un domaine inconnu est refuse, sans bloquer les autres operations', () => {
  const r = store.applyOps(base(), [
    {op: 'add_project', id: 'estimation', titre: 'Estimation', domaine: 'n_importe_quoi'},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /domaine/);
  assert.strictEqual(r.projects.length, 1, 'aucun projet ajoute');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

test('update_project avec un statut de projet inconnu est refuse, sans bloquer les autres operations', () => {
  const r = store.applyOps(base(), [
    {op: 'update_project', projet: 'estimmo', champs: {statut: 'peut_etre'}},
    {op: 'update_task', ref: 'ES1', champs: {prio: 'P1'}}], AUJ);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /statut/);
  assert.strictEqual(r.projects[0].statut, 'actif', 'le statut du projet n a pas change');
  assert.strictEqual(r.projects[0].taches[0].prio, 'P1');
});

// Regression (revue finale, correction mineure) : update_project avec un objet
// de champs vide renvoyait applied, declenchant une sauvegarde et un commit qui
// echouait faute de contenu, et la page annoncait un changement qui n avait pas
// eu lieu. update_task rejetait deja ce cas ; update_project est aligne dessus.

test('update_project avec un objet de champs vide est refuse, comme update_task', () => {
  const r = store.applyOps(base(), [{op: 'update_project', projet: 'estimmo', champs: {}}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /aucun champ/);
});

test('update_project sans champs du tout (o.champs absent) est refuse de la meme facon', () => {
  const r = store.applyOps(base(), [{op: 'update_project', projet: 'estimmo'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /aucun champ/);
});

// Regression (revue du 2026-09-10) : delete_project n'avait aucun test dedie dans ce
// fichier alors qu'elle est l'operation la plus destructrice (un projet supprime
// emporte toutes ses taches). Elle n'etait exercee qu'indirectement ailleurs, et dans
// test/server.test.js l'appel servait en realite a verifier un refus d'origine, sans
// jamais atteindre la logique de suppression.

function deuxProjets() {
  return [
    {
      id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
      echeance: '2026-10-15', prochaine_action: 'faire', jira: '', dernier_n: 2, contexte: '',
      taches: [
        {n: 1, titre: 'a', statut: 'a_faire', responsable: 'moi', echeance: '',
         nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
         derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''},
        {n: 2, titre: 'b', statut: 'en_cours', responsable: 'moi', echeance: '',
         nature_echeance: 'souhaitee', prio: 'P2', effort: 'S', bloque_par: '',
         derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-01', note_blocage: ''}
      ]
    },
    {
      id: 'topi', prefixe: 'TO', titre: 'Topi', domaine: 'side', statut: 'actif',
      echeance: '', prochaine_action: '', jira: '', dernier_n: 5, contexte: '',
      taches: [
        {n: 5, titre: 'c', statut: 'a_faire', responsable: 'moi', echeance: '',
         nature_echeance: 'souhaitee', prio: 'P1', effort: 'L', bloque_par: '',
         derniere_relance: '', prochaine_relance: '', maj_le: '2026-09-03', note_blocage: ''}
      ]
    }
  ];
}

test('delete_project retire le projet vise et toutes ses taches', () => {
  const r = store.applyOps(deuxProjets(), [{op: 'delete_project', projet: 'estimmo'}], AUJ);
  assert.strictEqual(r.projects.find((p) => p.id === 'estimmo'), undefined);
  assert.strictEqual(r.projects.length, 1);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.rejected.length, 0);
});

test('delete_project laisse les autres projets intacts, dernier_n et taches compris', () => {
  const r = store.applyOps(deuxProjets(), [{op: 'delete_project', projet: 'estimmo'}], AUJ);
  const topi = r.projects.find((p) => p.id === 'topi');
  assert.strictEqual(topi.dernier_n, 5);
  assert.strictEqual(topi.taches.length, 1);
  assert.strictEqual(topi.taches[0].n, 5);
  assert.strictEqual(topi.taches[0].titre, 'c');
});

test('delete_project sur un projet inexistant est refuse proprement, sans effet de bord', () => {
  const r = store.applyOps(deuxProjets(), [{op: 'delete_project', projet: 'fantome'}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0], /fantome/);
  assert.strictEqual(r.projects.length, 2, 'aucun projet retire');
});

test('delete_project et une autre operation dans la meme liste s appliquent toutes les deux', () => {
  const r = store.applyOps(deuxProjets(), [
    {op: 'delete_project', projet: 'estimmo'},
    {op: 'update_task', ref: 'TO5', champs: {prio: 'P4'}}], AUJ);
  assert.strictEqual(r.applied.length, 2);
  assert.strictEqual(r.rejected.length, 0);
  assert.strictEqual(r.projects.find((p) => p.id === 'estimmo'), undefined);
  const topi = r.projects.find((p) => p.id === 'topi');
  assert.strictEqual(topi.taches[0].prio, 'P4');
});

test('delete_project ne mute pas le tableau de projets recu en argument', () => {
  const avant = deuxProjets();
  store.applyOps(avant, [{op: 'delete_project', projet: 'estimmo'}], AUJ);
  assert.strictEqual(avant.length, 2, 'le tableau d origine garde ses deux projets');
  assert.strictEqual(avant.find((p) => p.id === 'estimmo').taches.length, 2,
    'le projet d origine et ses taches sont intacts');
});

test('le statut d une tache et celui d un projet ont des domaines distincts', () => {
  // Une valeur de statut de tache valide (par exemple a_faire) n est pas une valeur
  // de statut de projet valide, et reciproquement : les deux domaines ne doivent
  // jamais se confondre via la cle statut commune aux deux jeux de champs.
  const refuseTache = store.applyOps(base(), [
    {op: 'add_project', id: 'estimation', titre: 'Estimation', statut: 'a_faire'}], AUJ);
  assert.strictEqual(refuseTache.applied.length, 0, 'un statut de tache n est pas un statut de projet valide');

  const accepteProjet = store.applyOps(base(), [
    {op: 'add_project', id: 'estimation', titre: 'Estimation', statut: 'en_pause'}], AUJ);
  assert.strictEqual(accepteProjet.applied.length, 1);

  const refuseProjet = store.applyOps(base(), [
    {op: 'update_task', ref: 'ES1', champs: {statut: 'en_pause'}}], AUJ);
  assert.strictEqual(refuseProjet.applied.length, 0, 'un statut de projet n est pas un statut de tache valide');
});

function baseMulti() {
  return [
    {id: 'estimmo', prefixe: 'ES', titre: 'Estimmo', domaine: 'side', statut: 'actif',
     echeance: '', prochaine_action: '', jira: '', dernier_n: 3, ordre: 0, contexte: '',
     taches: [
       {n: 1, titre: 'a', statut: 'a_faire', responsable: 'moi', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''},
       {n: 2, titre: 'b', statut: 'a_faire', responsable: 'moi', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''},
       {n: 3, titre: 'c', statut: 'a_faire', responsable: 'moi', echeance: '',
        nature_echeance: 'souhaitee', prio: 'P3', effort: 'M', bloque_par: '',
        derniere_relance: '', prochaine_relance: '', maj_le: '', note_blocage: ''}
     ]},
    {id: 'cabinet', prefixe: 'CA', titre: 'Cabinet', domaine: 'side', statut: 'actif',
     echeance: '', prochaine_action: '', jira: '', dernier_n: 0, ordre: 1, contexte: '', taches: []},
    {id: 'topi', prefixe: 'TO', titre: 'Topi', domaine: 'side', statut: 'actif',
     echeance: '', prochaine_action: '', jira: '', dernier_n: 0, ordre: 2, contexte: '', taches: []}
  ];
}

test('reorder_projects reordonne et pose ordre selon la position', () => {
  const r = store.applyOps(baseMulti(), [
    {op: 'reorder_projects', ids: ['topi', 'estimmo', 'cabinet']}], AUJ);
  assert.strictEqual(r.rejected.length, 0);
  const parId = Object.fromEntries(r.projects.map((p) => [p.id, p.ordre]));
  assert.strictEqual(parId.topi, 0);
  assert.strictEqual(parId.estimmo, 1);
  assert.strictEqual(parId.cabinet, 2);
});

test('reorder_projects est refuse si un identifiant est inconnu', () => {
  const r = store.applyOps(baseMulti(), [
    {op: 'reorder_projects', ids: ['estimmo', 'cabinet', 'fantome']}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

test('reorder_projects est refuse en cas de doublon', () => {
  const r = store.applyOps(baseMulti(), [
    {op: 'reorder_projects', ids: ['estimmo', 'estimmo', 'cabinet']}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

test('reorder_projects est refuse si un projet manque a l appel', () => {
  const r = store.applyOps(baseMulti(), [
    {op: 'reorder_projects', ids: ['estimmo', 'cabinet']}], AUJ);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

test('reorder_tasks reordonne le tableau taches sans toucher aux numeros', () => {
  const r = store.applyOps(baseMulti(), [
    {op: 'reorder_tasks', projet: 'estimmo', ordre: [3, 1, 2]}], AUJ);
  assert.strictEqual(r.rejected.length, 0);
  const p = r.projects.find((x) => x.id === 'estimmo');
  assert.deepStrictEqual(p.taches.map((t) => t.n), [3, 1, 2]);
  assert.strictEqual(p.dernier_n, 3, 'dernier_n reste intact');
  assert.strictEqual(p.taches[0].titre, 'c');
});

test('reorder_tasks est refuse sur identifiant inconnu, doublon ou element manquant', () => {
  const r1 = store.applyOps(baseMulti(), [
    {op: 'reorder_tasks', projet: 'estimmo', ordre: [1, 2, 99]}], AUJ);
  assert.strictEqual(r1.applied.length, 0);
  assert.strictEqual(r1.rejected.length, 1);

  const r2 = store.applyOps(baseMulti(), [
    {op: 'reorder_tasks', projet: 'estimmo', ordre: [1, 1, 2]}], AUJ);
  assert.strictEqual(r2.applied.length, 0);
  assert.strictEqual(r2.rejected.length, 1);

  const r3 = store.applyOps(baseMulti(), [
    {op: 'reorder_tasks', projet: 'estimmo', ordre: [1, 2]}], AUJ);
  assert.strictEqual(r3.applied.length, 0);
  assert.strictEqual(r3.rejected.length, 1);
});

test('reorder_tasks et reorder_projects laissent le tableau recu intact', () => {
  const original = baseMulti();
  const copie = JSON.parse(JSON.stringify(original));
  store.applyOps(original, [
    {op: 'reorder_projects', ids: ['topi', 'cabinet', 'estimmo']},
    {op: 'reorder_tasks', projet: 'estimmo', ordre: [3, 2, 1]}], AUJ);
  assert.deepStrictEqual(original, copie);
});
