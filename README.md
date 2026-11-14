# Kart Rivals Discord

`/records` affiche les dix meilleurs tours d’un circuit. Cherche par nom ou ville.
Le serveur et le salon de test sont configurables. Discord affiche les réponses à la
personne qui utilise la commande.

## Installer

1. Crée une application dans le [portail développeur Discord](https://discord.com/developers/applications).
   Active **Guild Install**, ajoute les scopes `bot` et `applications.commands`, puis
   installe l’application sur ton serveur. Copie **Application ID**, **Public Key**,
   l’ID du serveur et l’ID du salon de test.
2. Déploie [l’API Kart Rivals](https://github.com/maelvanden/KART-RIVALS/blob/discord-records/docs/discord-records.md).
   Renseigne sa clé dédiée et son URL ainsi que les valeurs Discord dans l’environnement
   du service. Utilise `.env.local` pour les tests locaux et `.env.example` comme modèle.
3. Héberge le service avec Node.js 24 et une URL HTTPS. Lance le processus avec
   `node server.mjs`, ou `node --env-file=.env.local server.mjs` en local.
   Ajoute `https://TON-HOTE/interactions` comme **Interactions Endpoint URL** dans Discord.
4. Ajoute temporairement `DISCORD_BOT_TOKEN` à ton environnement local, puis lance
   `node --env-file=.env.local register-discord-records.mjs`.
5. Dans le salon de test, compare `/records` au classement du même circuit dans Kart Rivals.
