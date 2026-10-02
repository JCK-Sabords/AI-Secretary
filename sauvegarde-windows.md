# Mission : mettre en place mes sauvegardes cloud (Windows)

Ce fichier est un brief à exécuter dans Claude Code, en local, sur mon PC Windows.
Il résume une conversation précédente. Objectif : répondre vite aux questions ouvertes en
vérifiant la vraie config de la machine, puis me proposer un plan et les scripts.

Fin de réponse attendue : une conclusion synthétique, de préférence sous forme de tableau clair.

## Contexte

- OS : Windows. Si la machine "meurt", tout ce qui n'existe qu'en local est perdu.
- Le code et les fichiers versionnés sont déjà sur GitHub (dépôts privés). Rien à faire là-dessus.
- Mes artefacts importants vivent surtout dans Google Drive et dans le dossier Téléchargements.

## Ce que je veux conserver

| # | Besoin | Emplacement Windows | Statut |
|---|---|---|---|
| 1 | Code et fichiers versionnés | dépôts git | Déjà fait via GitHub, ne rien faire |
| 2 | Config et mémoire Claude Code | `%USERPROFILE%\.claude` | À sauvegarder |
| 3 | Dossier Téléchargements entier | `%USERPROFILE%\Downloads` | À sauvegarder dans le cloud |
| 4 | Artefacts dans Google Drive | dossier Drive for desktop | À sauvegarder aussi (synchronisation n'est pas sauvegarde) |

Les besoins 2 et 3 peuvent être sauvegardés à des endroits séparés, cela ne me dérange pas.

## Critère de choix principal : le moins cher

Je cherche l'option la moins chère qui reste fiable (chiffrée, versionnée, hors du PC).

Éléments de réponse déjà identifiés (prix indicatifs, à revérifier sur les sites officiels avant de décider) :

| Option | Coût indicatif | Remarque |
|---|---|---|
| Dépôt GitHub privé pour la partie texte de `.claude` | Gratuit | Seulement CLAUDE.md, skills, agents, settings. Jamais `.credentials.json` ni les historiques de sessions s'ils contiennent des secrets |
| Backblaze B2 + restic | Environ 6 $/To/mois, 10 Go gratuits | Paiement à l'usage. `.claude` (quelques Mo) reste gratuit |
| Cloudflare R2 + restic | Environ 0,015 $/Go/mois, 10 Go gratuits, pas de frais de sortie | Intéressant pour un petit volume |
| Hetzner Storage Box (1 To) | Environ 4 €/mois forfaitaire | Le moins cher au To si Téléchargements est gros |
| Backblaze Personal Backup | Environ 8 $/mois, illimité | Le plus simple, mais pas le moins cher si le volume est faible |
| Google Drive (15 Go gratuits) en copie | Gratuit | Ce n'est pas indépendant du Drive déjà utilisé : à éviter comme seule copie des artefacts Drive |

Règle de décision à appliquer une fois les tailles mesurées :

- Total (Téléchargements + `.claude` + Drive) inférieur à environ 10 Go : B2 ou R2, gratuit.
- Entre 10 Go et quelques centaines de Go : B2 ou R2 à l'usage.
- Plusieurs centaines de Go à plusieurs To : Hetzner Storage Box forfaitaire.

## Étape 1 : vérifier la config de ce PC (lecture seule)

Lance ces vérifications et résume les résultats dans un tableau :

1. Taille de `%USERPROFILE%\Downloads` (en Go) et nombre de fichiers.
2. Taille de `%USERPROFILE%\.claude` (en Mo) et contenu de premier niveau (repérer `.credentials.json`, `projects`, `skills`, `agents`, `settings.json`, `CLAUDE.md`).
3. Mode de Google Drive for desktop : "Diffuser les fichiers" (streaming, contenu non présent sur le disque) ou "Mettre en miroir". Chemin du dossier Drive et taille locale.
4. Espace libre sur le disque et débit montant approximatif (la première sauvegarde peut être longue).
5. Outils déjà installés : `restic`, `rclone`, `git`, `winget`, et version de PowerShell.
6. Dépôts git locaux avec des commits non poussés ou des fichiers non versionnés importants (`.env`, bases locales). Lister, sans rien modifier.

Commandes de départ :

```powershell
"{0:N1} Go" -f ((Get-ChildItem $env:USERPROFILE\Downloads -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB)
"{0:N1} Mo" -f ((Get-ChildItem $env:USERPROFILE\.claude -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB)
Get-Command restic, rclone, git, winget -ErrorAction SilentlyContinue
```

## Étape 2 : me proposer un plan chiffré

À partir des mesures :

1. Appliquer la règle de décision ci-dessus et recommander UNE option, avec le coût mensuel estimé.
2. Proposer un dépôt de sauvegarde séparé par type de données : `.claude`, Téléchargements, Drive.
3. Pour Drive en mode streaming : prévoir une copie cloud à cloud (rclone de Drive vers le stockage choisi), car une sauvegarde du PC ne contiendrait pas les fichiers.
4. Rétention proposée (par exemple 7 quotidiennes, 4 hebdomadaires, 6 mensuelles) et son effet sur le coût.

## Étape 3 : préparer les scripts, sans rien exécuter sans mon accord

Livrer, dans un dossier dédié (par exemple `%USERPROFILE%\backup-scripts`) :

- Un script PowerShell d'installation (winget pour restic et rclone).
- Un script de sauvegarde par jeu de données, avec exclusions utiles (`.credentials.json` sorti de toute copie vers GitHub, caches, fichiers temporaires).
- La tâche planifiée Windows (Planificateur de tâches), quotidienne, avec journal des exécutions.
- Un script de test de restauration (restaurer un fichier témoin dans un dossier temporaire et comparer).
- Une note sur la gestion du mot de passe restic et des clés d'accès : les stocker dans un gestionnaire de mots de passe, jamais dans un dépôt git.

## Garde-fous

- Ne rien supprimer, ne rien déplacer, ne rien envoyer vers un service externe sans me demander confirmation.
- Ne pas créer de compte ni engager de dépense à ma place : me donner les étapes, j'ai la main.
- Ne jamais committer ni pousser de secrets (`.credentials.json`, clés API, mots de passe restic).
- Chiffrer toutes les sauvegardes avant envoi.
- Ne pas utiliser le caractère tiret cadratin dans les fichiers produits.

## Conclusion attendue (à me rendre à la fin)

Un tableau de ce type :

| Point | Résultat mesuré | Décision |
|---|---|---|
| Taille Téléchargements | ... | ... |
| Taille `.claude` | ... | ... |
| Mode Google Drive | ... | ... |
| Option la moins chère retenue | ... | Coût mensuel estimé |
| Scripts prêts | ... | Prochaine action pour moi |
