# Point d'entree de la tache planifiee du mardi 17h.
#
# Ce script ne fait plus que deleguer a Node. Le premier passage reel du
# 15 septembre 2026 a montre que PowerShell mutilait le prompt multiligne en le
# passant en argument de ligne de commande, et que son client HTTP omettait
# l'en-tete Content-Type exige par le garde-fou anti-CSRF du serveur local.
# Node fait les deux correctement, avec le meme mecanisme que server/dictee.js.
#
# Tout le deroule, la rotation du journal et l'envoi du recap vivent desormais
# dans agent/run-weekly.js.

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot

try {
  & node (Join-Path $PSScriptRoot "run-weekly.js")
} catch {
  # Dernier filet : si Node lui-meme est introuvable, Node ne peut pas journaliser
  # son propre echec. On l'ecrit ici, sans quoi le passage serait silencieux.
  $journal = Join-Path $racine "data\history\run.log"
  $dossier = Split-Path -Parent $journal
  if (-not (Test-Path $dossier)) { New-Item -ItemType Directory -Path $dossier -Force | Out-Null }
  "$(Get-Date -Format o) echec du lanceur : $_" | Add-Content -Encoding utf8 $journal
}
