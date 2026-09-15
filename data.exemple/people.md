# Repertoire des personnes a qui des taches peuvent etre deleguees.
#
# Format : une liste YAML, une entree par personne. Exemple, commente ci-dessous
# (aucun identifiant reel, juste la forme attendue) :
#
# - id: alex
#   nom: Alex Dupont
#   accountID: whatsapp
#   reseau: whatsapp
#   participantID: '000000000'
#   chatId: '!identifiantDeConversation:beeper.local'
#   resolu_le: '2026-01-01'
#
# Role de chaque champ :
# - id : identifiant court, reutilise tel quel dans le champ responsable d'une
#   tache de data/projects/*.md.
# - nom : nom affiche dans le dashboard et dans les textes de relance proposes.
# - accountID : compte Beeper concerne (whatsapp, telegram, signal...), visible
#   via GET /api/comptes.
# - reseau : nom du reseau affiche dans le dashboard, souvent identique a accountID.
# - participantID : identifiant du contact aupres de Beeper, obtenu par une
#   recherche de contact (GET /api/contacts).
# - chatId : identifiant de la conversation individuelle avec ce contact. Ne
#   jamais le saisir a la main : il est resolu automatiquement par
#   POST /api/personne, depuis le dashboard (bouton « Resoudre le contact »).
# - resolu_le : date AAAA-MM-JJ a laquelle chatId a ete resolu.
#
# Ne rien ajouter ici a la main : passer par le dashboard, qui interroge Beeper
# pour resoudre chatId avant d'ecrire une fiche. Ce fichier commence vide.
[]
