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
4. Tester dans le salon configuré. Le token peut ensuite être retiré : il sert uniquement
   à enregistrer les commandes. Sans token, les commandes déjà enregistrées continuent de fonctionner.

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
