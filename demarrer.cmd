@echo off
rem Raccourci de demarrage du Secretariat particulier.
rem
rem 1. Verifie l'etat du port 5556 (sous-routine verifierEtat plus bas), qui
rem    distingue trois cas :
rem    - rien n'ecoute sur ce port : demarre le serveur normalement ;
rem    - notre serveur y repond deja : ouvre simplement le navigateur ;
rem    - un autre programme occupe ce port : n'ouvre rien, avertit et garde
rem      la fenetre ouverte pour que l'avertissement reste lisible.
rem 2. Si le serveur doit demarrer, attend qu'il reponde, avec un delai
rem    maximal de 30 secondes.
rem 3. Ouvre http://127.0.0.1:5556 dans le navigateur par defaut, puis cette
rem    fenetre se ferme.
rem 4. Si le serveur ne repond jamais, affiche une erreur claire et garde
rem    cette fenetre ouverte (pause) pour que l'erreur reste lisible.
rem
rem Le serveur tourne en fenetre CACHEE. Il tournait auparavant dans une
rem fenetre reduite, qui restait dans la barre des taches tant que le serveur
rem vivait : l'utilisateur voulait qu'aucune fenetre de commandes ne subsiste
rem une fois le navigateur ouvert. Consequence directe de ce choix : sans
rem fenetre, la sortie du serveur ne s'afficherait plus nulle part, donc elle
rem est redirigee vers data\history\serveur.log, et c'est ce journal que le
rem message d'erreur designe. Pour arreter le serveur, utiliser arreter.cmd.
rem
rem Le controle du port ne se contente pas d'une simple connexion TCP
rem reussie : une connexion TCP reussie prouve seulement que quelque chose
rem ecoute sur ce port, pas que c'est NOTRE serveur qui repond. N'importe
rem quel autre programme occupant le port 5556 accepterait la meme connexion,
rem et le script ouvrirait alors le navigateur sur ce programme sans jamais
rem avertir. La sous-routine interroge donc en plus http://127.0.0.1:5556/api/etat
rem et verifie la presence de la cle "today" dans le JSON renvoye : seule
rem preuve que c'est bien le Secretariat particulier qui repond.

setlocal
cd /d "%~dp0"

set "PORT=5556"
set "URL=http://127.0.0.1:%PORT%"
set "TITRE=Secretariat particulier"
set "JOURNAL=%~dp0data\history\serveur.log"

call :verifierEtat
if %errorlevel%==0 (
  echo Le serveur repond deja sur le port %PORT%.
  goto ouvrir
)
if %errorlevel%==2 goto occupe

echo Demarrage du serveur local...
if not exist "%~dp0data\history" mkdir "%~dp0data\history" >nul 2>&1
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'server\server.js' -WorkingDirectory '%~dp0.' -WindowStyle Hidden -RedirectStandardOutput '%JOURNAL%' -RedirectStandardError '%JOURNAL%.err'"

set /a tentatives=0
:attendre
"%SystemRoot%\System32\timeout.exe" /t 1 /nobreak >nul
call :verifierEtat
if %errorlevel%==0 goto ouvrir
if %errorlevel%==2 goto occupe
set /a tentatives+=1
if %tentatives% GEQ 30 goto echec
goto attendre

:ouvrir
start "" "%URL%"
exit /b 0

:occupe
echo.
echo ATTENTION : le port %PORT% est deja occupe par un autre programme.
echo Ce n'est pas le Secretariat particulier qui y repond : le navigateur ne
echo sera pas ouvert, pour ne pas afficher la page d'un autre programme.
echo Liberez le port %PORT% (fermez ou reconfigurez ce programme), puis
echo relancez ce script.
echo.
pause
exit /b 1

:echec
echo.
echo ERREUR : le serveur ne repond pas sur %URL% apres 30 secondes d'attente.
echo Verifiez :
echo  - le journal du serveur : data\history\serveur.log et serveur.log.err ;
echo  - que Node.js est bien installe (commande "node -v" dans un terminal) ;
echo  - que le port %PORT% n'est pas deja occupe par un autre programme.
echo.
pause
exit /b 1

rem Sous-routine : interroge http://127.0.0.1:%PORT%/api/etat et distingue
rem trois cas via errorlevel :
rem   0 = notre serveur repond (JSON contenant la cle "today") ;
rem   1 = rien n'ecoute sur ce port ;
rem   2 = quelque chose ecoute mais ne renvoie pas la reponse attendue
rem       (un autre programme occupe le port).
rem La connexion TCP est verifiee d'abord (rapide, evite d'attendre le delai
rem HTTP quand le port est simplement libre) ; c'est seulement si quelque
rem chose y ecoute que la requete HTTP tranche entre notre serveur et un
rem autre programme. Le caractere guillemet est construit via [char]34
rem plutot qu'ecrit directement, pour eviter tout probleme d'echappement de
rem guillemets entre cmd.exe et PowerShell.
:verifierEtat
powershell -NoProfile -Command "$q=[char]34; try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', %PORT%); $c.Close() } catch { exit 1 }; try { $r = Invoke-WebRequest -Uri ('http://127.0.0.1:%PORT%/api/etat') -UseBasicParsing -TimeoutSec 3; if ($r.Content -match ($q+'today'+$q)) { exit 0 } else { exit 2 } } catch { exit 2 }"
exit /b %errorlevel%
