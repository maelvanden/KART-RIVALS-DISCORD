# Kart Rivals Discord

`/records` affiche les dix meilleurs tours d’un circuit. Cherche par nom ou ville.
Le serveur et le salon de test sont configurables. Discord affiche les réponses à la
personne qui utilise la commande.

## Installer

1. Crée une application dans le [portail développeur Discord](https://discord.com/developers/applications).
   Active **Guild Install**, ajoute les scopes `bot` et `applications.commands`, puis
   installe l’application sur ton serveur. Copie **Application ID**, **Public Key**,
   l’ID du serveur et l’ID du salon de test.
2. Déploie [l’API Kart Rivals](https://github.com/maelvanden/KART-RIVALS/blob/main/docs/discord-records.md).
   Renseigne sa clé dédiée et son URL ainsi que les valeurs Discord dans l’environnement
   du service. Utilise `.env.local` pour les tests locaux et `.env.example` comme modèle.
3. Héberge le service avec Node.js 24 et une URL HTTPS. Lance le processus avec
   `node server.mjs`, ou `node --env-file=.env.local server.mjs` en local.
   Ajoute `https://TON-HOTE/interactions` comme **Interactions Endpoint URL** dans Discord.
4. Ajoute temporairement `DISCORD_BOT_TOKEN` à ton environnement local, puis lance
   `node --env-file=.env.local register-discord-records.mjs`.
5. Dans le salon de test, compare `/records` au classement du même circuit dans Kart Rivals.

## Commandes disponibles

| Commande | Paramètres | Résultat |
| --- | --- | --- |
| `/records` | circuit | Top 10 des chronos validés |
| `/profil` | pilote | Elo, bilan des matchs, jusqu’à 5 records personnels |
| `/classement` | aucun | Top 10 Elo des pilotes publics ayant joué un match |
| `/circuit` | circuit | Ville, adresse, longueur, site officiel et record |
| `/comparaison` | pilote1, pilote2, circuit | Meilleurs chronos sur le même circuit et écart |
| `/mesrecords` | pilote, page facultative | Tous les records personnels, 10 circuits par page |
| `/rival` | pilote, circuit | Prochain chrono strictement meilleur parmi les pilotes publics |
| `/dernierschronos` | aucun | 10 derniers chronos validés de pilotes publics, toutes sources |
| `/circuits` | ville, page facultative | Recherche partielle par ville, 10 circuits par page |
| `/aide` | aucun | Commandes et mode d’emploi |

Les pilotes se sélectionnent par leur **pseudo Kart Rivals**, avec autocomplétion.
Les profils non découvrables, bannis et de démonstration sont exclus de la recherche,
des fiches, du classement et de la comparaison. Les réponses restent privées et limitées
au serveur/salon de test configurés. Aucun chrono manquant n’est inventé.
Les records utilisent les mêmes sources validées que l’application ; la comparaison
ne garantit pas les mêmes conditions de roulage entre deux sessions.

## Mise à jour depuis un téléphone (FadeHost)

1. Déployer d’abord la nouvelle fonction Supabase `discord-data` (workflow du dépôt de l’application).
2. Dans les variables FadeHost, renseigner `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`
   et `DISCORD_BOT_TOKEN` (le jeton du bot depuis le portail Discord, jamais la clé publique).
   Conserver les autres variables existantes, notamment `DISCORD_TEST_CHANNEL_ID`.
3. Redéployer la dernière version de `main`. Si le token est présent, le serveur
   enregistre les dix commandes au démarrage. Les logs confirment chaque commande.
4. Tester dans le salon configuré. Conserver le token : il sert aussi à la connexion
   permanente nécessaire à l’accueil automatique des nouveaux membres.

L’ancien script `node register-discord-records.mjs` enregistre désormais les dix commandes.
Il met à jour chacune d’elles sans supprimer les autres commandes éventuelles du serveur.

`/mesrecords` et `/rival` demandent un pseudo Kart Rivals : aucun compte Discord
n’est automatiquement lié. `/rival` ignore les ex æquo et choisit un seul pilote
si plusieurs personnes détiennent le prochain temps à battre. Il ne se limite pas au top 10.
Les profils privés, bannis et de démonstration ne sont pas affichés dans les nouvelles commandes.
`/dernierschronos` trie par date de validation, pas par date de roulage.

Pour poursuivre une liste, relancer la même commande avec `page:2`, puis 3, etc.
Le pied de l’embed indique s’il reste une page. Les commandes gardent leurs réponses privées.

La migration `20261223000083_discord_commands.sql` doit être appliquée avant le
redéploiement du bot ; elle ajoute deux fonctions SQL accessibles uniquement au service backend.

## Accueil automatique des nouveaux membres

Le bot envoie un embed vert lime avec la mention et l’avatar du nouveau membre dans
le salon `1571089851330068500`. Seuls les nouveaux membres humains du serveur
`DISCORD_GUILD_ID` sont concernés : aucun message de bienvenue au démarrage ni pour
les membres déjà présents. Les salons règlement et général sont repérés par leur nom ;
s’ils sont introuvables, le texte reste utilisable sans lien inventé.

1. Discord Developer Portal → application → **Bot → Privileged Gateway Intents** :
   activer **Server Members Intent**, puis enregistrer. Message Content Intent et
   Presence Intent ne sont pas nécessaires.
2. Conserver `DISCORD_BOT_TOKEN` et `DISCORD_GUILD_ID` dans FadeHost. Le jeton est
   désormais nécessaire en permanence pour recevoir les arrivées, pas seulement pour
   enregistrer les commandes. `DISCORD_WELCOME_CHANNEL_ID` permet de changer le salon
   (facultatif : l’identifiant ci-dessus est utilisé par défaut).
3. Dans le salon, autoriser le bot à **Voir le salon**, **Envoyer des messages** et
   **Intégrer des liens**.
4. **Save & redeploy** installe les dépendances puis démarre l’écoute Gateway. Le log
   `Accueil automatique connecté` confirme la connexion. Les commandes continuent de
   passer par le point de terminaison HTTP existant ; ne pas le supprimer.
5. Tester avec l’arrivée d’un nouveau membre. Les messages sont publics dans le salon
   d’accueil et seule la personne accueillie est mentionnée. Les doublons d’un même
   événement sont filtrés et les reprises utilisent un nonce Discord stable.

Le SDK Discord gère les heartbeats, les limites REST et la reconnexion. Une arrivée
pendant une coupure non récupérable n’est pas rejouée à partir de la liste des membres.
Ne pas retirer le jeton si l’accueil automatique doit rester actif.

### Bannière personnalisée

Chaque arrivée produit une image PNG 1200×440 intégrée à l’embed : fond noir,
accent jaune fluo, logo Kart Rivals original, avatar rond et pseudo du membre.
Les images sont calculées localement avec `@napi-rs/canvas` ; aucune API d’image ni
clé supplémentaire n’est nécessaire. Le logo et la police sont embarqués dans `assets/`.
La police DejaVu Sans Bold est distribuée avec sa licence (sous-ensemble Latin/grec/cyrillique).

Autoriser aussi **Joindre des fichiers** dans le salon d’accueil. Les anciens messages
ne sont pas modifiés ; la bannière est utilisée pour les prochaines arrivées après
redéploiement. Le téléchargement de l’avatar est limité au CDN Discord, 4 secondes
et 2 Mo. En cas d’échec, une silhouette neutre est affichée ; si la génération échoue,
le bot envoie l’embed d’origine avec son avatar miniature.

`previews/bienvenue-kart-rivals.png` est un exemple avec silhouette de démonstration.
Le vrai avatar est téléchargé au moment où le membre rejoint le serveur.
