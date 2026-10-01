# Journal des iterations

Convention : a chaque evolution fonctionnelle du systeme, une nouvelle iteration numerotee
est ajoutee ici, datee, decrivant ce qu'elle couvre. Voir `CLAUDE.md`, section « convention
de documentation ».

## Iteration 1 : 9 septembre 2026

Premiere livraison complete du systeme, taches 1 a 12 du plan
`docs/superpowers/plans/2026-09-06-agent-secretaire.md`.

- **Socle de donnees** : un projet est un fichier Markdown dans `data/projects/`, frontmatter
  YAML plus corps libre. Aller-retour parse puis serialise sans perte
  (`server/store.js`, `parseProject`/`serializeProject`).
- **References de tache** a deux lettres plus numero (`ES2`), prefixe unique par portefeuille
  attribue automatiquement a la creation d'un projet, avec repli en cas de collision.
- **Numerotation monotone** des taches par projet (`dernier_n`), jamais reattribuee apres
  suppression.
- **Six signaux calcules** sur chaque projet (relance due, echeance proche, sans prochaine
  action, dormant, WIP eleve, en retard) et cinq niveaux de gravite (inactif, retard,
  critique, attention, sain).
- **Validation stricte des champs** : valeurs fermees pour le statut et la nature d'echeance
  d'une tache, la priorite, l'effort, le domaine et le statut d'un projet ; refus d'ecriture
  sur YAML illisible ou date mal formee.
- **Serveur HTTP local** (`server/server.js`, port 5556, ecoute sur `127.0.0.1` uniquement) :
  sert le dashboard statique, expose l'API (`/api/etat`, `/api/ops`, `/api/tache`,
  `/api/dictee`, `/api/comptes`, `/api/contacts`, `/api/relance`, `/api/personne`).
- **Commit Git automatique** apres chaque ecriture de donnees, limite au dossier `data`
  (`server/repo.js`).
- **Dashboard** (`web/index.html`) : portefeuille filtrable (Tout, Pro, Side, Perso),
  detail des taches par projet en place, panneaux « Ma semaine » et « Relances a valider »,
  identite visuelle « Nuit ».
- **Client Beeper** (`server/beeper.js`) conforme a l'API `/v1` reellement observee
  (`docs/beeper-observe.md`) : recherche de contact par compte, ouverture de conversation,
  envoi de message, distinction des causes d'echec (authentification, injoignable, refus,
  reponse illisible).
- **Repertoire des personnes** (`server/people.js`, `data/people.md`) resolu en deux temps
  (contact puis conversation) et file des relances a proposer, calculee sans jamais toucher
  au reseau.
- **Dictee en langage naturel** depuis le dashboard (`server/dictee.js`,
  `POST /api/dictee`) : le binaire `claude` local transforme une phrase en operations
  structurees, validees par le meme chemin que les ecritures directes (`store.applyOps`) ;
  aucune operation ne peut envoyer de message.
- **Agent hebdomadaire** (`agent/weekly-recap.md`, `agent/run-weekly.ps1`), planifie tous les
  mardis a 17h via le Planificateur de taches Windows (`Secretariat - recap hebdo`) : lecture
  des projets, ingestion deduplique des notes du fil Beeper « Note to self », ecriture du
  recap dans `data/history/`, envoi du recap sur Beeper. Confidentialite stricte des projets
  `domaine: pro` et interdiction absolue d'envoyer un message a un tiers, rappelees dans
  le prompt.
- **Documentation d'usage** : `CLAUDE.md` (conventions de saisie), `README.md` (demarrage et
  garanties), `FEATURES.md` (ce journal).

### Points de configuration ouverts a cette date

Voir `README.md`, section « Configuration ». Sur ce poste, le 9 septembre 2026 :
authentification du binaire `claude` non faite (`claude -p` renvoie `Not logged in`, bloque
la dictee et l'agent hebdomadaire) ; `BEEPER_TOKEN` deja definie et Beeper Desktop deja
joignable (verifie).

### Non couvert (hors perimetre assume)

Gantt, capacite de developpeur, multi-utilisateur, mobile natif, authentification du
dashboard, synchronisation Jira, hierarchie a plus de deux niveaux : voir
`docs/superpowers/specs/2026-09-06-agent-secretaire-design.md`, section 1.

## Iteration 2 : 9 septembre 2026

Corrections issues de la revue finale de la branche `feat/secretaire-v1`, huit points
(trois critiques), tous demontres empiriquement par le relecteur avant correction.

- **Isolation du calcul de gravite par projet** (`server/api.js`, `etat`) : un projet dont le
  calcul de severite ou de signaux fait lever rejoint desormais `errors` avec un message qui le
  nomme, au lieu de faire echouer `GET /api/etat` pour tout le portefeuille. `maj_le` a rejoint
  `CHAMPS_DATE` (`server/store.js`) : une date mal saisie sur ce champ est desormais rejetee au
  chargement, comme les trois autres champs de date. `web/index.html` traite une reponse sans
  tableau `projects` comme une erreur affichee dans le bandeau persistant, jamais comme un etat
  valide, sans jamais ecraser le dernier etat correct.
- **L'agent hebdomadaire ne peut plus envoyer de message** : `agent/run-weekly.ps1` ne
  pre-autorise plus que des outils de lecture du serveur MCP Beeper, enumeres un par un
  (verifies aupres du serveur reel comme portant `readOnlyHint: true`), plus `Edit`/`Write`. Une
  nouvelle route `POST /api/recap` (`server/api.js`) lit le recap du jour et l'envoie
  exclusivement au fil `filNoteASoiMeme` de `data/config.json`, sans jamais accepter de
  destinataire en parametre ; c'est `run-weekly.ps1` qui l'appelle, jamais le modele.
- **Defense contre les requetes croisees** (`server/server.js`) : controle de l'en-tete
  `Origin` (si present), de l'en-tete `Host` (doit valoir `127.0.0.1:5556` ou
  `localhost:5556`, protection contre la reassociation de nom de domaine) et du `Content-Type`
  d'une requete d'ecriture (doit etre `application/json`), avant tout traitement. Reproduit et
  verifie moi-meme, avant et apres correctif.
- **`POST /api/relance` restreint sa destination** : `chatId` doit correspondre a une fiche de
  `data/people.md` dont le `chatId` est resolu, sinon 403 (sans quoi la defense croisee
  ci-dessus restait exploitable jusqu'a l'envoi).
- **Une relance envoyee est memorisee sur le disque** : `derniere_relance` et
  `prochaine_relance` (reportee de sept jours, nouvelle fonction pure `store.addDays`) sont
  mises a jour via `applyOps` apres un envoi reussi, pour qu'un rechargement de page ne fasse
  jamais repartir la meme relance deux fois.
- **Regle de confidentialite pro reprise dans la dictee** (`server/dictee.js`,
  `construirePrompt`) : meme clause que le prompt de l'agent hebdomadaire, elle ne figurait
  auparavant que comme valeur fermee de domaine.
- **`saveAll` ne supprime plus un fichier apparu entre-temps** (`server/repo.js`) : nouveau
  parametre `idsConnus`, seul un fichier deja connu au chargement de l'instantane et absent de
  la nouvelle liste est efface.
- **`update_project` rejette un objet de champs vide**, aligne sur `update_task`.

Rapport complet : `.superpowers/sdd/revue-finale-report.md`.

## Iteration 3 : 9 septembre 2026

Tache 13 : resolution de contact et relances bloquees. Les routes de resolution de contact
(`GET /api/comptes`, `GET /api/contacts`, `POST /api/personne`) existaient et etaient testees
depuis la tache 9, mais aucun element du dashboard ne les appelait : une tache deleguee a un
responsable absent du repertoire, ou dont la conversation n'etait pas encore ouverte,
declenchait bien le signal `relanceDue` (donc un projet rouge), mais `relances`
(`server/people.js`) l'ecartait silencieusement, et le panneau « Relances a valider »
affichait « tout est parti » alors que rien n'avait jamais pu partir.

- **`relancesBloquees(projects, gens, today)`** (`server/people.js`) : jumelle exacte de
  `relances`, meme parcours des taches ouvertes, deleguees, dont la date de relance est
  atteinte, mais ne retient que celles qu'`relances` ecarte faute de contact exploitable,
  avec la raison precise (`contact_inconnu` si le responsable n'a aucune fiche exploitable
  dans le repertoire, `conversation_non_resolue` si la fiche existe mais que son `chatId` est
  vide). Les deux fonctions sont exactement complementaires (teste sur un portefeuille mixte).
  Exposee dans `GET /api/etat` sous la cle `relancesBloquees`, a cote de `relances`.
- **Panneau « Relances a valider »** (`web/index.html`) : rend desormais les deux listes, les
  bloquees d'abord. Une entree bloquee reprend la presentation d'une relance mais remplace le
  bouton d'envoi par « Resoudre le contact » et affiche la raison reelle en une phrase. Le
  compteur du panneau ne dit plus jamais que tout est parti tant qu'il reste des bloquees.
- **Tiroir de resolution de contact** (`web/index.html`), sur le modele exact du tiroir de
  relance : liste les comptes de messagerie connectes (`GET /api/comptes`, WhatsApp
  preselectionne s'il est present), recherche un contact prerempli avec le nom du responsable
  (`GET /api/contacts`), et la selection d'un resultat appelle `POST /api/personne` avec l'id
  du responsable tel qu'il figure dans le fichier projet et le `participantID` du contact
  choisi. A la reponse, le tiroir se ferme et l'etat se rafraichit depuis la reponse du
  serveur : la relance quitte les bloquees pour rejoindre les envoyables sans nouvel appel.
  Les echecs (401 jeton a reconfigurer, 503 Beeper injoignable, 502 conversation non
  exploitable, recherche sans resultat) sont tous traduits en phrase lisible, jamais un ecran
  muet.

Verifie a la main avec Beeper Desktop reellement lance : voir
`.superpowers/sdd/task-13-report.md` pour le deroule complet. Le bouton d'envoi n'a jamais ete
sollicite pendant cette verification, aucun message n'est parti.

## Iteration 4 : 10 septembre 2026

Tache 14 : champs de relance dans l'editeur de tache, formulaire de projet, et correction
d'une course dans le tiroir de resolution de contact introduit par la tache 13. Le cahier des
charges (`.superpowers/sdd/task-14-brief.md`) numerotait cette section « Iteration 2 » ; le
numero suivant reel est repris ici, l'iteration 2 (revue finale) et l'iteration 3 (tache 13)
existant deja dans ce journal a la date de redaction du cahier des charges.

- **Champs de relance dans l'editeur de tache** (`web/index.html`, `editorHtml`) :
  `derniere_relance` et `prochaine_relance` sont desormais deux champs de date de l'editeur en
  place, transmis par `applyOps` comme les autres champs. Une rangee dediee n'apparait que
  pour une tache deleguee (`responsable` different de `moi`) ; elle est masquee ou montree par
  un ecouteur `change` delegue sur le responsable, sans jamais reconstruire le formulaire. Un
  bouton « Dans une semaine » pose la prochaine relance a sept jours de `etat.today` (la date
  du serveur, jamais celle du navigateur), via une fonction `addDays` cote client qui reprend
  exactement l'implementation de `store.addDays`.
- **Formulaire de projet** (`web/index.html`) : un tiroir de creation, ouvert par le bouton
  « Nouveau projet » du portefeuille, et un tiroir de modification, ouvert par un nouveau
  bouton « Modifier le projet » sur une ligne de projet depliee, prerempli, avec l'identifiant
  fixe. Champs : titre, identifiant (calcule depuis le titre en creation, minuscules, sans
  accent, espaces en traits d'union, modifiable avant validation), domaine, echeance,
  prochaine action, reference de ticket visible uniquement pour le domaine `pro`. La
  suppression, disponible uniquement en modification, demande une confirmation explicite
  (`window.confirm`) rappelant le titre du projet et le nombre de taches qui seraient perdues.
  Les trois operations passent par `add_project`/`update_project`/`delete_project`, deja
  presentes et testees dans `server/store.js` depuis une tache anterieure : aucune route
  serveur nouvelle.
- **Correction d'une course dans le tiroir de resolution de contact** (`web/index.html`,
  constat de revue) : `chargerComptesDrawer` et `chercherContactsDrawer` ecrivaient leur
  resultat dans des elements dont l'identifiant est reutilise a chaque ouverture de tiroir,
  sans verifier que leur requete correspondait toujours au tiroir affiche. Fermer le tiroir
  pendant une recherche puis en rouvrir un autre pour une tache differente pouvait faire
  s'afficher, dans le second tiroir, la reponse tardive de la recherche lancee pour le
  premier : un clic sur un resultat aurait alors resolu le contact d'une tache pour une autre.
  Un jeton `resolveToken`, incremente a chaque ouverture et chaque fermeture de tiroir, est
  desormais compare avant chaque ecriture issue d'une reponse asynchrone, qui se jette si les
  deux jetons different. Reproduit et verifie en fabriquant deux reponses `fetch` concurrentes
  (une lente, une rapide) sur les deux fonctions : la reponse tardive n'atteint jamais le DOM
  du tiroir suivant.
- **Correctif connexe, trouve pendant la reprise de cette tache** : la rangee de relance de
  l'editeur de tache et la rangee Jira du tiroir de projet utilisaient toutes deux l'attribut
  HTML `hidden` seul pour se masquer, sur un conteneur portant une classe qui fixe
  `display:flex` (`.erow`, `.f`). Cette regle d'auteur l'emporte sur la regle `[hidden]` du
  navigateur (origine agent utilisateur, moins prioritaire), quelle que soit sa specificite :
  verifie dans le navigateur, `getComputedStyle` rendait `flex` malgre l'attribut, et la
  rangee occupait un espace de mise en page bien reel bien que censee etre invisible.
  Corrige en doublant l'attribut `hidden` d'un `style="display:none"` explicite (qui, lui,
  l'emporte), pose ou retire ensemble a chaque bascule ; aucune regle n'a ete ajoutee a la
  feuille de style.

Verifie a la main, projet de test cree puis supprime dans le vrai depot de donnees (projet et
taches d'origine, dont `estimmo`, non modifies en sortie de verification) : voir
`.superpowers/sdd/task-14-report.md` pour le deroule complet et les ecarts observes. Le bouton
d'envoi de relance n'a jamais ete sollicite pendant cette verification, aucun message n'est
parti.

## Iteration 5 : 15 septembre 2026

Tache 15 : deux voyants de sante dans l'en-tete du dashboard, et un raccourci de demarrage sur
le Bureau. Les deux dependances externes du systeme (Beeper Desktop, binaire `claude`
authentifie) sont deja tombees en panne sans que rien ne le signale ; cette tache comble ce
manque.

- **`server/sante.js`** (nouveau, TDD strict, 13 tests dans `test/sante.test.js`) :
  `etatBeeper(deps)` et `etatClaude(deps)` renvoient toujours `{ok, etat, detail}`, jamais une
  exception, et sont entierement injectables (`deps.comptes`, `deps.resoudreBinaireClaude`,
  `deps.executerAuthStatus`) pour que les tests ne touchent jamais ni au vrai Beeper ni au vrai
  binaire `claude`. `etatBeeper` s'appuie sur `beeper.comptes` et distingue `arrete` (Beeper
  injoignable), `jeton` (authentification refusee) et `erreur` (toute autre cause). `etatClaude`
  fait un controle gratuit et instantane : resolution du binaire (`resoudreBinaireClaude`, deja
  utilise par la dictee) puis lecture de `claude auth status` (JSON), distinguant `deconnecte`
  (avec la commande exacte a lancer), `binaire_absent` et `erreur`. Une troisieme fonction,
  `testerClaude(ctx)`, fait le vrai aller-retour (non couverte par TDD : lancer un vrai
  processus `claude` dans un test unitaire est lent et depend de l'etat d'authentification du
  poste ; verifiee a la main) : elle reprend obligatoirement le motif d'`agent/run-weekly.js`
  (`spawn`, tableau d'arguments fixe, prompt transmis par l'entree standard), jamais le prompt
  en argument positionnel, `--tools` et `--allowed-tools` etant variadiques (c'est exactement
  le bug qui avait casse la dictee). Bornee a 120 secondes.
- **`server/api.js`** : trois routes, toutes des controles sans effet de bord (aucune
  n'ecrit ni n'envoie). `GET /api/sante/beeper` et `GET /api/sante/claude` relaient les
  controles gratuits ; `POST /api/sante/claude/test` relaie le vrai aller-retour.
- **`web/index.html`** : deux pastilles cliquables dans l'en-tete, a droite, avec un point de
  couleur et un libelle court. Couleurs prises uniquement dans les jetons existants (`--ok`,
  `--crit`, `--warn` et leurs variantes douces), composees avec la classe `.pill` deja definie
  (badge existant) : aucune couleur nouvelle, aucun rayon de bordure (identite visuelle sans
  coin arrondi, deja respectee par `.toast .dot` et `.sevbar`). Beeper est verifiee au
  chargement puis toutes les dix minutes tant que l'onglet reste visible (arretee/relancee sur
  `visibilitychange`) ; un clic force une verification immediate. Claude n'est verifiee qu'une
  fois au chargement (controle gratuit) ; un clic lance le vrai aller-retour, la pastille passe
  en attente (desactivee) pendant l'appel. Le detail en francais reste toujours visible au
  survol (`title` et `aria-label`), y compris la commande a lancer quand c'est reparable :
  aucune pastille en echec ne reste muette sur la cause.
  - Correctif trouve en verifiant contre `test/web.charger.test.js` (seul endroit ou ce script
    tourne sous Node, dans un environnement factice sans navigateur reel) : le minuteur des dix
    minutes est desormais `unref()` (no-op en navigateur, mais indispensable sous Node : sans
    lui ce test ne se terminait jamais) ; le libelle de chaque pastille est transmis
    explicitement a `definirVoyant` plutot que relu depuis le DOM via `querySelector`, qui
    renvoyait `undefined` dans cet environnement factice et faisait echouer l'appel.
- **`demarrer.cmd`** (nouveau, racine du depot) : verifie si le port 5556 ecoute deja (une
  connexion TCP directe via PowerShell, plutot que `netstat | findstr LISTENING`, dont le texte
  d'etat peut etre localise sur un Windows en francais) ; si non, demarre
  `node server\server.js` dans sa propre fenetre, attend jusqu'a 30 secondes que le port
  reponde, puis ouvre `http://127.0.0.1:5556` dans le navigateur par defaut. Si le serveur ne
  repond jamais, affiche une erreur claire et garde sa fenetre ouverte (`pause`) pour que
  l'erreur reste lisible. Un raccourci Bureau nomme « Secretariat particulier », pointant sur ce
  fichier avec le dossier du depot comme repertoire de travail, a ete cree separement via
  PowerShell et `WScript.Shell`.

218/218 tests verts (205 existants + 13 nouveaux), aucune regression. Verifie a la main dans
son integralite (Beeper arrete puis relance, vrai aller-retour Claude, raccourci lance serveur
arrete puis relance sans doublon serveur quand il tourne deja) : voir
`.superpowers/sdd/task-15-report.md` pour le deroule complet, la methode exacte de chaque
verification et les ecarts observes. Aucun message n'est parti sur Beeper pendant cette tache.

## Iteration 6 : 15 septembre 2026

Tache 16 : transformation d'un outil personnel en outil installable par quelqu'un d'autre. Le
nom du proprietaire etait ecrit en dur dans les prompts, et les donnees reelles d'un utilisateur
etaient versionnees dans le depot : quelqu'un qui aurait clone ce depot aurait heritee d'un
secretaire croyant travailler pour une autre personne, avec les donnees de cette autre personne.

- **`server/config.js`** (nouveau, TDD strict) : `lireConfig(dataDir)` lit `proprietaire` et
  `filNoteASoiMeme` depuis `data/config.json`, avec des valeurs de repli explicites (`"l'utilisateur"`,
  chaine vide) quand le fichier manque ou est illisible ; ne leve jamais. `substituerProprietaire(gabarit, proprietaire)`
  remplace toutes les occurrences du marqueur `{{PROPRIETAIRE}}`, fonction pure, testee y compris
  contre le vrai gabarit `agent/weekly-recap.md` pour garantir qu'aucun marqueur ne subsiste.
- **`server/dictee.js`** : `construirePrompt` prend desormais le nom du proprietaire en
  parametre au lieu d'aller le chercher elle-meme (reste une fonction pure et testable) ;
  `dicter()` le resout via `server/config.js`. Le nom du proprietaire, jusque-la ecrit en dur, a
  disparu du code.
- **`agent/weekly-recap.md`** : les trois occurrences du prenom sont remplacees par le marqueur
  `{{PROPRIETAIRE}}`, substitue par **`agent/run-weekly.js`** juste avant l'envoi du prompt sur
  l'entree standard (jamais en argument positionnel, le bug deja corrige a la tache 15 sur
  `--tools`/`--allowed-tools` variadiques n'est pas reintroduit).
- **Separation code / donnees** : `data/` rejoint `.gitignore` et est retire du suivi Git avec
  `git rm --cached` (jamais `git rm` : les fichiers restent intacts sur le disque de
  l'installation existante). **`data.exemple/`** le remplace comme point de depart versionne
  (`config.json` a completer avec commentaire, `people.md` documente et vide, `projects/exemple.md`
  qui documente aussi le format). **`server/server.js`** amorce une installation neuve au
  demarrage : `data/projects/` est toujours cree s'il manque, et si `data/config.json` est
  absent, tout `data.exemple/` est recopie dans `data/`.
- **Tests et maquette** : les fixtures de `test/api.test.js`, `test/beeper.test.js`,
  `test/dictee.test.js`, `test/people.test.js` et les donnees de demonstration de
  `docs/maquette-nuit.html` remplacent un contact reel par un contact neutre et clairement
  fictif (Bruno Martin), sans changer ce que les tests verifient.
- **`outils/trouver-fil-notes.js`** (nouveau) : interroge `GET /v1/chats/search` sur l'API
  Beeper locale en lecture seule et affiche les conversations dont le titre evoque une note a
  soi-meme, avec leur identifiant pret a coller dans `data/config.json`. Ajoute comme script npm
  (`npm run trouver-fil-notes`).
- **`README.md`** reecrit en guide d'installation : ce que fait le systeme, prerequis (Node,
  Beeper Desktop, abonnement Claude), installation, les trois etapes de configuration, le
  lancement, le raccourci, la tache planifiee du mardi (chemin reconstruit depuis le repertoire
  courant, jamais en dur), et ce que le systeme ne fait pas.

Suite de tests passee de 218 a 232 (14 nouveaux : 6 pour `lireConfig`, 4 pour
`substituerProprietaire`, 1 sur `construirePrompt`, 3 sur l'amorcage d'une installation neuve
dans `test/server.test.js`), aucune regression. Verification manuelle d'une installation vierge
(depot copie dans un dossier temporaire, `data/` supprime, `npm install` puis lancement du
serveur) : voir `.superpowers/sdd/task-16-report.md` pour le deroule complet et les eventuels
ecarts observes. Aucune donnee reelle n'a ete supprimee du disque de l'installation existante,
et aucun message n'est parti sur Beeper pendant cette tache.

## Iteration 7 : 22 septembre 2026

Tache 19 : six interactions rapides du tableau de bord, pour que les modifications
quotidiennes les plus frequentes (reordonner, supprimer une tache, corriger un champ) ne
passent plus systematiquement par un formulaire complet.

- **`server/store.js`** : nouveau champ `ordre` (entier) sur les projets, avec sa valeur par
  defaut dans `PROJECT_DEFAULTS`. Deux nouvelles operations dans `applyOps`, seule porte
  d'ecriture du systeme : `reorder_projects` (`{ids}`) et `reorder_tasks` (`{projet, ordre}`),
  toutes deux refusees proprement (dans `rejected`, sans effet de bord) si la liste fournie
  n'est pas exactement une permutation des elements existants. Aucune des deux ne touche au
  numero `n` d'une tache ni a `dernier_n` : une reference designe toujours la meme tache.
- **`server/repo.js`** : `loadAll` et `loadAllSafe` trient desormais par `ordre` croissant puis
  par `id` a egalite, pour que les projets sans ordre explicite restent stables.
- **`web/index.html`**, interface :
  - une poignee (`⋮⋮`) a l'extreme gauche de chaque ligne de projet et de tache declenche seule
    le glisser-deposer natif du navigateur (aucune bibliotheque) ; au lacher, `reorder_projects`
    ou `reorder_tasks` est envoye via `applyOps` comme toute autre operation. Une tache ne peut
    etre deposee que dans son propre projet.
  - un bouton de suppression rapide sur chaque ligne de tache fait disparaitre la tache de
    l'ecran immediatement et arme un bandeau d'annulation independant pendant six secondes
    (plusieurs suppressions en rafale gardent chacune leur propre delai, empilees dans
    `#undoHost`) ; la requete `delete_task` n'est envoyee qu'a l'expiration du delai, jamais si
    l'utilisateur clique sur Annuler. Un projet garde sa confirmation existante (titre, nombre
    de taches perdues), desormais accessible aussi depuis un bouton rapide de la ligne.
  - edition en place : un clic sur le titre, le statut, la priorite, le responsable ou
    l'echeance d'une tache (et sur le titre, l'echeance ou la prochaine action d'un projet)
    transforme cette seule cellule en champ ou liste deroulante ; Entree ou perte de focus
    enregistre via `update_task`/`update_project`, Echap annule sans requete, un enregistrement
    qui ne change rien n'envoie rien non plus. Nature d'echeance et effort restent sans cellule
    dediee dans la maquette verrouillee : voir les reserves du rapport de tache.
  - un bouton rond (`✎`), a cote du bouton de suppression, est desormais seul a ouvrir
    l'editeur complet d'une tache ou le tiroir complet d'un projet ; un clic ailleurs sur la
    ligne ouvre l'edition en place ou deplie le projet, jamais plus l'editeur complet.
  - les boutons textuels « Ajouter une tache » et « Modifier le projet » ont disparu,
    remplaces par, respectivement, un bouton compact « + » sur la ligne de projet et le bouton
    rond ci-dessus.
  - la zone de dictee est un `textarea` qui s'agrandit en hauteur avec la saisie jusqu'a une
    hauteur maximale (au-dela, elle defile), jamais en largeur ; Entree envoie, Maj+Entree ajoute
    une ligne, la hauteur revient a l'origine apres envoi.

Suite de tests passee de 234 a 242 (7 nouveaux dans `test/store.ops.test.js` pour
`reorder_projects`/`reorder_tasks`, dont les refus sur identifiant inconnu, doublon et element
manquant, et 1 dans `test/repo.test.js` pour le tri par `ordre` puis `id`), aucune regression.
Verification manuelle steps 4 a 9 sur un projet de test cree puis supprime a la fin (aucun
projet reel touche) : voir `.superpowers/sdd/task-19-report.md` pour le deroule complet et les
ecarts observes.

## Iteration 20 : tableau de bord mobile, chiffre (GitHub Pages)

Nouvelle capacite optionnelle : publication, toutes les heures, d'un instantane en lecture
seule du tableau de bord sur un depot GitHub Pages public et dedie, pour consultation depuis
un telephone meme quand le PC est eteint.

- `server/export.js` : `construireInstantane(dataDir, today)` reassemble l'etat (projets,
  severite, signaux, taches ouvertes, Ma semaine, relances et relances bloquees) a partir des
  fonctions existantes de `store`, `repo` et `people`, sans dupliquer leur logique, et retire
  tout identifiant de contact (seul le nom d'une personne y figure) ainsi que la configuration
  (fil de notes, code d'acces). `chiffrer`/`dechiffrer` : PBKDF2-SHA256 (sel 16 octets, 600 000
  iterations) puis AES-256-GCM (IV 12 octets), module `crypto` natif uniquement.
- `web/mobile-gabarit.html` : page autonome, identite visuelle « Nuit » reprise a l'identique,
  qui demande le code, derive la cle avec WebCrypto (memes parametres que le serveur) et
  dechiffre le paquet embarque dans le navigateur. Le code n'est jamais stocke. Affiche d'abord
  Ma semaine et les relances, puis le portefeuille de projets depliable, avec l'heure de
  generation bien visible en tete.
- `outils/exporter-mobile.js` : lit `exportMobile` (`code`, `depot`) dans `data/config.json`
  (n'agit pas si absent), publie `index.html` dans un dossier de travail temporaire distinct du
  depot du code et de celui des donnees, avec un commit unique pousse en force (jamais
  d'accumulation horaire). Journalise chaque passage dans `data/history/export.log`, jamais le
  code. Ajoute comme script npm `exporter-mobile`.

Suite de tests passee de 242 a 248 (6 nouveaux dans `test/export.test.js` : absence de tout
identifiant de contact et de la configuration dans l'instantane serialise, aller-retour
chiffrer/dechiffrer, echec propre sur mauvais code, echec sur texte altere d'un octet,
non-repetition du sel/IV entre deux chiffrements, conformite des parametres PBKDF2/AES-GCM),
aucune regression. Voir `.superpowers/sdd/task-20-report.md` pour le deroule complet de la
publication et de la verification de bout en bout.

## Iteration 21 : le lanceur ne laisse plus de fenetre ouverte

Le serveur local tournait dans une fenetre reduite, qui restait dans la barre des taches tant
qu'il vivait. Il tourne desormais en fenetre cachee, lancee par `Start-Process -WindowStyle
Hidden` : une fois le dashboard ouvert dans le navigateur, plus aucune fenetre de commandes ne
subsiste.

Deux consequences de ce choix, traitees dans la meme iteration :

- sans fenetre, la sortie du serveur ne s'afficherait plus nulle part. Elle est redirigee vers
  `data/history/serveur.log` et `serveur.log.err`, et c'est ce journal que designe desormais le
  message d'erreur du lanceur, a la place de la fenetre disparue ;
- sans fenetre a fermer, il n'y avait plus aucun moyen d'arreter le serveur. `arreter.cmd`
  comble ce manque. Il retrouve le processus par le port 5556 qu'il ecoute, et jamais par son
  nom, pour ne pas risquer d'arreter un autre programme Node.

Les appels a `timeout` des deux scripts passent par `%SystemRoot%\System32\timeout.exe` : sous
un terminal dont le PATH contient un autre `timeout`, celui de Git par exemple, la boucle
d'attente du lanceur echouait instantanement et concluait a tort que le serveur ne demarrait pas.

## Iteration 22 : menus deroulants immediats, volume et priorite des projets

Deux ameliorations d'usage demandees apres plusieurs jours d'utilisation quotidienne.

**Les listes deroulantes s'ouvrent du premier coup.** Cliquer le statut, la priorite, le
responsable ou l'echeance d'une tache ouvrait bien l'edition en place, mais le champ etait
seulement focalise : il fallait un second clic pour deployer la liste ou le calendrier.
`focusInlineInput` appelle desormais `showPicker()` sur les `<select>` et les champs de date.
Cet appel n'est autorise par le navigateur que dans le prolongement direct du clic, ce qui est
le cas ici, et il est protege par un `try` : un navigateur qui ne connait pas `showPicker`
retombe sur l'ancien comportement plutot que de casser l'edition.

**Le volume et la priorite d'un projet se lisent ligne fermee.** Chaque ligne de projet porte
le nombre de taches associees et une pastille P1-P4.

Ce PX n'est pas une propriete du projet : c'est la plus haute priorite parmi ses taches. Il est
donc independant de l'ordre d'affichage, qui reste celui que l'utilisateur definit a la main :
un projet P1 peut parfaitement apparaitre apres un projet P2.

Les taches faites ou abandonnees sont exclues de ce calcul. Une tache P1 terminee ne dit plus
rien de ce qui reste a faire, et laisserait le projet affiche en P1 indefiniment. Si toutes les
taches sont closes, aucune pastille n'est affichee. Le nombre, lui, compte bien toutes les
taches associees, closes comprises.

## Iteration 23 : la prochaine action d'un projet se deduit de ses taches

La prochaine action etait une phrase libre a tenir a jour a la main, en double de taches qui
disaient deja la meme chose. Elle est desormais calculee : c'est la tache ouverte la plus
prioritaire du projet. A priorite egale, c'est la premiere de la liste, donc celle que
l'utilisateur a placee en tete par glisser-deposer : l'ordre de la liste est le seul departage,
et il lui appartient entierement.

`store.prochaineAction(project)` renvoie cette tache, ou `null` si le projet n'a aucune tache
ouverte. `GET /api/etat` et l'export mobile la calculent une seule fois et la publient sous
`prochaine_action_auto` (`{ref, titre, prio}`), pour que le tableau de bord, la page mobile et
l'agent hebdomadaire lisent tous la meme valeur au lieu de la recalculer chacun de son cote.

Dans le tableau de bord, la cellule affiche la reference de la tache puis son intitule, et
n'est plus editable : la valeur ne se saisit pas. Le champ texte `prochaine_action` du fichier
n'est pas supprime pour autant, il reprend la main sur un projet sans tache ouverte, seul cas
ou il reste editable. C'est la seule facon de dire ce qu'il faut faire sur un projet qui ne
porte pas encore de tache, et sept des treize projets sont dans ce cas.

Deux consequences traitees dans la meme iteration :

- le signal « sans prochaine action » ne peut plus se declencher sur un projet qui porte une
  tache ouverte, puisqu'il en a alors toujours une par construction. Il ne subsiste que pour un
  projet sans tache ouverte dont le champ texte est vide ;
- le prompt de dictee precise que ce champ ne se saisit plus : une demande de changement de
  prochaine action sur un projet qui a des taches doit agir sur les taches (priorite ou
  creation), jamais sur le champ.

## Iteration 24 : rapprochement avec la liste de taches WhatsApp

Le proprietaire tient depuis longtemps sa liste de taches dans la conversation WhatsApp avec
son propre numero : il y renvoie regulierement la meme liste a puces, amputee des lignes qu'il
a faites. Le secretariat lit desormais ce fil a chaque ouverture du tableau de bord et en tire
deux constats.

**Une ligne disparue d'un message au suivant est une tache faite.** Une premiere fenetre liste
ces taches, avec leur reference et leur projet. « OK » les retire du secretariat, « Retablir »
les garde.

**Une ligne de la liste qui ne correspond a aucune tache ouverte est une tache a creer.** Une
seconde fenetre les liste, chacune avec le projet devine par Claude (la note n'indique jamais
le projet) dans une liste deroulante modifiable, et un bouton `+`. Fermer la fenetre laisse de
cote les lignes restantes.

Trois decisions de conception meritent d'etre notees.

**Rien n'est retire avant le clic sur OK.** La fenetre annonce une suppression, mais l'ecriture
n'est envoyee qu'a la validation. Ce n'est pas de la prudence gratuite : les numeros de tache
ne sont jamais reattribues, donc une tache supprimee puis recreee reviendrait sous une autre
reference, `TO1` deviendrait `TO3`. Differer l'ecriture est le seul moyen pour que
« Retablir » rende exactement l'etat d'avant.

**Le message traite est memorise** dans `data/history/liste-whatsapp.json`. Sans cela, un
« Retablir » serait defait a l'ouverture suivante, qui reproposerait la meme suppression, et
les lignes volontairement laissees de cote reviendraient indefiniment.

**Le rapprochement ne decide jamais seul.** `server/lancement.js` est en lecture seule : il
constate et propose. Toute ecriture passe par `applyOps`, apres un geste explicite. Un
appariement douteux est refuse plutot que tranche : le rapprochement compare les libelles sans
accents ni casse ni ponctuation (coefficient de Dice sur les mots, seuil 0,72), ce qui accepte
« TOPI FAM - faire page presse - 21 sept » face a « TOPI FAM - faire page presse » mais refuse
« vendre BTC » face a « vendre actions » ; et si deux taches se disputent une ligne a moins de
0,05 d'ecart, aucune n'est retenue.

Le texte des lignes est traite comme une donnee, jamais comme une consigne : le prompt de
classement porte la meme clause anti-injection que l'agent hebdomadaire, une ligne redigee
comme un ordre restant un simple libelle de tache.

La conversation se configure par `filTachesWhatsApp` dans `data/config.json`. Absente, le
rapprochement est inactif et rien ne s'affiche.

## Iteration 25 : la fenetre d'ajout ne jetait pas ce qu'elle proposait

Correction d'un defaut trouve au premier vrai usage. La fenetre « Taches absentes du
secretariat » listait sept lignes a ajouter, et l'utilisateur ne les a pas retrouvees dans le
tableau de bord. Le depot de sauvegarde l'a confirme : aucune operation d'ajout n'avait jamais
atteint le serveur.

La cause n'etait pas un bug de code, le mecanisme fonctionnait. C'etait la fenetre elle-meme.
Le seul bouton mis en avant, en couleur d'accent, etait « Fermer », c'est-a-dire celui qui
abandonne tout. Les ajouts se faisaient par de petits boutons ronds de 22 pixels, un par ligne,
colles au bord droit, et rien ne disait qu'il fallait les cliquer un par un. Le geste naturel,
cliquer le gros bouton, jetait les sept lignes.

Trois changements :

- un bouton **« Tout ajouter (n) »** devient l'action mise en avant. Il envoie tous les ajouts
  prets en une seule operation, donc une seule ecriture et une seule sauvegarde ;
- le bouton d'abandon passe en bouton discret et dit ce qu'il fait : **« Fermer sans ajouter le
  reste »** ;
- le pied de fenetre affiche en permanence ce qui se joue : « 4 sur 7 pretes : les autres
  attendent que tu choisisses un projet ».

Second defaut trouve au passage, du meme ordre : **la fenetre mettait environ 45 secondes a
s'afficher**. Elle attendait deux appels au binaire `claude` l'un apres l'autre, le controle
d'ouverture puis le classement des lignes. Les deux partent desormais en parallele, et surtout
la fenetre s'affiche immediatement, avec la mention « Claude cherche le projet de chaque ligne,
tu peux deja choisir toi-meme ». Les listes deroulantes se remplissent a l'arrivee de la
reponse, sans jamais ecraser un choix deja fait a la main ni une ligne deja ajoutee.

Le comportement demande reste inchange : fermer la fenetre abandonne bien les lignes restantes.
Ce qui change, c'est que ce choix est desormais explicite au lieu d'etre le geste par defaut.

`test/web.ajouts.test.js` verrouille la lecon : le bouton qui abandonne ne doit jamais porter
la classe `primary`, le pied doit toujours annoncer combien de lignes attendent, et le premier
rendu doit preceder l'attente de Claude.

## Iteration 26 : hierarchie visuelle, echeances en delai, et « Ma semaine » etablie par Claude

Quatre changements demandes apres plusieurs semaines d'usage quotidien, tous sur la meme
question : ce qui compte ne se voyait pas assez.

**Le mode d'emploi de la dictee est retire.** Il occupait la hauteur d'un paragraphe a chaque
ouverture pour redire ce que le champ de saisie indique deja. Le journal des echanges ne prend
plus aucune place tant qu'aucun echange n'a eu lieu (`.log:empty{display:none}`).

**Les echeances se lisent en delai, plus en date.** « dans 6 j » dit tout de suite ce que
« 1 oct. » oblige a calculer. La regle est portee par `echeanceRelative` : « en retard de 3 j »,
« aujourd'hui », « demain », « dans N j » jusqu'a trente jours, puis la date au-dela, ou le
delai perdrait son sens (« dans 97 j » n'aide personne). La date exacte reste en infobulle, et
une echeance sous sept jours passe en couleur d'alerte, comme un retard.

**Les titres passent devant leurs metadonnees.** Titre de projet de 17 a 20 pixels, intitule de
tache de 14 a 15 avec une graisse moyenne, code de projet et domaine reduits et attenues. Les
objets du portefeuille se lisent, leur etiquetage s'efface.

**« Ma semaine » devient un classement, plus un inventaire.** Le panneau listait toutes les
taches a echeance sous quatorze jours, triees par date : il disait ce qui arrivait, jamais par
quoi commencer. Il porte desormais le **top 5 des projets** a faire avancer, etabli par Claude a
chaque ouverture, avec pour chacun une justification d'une ligne, l'echeance en delai, et la
**part du travail delegable a une IA** en pourcentage, affichee en jauge pour que les cinq
lignes se comparent d'un coup d'oeil. Un clic sur une ligne deplie le projet dans le
portefeuille.

Trois points de conception sur ce classement.

**Seuls les projets portant au moins une tache ouverte sont eligibles.** Demander au modele de
les eviter ne suffisait pas : sur un projet vide, il deduisait du titre un travail restant qui
n'existait nulle part et le presentait comme un fait. La regle est appliquee dans
`server/semaine.js`, pas plaidee dans le prompt.

**Le resultat est garde tant que le portefeuille ne bouge pas.** L'empreinte couvre les projets
eligibles, leurs taches ouvertes et la date du jour : un rechargement de page ne redepense pas
trente secondes d'appel, mais la moindre modification de tache fait recalculer.

**Deux demandes simultanees partagent un seul calcul.** Sans cela, un rechargement pendant le
calcul lancait un second binaire `claude` pour exactement le meme resultat.

Le panneau affiche son attente (« Claude etablit ta semaine... ») au lieu de rester vide, et le
reste du tableau de bord ne l'attend pas.

Au passage, `test/web.charger.test.js` n'evalue plus l'appel de demarrage du script : le simple
fait de charger le fichier lancait la sequence d'ouverture reelle, dont l'activite asynchrone
survivait a la fin du test.

## Iteration 27 : « Ma semaine » classe des taches, pas des projets

Correction de cadrage sur l'iteration precedente. Le panneau proposait le top 5 des projets a
faire avancer ; ce n'est pas ce qui sert le mardi matin. On attaque une tache, pas un projet.

Le classement porte desormais sur les taches ouvertes de tout le portefeuille. Chaque ligne
donne l'intitule de la tache, sa reference, sa priorite, son projet, la raison de son rang,
son echeance en delai, et la part de cette tache delegable a une IA.

Le changement de granularite rend le pourcentage nettement plus utile. Sur un projet, il
moyennait des travaux sans rapport entre eux. Sur une tache, il discrimine vraiment : « finir
le secretaire IA » ressort a 85 %, « couper le versement du loyer » ou « vendre BTC » a 15 %,
parce qu'aucune IA ne passera l'appel a la banque.

Deux points de mise en oeuvre.

**Les taches sont designees par leur reference** (`ES2`, `TO1`), unique dans tout le
portefeuille et jamais reattribuee : c'est la seule cle sure pour relire la reponse du modele.
Une reference absente de la liste soumise est ecartee, donc le panneau ne peut pas afficher une
tache inventee, ni une tache close.

**Le panneau relit toujours l'etat courant.** Le classement ne sert qu'a donner l'ordre et le
pourcentage : le titre, la priorite et l'echeance affiches viennent de la tache telle qu'elle
est aujourd'hui, et une tache supprimee depuis le dernier calcul disparait simplement de la
liste au lieu de faire tomber le panneau.

La justification ne repete plus la priorite, la reference ni le nom du projet, tous affiches a
cote d'elle : elle porte la raison, pas l'etiquette.

## Iteration 28 : deleguer une tache a Claude Code en un clic

Chaque ligne de « Ma semaine » porte un bouton **Deleguer**. Il ouvre une nouvelle session
Claude Code dans l'application de bureau, avec la demande deja ecrite : la tache, son projet, sa
reference, sa priorite, son echeance en delai, le blocage eventuel, le contexte du projet, et la
consigne de commencer par expliquer comment il compte s'y prendre.

Le bouton est mis en avant au-dela de 50 % de delegabilite, discret en dessous, jamais absent :
le pourcentage n'est qu'une estimation, c'est le proprietaire qui tranche.

**Deux schemas d'URL sont enregistres sur le poste, et ils ne font pas la meme chose.** La
premiere version de ce bouton utilisait `claude-cli://open`, gere par le binaire en ligne de
commande : il ouvre une fenetre de terminal. Ce n'est pas ce qui etait demande. Le bon schema
est `claude://`, celui de l'application de bureau, le meme que ses propres entrees de menu
(`claude://code/new?source=desktop_action`). Sa grammaire a ete relevee dans les ressources de
l'application :

```
claude://code/new?q=<demande>&folder=<dossier>&file=<fichier>
```

`q` porte la demande, `prompt` en est un alias, et l'application la tronque a 14336 caracteres ;
`folder` et `file` acceptent plusieurs valeurs. `test/web.delegation.test.js` verrouille le
schema autant que le reste : aucun navigateur ne signalerait la difference entre les deux, le
clic ouvrirait simplement la mauvaise chose.

Le contexte du projet est tronque avant tout le reste quand la demande approche la limite : la
tache et la consigne finale doivent survivre, pas le contexte.

Un champ **dossier de travail** est ajoute aux projets, facultatif. Renseigne, la session
s'ouvre directement dedans. Un chemin relatif ou reseau est ignore plutot que transmis : mieux
vaut ouvrir sans dossier qu'au mauvais endroit. Le secretariat ne lit et n'ecrit jamais rien a
cet endroit, ce champ ne sert qu'a construire le lien.

## Iteration 29 : la liste WhatsApp est tenue a jour dans l'autre sens

L'ingestion existait depuis l'iteration 24 : le secretariat lisait la liste manuscrite du fil a
soi-meme. Le sens retour est maintenant en place. Toutes les heures, s'il y a du nouveau, le
secretariat republie dans cette meme conversation la liste complete de ses taches ouvertes,
classees par priorite comme « Ma semaine », chacune en huit mots au plus, au format a puces
exact de la liste manuscrite.

Trois garanties structurent le module.

**La destination ne vient jamais du modele.** C'est `filTachesWhatsApp` de `data/config.json`,
le meme fil que celui qui est lu. Ni la route d'API ni la reponse de Claude ne peuvent faire
partir ce message ailleurs.

**La liste est toujours complete.** Une tache que le modele aurait oubliee dans son classement
est ajoutee a la fin, avec son intitule d'origine raccourci. Cette liste remplace celle que le
proprietaire garde sur son telephone : une tache oubliee serait une tache perdue. Si Claude est
injoignable, la liste part quand meme, dans l'ordre du portefeuille : un fil muet serait pire
qu'un classement imparfait.

**Rien ne part si rien n'a change.** La comparaison porte sur la suite des taches designees par
la derniere liste presente dans la conversation, jamais sur son texte, et le classement est mis
en cache sur l'empreinte du portefeuille. Sans ce cache, deux classements du meme portefeuille
differeraient legerement et chaque passage horaire enverrait un message pour rien.

### Le piege de la boucle, traite avant d'ecrire le module

Faire ecrire le secretariat dans la conversation qu'il lit cree un risque evident : ses propres
messages relus comme des modifications du proprietaire. Deux corrections l'ont ferme.

**La detection des taches faites porte desormais sur les taches, pas sur le texte des lignes**
(`liste.tachesDisparues`). Une tache n'est consideree comme faite que si une ligne de la liste
precedente la designait et qu'aucune ligne de la liste courante ne la designe plus. Avec une
comparaison textuelle, la premiere publication aurait fait disparaitre presque toutes les
lignes d'un coup, et propose de supprimer la quasi-totalite du portefeuille.

**Les libelles deja publies servent d'alias a l'appariement.** Ce defaut n'est pas apparu en
test mais au premier envoi reel : un libelle de huit mots partage trop peu de mots avec un
intitule long pour s'apparier a lui. Le secretariat ne reconnaissait donc pas son propre
message, republiait la liste a chaque heure, et la synchro entrante proposait de recreer six
taches qui existaient deja. Les libelles publies sont maintenant memorises par tache (quatre au
plus, les plus recents) et servent d'alias, ce qui rend la reconnaissance exacte.

Le tout tourne sous la tache planifiee `Secretariat - liste WhatsApp`, toutes les heures.
`npm run publier-liste` fait la meme chose a la demande, et `GET /api/liste-sortante` montre le
message sans rien envoyer.

## Iteration 30 : le lanceur redemarre le serveur quand le code a change

Panne silencieuse trouvee en usage reel. Le tableau de bord proposait d'ajouter sept taches
dont six existaient deja, alors que le correctif de l'iteration precedente etait sur le disque
depuis plusieurs minutes et que les tests passaient.

La cause n'etait pas dans le code : **Node charge ses modules une fois pour toutes au
demarrage**. Le serveur lance avant la correction continuait d'executer l'ancienne version, et
rien ne le signalait. Un processus neuf ne proposait qu'une seule tache, le serveur en cours
d'execution en proposait sept : c'est cette comparaison qui a tranche.

Le piege etait durable. `demarrer.cmd` reutilise deliberement un serveur qui repond deja, donc
relancer le raccourci apres une mise a jour ne changeait rien, et rien n'indiquait qu'il
fallait arreter puis relancer.

`GET /api/version` expose desormais l'instant de demarrage du processus. Le lanceur le compare
a la date de modification la plus recente parmi `server/**.js`, `web/**.js`, `outils/**.js` et
`web/*.html` : si le code est plus recent, il arrete le serveur par son port et en relance un.
En cas de doute (reponse illisible, date inexploitable), il ne redemarre pas : interrompre un
serveur qui fonctionne serait pire que de laisser l'utilisateur relancer lui-meme.

Trois situations verifiees a la main : serveur a jour, il est reutilise et garde son
identifiant de processus ; code modifie, il est arrete et relance sous un nouvel identifiant ;
port libre, demarrage normal.

Au passage, les trois attentes des scripts `.cmd` n'utilisent plus `timeout.exe`, qui refuse de
s'executer des que l'entree standard est redirigee, c'est-a-dire des que le script est lance
autrement que par un double-clic. Elles passent par `Start-Sleep`, dans le meme appel
PowerShell que l'action qui les precede quand il y en a un.

## Iteration 31 : republication immediate, et retrait du statut des taches

### La liste WhatsApp suit l'ecriture, plus l'horloge

La publication n'etait declenchee que par la tache horaire. Une tache supprimee a 13h31
n'atteignait le telephone qu'a 14h30 : la liste y etait fausse pendant une heure, sans que rien
ne l'indique. Toute ecriture appliquee programme desormais la republication, qui ne part
toujours que si la liste a reellement change.

Un court delai separe la derniere ecriture de la publication. Il n'est pas la pour temporiser
mais pour regrouper : reordonner cinq taches a la souris, ou corriger un intitule lettre par
lettre, produit une rafale d'ecritures, et chacune declencherait sinon son propre classement par
Claude et son propre message. Chaque nouvelle ecriture repousse l'echeance. La tache horaire
reste en place comme filet.

La republication automatique est conditionnee a un drapeau porte par le contexte du serveur :
les tests construisent le leur et n'envoient donc jamais rien.

### Une tache n'a plus de statut

Cet outil ne contient que du travail a faire. Un statut n'y avait donc que des valeurs sans
objet (`fait`, `abandonne` ne devraient jamais y rester) ou redondantes avec la priorite. Le
champ est retire partout : modele, validation, dictee, export mobile, page mobile, et la colonne
du tableau de bord.

Consequences traitees dans la meme iteration :

- `openTasks` ne filtre plus rien mais reste, et reste utilisee partout : elle nomme l'intention
  au lieu de la supposer, et c'est elle qu'il faudra changer si un etat autre que « presente »
  revenait un jour ;
- le signal « WIP eleve », qui comptait les taches `en_cours`, disparait ;
- `note_blocage` perd son effacement automatique, qui etait declenche par un changement de
  statut. Le champ reste, il decrit ce qui empeche d'avancer ;
- le prompt de dictee precise qu'une tache n'a pas de statut et que `delete_task` est la seule
  facon de la clore, pour que le modele ne cherche pas a en changer un qui n'existe plus ;
- les dix fichiers de projet ont ete reecrits pour en retirer le champ. Le diff ne contient que
  des suppressions de lignes `statut`, dix-sept au total, aucun ajout.

Un fichier ecrit avant ce retrait reste lisible : le champ est ignore au chargement et n'est
jamais recopie a l'ecriture.

## Iteration 32 : pas de publication pendant le delai d'annulation

Le bouton croix retire une tache de l'ecran immediatement, mais n'envoie la suppression qu'a
l'expiration du bandeau « Annuler », six secondes plus tard. Entre les deux, l'ecran et le
disque ne disent pas la meme chose.

Une suppression annulee n'ecrivait deja rien, donc ne publiait rien : ce cas etait couvert. Le
trou etait plus etroit. Une publication armee par une modification anterieure, quinze secondes
plus tot, pouvait tomber pendant ces six secondes et partir avec une tache que l'utilisateur
voyait deja disparue. Un message immediatement perime, corrige quelques secondes plus tard par
un second.

Le tableau de bord suspend donc la republication des qu'une suppression attend sa confirmation
(`POST /api/liste-sortante/differer`), et la leve des que la derniere est tranchee, confirmee ou
annulee. Une publication demandee pendant la suspension n'est pas perdue mais due : elle part a
la levee.

La suspension porte sa propre echeance de deux minutes. Un onglet ferme au mauvais moment ne
doit pas rendre la publication muette pour toujours, et la tache horaire, qui n'emprunte pas ce
chemin, reste un filet dans tous les cas.

## Iteration 33 : les taches planifiees n'ouvrent plus de fenetre

Signale par l'utilisateur : une console `node.exe` apparaissait sur son bureau plusieurs fois
par jour, depuis la mise en place du projet.

Les trois taches planifiees tournaient avec un type d'ouverture de session `Interactive`, donc
dans sa session, donc avec une console visible a chaque passage. Deux d'entre elles passent
toutes les heures.

La solution propre serait de les faire tourner hors session (type `S4U`), mais cela demande des
droits administrateur que l'installation n'exige nulle part ailleurs, et la tentative est
refusee sans elevation. Les trois taches passent donc par `outils/lancer-sans-fenetre.vbs` :
`wscript.exe` n'a pas de console, et `Run` avec un style de fenetre 0 n'en cree pas non plus
pour le processus fils.

Le lanceur attend la fin de la commande et rend son code de sortie. Sans cette attente, le
planificateur croirait la tache terminee des son lancement, perdrait son code de sortie, et son
delai maximal d'execution ne s'appliquerait plus.

Verifie en lancant les trois taches a la main : aucune fenetre, code de retour 0, et les
journaux `liste-sortante.log` et `export.log` recoivent bien leur ligne.

## Iteration 34 : une vraie icone pour le raccourci

Le raccourci du Bureau portait l'icone generique des fichiers `.cmd`, parce que son
`IconLocation` pointait sur `demarrer.cmd` lui-meme.

`outils/generer-icone.js` produit desormais `web/secretariat.ico`, sans aucune dependance : le
PNG et le conteneur ICO sont ecrits octet par octet et le dessin est purement geometrique. Le
depot n'a qu'une seule dependance, `js-yaml`, et une icone n'avait pas a en ajouter une seconde.

Le motif reprend le tableau de bord plutot que d'inventer un symbole : la barre verticale de
gravite qui borde chaque ligne de projet, et trois lignes de liste de longueurs decroissantes,
la plus haute a la couleur d'accent puisque c'est la prochaine action. Les couleurs sont celles
de l'identite « Nuit », reprises telles quelles.

L'icone porte sept tailles, de 16 a 256 pixels, chacune dessinee a sa taille plutot que reduite
depuis la plus grande. Le rendu a 16 pixels a ete verifie sur une planche agrandie au plus
proche voisin : c'est la seule facon de voir ce que Windows affichera vraiment dans la barre des
taches. Les extremites de la barre et des lignes sont arrondies, des bouts carres durcissaient
le motif des la taille 32.

`installer-raccourci.ps1` applique l'icone, en retombant sur l'ancien comportement si le fichier
manque. La meme icone sert de favicone au tableau de bord : l'onglet et le lanceur doivent se
reconnaitre au premier coup d'oeil.

## Iteration 34 : deleguer a n'importe quel contact Beeper

Signale par l'utilisateur : impossible d'assigner une tache a quelqu'un d'autre que lui-meme et
son frere, alors que les personnes a relancer sont ses partenaires, tous presents dans ses
contacts Beeper.

Le mecanisme d'ajout au repertoire existait pourtant, avec sa recherche de contacts et
`POST /api/personne`. Il n'etait atteignable que depuis une relance bloquee. Or une relance
bloquee suppose une tache deja assignee a une personne absente du repertoire, et la liste des
responsables ne proposait que les personnes du repertoire : **le cercle etait ferme**, et seules
les fiches ecrites a la main pouvaient en sortir.

La liste des responsables porte desormais une entree « + Ajouter un contact Beeper... »,
proposee y compris quand le repertoire est vide, precisement le cas ou elle est indispensable.
Elle ouvre la recherche de contacts, cree la fiche, ouvre la conversation, et assigne la tache
dans la foulee. Le tiroir sert donc deux origines : une relance bloquee, qui attend un
identifiant de fiche precis, et une assignation en cours, qui cree la fiche de toutes pieces.

L'identifiant de fiche derive du nom. Deux partenaires homonymes recoivent des identifiants
distincts : sans cela le second ecraserait la fiche du premier et ses relances partiraient dans
la mauvaise conversation.

Deux garde-fous, parce que cette entree est une action et non un responsable : choisir l'entree
remet la liste sur sa valeur precedente avant d'ouvrir le tiroir, et l'enregistrement de
l'editeur la refuse une seconde fois. Sans cela, annuler le tiroir laisserait la liste sur une
valeur qui serait ecrite telle quelle, et la tache serait assignee a une personne inexistante.

### Chaque contact n'apparait plus qu'une fois

Defaut trouve en cherchant sur de vrais contacts : Beeper renvoie la meme personne deux fois,
sous sa forme brute (`lid-2115660...`) et sous sa forme qualifiee
(`@whatsapp_lid-2115660...:beeper.local`). Verifie sur un contact deja resolu, les deux ouvrent
bien la meme conversation, mais afficher chaque partenaire en double rend le choix illisible.

La recherche deduplique donc sur l'identifiant debarrasse de son habillage, et garde la forme
qualifiee, celle que portent les fiches deja resolues. La deduplication ne porte jamais sur le
nom : deux homonymes sans numero de telephone sont deux personnes differentes.

Verifie de bout en bout sur une copie des donnees : recherche d'un contact WhatsApp reel,
creation de la fiche, assignation de la tache, et la relance quitte les bloquees pour les
validables avec un brouillon nominatif.

## Iteration 35 : les relances programmees se voient

Signale par l'utilisateur : une tache deleguee, datee, au contact resolu, n'apparaissait pas
dans « Relances a valider ».

Rien n'etait casse. Le panneau ne montrait que les relances **dues**, et celles-la etaient
programmees pour le 2 octobre, cinq jours plus tard. Mais rien ne le disait : on renseignait un
responsable et une date, et on obtenait le silence, sans pouvoir distinguer « programmee » de
« oubliee ». C'est ce silence qui etait le defaut, pas la regle.

Le panneau porte desormais les relances a venir sous les autres, en retrait, avec leur date et
le delai restant, et un bouton « Relancer maintenant » qui ouvre le meme brouillon avant
l'heure. Le compteur les annonce (« 2 programmees ») au lieu de dire « tout est parti ».

**Un contact non resolu est signale sans attendre la date.** Seule asymetrie assumee entre les
listes : resoudre un contact est une action a mener tout de suite, et la decouvrir le jour ou
l'on comptait envoyer serait trop tard. Sur les taches dont la relance est due, les listes
restent exactement complementaires.

### Trois defauts du brouillon, vus en ouvrant un vrai message

Le brouillon destine a un agent immobilier disait « Salut M. », « d'ici le 2026-10-05 » et
« cale il y a 0 jours ».

- le nom d'appel saute les titres de civilite : « M. BAREC agent Immo » donne « BAREC » ;
- la date s'ecrit en francais, « 5 oct. ». Un brouillon part au nom du proprietaire, une date
  au format machine dedans se remarque ;
- l'anciennete n'est mentionnee qu'au-dela de deux jours. « Cale il y a 0 jours » sur une tache
  creee le matin meme n'apprend rien et sonne faux.

Reste ouvert, parce que c'est une decision de ton et non un defaut : le brouillon tutoie tout
le monde. Cela convient a un frere, moins a un agent immobilier.

## Iteration 36 : le brouillon de relance est redige a partir du fil reel

Le gabarit ecrivait toujours la meme chose, tutoyait tout le monde, et reclamait un point
d'avancement sans jamais dire pourquoi l'interlocuteur y aurait interet. Adresse a un agent
immobilier avec qui le proprietaire se vouvoie, il etait a cote de la plaque, et c'est lui qui
en portait la signature.

Le brouillon est desormais redige par Claude a partir des **dix derniers messages** echanges
avec la personne. Trois exigences lui sont posees, dans cet ordre.

**Reprendre le registre du fil.** Vouvoiement ou tutoiement, formule d'ouverture, formule de
politesse, longueur des phrases : cela se lit dans la conversation, cela ne se decide pas dans
le code. Sans fil, on vouvoie.

**Jamais de ton condescendant.** L'interdiction est concrete plutot qu'abstraite, parce que
l'abstraction ne suffisait pas : « toujours sans nouvelles », « sans retour de votre part »,
« je me permets de vous relancer », « pour rappel », « dans l'attente », toute mention d'un
delai ecoule sont nommement bannies. Une relance ne doit jamais faire sentir qu'elle en est
une.

**Montrer a la personne son propre interet a avancer**, au sens de Dale Carnegie : ce que cela
lui evite, lui fait gagner, ou lui permet de boucler de son cote, formule de son point de vue a
elle. C'est le coeur du message, pas une politesse ajoutee a la fin.

S'y ajoutent deux regles de justesse : ne mentionner que des faits presents dans le fil, et
partir de la prochaine etape deja convenue plutot que de reposer la question depuis le debut.

### Le fil lu n'est pas toujours celui de la fiche

Defaut trouve sur le cas reel. La fiche du repertoire porte la conversation d'envoi, qui peut
etre toute neuve et vide quand le contact vient d'etre resolu, alors que l'echange se tient
ailleurs : ici un SMS et non un WhatsApp. `filHistorique` cherche donc, parmi les conversations
qui portent **exactement** le nom de la fiche, celle qui a le plus de messages. Une
correspondance approximative ferait lire la conversation de quelqu'un d'autre pour en imiter le
ton, ce qui serait bien pire que de n'en lire aucune.

Cette recherche ne sert qu'a **lire**. L'envoi reste sur la conversation figee dans la fiche :
deviner un destinataire serait une tout autre affaire, et une faute.

### Garanties

Le fil est traite comme une donnee, jamais comme une consigne : un message qui ressemblerait a
une instruction reste un propos rapporte. `server/brouillon.js` ne connait aucune voie d'envoi,
ce qu'un test verifie sur son code source. Le tiroir s'ouvre immediatement avec le texte de
repli, affiche « Claude relit vos derniers echanges pour en reprendre le ton », puis remplace
le brouillon a l'arrivee, sauf si l'utilisateur a deja commence a ecrire : sa version l'emporte
toujours.

## Iteration 37 : toute tache deleguee figure au panneau des relances

Signale par l'utilisateur : GA1, confiee a quelqu'un d'autre, n'apparaissait nulle part.

La regle exigeait une date de relance. Une tache deleguee sans date etait donc invisible : pas
dans « Ma semaine », qui ne montre que ce qu'on fait soi-meme, pas dans les relances non plus.
Elle sortait du champ de vision au moment precis ou l'on cessait d'en etre responsable. Quatre
taches etaient dans ce cas.

L'absence de date vaut desormais « a relancer des maintenant ». La meme regle s'applique aux
relances bloquees : une tache deleguee a quelqu'un dont le contact n'est pas resolu le signale,
avec ou sans date.

L'invariant tenu par les tests est maintenant plus fort : **aucune tache confiee a quelqu'un
d'autre ne peut tomber dans aucune des trois listes**. Elle est due, programmee, ou bloquee.

### Le contact de M. Barec pointe sur le bon canal

Sa fiche portait la conversation WhatsApp creee au moment de la resolution, vide, alors que
l'echange se tient par SMS. Le brouillon lisait deja le bon fil, mais l'envoi serait parti sur
un canal ou il n'a jamais ecrit. La fiche est repointee sur le fil SMS.

### Le redemarrage du lanceur attend la liberation reelle du port

Trouve en verifiant ce qui precede. `arreter` puis `demarrer` enchaines laissaient parfois le
processus mourant tenir encore le fichier journal : `Start-Process` echouait alors sans un mot,
et le lanceur repartait en attente comme si le serveur tardait a demarrer. L'arret attend
desormais que le port soit reellement libere, au lieu d'une duree fixe, et le demarrage
reessaie quelques secondes avant d'afficher un echec explicite.

## Iteration 38 : trois habillages au choix

Apres comparaison de vingt maquettes, deux directions sont retenues a cote de l'habillage
d'origine. Le tableau de bord bascule desormais entre les trois, par un selecteur dans le
bandeau.

- **Nuit**, l'habillage d'origine, inchange ;
- **Nuit serif**, memes couleurs, titrage en romaine (Newsreader) et graisses allegees ;
- **Jour**, le meme dessin sur fond ivoire.

Rien n'a bouge dans la structure : ce sont les memes panneaux, la meme grille, les memes
composants. Tout ce qui distingue un habillage tient en jetons CSS, et le theme s'applique
par un seul attribut sur `<html>`. Aucun composant ne connait le nom de l'habillage courant.

### Ce que l'exercice a demande

**Une seule couleur etait encore ecrite en dur**, celle du voile des tiroirs. Elle est devenue
un jeton. Un test verifie maintenant qu'aucune couleur ne subsiste hors des blocs d'habillage :
c'est le genre d'oubli qui passe inapercu en nuit et donne, en jour, du texte sombre sur fond
sombre a un endroit ou personne ne regarde.

**Les teintes d'alerte sont assombries en jour, pas seulement inversees.** Un jaune et un rouge
qui se lisent sur du charbon deviennent illisibles sur du papier. Les contrastes ont ete
mesures dans le navigateur plutot que supposes : le plus faible est a 4,56 pour un seuil de
4,5, et la plupart depassent 5.

**L'habillage est pose avant le premier rendu**, par un petit script dans le `<head>`.
Applique depuis le script principal, il serait arrive apres la premiere peinture et la page
aurait clignote en nuit avant de passer en jour.

**Un nom d'habillage inconnu retombe sur la nuit.** Un stockage bricole a la main ou herite
d'une version anterieure ne doit jamais laisser la page sans jetons. Lecture comme ecriture du
choix sont protegees : en navigation privee, l'habillage tient pour la session.

Le harnais de `test/web.charger.test.js` a gagne un `documentElement` : son faux document n'en
avait pas, et le script le lit desormais au chargement.

## Iteration 39 : un seul titrage, et toute la largeur de la fenetre

L'iteration precedente proposait trois habillages pour trancher entre deux titrages. Le
choix est fait : la romaine l'emporte, en nuit comme en jour.

### Ce que ca change

**`nuit-serif` disparait.** Sa typographie est devenue celle de tout le monde, donc
l'habillage n'avait plus rien a redefinir. Il ne reste que la nuit et le jour, qui ne
different plus que par la lumiere. Un choix `nuit-serif` encore en memoire retombe sur
`nuit` : la regle de repli existait deja, et comme la nuit porte desormais cette meme
romaine, la bascule ne se voit pas a l'ecran.

**Bricolage Grotesque n'est plus telechargee.** Plus rien ne s'en servait : la requete
aurait ete payee a chaque chargement pour une police jamais dessinee. Un test le verifie,
parce qu'une police abandonnee dans un lien ne se voit par definition nulle part.

**Le tableau de bord occupe presque toute la largeur.** La marge laterale suit la fenetre
(`clamp(28px, 3.4vw, 72px)`) au lieu d'une colonne figee a 1200 px qui laissait deux bandes
vides sur un ecran large et comprimait le portefeuille, qui est un tableau a sept colonnes.
Un plafond de 2000 px reste, pour les tres grands ecrans ou une ligne qui traverse tout
devient penible a lire.

**Tout respire d'un cran** : marges du bandeau, ecart entre les deux panneaux transverses,
hauteur des lignes de projet et de tache, colonnes de la grille des taches. Le gain de
largeur sans le gain d'air aurait seulement etale la meme densite.

Deux tests nouveaux tiennent ces deux points : le conteneur doit garder une marge laterale
relative et un plafond assez haut pour ne pas reproduire la colonne etroite, et le titrage
doit rester une romaine.

## Iteration 40 : les taches d'un projet se lisent par priorite

Un projet deplie montrait ses taches dans l'ordre du fichier. Sur un projet qui en porte
huit, comme « Autre », une P1 pouvait se trouver en sixieme position : il fallait parcourir
toute la liste pour savoir par quoi commencer, alors que c'est precisement la question que
le projet pose quand on le deplie.

### Ce que ca change

**Les taches sortent de la plus prioritaire a la moins prioritaire.** A priorite egale,
l'ordre du fichier departage, c'est-a-dire celui que le proprietaire a etabli par
glisser-deposer : le geste garde donc un sens, a l'interieur d'une priorite.

**Le classement vit a un seul endroit.** `openTasks` dans `server/store.js` le tient, et le
tableau de bord reprend la meme regle parce qu'il lit `p.taches` directement. L'export
mobile, la liste WhatsApp, le panneau « Ma semaine » et les relances passent tous par
`openTasks` et presentent donc la meme sequence. Un test compare les deux implementations
sur le meme jeu de taches : une divergence ne produirait aucune erreur, juste deux
classements differents pour les memes taches, ce qui ne se remarque pas.

**`prochaineAction` n'a plus son propre parcours.** Elle cherchait la tache la plus
prioritaire par une boucle ; c'est devenu `openTasks(project)[0]`. Deux classements qui
disaient la meme chose pouvaient se mettre a diverger, il n'en reste qu'un.

**Un glisser-deposer qui franchit une priorite change la priorite.** C'est le point qui
demandait une decision plutot qu'un tri. Deposer une tache parmi des P1 n'aurait rien pu
produire de visible, puisque le tri l'aurait aussitot ramenee dans son groupe : le geste
aurait paru ignore. Il est donc lu pour ce qu'il dit, la priorite suit la destination. Le
changement de priorite et le rangement partent dans le meme lot d'operations, pour qu'une
tache repriorisee ne se retrouve pas au mauvais rang de son nouveau groupe si la seconde
operation echouait.

**Une priorite absente ou hors liste passe en queue**, jamais en tete : une tache ecrite a
la main sans `prio` ne doit pas s'imposer devant les P1.
