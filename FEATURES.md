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
