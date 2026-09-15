# Agent secrétaire personnel - conception

**Date :** 6 septembre 2026
**Auteur :** le proprietaire, avec Claude Code
**Statut :** conception validée, prête pour le plan d'implémentation
**Maquette de référence :** https://claude.ai/code/artifact/47473be2-231d-4632-a97a-f5ce37431c23

---

## 1. Objet

Un système personnel de pilotage de projets et de tâches, doublé d'un agent qui produit un
récap hebdomadaire et prépare les relances des personnes à qui des tâches sont déléguées.

Le système remplace le projet « Tour de contrôle » d'août 2026, abandonné. On repart de zéro.
Deux acquis sont repris : le modèle à deux niveaux avec sa liste de champs, et le principe
selon lequel le canal de notification doit être une messagerie déjà utilisée au quotidien
plutôt qu'un outil de plus.

### Périmètre

Tous les projets sans exception : side projects, vie personnelle et travail salarié.

Réserve posée et acceptée par l'utilisateur : pour les projets du domaine `pro`, l'outil de
suivi de l'employeur reste la source de vérité. Le système ne stocke que le titre, le statut,
l'échéance et une référence de ticket. Aucun détail métier employeur n'est écrit sur le disque
personnel.

### Hors périmètre (YAGNI)

Pas de Gantt, pas de capacité de développeur, pas de multi-utilisateur, pas de mobile natif,
pas d'authentification, pas de synchronisation Jira, pas de niveau de hiérarchie au-delà de deux.

---

## 2. Décisions structurantes

| Sujet | Décision | Raison |
|---|---|---|
| Socle de données | Fichiers Markdown locaux, un par projet | Gratuit, versionnable, lisible par l'humain et par le LLM |
| Hiérarchie | Deux niveaux : projet, puis tâche | Suffit au besoin, un troisième niveau serait de la complexité gratuite |
| Serveur | Micro-serveur Node local | Nécessaire pour que le dashboard écrive les fichiers et parle à Beeper |
| LLM | Claude, via le compte de l'utilisateur | Déjà payé, aucun coût marginal |
| Canal sortant | Beeper | Agrège WhatsApp, Signal, Telegram, sans les contraintes de l'API Meta |
| Relance de tiers | L'agent rédige, l'humain valide, le code envoie | Rien ne part au nom de l'utilisateur sans qu'il l'ait lu |
| Récap hebdo | Message unique à lire, mardi 17h | Pas de conversation guidée, l'utilisateur met à jour ensuite lui-même |
| Identité visuelle | « Nuit » : fond charbon, accent laiton | Choisie sur maquette parmi trois propositions |

---

## 3. Architecture

```
<dossier du depot>\
  data/
    projects/<id>.md      source de vérité, un fichier par projet
    people.md             contacts résolus via Beeper, cache local
    history/AAAA-MM-JJ-recap.md
  server/
    server.js             HTTP local : sert web/, lit et écrit data/, relaie Beeper
    store.js              parse, sérialise, calcule les signaux (fonctions pures)
    beeper.js             client de l'API Beeper locale
    git.js                commit automatique après chaque écriture
  web/
    index.html            dashboard, page unique sans dépendance
  agent/
    weekly-recap.md       prompt de l'agent hebdomadaire
    run-weekly.ps1        lancé par le Planificateur de tâches Windows
  CLAUDE.md               conventions de saisie en langage naturel
  README.md, FEATURES.md
```

### Répartition des responsabilités

Le point clé de l'architecture : **l'API Beeper est un serveur HTTP local** sur
`http://localhost:23373`. Le serveur Node peut donc chercher un contact et envoyer un message
lui-même, sans passer par le LLM.

- **Claude** fait ce qu'il fait bien : comprendre une phrase en français, rédiger le récap,
  rédiger le texte d'une relance.
- **Le code** fait ce qui doit être déterministe : écrire les fichiers, calculer les signaux,
  envoyer les messages.

Aucun message ne part d'un chemin où un LLM décide seul.

### Les trois portes d'entrée

Toutes écrivent dans les mêmes fichiers.

1. **Conversation avec Claude Code** dans le dossier. `CLAUDE.md` décrit le format et les
   références, Claude édite les fichiers directement.
2. **Note à soi-même dans Beeper.** L'agent hebdomadaire lit les messages non traités du fil
   « Note to self », les transforme en tâches et les marque comme traités.
3. **Dashboard.** Formulaire d'édition en place, le serveur écrit le fichier.

S'y ajoute la **dictée à l'agent** depuis le dashboard : une zone de texte où l'utilisateur
écrit ce qu'il faut changer, Claude renvoie une liste d'opérations structurées, le serveur les
applique. Validée en maquette, elle fonctionne réellement.

---

## 4. Modèle de données

Un projet est un fichier. Les tâches vivent dans le frontmatter YAML, le corps du fichier reste
du texte libre. Une seule opération de parsing, pas de parseur maison.

```yaml
---
id: estimmo
prefixe: ES
titre: Estimmo
domaine: side              # side | perso | pro
statut: actif              # actif | en_pause | termine | abandonne
echeance: 2026-10-15       # vide autorisé
prochaine_action: "Brancher le comparateur viager sur l'extension"
jira: ""                   # renseigné uniquement pour domaine pro
taches:
  - n: 2
    titre: Relire la note de valeur avant publication
    statut: bloque         # a_faire | en_cours | bloque | fait | abandonne
    responsable: bruno     # "moi" ou un id de people.md
    echeance: 2026-09-09
    nature_echeance: dure  # dure | souhaitee
    prio: P1               # P1 | P2 | P3 | P4
    effort: S              # S | M | L
    bloque_par: ""         # référence d'une autre tâche, ex "ES1"
    derniere_relance: 2026-08-29
    prochaine_relance: 2026-09-06
    maj_le: 2026-08-24
    note_blocage: "Sans retour depuis 13 jours, la v0.4 attend."
---
## Contexte
Extension Chrome d'estimation immobilière, repo exemple/estimmo.
```

### Références de tâches

`prefixe` du projet, deux lettres majuscules, plus le numéro : `ES2`, `CA3`, `TO1`.

Deux lettres et non une seule, parce qu'une référence à une lettre entrerait en collision
visuelle avec les priorités : `P3` en référence se confondrait avec `P3` en priorité.

Le préfixe est unique dans tout le portefeuille. À la création d'un projet, il est dérivé des
deux premières lettres du titre ; en cas de collision, la deuxième lettre est remplacée par la
suivante disponible du titre, puis par un chiffre.

Le numéro `n` est monotone par projet : il vaut le maximum existant plus un, et n'est jamais
réattribué après suppression. Une référence désigne donc toujours la même tâche dans le temps,
ce qui permet de dire « valide CA3 » sans ambiguïté, y compris dans un récap archivé.

### people.md

```yaml
- id: bruno
  nom: Bruno Martin
  accountID: whatsapp        # compte Beeper sur lequel la personne est jointe
  reseau: WhatsApp
  participantID: '336xxxxxxxx'
  chatId: '...'              # vide tant que la conversation n'est pas ouverte
  resolu_le: 2026-09-06
```

Cache alimenté à la première assignation, en deux temps, parce qu'un contact n'est pas une
conversation dans l'API Beeper. Le serveur cherche la personne compte par compte et propose les
correspondances, l'utilisateur choisit, puis le serveur ouvre la conversation pour obtenir son
`chatId` et écrit la fiche complète ici. Les appels suivants ne touchent plus le réseau. Une
personne dont le `chatId` est vide n'est pas relançable, et aucune relance n'est proposée pour
elle.

---

## 5. Signaux et santé

Six signaux, calculés et jamais saisis. Ils ne sont pas affichés individuellement dans
l'interface : ils alimentent le liseré de gravité de chaque projet et le contenu du récap.

Sur les tâches ouvertes d'un projet, une tâche ouverte étant une tâche dont le statut n'est ni
`fait` ni `abandonne` :

1. **Relance due** : une tâche déléguée a une `prochaine_relance` atteinte ou dépassée.
2. **Échéance proche** : l'échéance du projet tombe dans moins de 14 jours (et n'est pas
   dépassée : voir signal 6).
3. **Sans prochaine action** : `prochaine_action` est vide.
4. **Dormant** : toutes les tâches ouvertes ont un `maj_le` de plus de 30 jours.
5. **WIP élevé** : au moins 3 tâches simultanément `en_cours`.
6. **En retard** : le projet a au moins une tâche ouverte, et l'une au moins de ces deux
   conditions est remplie : l'échéance du projet est renseignée et dépassée, ou une tâche
   ouverte porte une échéance dépassée de nature `dure`. Une échéance `souhaitee` dépassée
   ne compte pas : c'est une intention, pas un engagement.

Gravité affichée, du plus fort au plus faible :

- **inactif** (gris) : aucune tâche ouverte. Cette règle prime sur tout le reste, un projet
  terminé n'est jamais en retard.
- **retard** (rouge) : signal 6 actif. Passe devant la relance due car une échéance manquée
  est un fait acquis, alors qu'une relance due est encore une action à mener.
- **critique** (rouge) : signal 1 actif. C'est le seul qui engage quelqu'un d'autre que
  l'utilisateur.
- **attention** (ambre) : au moins un des signaux 2 à 5.
- **sain** (vert) : aucun signal.

`retard` et `critique` partagent le même liseré rouge dans l'interface : la distinction entre
les deux est portée par la donnée et par le contenu du récap hebdomadaire, pas par une couleur
supplémentaire.

---

## 6. Dashboard

### Niveau 1, le portefeuille

Une ligne par projet : liseré de gravité, titre, préfixe et domaine, échéance, prochaine action.
Filtres Tout, Pro, Side, Perso.

Le nombre de tâches ouvertes et le détail des signaux ne sont pas affichés : ils ont été retirés
en revue de maquette comme bruit sans valeur de décision.

### Niveau 2, les tâches

Le clic sur une ligne déplie ses tâches en place, sans navigation, pour garder le contexte du
portefeuille. Colonnes : référence, intitulé, statut, responsable, échéance, priorité.

Le clic sur une tâche la transforme en formulaire d'édition à sa place, avec Enregistrer,
Annuler et Supprimer. « Ajouter une tâche » ouvre le même formulaire vierge. Échap annule.

### Panneaux transverses

- **Ma semaine** : toutes les tâches dont l'utilisateur est responsable, échéance à moins de
  14 jours, tous projets confondus, triées par date.
- **Relances à valider** : les brouillons produits par l'agent. « Relire et envoyer » ouvre un
  tiroir avec le contact résolu, son réseau, le texte éditable, et un bouton d'envoi. Rien ne
  part avant ce clic.

### Encodage typographique

- **Échéances** au format « 15 oct. ». Une échéance dure s'affiche en plein, une échéance
  souhaitée en grisé souligné de pointillés. La nature de la donnée est portée par la donnée
  elle-même, sans badge supplémentaire.
- **Priorités** sur une seule rampe de couleur, celle de l'accent, avec quatre degrés
  d'insistance : P1 en pastille encadrée, P2 dans la même couleur sans cadre, P3 en encre
  secondaire, P4 estompé.
- **Couleur** dépensée une seule fois par ligne, sur le liseré de gravité.

### Identité visuelle « Nuit »

Monde visuel unique et assumé, sans variante claire. Chaque couleur est peinte explicitement,
fond du body compris.

```
fond        #14151A    surface     #1B1D24    surface creuse  #22252E
encre       #ECEAE5    encre 2     #A9A79F    estompé         #77746C
filets      #31343E    filets doux #282B33
accent      #E2A03F (laiton)       sur accent #14151A
sain        #5FAE7C    attention   #D9A038    critique        #E2705C
```

Titrage **Bricolage Grotesque** 800, texte **Figtree**, données **Martian Mono**.
Étiquettes en capitales espacées. Pas de coins arrondis, pas d'ombres, pas de cartes : des
lignes-instruments séparées par des filets.

---

## 7. Dictée à l'agent

Zone de texte fixée en bas à droite du dashboard, repliable.

L'utilisateur écrit en français. Le système envoie à Claude l'état courant des projets, la
demande, et le schéma d'opérations attendu. Claude répond par du JSON strict, jamais par du
texte libre appliqué directement.

```json
{"ops": [...], "message": "phrase courte disant ce qui a été fait"}
```

Opérations autorisées, et elles seules :

| Opération | Champs |
|---|---|
| `add_task` | projet, titre, statut, responsable, echeance, nature, prio, effort |
| `update_task` | ref, champs modifiés |
| `delete_task` | ref |
| `add_project` | id, prefixe, titre, domaine, echeance, prochaine_action |
| `update_project` | projet, champs modifiés |
| `delete_project` | projet |

Le serveur valide chaque opération contre ce schéma avant d'écrire. Une opération inconnue, mal
formée ou visant une référence inexistante est ignorée sans faire échouer les autres. Les
opérations appliquées sont listées à l'écran, pour que l'utilisateur voie exactement ce qui a
changé.

Aucune opération ne peut envoyer de message. La dictée modifie des données, elle ne communique
avec personne.

---

## 8. Agent hebdomadaire

**Déclenchement :** Planificateur de tâches Windows, tous les mardis à 17h, exécutant
`agent/run-weekly.ps1`, qui lance `claude -p` sur le dossier avec le prompt
`agent/weekly-recap.md`.

Le job tourne sur le poste de l'utilisateur, ce qui est de toute façon obligatoire : l'API
Beeper est locale et exige que Beeper Desktop soit lancé.

**Déroulé :**

1. Lire tous les fichiers de `data/projects/`.
2. Lire le fil Beeper « Note to self » à partir du curseur stocké dans
   `data/history/.last-ingest`, convertir chaque message en tâche, puis remplacer ce curseur par
   le `newestCursor` renvoyé. C'est cette borne, et non une marque posée sur les messages, qui
   garantit qu'une note n'est ingérée qu'une fois.
3. Calculer les six signaux sur chaque projet.
4. Écrire `data/history/AAAA-MM-JJ-recap.md` : ce qui a bougé depuis le dernier récap, les
   échéances sous 14 jours, les projets sans prochaine action, les projets dormants, et les
   relances proposées avec leur texte rédigé.
5. Envoyer le récap à l'utilisateur sur Beeper, en un seul message.

Les relances vers des tiers ne partent pas à cette étape. Elles attendent une validation dans
le dashboard.

---

## 9. Intégration Beeper

Beeper Desktop expose une API HTTP locale sur `http://localhost:23373`, avec un serveur MCP
intégré sur `/v0/mcp`. Authentification par jeton porteur, ou OAuth automatique pour les clients
MCP.

Deux usages, deux chemins :

- **Le serveur Node** appelle l'API REST pour rechercher un contact et envoyer un message. Code
  déterministe, aucune décision confiée au modèle.
- **L'agent hebdomadaire**, qui tourne dans Claude Code, utilise le serveur MCP Beeper pour
  lire les notes à soi-même et envoyer le récap.

Le jeton est lu depuis une variable d'environnement, jamais écrit dans le dépôt. Le dépôt
contient un `.gitignore` couvrant le jeton et tout fichier de configuration local.

**Observation faite le 6 septembre 2026,** relevé complet dans `docs/beeper-observe.md`. Les
routes REST sont toutes préfixées `/v1`, la spec OpenAPI est servie sur `GET /v1/spec`, et le
serveur MCP reste sur `/v0/mcp`. Trois enseignements ont modifié la conception :

- `GET /v1/accounts` renvoie un tableau nu, et la recherche de contacts est faite compte par
  compte via `GET /v1/accounts/{accountID}/contacts?query=...`.
- Un contact ne porte que `id`, `phoneNumber` et `fullName` : ni conversation ni réseau. Il faut
  donc `POST /v1/chats` pour obtenir un `chatID` avant tout envoi, d'où la fiche de personne en
  deux temps décrite en section 4.
- L'envoi, `POST /v1/chats/{chatID}/messages` avec `{text}`, est asynchrone : la réponse
  confirme la prise en compte, pas la remise sur le réseau. L'interface doit donc dire
  « transmise à Beeper » plutôt que « reçue ».

---

## 10. Gestion des erreurs

| Situation | Comportement |
|---|---|
| YAML invalide dans un fichier projet | Le serveur refuse d'écrire et signale le fichier. Il ne réécrit jamais un fichier qu'il n'a pas su lire. |
| Beeper fermé au moment du récap | Le récap est écrit sur disque quand même, et présenté au prochain démarrage du dashboard. |
| Beeper fermé au moment d'un envoi | L'envoi échoue explicitement dans le tiroir. La relance reste en attente, jamais marquée envoyée. |
| Contact introuvable dans Beeper | La tâche reste assignée au nom saisi, sans identifiant de conversation. Aucune relance n'est proposée tant que le contact n'est pas résolu. |
| Claude renvoie du JSON invalide | Aucune opération appliquée, message d'erreur demandant de reformuler. Pas de nouvelle tentative automatique. |
| Écriture concurrente | Chaque écriture est suivie d'un commit Git automatique. Tout état antérieur est récupérable. |

---

## 11. Tests

`store.js` ne fait que des transformations pures et concentre la logique métier. Il est testé
avec le module `node:test` natif, sans dépendance :

- Aller-retour parse puis sérialise sur un fichier projet, sans perte ni réordonnancement.
- Calcul des six signaux sur des jeux de données couvrant chaque signal isolément, puis
  combinés.
- Attribution des préfixes de projet, y compris les cas de collision.
- Monotonie des numéros de tâche après suppression.
- Refus d'écriture sur YAML invalide.
- Validation du schéma d'opérations : opérations inconnues et références inexistantes ignorées
  sans effet de bord.

`beeper.js` est testé contre un serveur HTTP local bouchonné reproduisant les réponses réelles
observées.

---

## 12. Sécurité et confidentialité

- Aucun message sortant vers un tiers sans clic explicite dans le tiroir de relance.
- Le jeton Beeper vit dans l'environnement, jamais dans le dépôt.
- Le serveur n'écoute que sur `127.0.0.1`.
- Les projets du domaine `pro` ne portent ni détail métier ni donnée client, seulement un
  titre, un statut, une échéance et une référence de ticket.
- Le dépôt est local et n'est jamais poussé sans demande explicite de l'utilisateur.

---

## 13. Ce qui reste ouvert

Rien ne bloque l'implémentation. Deux points seront tranchés en cours de route, sans impact sur
l'architecture :

- Le format exact du message de récap envoyé sur Beeper sera calé après le premier envoi réel,
  sur pièce.
- Le fil Beeper servant de « note à soi-même » sera désigné à la configuration, sur la liste des
  fils que l'API renvoie.
