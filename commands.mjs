const circuit = { name: 'circuit', description: 'Tape le nom du circuit ou sa ville', type: 3, required: true, autocomplete: true };
const pilot = (name) => ({ name, description: 'Recherche un pseudo Kart Rivals (pas un compte Discord)', type: 3, required: true, autocomplete: true });
const page = { name: 'page', description: 'Page de résultats (10 par page)', type: 4, min_value: 1, max_value: 10000 };
const ownPilot = { ...pilot('pilote'), required: false };
export const commands = [
  { name: 'lier', description: 'Lier ton compte avec le code généré dans Kart Rivals', options: [{ name: 'code', description: 'Code privé depuis Modifier ma licence → Mon compte Discord', type: 3, required: true, min_length: 32, max_length: 80 }] },
  { name: 'delier', description: 'Dissocier ton compte Discord de Kart Rivals', options: [] },
  { name: 'tickets', description: 'Publier le panneau dans le salon d’assistance Kart Rivals', default_member_permissions: '8', options: [
    { name: 'staff', description: 'Rôle réservé au staff qui pourra lire et traiter les tickets', type: 8, required: true },
  ] },
  { name: 'fermer-ticket', description: 'Fermer le ticket actuel en conservant son historique', options: [] },
  { name: 'records', description: 'Les dix meilleurs tours validés sur un circuit', options: [circuit] },
  { name: 'profil', description: 'Statistiques et records personnels d’un pilote Kart Rivals', options: [ownPilot] },
  { name: 'classement', description: 'Le top 10 Elo des pilotes publics Kart Rivals', options: [] },
  { name: 'circuit', description: 'Informations et record d’un circuit de karting', options: [circuit] },
  { name: 'comparaison', description: 'Compare les meilleurs chronos de deux pilotes sur un circuit', options: [pilot('pilote1'), pilot('pilote2'), circuit] },
  { name: 'mesrecords', description: 'Tous les records personnels d’un pilote, page par page', options: [ownPilot, page] },
  { name: 'rival', description: 'Le prochain chrono à battre sur un circuit', options: [circuit, ownPilot] },
  { name: 'dernierschronos', description: 'Les dix derniers chronos validés des pilotes publics', options: [] },
  { name: 'circuits', description: 'Trouve les circuits d’une ville', options: [{ name: 'ville', description: 'Nom de la ville à rechercher', type: 3, required: true, min_length: 2, max_length: 80 }, page] },
  { name: 'aide', description: 'Découvre toutes les commandes Kart Rivals', options: [] },
].map((command) => ({ ...command, type: 1 }));

export async function registerCommands(env = process.env, send = fetch) {
  const { DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN } = env;
  if (![DISCORD_APPLICATION_ID, DISCORD_GUILD_ID].every((id) => /^\d{17,20}$/.test(id ?? '')) || !DISCORD_BOT_TOKEN) {
    throw new Error('Renseigne DISCORD_APPLICATION_ID, DISCORD_GUILD_ID et DISCORD_BOT_TOKEN.');
  }
  const url = 'https://discord.com/api/v10/applications/' + DISCORD_APPLICATION_ID +
    '/guilds/' + DISCORD_GUILD_ID + '/commands';
  // Upsert these commands individually; preserve any other commands already installed.
  for (const command of commands) {
    const response = await send(url, {
      method: 'POST',
      headers: { Authorization: 'Bot ' + DISCORD_BOT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Enregistrement /' + command.name + ' : Discord HTTP ' + response.status);
    console.log('Commande /' + command.name + ' enregistrée.');
  }
}
