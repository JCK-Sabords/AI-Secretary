' Lance une commande sans ouvrir la moindre fenetre, et rend son code de sortie.
'
' Les taches planifiees du secretariat tournent dans la session de l'utilisateur
' et font donc apparaitre une console a chaque passage, plusieurs fois par jour.
' La facon propre de l'eviter serait de les faire tourner hors session (type
' d'ouverture S4U), mais cela demande des droits administrateur que l'installation
' n'exige nulle part ailleurs.
'
' wscript.exe, lui, n'a pas de console, et Run avec un style de fenetre 0 n'en
' cree pas non plus pour le processus fils. L'attente (troisieme argument a True)
' est volontaire : sans elle le planificateur croirait la tache terminee des son
' lancement, perdrait son code de sortie et son delai maximal d'execution ne
' s'appliquerait plus.
'
' Usage : wscript lancer-sans-fenetre.vbs <dossier de travail> <commande> [arguments...]

Option Explicit
Dim sh, i, commande, code

If WScript.Arguments.Count < 2 Then
  WScript.Quit 2
End If

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = WScript.Arguments(0)

commande = """" & WScript.Arguments(1) & """"
For i = 2 To WScript.Arguments.Count - 1
  commande = commande & " """ & WScript.Arguments(i) & """"
Next

code = sh.Run(commande, 0, True)
WScript.Quit code
