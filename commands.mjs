const circuit = { name: 'circuit', description: 'Tape le nom du circuit ou sa ville', type: 3, required: true, autocomplete: true };
const pilot = (name) => ({ name, description: 'Recherche un pseudo Kart Rivals (pas un compte Discord)', type: 3, required: true, autocomplete: true });
export const commands = [
  { name: 'records', description: 'Les dix meilleurs tours validés sur un circuit', options: [circuit] },
  { name: 'profil', description: 'Statistiques et records personnels d’un pilote Kart Rivals', options: [pilot('pilote')] },
  { name: 'classement', description: 'Le top 10 Elo des pilotes publics Kart Rivals', options: [] },
  { name: 'circuit', description: 'Informations et record d’un circuit de karting', options: [circuit] },
  { name: 'comparaison', description: 'Compare les meilleurs chronos de deux pilotes sur un circuit', options: [pilot('pilote1'), pilot('pilote2'), circuit] },
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
