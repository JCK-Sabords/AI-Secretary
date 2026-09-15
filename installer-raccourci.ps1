# Installe (ou reinstalle) le raccourci Bureau "Secretariat particulier".
#
# Le raccourci cree par la tache 15 avait ete pose a la main (commande
# PowerShell lancee directement, jamais rejouable telle quelle) : si le
# raccourci est supprime, ou si ce depot est deplace, rien ne permettait de
# le recreer sans redecouvrir cette commande. Ce script la remplace par une
# version reproductible et deplacable : il se base uniquement sur son propre
# emplacement ($PSScriptRoot), jamais sur un chemin ecrit en dur, pour
# retrouver la racine du depot ou qu'elle se trouve sur ce poste.
#
# Usage : depuis ce dossier (ou n'importe ou), en PowerShell :
#   powershell -ExecutionPolicy Bypass -File installer-raccourci.ps1
#
# Idempotent : relance sans risque, recree le raccourci a l'identique s'il
# existe deja.

$ErrorActionPreference = 'Stop'

# Racine du depot : le dossier qui contient ce script lui-meme, jamais un
# chemin fixe. Fonctionne donc encore si le depot entier est deplace ou
# clone ailleurs.
$racineDepot = $PSScriptRoot
$cible = Join-Path $racineDepot 'demarrer.cmd'

if (-not (Test-Path $cible)) {
    Write-Error "Fichier introuvable : $cible (demarrer.cmd doit se trouver a la racine du depot, a cote de ce script)."
    exit 1
}

$bureau = [Environment]::GetFolderPath('Desktop')
$raccourci = Join-Path $bureau 'Secretariat particulier.lnk'

$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($raccourci)
$lnk.TargetPath = $cible
$lnk.WorkingDirectory = $racineDepot
$lnk.IconLocation = $cible
$lnk.Description = 'Secretariat particulier : demarre le serveur local et ouvre le tableau de bord.'
$lnk.Save()

if (-not (Test-Path $raccourci)) {
    Write-Error "Echec : le raccourci n'a pas ete cree ($raccourci)."
    exit 1
}

# Relecture pour confirmer que la cible et le repertoire de travail sont
# bien ceux attendus, jamais suppose sur la seule foi de Save().
$verif = $wsh.CreateShortcut($raccourci)
if ($verif.TargetPath -ne $cible -or $verif.WorkingDirectory -ne $racineDepot) {
    Write-Error "Raccourci cree mais incorrect. Cible lue : $($verif.TargetPath) ; repertoire lu : $($verif.WorkingDirectory)"
    exit 1
}

Write-Host "Raccourci installe : $raccourci"
Write-Host "  Cible             : $($verif.TargetPath)"
Write-Host "  Repertoire de travail : $($verif.WorkingDirectory)"
