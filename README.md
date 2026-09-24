# Secretariat particulier

Systeme personnel de pilotage de projets et de taches, double d'un agent qui produit un recap
hebdomadaire et prepare les relances des personnes a qui des taches sont deleguees. Tous les
projets sans exception : side projects, vie personnelle et travail salarie (avec une reserve de
confidentialite pour un domaine employeur, voir plus bas).

Ce depot est installable : chaque personne qui le clone obtient son propre secretariat, avec son
nom, ses projets, ses contacts et son fil de notes. Aucune donnee reelle n'est versionnee ici
(voir `.gitignore`) ; `data.exemple/` sert de point de depart documente.

Conception detaillee : `docs/superpowers/specs/2026-09-06-agent-secretaire-design.md`.
Observations de l'API Beeper Desktop reellement utilisee : `docs/beeper-observe.md`.

## Ce que fait le systeme

- Chaque projet est un fichier Markdown dans `data/projects/`, avec ses taches dans le
  frontmatter YAML. Ce fichier est la source de verite, versionne dans Git (dans votre propre
  historique local : `data/` lui-meme n'est jamais pousse par ce depot, voir plus bas).
- Un serveur Node local (`server/server.js`) sert le dashboard, lit et ecrit ces fichiers, et
  relaie l'API locale de Beeper Desktop pour chercher un contact et envoyer un message. Toute
  requete est verifiee avant traitement : origine (`Origin`), hote (`Host`, doit valoir
  `127.0.0.1:5556` ou `localhost:5556`) et, pour une ecriture, `Content-Type: application/json`
  strictement, sinon 403 (voir la section « Defense contre les requetes croisees »).
- Six signaux sont calcules, jamais saisis, sur chaque projet (relance due, echeance proche,
  sans prochaine action, dormant, WIP eleve, en retard), et determinent le liseré de gravite
  affiche dans le dashboard.
- Un agent hebdomadaire, lance par le Planificateur de taches Windows, lit les projets,
  ingere les notes laissees dans un fil Beeper de « note a soi-meme », ecrit un recap dans
  `data/history/` et l'envoie sur Beeper.
- Aucun message ne part vers un tiers sans validation humaine explicite : l'agent redige les
  textes de relance, seul un clic dans le dashboard les envoie.

## Prerequis

- **Node.js** (version 18 ou plus recente ; `node -v` pour verifier).
- **Beeper Desktop**, installe et lance sur le meme poste. Le systeme s'appuie sur son API
  locale (`http://127.0.0.1:23373`) pour lire et envoyer des messages : sans lui, la recherche
  de contact, l'envoi de relance, l'ingestion des notes et le recap hebdomadaire sont
  indisponibles.
- Un **abonnement Claude** avec acces au binaire `claude` (Claude Code), utilise par la dictee
  en langage naturel et par l'agent hebdomadaire. `claude -p "dis bonjour"` doit repondre
  normalement ; sinon lancer `claude` dans un terminal et executer `/login`.

## Installation

```bash
git clone <url-de-ce-depot>
cd secretaire
npm install
```

Une seule dependance npm directe (`js-yaml`), pas de framework.

## Configuration : trois etapes avant le premier lancement

Au tout premier demarrage du serveur (voir « Lancement » ci-dessous), `data/` est cree
automatiquement a partir de `data.exemple/` s'il n'existe pas encore : vous obtenez tout de
suite un dashboard fonctionnel, avec un projet d'exemple. Completez ensuite `data/config.json` :

### 1. Votre nom

Ouvrez `data/config.json` et renseignez la cle `proprietaire` (votre prenom, par exemple). Ce
nom est repris tel quel dans les prompts envoyes a Claude (dictee et agent hebdomadaire) :
« Tu es le secretaire de \<votre nom\>. » Sans cette cle, le systeme fonctionne quand meme, avec
un repli generique (« l'utilisateur »).

### 2. Votre jeton Beeper

Le serveur (recherche de contact, envoi de relance) et l'agent hebdomadaire (lecture des notes,
envoi du recap) ont besoin de la variable d'environnement `BEEPER_TOKEN`. En PowerShell :

```powershell
[Environment]::SetEnvironmentVariable("BEEPER_TOKEN", "<votre jeton>", "User")
```

Rouvrez ensuite la session ou le terminal pour que la variable soit prise en compte. Le jeton
ne doit jamais etre ecrit dans ce depot ; `.gitignore` exclut deja `.env`, `*.local.json` et
`beeper-token*`.

Sans l'une ou l'autre (jeton, Beeper Desktop lance), les routes qui appellent Beeper
(`GET /api/comptes`, `GET /api/contacts`, `POST /api/relance`, `POST /api/personne`,
`POST /api/recap`) repondent en erreur : 401 si le jeton est absent ou refuse, 503 si Beeper
Desktop ne repond pas.

### 3. Votre fil de notes

L'agent hebdomadaire lit les messages d'un fil Beeper qui vous sert de « note a soi-meme » et
les transforme en taches. Pour trouver son identifiant (l'etape la plus obscure de cette
configuration), un outil est fourni :

```bash
npm run trouver-fil-notes
```

Il interroge l'API Beeper locale en lecture seule (n'ecrit rien, n'envoie aucun message) et
affiche les conversations dont le titre evoque une note a soi-meme, avec leur identifiant.
Copiez cet identifiant dans la cle `filNoteASoiMeme` de `data/config.json`.

## Lancement

```bash
npm start
```

Puis ouvrir `http://127.0.0.1:5556`. Le serveur n'ecoute que sur `127.0.0.1`.

## Le raccourci

Un raccourci Bureau nomme « Secretariat particulier » (pointant sur `demarrer.cmd`, a la racine
du depot) fait les quatre choses suivantes en un double-clic : il verifie l'etat du port 5556 en
interrogeant `/api/etat` et en cherchant la cle `today` dans la reponse (une simple connexion
TCP reussie ne suffit pas a prouver que c'est bien notre serveur qui repond, un autre programme
pourrait occuper ce port), puis distingue trois cas : rien n'ecoute (demarre le serveur, attend
qu'il reponde, 30 secondes maximum, puis ouvre le dashboard), notre serveur repond deja (ouvre
simplement le dashboard), ou un autre programme occupe le port (n'ouvre rien, avertit clairement
et garde la fenetre affichee pour que le port puisse etre libere). Si le serveur ne demarre
jamais, une erreur claire reste affichee a l'ecran (la fenetre ne se ferme pas toute seule).

Une fois le dashboard ouvert dans le navigateur, **la fenetre de commandes se ferme** et il
n'en reste aucune : le serveur tourne en fenetre cachee. Sa sortie, qui ne s'afficherait donc
plus nulle part, est redirigee vers `data/history/serveur.log` et `serveur.log.err` : c'est la
qu'il faut regarder si le serveur refuse de demarrer.

Comme le serveur n'a plus de fenetre a fermer, `arreter.cmd`, a la racine du depot, l'arrete.
Il identifie le processus par le port qu'il ecoute, jamais par son nom, pour ne pas risquer
d'arreter un autre programme Node qui tournerait en parallele.

Pour creer ce raccourci sur votre poste :

```powershell
powershell -ExecutionPolicy Bypass -File installer-raccourci.ps1
```

Le script se base uniquement sur son propre emplacement (jamais un chemin fixe) pour retrouver
`demarrer.cmd` et poser le raccourci, quel que soit l'endroit ou le depot se trouve sur votre
poste. Si ce raccourci est supprime ou que le depot est deplace, relancer simplement ce script.

## La tache planifiee du mardi

Tous les mardis a 17h, une tache planifiee Windows lance `agent/run-weekly.ps1`, qui execute
`claude -p` sur le prompt `agent/weekly-recap.md` (le marqueur `{{PROPRIETAIRE}}` de ce gabarit
est remplace par votre nom, lu dans `data/config.json`, juste avant l'envoi). C'est un message
unique a lire, pas une conversation guidee : vous mettez a jour vos projets vous-meme ensuite.

Ce que l'agent fait, dans l'ordre : il lit tous les projets, ingere les notes non encore
traitees du fil de note a soi-meme (avec un registre de deduplication qui garantit qu'une note
n'est jamais ingeree deux fois), calcule les six signaux, ecrit
`data/history/AAAA-MM-JJ-recap.md` (ce qui a bouge, les projets en retard, les relances
proposees avec leur texte, les echeances a moins de 14 jours, les projets sans prochaine
action, les projets dormants), puis s'arrete. Pour un projet `domaine: pro`, seuls le
titre, le statut, l'echeance et la reference de ticket apparaissent dans le recap, jamais de
detail metier (voir « Regle pro » dans `CLAUDE.md`). Les relances vers des tiers ne partent jamais
a cette etape : elles attendent une validation dans le dashboard.

**L'agent n'envoie jamais rien lui-meme.** Il n'a recu aucun outil d'envoi de message :
`agent/run-weekly.ps1` ne pre-autorise que des outils de lecture du serveur MCP Beeper
(`search`, `get_accounts`, `get_chat`, `search_chats`, `list_messages`, `search_messages`,
`search_docs`), plus `Edit`/`Write` pour ecrire le fichier de recap. C'est le script, une fois
le modele termine, qui appelle `POST /api/recap` : cette route lit le recap du jour dans
`data/history/` et l'envoie exclusivement au fil `filNoteASoiMeme` de `data/config.json`. Elle
n'accepte aucun destinataire en parametre : aucun message ne part d'un chemin ou un modele
decide seul, de facon mecanique et non plus seulement declarative.

Pour la planifier, en PowerShell, depuis la racine du depot (adapte automatiquement le chemin
a votre installation, sans rien coller en dur) :

```powershell
$script = Join-Path (Get-Location) "agent\run-weekly.ps1"
schtasks /create /tn "Secretariat - recap hebdo" /sc WEEKLY /d TUE /st 17:00 /f `
  /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
```

La tache planifiee doit s'executer en mode « Interactive uniquement » : elle depend d'une
session Windows ouverte, dans laquelle `BEEPER_TOKEN` est chargee et Beeper Desktop est lance.

Pour la supprimer :

```
schtasks /delete /tn "Secretariat - recap hebdo" /f
```

(a executer depuis PowerShell : `schtasks` avec des options commencant par `/` est deforme par
Git Bash).

## Les trois portes d'entree

Toutes ecrivent dans les memes fichiers de `data/projects/` et `data/people.md`.

1. **Conversation avec Claude Code**, dans ce dossier : `CLAUDE.md` decrit le format des
   fichiers projet, les references et les regles a respecter. Claude edite alors les fichiers
   Markdown directement.
2. **Note a soi-meme dans Beeper** : l'agent hebdomadaire lit les messages non traites du fil
   designe dans `data/config.json` (`filNoteASoiMeme`) et les transforme en taches.
3. **Dashboard** (`http://127.0.0.1:5556`) : formulaire d'edition en place pour les taches
   (titre, statut, responsable, echeance, nature, priorite, effort, plus les deux champs de
   relance decrits plus bas), et un tiroir de projet pour creer ou modifier un projet (titre,
   domaine, echeance, prochaine action, reference de ticket si le domaine est `pro`), ouvert
   depuis le bouton « Nouveau projet » du portefeuille ou « Modifier le projet » sur une ligne
   depliee. En creation, l'identifiant de fichier est calcule depuis le titre (minuscules,
   sans accent, espaces en traits d'union) et reste modifiable avant validation ; en
   modification il est fixe, et un bouton separe permet de supprimer le projet apres
   confirmation explicite rappelant son titre et le nombre de taches perdues. S'y ajoute une
   zone de dictee en langage naturel (« Dicter a l'agent »), un champ multiligne qui suit la
   saisie jusqu'a une hauteur maximale puis defile comme un champ de texte ordinaire ; Entree
   envoie la demande, Maj+Entree ajoute une ligne sans envoyer. L'envoi appelle
   `POST /api/dictee`. Cette route lance le binaire `claude` local pour transformer la phrase
   en operations structurees, que le serveur valide avant de les appliquer : le modele ne peut
   jamais envoyer de message, seulement lire et ecrire des donnees.

   Chaque ligne de projet affiche, sans avoir a la deplier, le nombre de taches associees et
   une pastille de priorite P1-P4. Cette pastille n'est pas une propriete du projet : elle
   porte la plus haute priorite parmi ses taches ouvertes. Elle est donc independante de
   l'ordre d'affichage, que l'utilisateur definit a la main : un projet P1 peut apparaitre
   apres un projet P2. Les taches faites ou abandonnees sont exclues du calcul, sinon une
   tache P1 terminee maintiendrait le projet en P1 indefiniment ; quand toutes les taches
   sont closes, aucune pastille n'est affichee. Le nombre, lui, compte toutes les taches.

   Sur chaque ligne de tache : une poignee (`⋮⋮`) glisser-deposer pour reordonner les taches
   d'un projet (et, de la meme facon, les projets entre eux) ; un clic sur une cellule visible
   (titre, statut, responsable, echeance) l'ouvre en edition en place, enregistree a la perte
   du focus ou a la selection dans une liste deroulante, Entree validant un champ texte et
   Echap annulant sans rien envoyer. Pour les champs a choix (statut, priorite, responsable)
   et pour l'echeance, la liste deroulante ou le calendrier se deploie des le premier clic,
   sans avoir a cliquer une seconde fois ; un bouton crayon (« Edition complete ») ouvre le meme
   formulaire complet que pour une nouvelle tache, seul moyen de modifier l'effort et la nature
   d'echeance (`dure` ou `souhaitee`), qui n'ont pas de cellule visible dans la ligne ; un bouton
   croix (« Supprimer ») retire la tache immediatement et affiche un bandeau « Annuler » pendant
   six secondes avant l'envoi effectif de la suppression ; fermer l'onglet pendant ce delai
   vaut acceptation, la suppression encore en attente est alors envoyee immediatement via
   `navigator.sendBeacon`, pour qu'elle ne soit jamais perdue. Le bouton `+` (« Ajouter une
   tache ») en tete de projet ouvre ce meme formulaire complet, vide, pour une nouvelle tache.

   Une tache deleguee (`responsable` different de `moi`) porte deux champs de relance,
   « Derniere relance » et « Prochaine relance », visibles uniquement pour ce cas (masques des
   la selection de `moi`, sans recharger le formulaire) ; un bouton « Dans une semaine » pose
   la seconde a sept jours de la date du jour renvoyee par le serveur. Quand une relance
   devient due sans que le responsable ait de conversation resolue dans `data/people.md`, elle
   rejoint le panneau « Relances a valider » comme relance bloquee, avec un bouton « Resoudre
   le contact » qui ouvre un tiroir de recherche (comptes de messagerie Beeper, recherche par
   nom) ; le choix d'un resultat appelle `POST /api/personne` et fait immediatement rejoindre
   la relance a la liste des relances envoyables, sans recharger la page.

## Deux voyants de sante dans l'en-tete du dashboard

A droite de l'en-tete, deux pastilles signalent l'etat des deux dependances externes du
systeme : **Beeper** (recherche de contact, envoi de relance) et **Claude** (dictee, agent
hebdomadaire). Vert (`--ok`) quand tout va bien, rouge (`--crit`) quand la dependance est
hors service, orange (`--warn`) pendant une verification. Le detail en francais (au survol,
et pourquoi c'est en panne le cas echeant) est toujours visible, jamais muet sur la cause.

La pastille Beeper se revenifie au chargement puis toutes les dix minutes tant que l'onglet
reste ouvert et visible (mise en pause quand l'onglet est cache) ; un clic force une
verification immediate. La pastille Claude ne fait qu'un controle gratuit et instantane au
chargement (`claude auth status`) ; un clic dessus lance le seul vrai aller-retour (un appel
reel au binaire `claude`, jusqu'a 120 secondes) via `POST /api/sante/claude/test`. Aucune des
trois routes de sante (`GET /api/sante/beeper`, `GET /api/sante/claude`,
`POST /api/sante/claude/test`) n'ecrit quoi que ce soit ni n'envoie de message : ce sont des
controles, jamais des actions.

## Defense contre les requetes croisees

Le serveur (`server/server.js`) refuse en 403, avant tout autre traitement :

- une requete dont l'en-tete `Origin`, s'il est present, ne correspond pas a
  `http://127.0.0.1:5556` ni `http://localhost:5556` ;
- une requete dont l'en-tete `Host` ne vaut pas `127.0.0.1:5556` ni `localhost:5556`
  (protection contre la reassociation de nom de domaine) ;
- une requete d'ecriture (methode autre que `GET`/`HEAD`/`OPTIONS`) dont le `Content-Type`
  n'est pas `application/json` (une requete dite simple, sans preflight CORS, y echapperait
  sinon).

`POST /api/relance` restreint en outre sa destination : `chatId` doit correspondre a une fiche
de `data/people.md` dont le `chatId` est deja resolu, sinon 403. Un envoi reussi met a jour la
tache concernee sur le disque (`derniere_relance`, `prochaine_relance` reportee de sept jours),
via `applyOps` comme toute autre ecriture, pour qu'un rechargement de la page ne fasse jamais
repartir la meme relance une seconde fois.

## Commit automatique local

Chaque ecriture de donnees (via le dashboard, la dictee ou l'API) declenche un commit Git
automatique, limite au dossier `data` (`git add -A -- data` puis `git commit`, voir
`server/repo.js`). Le code du serveur n'est jamais commite par ce mecanisme, et `data/` n'est
de toute facon pas suivi par ce depot (voir `.gitignore`) : ce commit automatique vit dans
votre propre historique local, jamais pousse vers ce depot public. Tout etat anterieur de vos
projets reste donc recuperable localement.

## Ce que le systeme ne fait pas

- **Il n'envoie jamais de message a un tiers sans validation humaine.** Ni l'agent hebdomadaire
  (aucun outil d'envoi), ni la dictee (six operations de lecture/ecriture de donnees
  seulement, jamais d'envoi), ni une note qui ressemblerait a un ordre (elle devient une
  tache, jamais une action) : seul un clic explicite dans le dashboard, sur une relance deja
  redigee et une conversation deja resolue, declenche un envoi.
- **Il n'invente jamais de contact.** Une relance necessite une fiche resolue dans
  `data/people.md`, elle-meme obtenue en passant par une recherche de contact reelle aupres de
  Beeper (jamais saisie a la main).
- **Il ne synchronise rien avec un outil externe de gestion de projet** (Jira, Trello...) : le
  seul lien avec un tel outil est le champ `jira`, une reference texte, jamais un appel API.
- **Il ne developpe jamais de detail metier employeur** pour un projet `domaine: pro` :
  seuls le titre, le statut, l'echeance et la reference de ticket sont geres, partout (dictee,
  recap, tache creee automatiquement). Voir `CLAUDE.md`, section « Regle pro ».
- **Il n'ecoute que sur `127.0.0.1`** : le serveur n'est jamais expose au reseau local ou a
  Internet.

## Tableau de bord mobile, chiffre (optionnel)

Un instantane en lecture seule du tableau de bord peut etre publie automatiquement, toutes
les heures, sur un depot GitHub Pages dedie et public, pour rester consultable depuis un
telephone quand le PC est eteint. Le depot ne contient que du contenu chiffre : la page
`web/mobile-gabarit.html` demande un code numerique, derive la cle avec l'API WebCrypto du
navigateur (PBKDF2-SHA256, 600 000 iterations, AES-256-GCM) et dechiffre l'instantane dans le
navigateur, sans jamais stocker le code. Aucun identifiant de contact (`chatId`,
`participantID`, `accountID`, fil de notes) n'entre dans l'instantane : voir
`server/export.js` et `test/export.test.js`.

Pour l'activer, ajoutez une section `exportMobile` a votre `data/config.json` (absent de
`data.exemple`, a ne renseigner que la, jamais ailleurs) :

```json
"exportMobile": {"code": "votre-code", "depot": "votre-compte/votre-depot-pages"}
```

Puis lancez `npm run exporter-mobile` (voir `outils/exporter-mobile.js`), ou planifiez-le
toutes les heures. L'outil ne clone jamais le depot de publication : il construit `index.html`
dans un depot git flambant neuf, cree dans un dossier de travail temporaire vide, distinct du
code et des donnees, puis pousse un commit unique en force sur ce depot ; l'historique du depot
public ne s'accumule jamais et rien de son contenu existant n'est jamais lu ni recopie. Avant
tout push, l'outil interroge le depot cible via `gh` et refuse de publier, sans y toucher, s'il
contient autre chose qu'un `index.html` ou s'il correspond au depot du logiciel lui-meme : ce
garde-fou protege contre une faute de frappe dans `exportMobile.depot`. Sans section
`exportMobile`, l'outil ne publie rien et le journalise dans `data/history/export.log`, sans
jamais y ecrire le code.

### Changer le code d'acces

Le depot de publication est public : ses anciens commits restent telechargeables par leur
identifiant meme apres un push force qui remplace la branche. Changer le code sans recreer le
depot laisserait donc en ligne d'anciens instantanes toujours dechiffrables avec l'ancien code.
Procedure, a executer a la main (la suppression d'un depot GitHub n'est jamais automatisee) :

1. Remplacer `exportMobile.code` dans `data/config.json` par le nouveau code.
2. Supprimer le depot de publication :
   ```bash
   gh repo delete votre-compte/votre-depot-pages --yes
   ```
3. Le recreer, public :
   ```bash
   gh repo create votre-compte/votre-depot-pages --public
   ```
4. Reactiver GitHub Pages sur ce depot (branche `main`, dossier racine) :
   ```bash
   gh api -X POST repos/votre-compte/votre-depot-pages/pages -f source[branch]=main -f source[path]=/
   ```
5. Relancer un export :
   ```bash
   npm run exporter-mobile
   ```

## Tests

```bash
npm test
```

Suite `node --test` native, sans dependance de test. `server/store.js` concentre la logique
metier en fonctions pures (parsing, signaux, allocation de prefixe, validation des
operations) et en est la partie la plus couverte.
