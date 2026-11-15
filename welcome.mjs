import { renderWelcomeBanner } from './welcome-banner.mjs';
import { createHash } from 'node:crypto';
import { Client, Events, GatewayIntentBits, Routes } from 'discord.js';

export const DEFAULT_WELCOME_CHANNEL_ID = '1571089851330068500';
const snowflake = /^\d{17,20}$/;

export function welcomePayload(member) {
  const channels = [...member.guild.channels.cache.values()];
  const findChannel = (word) => channels.find((channel) => channel.isTextBased() &&
    channel.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(word));
  const rules = findChannel('reglement');
  const general = findChannel('general');
  const mention = '<@' + member.id + '>';
  const steps = [
    '📜 ' + (rules ? 'Lis le règlement dans <#' + rules.id + '>.' : 'Prends connaissance du règlement du serveur.'),
    '👋 ' + (general ? 'Présente-toi dans <#' + general.id + '> : prénom, région et circuit préféré.' : 'Présente-toi à la communauté : prénom, région et circuit préféré.'),
    '⏱️ Partage tes sessions, compare tes chronos et trouve tes prochains rivaux !',
  ];
  return {
    content: mention + ', bienvenue sur la grille ! 🏎️',
    allowed_mentions: { parse: [], users: [member.id] },
    // Discord deduplicates retries of this same join; rejoining later gets a new nonce.
    nonce: createHash('sha256').update(member.guild.id + ':' + member.id + ':' + member.joinedTimestamp).digest('hex').slice(0, 24),
    enforce_nonce: true,
    embeds: [{
      color: 0xdfff00,
      author: { name: 'KART RIVALS • NOUVEAU PILOTE' },
      title: '🏁 Bienvenue dans le paddock !',
      description: mention + ', tu rejoins **Kart Rivals**, la communauté des passionnés de karting.\n\nDébutant ou habitué des podiums, **tu as ta place sur la grille** !',
      thumbnail: { url: member.user.displayAvatarURL({ size: 256, extension: 'png' }) },
      fields: [
        { name: '🚦 Avant de prendre la piste', value: steps.join('\n\n') },
        { name: '🔥 À toi de jouer', value: 'Le prochain chrono à battre, c’est peut-être le tien !' },
      ],
      footer: { text: 'Kart Rivals • La passion du karting nous rassemble' },
      timestamp: new Date().toISOString(),
    }],
  };
}

export function createWelcomeHandler({ guildId, channelId, send, renderBanner = renderWelcomeBanner, log = console }) {
  const seen = new Map();
  return async (member) => {
    if (member.guild.id !== guildId || member.user.bot || !snowflake.test(member.id)) return;
    const key = member.id + ':' + member.joinedTimestamp;
    const now = Date.now();
    for (const [id, time] of seen) if (now - time > 3_600_000) seen.delete(id);
    if (seen.has(key)) return;
    seen.set(key, now);
    if (seen.size > 10000) seen.delete(seen.keys().next().value);
    try {
      const body = welcomePayload(member);
      let files;
      try {
        const image = await renderBanner(member);
        files = [{ name: 'bienvenue.png', data: image, contentType: 'image/png' }];
        body.attachments = [{ id: 0, filename: 'bienvenue.png', description: 'Bienvenue sur Kart Rivals, avec ton avatar et ton pseudo.' }];
        body.embeds[0].image = { url: 'attachment://bienvenue.png' };
        delete body.embeds[0].thumbnail;
      } catch {
        log.warn?.('Bannière indisponible : envoi de l’embed avec avatar.');
      }
      await send(channelId, body, files);
      log.info('Bienvenue envoyée dans le salon configuré.');
    } catch (error) {
      seen.delete(key);
      // Log only a numeric Discord code, never request data or the bot token.
      log.error('Échec du message de bienvenue. Vérifie le salon et les permissions Voir le salon, Envoyer des messages, Intégrer des liens, Joindre des fichiers. Code :',
        Number.isInteger(error?.code) ? error.code : 'réseau');
    }
  };
}

export function startWelcome(env = process.env, log = console) {
  const token = env.DISCORD_BOT_TOKEN;
  const guildId = env.DISCORD_GUILD_ID;
  const channelId = env.DISCORD_WELCOME_CHANNEL_ID || DEFAULT_WELCOME_CHANNEL_ID;
  if (!token || !snowflake.test(guildId ?? '') || !snowflake.test(channelId)) {
    log.warn('Bienvenue inactive : vérifie DISCORD_BOT_TOKEN, DISCORD_GUILD_ID et DISCORD_WELCOME_CHANNEL_ID.');
    return null;
  }
  // Gateway is used only for arrivals; slash commands remain served through HTTP.
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  client.on(Events.GuildMemberAdd, createWelcomeHandler({ guildId, channelId, log,
    send: (id, body, files) => client.rest.post(Routes.channelMessages(id), { body, files }),
  }));
  client.once(Events.ClientReady, () => log.info('Accueil automatique connecté • salon ' + channelId));
  client.on(Events.Error, () => log.error('Connexion Discord indisponible ; surveille la reconnexion.'));
  client.on(Events.ShardDisconnect, (event) => {
    if (event.code === 4014) log.error('Active SERVER MEMBERS INTENT dans Discord Developer Portal → Bot, puis redéploie.');
    else if (event.code === 4004) log.error('Jeton Discord refusé : vérifie DISCORD_BOT_TOKEN.');
  });
  void client.login(token).catch(() => {
    log.error('Accueil automatique non connecté. Vérifie le jeton et SERVER MEMBERS INTENT dans Discord → Bot.');
    client.destroy();
  });
  return client;
}
