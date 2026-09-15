---
# Ceci est un projet d'exemple : il documente le format attendu par le systeme
# (voir aussi CLAUDE.md, section « Format d'un fichier projet ») et sert de
# portefeuille de depart a une installation neuve. Vous pouvez le modifier
# librement, ou le supprimer une fois vos propres projets crees.
id: exemple
prefixe: EX
titre: Projet d'exemple
domaine: side
statut: actif
echeance: ''
prochaine_action: Lire ce fichier puis creer votre premier vrai projet
jira: ''
dernier_n: 3
taches:
  - n: 1
    titre: Decouvrir le dashboard et ses trois portes d'entree
    statut: a_faire
    responsable: moi
    echeance: ''
    nature_echeance: souhaitee
    prio: P3
    effort: S
    bloque_par: ''
    derniere_relance: ''
    prochaine_relance: ''
    maj_le: ''
    note_blocage: ''
  - n: 2
    titre: Renseigner data/config.json (proprietaire, fil de notes)
    statut: a_faire
    responsable: moi
    echeance: ''
    nature_echeance: souhaitee
    prio: P2
    effort: S
    bloque_par: ''
    derniere_relance: ''
    prochaine_relance: ''
    maj_le: ''
    note_blocage: ''
  - n: 3
    titre: Creer un premier vrai projet et supprimer celui-ci
    statut: a_faire
    responsable: moi
    echeance: ''
    nature_echeance: souhaitee
    prio: P4
    effort: S
    bloque_par: ''
    derniere_relance: ''
    prochaine_relance: ''
    maj_le: ''
    note_blocage: ''
---
## Contexte
Projet livre avec le depot pour que le dashboard ne soit jamais vide au premier
lancement. Un fichier de projet est un fichier Markdown dans `data/projects/`,
avec un frontmatter YAML (voir les champs ci-dessus) et un corps libre sous un
titre `## Contexte`, comme celui-ci. Voir `CLAUDE.md` pour le detail de chaque
champ et les regles d'edition.
