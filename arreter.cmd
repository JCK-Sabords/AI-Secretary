@echo off
rem Arret du serveur local du Secretariat particulier.
rem
rem Ce script existe parce que demarrer.cmd lance desormais le serveur en
rem fenetre cachee : il n'y a plus de fenetre a fermer pour l'arreter. On
rem identifie donc le processus par le port qu'il ecoute, plutot que par son
rem nom, pour ne jamais risquer d'arreter un autre programme Node.

setlocal
set "PORT=5556"

rem L attente se fait dans le meme appel PowerShell que l arret : timeout.exe
rem refuse de s executer quand l entree standard est redirigee, ce qui arrive
rem des que ce script est lance autrement que par un double-clic.
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $c) { Write-Host 'Aucun serveur n ecoute sur le port %PORT%.'; exit 0 }; $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if (-not $p) { Write-Host 'Processus introuvable.'; exit 1 }; Stop-Process -Id $p.Id -Force; Start-Sleep -Seconds 2; Write-Host ('Serveur arrete (' + $p.ProcessName + ', PID ' + $p.Id + ').')"
exit /b 0
