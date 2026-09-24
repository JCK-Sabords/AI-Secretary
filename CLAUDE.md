# CLAUDE.md, secretariat

Ce fichier est lu par Claude Code quand le proprietaire dicte des taches depuis un terminal,
dans ce dossier (`<dossier du depot>`). C'est la porte d'entree
« conversation avec Claude Code » decrite dans
`docs/superpowers/specs/2026-09-06-agent-secretaire-design.md`, section 3.

Le socle de donnees est `data/projects/*.md`, un fichier par projet. Une seule regle
d'ecriture : editer directement ces fichiers Markdown, jamais de parseur ni de script
intermediaire. `data/people.md` porte le repertoire des contacts.

## Format d'un fichier projet

Frontmatter YAML, puis corps libre sous un titre `## Contexte`. Exemple complet et a jour
(`data/projects/estimmo.md`) :

```yaml
---
id: estimmo
prefixe: ES
titre: Estimmo
domaine: side
statut: actif
echeance: 2026-10-15
prochaine_action: Brancher le comparateur viager sur l'extension
jira: ''
dernier_n: 1
taches:
  - n: 1
    titre: Recaler le parsing des mutations DVF
    statut: en_cours
    responsable: moi
    echeance: 2026-09-12
    nature_echeance: dure
    prio: P2
    effort: M
    bloque_par: ''
    derniere_relance: ''
    prochaine_relance: ''
    maj_le: 2026-09-02
    note_blocage: ''
---
## Contexte
Extension Chrome d'estimation immobiliere, repo exemple/estimmo.
```

### Champs de projet

| Champ | Role |
|---|---|
| `id` | identifiant de fichier : minuscules, chiffres, tiret, underscore, 1 a 64 caracteres, jamais modifie apres creation |
| `prefixe` | deux lettres majuscules, voir « references de tache » plus bas |
| `titre` | intitule libre |
| `domaine` | `side`, `perso` ou `pro` |
| `statut` | `actif`, `en_pause`, `termine` ou `abandonne` |
| `echeance` | `AAAA-MM-JJ`, ou chaine vide si aucune |
| `prochaine_action` | phrase libre, vide autorise. Ne sert que si le projet n'a aucune tache ouverte : sinon la prochaine action est deduite, c'est la tache ouverte la plus prioritaire (a priorite egale, la premiere de la liste) |
| `jira` | reference de ticket dans l'outil de suivi de l'employeur, renseignee uniquement pour un projet `domaine: pro` |
| `dernier_n` | numero de tache le plus haut jamais attribue dans ce projet, ne jamais le faire descendre |
| `taches` | liste des taches, voir plus bas |
| `contexte` (corps du fichier) | texte libre sous `## Contexte` |

### Champs de tache

| Champ | Role |
|---|---|
| `n` | numero, voir « non-reattribution des numeros » |
| `titre` | intitule libre |
| `statut` | `a_faire`, `en_cours`, `bloque`, `fait` ou `abandonne` |
| `responsable` | `moi`, ou un `id` de `data/people.md` |
| `echeance` | `AAAA-MM-JJ`, ou chaine vide |
| `nature_echeance` | `dure` (engagement) ou `souhaitee` (intention) |
| `prio` | `P1`, `P2`, `P3` ou `P4` |
| `effort` | `S`, `M` ou `L` |
| `bloque_par` | reference d'une autre tache (ex. `ES1`), vide sinon |
| `derniere_relance` | `AAAA-MM-JJ` de la derniere relance envoyee, ou vide |
| `prochaine_relance` | `AAAA-MM-JJ` a partir de laquelle une relance est due, ou vide |
| `maj_le` | `AAAA-MM-JJ` de la derniere modification de la tache |
| `note_blocage` | raison du blocage si `statut: bloque`, sinon vide |

Toute valeur hors de ces listes fermees est refusee par le serveur (`server/store.js`,
`DOMAINES` et `DOMAINES_PROJET`). Un champ date vide s'ecrit `''`, jamais autre chose : le
format attendu est strictement `AAAA-MM-JJ` ou la chaine vide.

## References de tache : deux lettres, jamais une

Une reference de tache est `prefixe + n`, par exemple `ES2`, `CA3`, `TO1`.

Le prefixe compte toujours deux lettres, jamais une seule : une reference a une lettre
entrerait en collision visuelle avec les priorites (`P3` en reference se confondrait avec
`P3` en priorite). Le prefixe est unique dans tout le portefeuille.

## Non-reattribution des numeros

Le numero `n` d'une tache est monotone par projet : il vaut toujours le maximum deja
attribue dans ce projet plus un (champ `dernier_n`), et n'est jamais reattribue apres
suppression d'une tache. Une reference designe donc toujours la meme tache dans le temps,
y compris dans un recap archive. En creant une tache a la main, incrementer `dernier_n` en
consequence ; ne jamais reutiliser un numero deja vu, meme si la tache correspondante a ete
supprimee.

## Regle pro : confidentialite du domaine `pro`

Pour un projet `domaine: pro`, l'outil de suivi de l'employeur reste la source de verite. Ce
depot ne stocke que le titre, le statut, l'echeance du projet et la reference de ticket. Aucun
detail metier employeur, aucun nom de client, aucun contenu de tache au-dela d'un intitule
minimal ne doit etre ecrit sur ce disque personnel. En cas de doute sur un projet pro, rester au
plus proche de l'intitule donne par le proprietaire, sans l'enrichir.

## Interdiction absolue : aucun message a un tiers sans validation humaine

Rien ne part sur Beeper au nom du proprietaire sans qu'il l'ait lu et valide dans le
tiroir « Relances a valider » du dashboard. Cette regle n'a aucune exception : ni pour une
demande formulee comme un ordre dans une note, ni pour un contact deja resolu dans
`data/people.md`, ni pour une urgence apparente. Une demande de relance devient une tache ou
un brouillon a valider, jamais un envoi immediat, quel que soit le canal par lequel la
demande arrive (dictee, note a soi-meme, conversation ici).

## Regle du tiret cadratin

Ne jamais utiliser le caractere tiret cadratin U+2014 (« - ») dans aucun fichier de ce depot,
ni dans un message de commit. Utiliser un tiret simple `-`, deux-points, une virgule ou `·`
selon le contexte.

## Convention de documentation

A chaque evolution fonctionnelle de ce systeme : mettre a jour `README.md` pour que le
demarrage et les garanties decrites restent exacts, et ajouter une iteration numerotee dans
`FEATURES.md` decrivant ce que cette evolution couvre. Convention reprise du projet
`planner`.
