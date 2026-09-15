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
