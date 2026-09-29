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
if %errorlevel%==2 goto occupe
if %errorlevel%==0 goto dejaLa
goto lancer

rem Notre serveur repond deja. Reste a savoir s il execute bien le code present
rem sur le disque : Node charge ses modules une fois pour toutes au demarrage,
rem donc un serveur lance avant une modification continue d executer l ancienne
rem version sans que rien ne le signale. C est une panne silencieuse, et elle a
rem deja trompe l utilisateur : le tableau de bord proposait d ajouter des taches
rem qui existaient deja, alors que le correctif etait sur le disque depuis
rem plusieurs minutes.
:dejaLa
call :codeModifieDepuisDemarrage
if %errorlevel%==1 (
  echo Le code a change depuis le demarrage du serveur, redemarrage...
  call :arreterServeur
  goto lancer
)
echo Le serveur repond deja sur le port %PORT%.
goto ouvrir

:lancer

echo Demarrage du serveur local...
if not exist "%~dp0data\history" mkdir "%~dp0data\history" >nul 2>&1
rem La redirection echoue tant que le journal est tenu par un processus qui
rem vient d etre arrete : on reessaie quelques secondes plutot que d abandonner
rem sans rien dire, et l echec finit par s afficher au lieu de se deguiser en
rem serveur qui ne demarre pas.
powershell -NoProfile -Command "$ok = $false; for ($i = 0; $i -lt 10 -and -not $ok; $i++) { try { Start-Process -FilePath 'node' -ArgumentList 'server\server.js' -WorkingDirectory '%~dp0.' -WindowStyle Hidden -RedirectStandardOutput '%JOURNAL%' -RedirectStandardError '%JOURNAL%.err' -ErrorAction Stop; $ok = $true } catch { Start-Sleep -Milliseconds 500 } }; if (-not $ok) { Write-Host 'Le serveur n a pas pu etre lance : journal inaccessible.' }"

set /a tentatives=0
:attendre
rem Meme raison que dans :arreterServeur : timeout.exe refuse de s executer
rem quand l entree standard est redirigee.
powershell -NoProfile -Command "Start-Sleep -Seconds 1"
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

rem Sous-routine : vrai (errorlevel 1) si un fichier source est plus recent que
rem l instant de demarrage du serveur, que /api/version renvoie. En cas de doute
rem (reponse illisible, date inexploitable) on ne redemarre pas : interrompre un
rem serveur qui fonctionne serait pire que de laisser l utilisateur relancer.
:codeModifieDepuisDemarrage
powershell -NoProfile -Command "try { $v = Invoke-RestMethod -Uri 'http://127.0.0.1:%PORT%/api/version' -TimeoutSec 3; $d = [datetime]::Parse($v.demarreLe).ToUniversalTime(); $f = Get-ChildItem -Path 'server','web','outils' -Filter *.js -Recurse -ErrorAction SilentlyContinue; $f += Get-ChildItem -Path 'web' -Filter *.html -ErrorAction SilentlyContinue; $r = $f | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1; if ($r -and $r.LastWriteTimeUtc -gt $d) { exit 1 } else { exit 0 } } catch { exit 0 }"
exit /b %errorlevel%

rem Sous-routine : arrete le serveur qui ecoute sur le port, par le port et
rem jamais par le nom du processus, comme arreter.cmd.
:arreterServeur
rem L arret attend que le port soit reellement libere, et non une duree fixe.
rem Un delai arbitraire laissait parfois le processus mourant tenir encore le
rem port et surtout le fichier journal : le demarrage suivant redirigeait sa
rem sortie vers un fichier verrouille, Start-Process echouait sans un mot, et
rem le lanceur repartait en attente comme si rien ne s etait passe.
rem
rem L attente se fait dans le meme appel PowerShell : timeout.exe refuse de
rem s executer quand l entree standard est redirigee.
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $c) { exit 0 }; Stop-Process -Id $c.OwningProcess -Force; for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 300; if (-not (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue)) { break } }"
exit /b 0

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
