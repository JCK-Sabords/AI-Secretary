# API Beeper Desktop : observations réelles

Relevé le 6 septembre 2026 sur Beeper 4.3.89, Windows, API locale sur
`http://127.0.0.1:23373`, `remote_access: false`, `mcp_enabled: true`.

Ce document fait foi contre toute supposition. Le plan supposait une surface `/v0`
avec `GET /v0/contacts/search` et `POST /v0/messages` : **les deux sont fausses**.

## Surface réelle

La spec OpenAPI 3.1 est servie sur `GET /v1/spec`, 68 routes, toutes préfixées `/v1`
sauf OAuth et un pont Matrix. Le serveur MCP reste sur `/v0/mcp`.

Authentification : `Authorization: Bearer <BEEPER_TOKEN>`.

## Routes utilisées par le secrétaire

### GET /v1/accounts

Réponse observée : un tableau, pas un objet enveloppe.

```json
[{"accountID":"whatsapp","loginID":"...","network":"WhatsApp",
  "bridge":{"id":"whatsapp","type":"whatsapp","provider":"cloud"},
  "user":{"id":"...","fullName":"...","isSelf":true},"status":"connected"}]
```

Comptes connectés sur ce poste : `matrix`, `facebookgo`, `gmessages`, `linkedin`,
`telegram`, `whatsapp`. `accountID` est la clé à utiliser partout ailleurs.

### GET /v1/accounts/{accountID}/contacts?query=...

Le paramètre `query` est **requis**. La recherche est donc toujours faite compte par
compte, il n'existe pas de recherche transverse dans les contacts.

Réponse observée sur `whatsapp` avec `query=Martin`, 6 résultats :

```json
{"items":[{"id":"336xxxxxxxx","phoneNumber":"+336xxxxxxxx","fullName":"Martin J-C"}]}
```

Trois champs seulement : `id`, `phoneNumber`, `fullName`.

**Conséquence structurante :** un contact n'est pas une conversation. Il n'y a ni
`chatID` ni `network` dans la réponse. Pour écrire à quelqu'un il faut, en plus,
obtenir un `chatID`.

### POST /v1/chats

Ouvre ou retrouve une conversation avec une personne.

Corps : `{accountID, type: "single", participantIDs: ["<id du contact>"]}`.
`messageText` et `title` sont facultatifs et inutiles ici.

Reponse, relevee dans le schema `CreateChatOutput` de la spec servie par Beeper : c'est un objet
Chat dont le champ canonique d'identifiant est **`id`**. Le champ `chatID` existe aussi mais il
est marque deprecie, decrit comme un alias de compatibilite pour les anciens clients, tout comme
le champ `status` valant `existing` ou `created`. Un client doit donc lire `id` en priorite et ne
retomber sur `chatID` que par prudence.

### GET /v1/chats/search

Recherche de conversations existantes par texte. Sert à retrouver le fil de note à
soi-même sans le créer.

### GET /v1/chats

Paramètres : `cursor`, `direction`, `limit`, `accountIDs`.
Réponse : `{items, hasMore, oldestCursor, newestCursor}`, conversations triées par
dernière activité décroissante.

### GET /v1/chats/{chatID}/messages

Paramètres : `cursor`, `direction` (`before` ou `after`).
Réponse : `{items, hasMore, oldestCursor, newestCursor}`, messages triés par date.

C'est cette route, avec `direction=after` et le curseur conservé dans
`data/history/.last-ingest`, qui alimente l'ingestion des notes à soi-même.

### POST /v1/chats/{chatID}/messages

Corps : `{text: "<chaîne>"}`. Le champ accepte du texte brut ou du Markdown, converti
en texte enrichi par Beeper. `replyToMessageID` et `attachment` sont facultatifs.

Réponse : `{chatID, pendingMessageID}`. L'envoi est donc **asynchrone** : la réponse
confirme la prise en compte, pas la remise sur le réseau.

Cette route n'a **pas** été appelée pendant l'observation : elle enverrait un vrai
message. Son schéma vient de la spec OpenAPI servie par Beeper, pas d'une supposition.

## Ce que cela change dans le plan

1. Toutes les routes passent de `/v0` à `/v1`.
2. `chercherContacts` prend un `accountID` en plus du nom.
3. Une fiche de personne doit porter `accountID` et `participantID`, et non plus un
   simple `chatId` supposé donné par la recherche.
4. La résolution d'un contact devient : chercher dans les comptes, choisir une
   personne, puis ouvrir la conversation pour obtenir son `chatID`, et seulement
   alors la mémoriser dans `data/people.md`.
5. L'ingestion des notes se fait par curseur Beeper, pas par horodatage.
