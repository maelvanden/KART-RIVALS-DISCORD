import { REST, Routes, PermissionFlagsBits as P } from 'discord.js';

const kinds = { chrono: '🏁 Chrono suspect', bug: '🐛 Signaler un bug', staff: '💬 Contacter le staff', partenariat: '🤝 Demande de partenariat' };
const id = /^\d{17,20}$/;
const reply = (content) => Response.json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
const button = (custom_id, label, style = 2) => ({ type: 2, custom_id, label, style });
const row = (...components) => ({ type: 1, components });
const admin = (i) => (BigInt(i.member?.permissions ?? '0') & P.Administrator) !== 0n;
const meta = (channel) => /^kr-ticket:(\d{17,20}):(\d{17,20}):(open|closed)$/.exec(channel.topic ?? '');
const visible = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles | P.EmbedLinks;
export function ticketOverwrites(guild, owner, role, bot) {
  return [
    { id: guild, type: 0, deny: String(P.ViewChannel), allow: '0' },
    { id: owner, type: 1, allow: String(visible), deny: '0' },
    { id: role, type: 0, allow: String(visible), deny: '0' },
    { id: bot, type: 1, allow: String(visible | P.ManageChannels), deny: '0' },
  ];
}
export function createTicketRouter({ env = process.env, rest, log = console } = {}) {
  let api = rest;
  const locks = new Set();
  const getApi = () => api ??= new REST({ version: '10', timeout: 10_000 }).setToken(env.DISCORD_BOT_TOKEN);
  async function finish(i, action) {
    let content;
    try { content = await action(getApi()); }
    catch (e) {
      log.error('Ticket : opération impossible.', Number.isInteger(e?.code) ? e.code : 'réseau');
      content = 'Impossible de terminer. Le staff doit vérifier les permissions du bot (Gérer les salons, Gérer les rôles, Voir le salon, Envoyer des messages et Intégrer des liens). Réessaie ensuite.';
    }
    try {
      await getApi().patch(Routes.webhookMessage(i.application_id, i.token, '@original'), {
        auth: false, body: { content, allowed_mentions: { parse: [] } },
      });
    } catch { log.error('Ticket : réponse privée indisponible.'); }
  }
  const defer = (i, action) => {
    setTimeout(() => { void finish(i, action); }, 0);
    return Response.json({ type: 5, data: { flags: 64 } });
  };
  return function route(i) {
    const custom = i.data?.custom_id ?? '';
    const setup = i.type === 2 && i.data?.name === 'tickets';
    const closeCommand = i.type === 2 && i.data?.name === 'fermer-ticket';
    if (!setup && !closeCommand && !custom.startsWith('kr-ticket:')) return null;
    if (i.guild_id !== env.DISCORD_GUILD_ID || !id.test(i.member?.user?.id ?? '') ||
        i.application_id !== env.DISCORD_APPLICATION_ID || !i.token || !env.DISCORD_BOT_TOKEN) {
      return reply('Les tickets sont disponibles uniquement sur le serveur Kart Rivals.');
    }
    const owner = i.member.user.id;
    if (setup) {
      if (!admin(i)) return reply('Seuls les administrateurs peuvent installer le panneau.');
      const role = i.data.options?.find((o) => o.name === 'staff')?.value;
      if (!id.test(role ?? '') || role === i.guild_id) return reply('Choisis un rôle réservé au staff, pas @everyone.');
      return defer(i, async (api) => {
        const roles = await api.get(Routes.guildRoles(i.guild_id));
        if (!roles.some((r) => r.id === role && !r.managed)) return 'Choisis un rôle staff existant, non géré par un bot.';
        const channel = await api.get(Routes.channel(i.channel_id));
        if (channel.guild_id !== i.guild_id || ![0, 5].includes(channel.type)) return 'Installe le panneau dans un salon textuel classique.';
        await api.post(Routes.channelMessages(i.channel_id), { body: {
          allowed_mentions: { parse: [] },
          embeds: [{ color: 0xdfff00, title: '🎫 Assistance Kart Rivals',
            description: 'Un chrono suspect, un bug, une question ou un partenariat ?\nChoisis un motif pour ouvrir un ticket privé avec le staff.\n\nUn seul ticket ouvert par personne. Les administrateurs ont également accès aux tickets.',
            footer: { text: 'Kart Rivals • On est là pour t’aider' } }],
          components: [row(...Object.entries(kinds).map(([key, label]) => button('kr-ticket:new:' + key + ':' + role, label)))],
        } });
        return 'Panneau publié ! Le rôle <@&' + role + '> aura accès aux nouveaux tickets.';
      });
    }
    const open = /^kr-ticket:new:(chrono|bug|staff|partenariat):(\d{17,20})$/.exec(custom);
    if (i.type === 3 && open) {
      if (i.message?.author?.id !== i.application_id) return reply('Utilise le panneau officiel du bot.');
      return Response.json({ type: 9, data: {
        custom_id: 'kr-ticket:submit:' + open[1] + ':' + open[2], title: kinds[open[1]],
        components: [row({ type: 4, custom_id: 'details', label: 'Décris ta demande', style: 2,
          placeholder: open[1] === 'partenariat' ? 'Présente ton projet ou serveur, son lien, ta communauté et le partenariat proposé.' : open[1] === 'chrono' ? 'Circuit, pilote, chrono concerné et raison du signalement…' : 'Explique ce qui se passe. Tu pourras ajouter des captures dans le ticket.',
          min_length: 10, max_length: 2000, required: true })],
      } });
    }
    const submit = /^kr-ticket:submit:(chrono|bug|staff|partenariat):(\d{17,20})$/.exec(custom);
    if (i.type === 5 && submit) {
      const details = i.data.components?.flatMap((r) => r.components ?? []).find((c) => c.custom_id === 'details')?.value;
      if (typeof details !== 'string' || details.trim().length < 10 || details.length > 2000 || submit[2] === i.guild_id) return reply('Décris ta demande en 10 à 2000 caractères.');
      const key = i.guild_id + ':' + owner;
      if (locks.has(key)) return reply('Ton ticket est en cours de création. Patiente un instant.');
      locks.add(key);
      return defer(i, async (api) => {
        try {
          const channels = await api.get(Routes.guildChannels(i.guild_id));
          const existing = channels.find((c) => { const m = meta(c); return m?.[1] === owner && m[3] === 'open'; });
          if (existing) return 'Tu as déjà un ticket ouvert : <#' + existing.id + '>.';
          const roles = await api.get(Routes.guildRoles(i.guild_id));
          if (!roles.some((r) => r.id === submit[2] && !r.managed)) return 'Le rôle staff n’existe plus. Demande à un administrateur de réinstaller le panneau.';
          const channel = await api.post(Routes.guildChannels(i.guild_id), { body: {
            name: 'ticket-' + submit[1] + '-' + owner.slice(-6), type: 0,
            topic: 'kr-ticket:' + owner + ':' + submit[2] + ':open',
            permission_overwrites: ticketOverwrites(i.guild_id, owner, submit[2], i.application_id),
          } });
          try {
            await api.post(Routes.channelMessages(channel.id), { body: {
              content: '<@' + owner + '>', allowed_mentions: { parse: [], users: [owner] },
              embeds: [{ color: 0xdfff00, title: kinds[submit[1]], description: details,
                footer: { text: 'Ajoute tes captures ici. Seuls toi, le staff et les administrateurs ont accès.' } }],
              components: [row(button('kr-ticket:close', 'Fermer le ticket', 4))],
            } });
          } catch {
            return 'Ticket créé : <#' + channel.id + '>. Le message initial n’a pas pu être envoyé : recopie ta demande ici. Le staff peut utiliser /fermer-ticket.';
          }
          return 'Ton ticket est prêt : <#' + channel.id + '>.';
        } finally { locks.delete(key); }
      });
    }
    if (closeCommand || (i.type === 3 && custom === 'kr-ticket:close')) {
      return replyWithConfirmation();
    }
    if (i.type === 3 && custom === 'kr-ticket:confirm-close') {
      return defer(i, async (api) => {
        const channel = await api.get(Routes.channel(i.channel_id));
        const m = meta(channel);
        if (channel.guild_id !== i.guild_id || !m) return 'Ce salon n’est pas un ticket Kart Rivals.';
        if (owner !== m[1] && !i.member.roles?.includes(m[2]) && !admin(i)) return 'Seuls l’auteur du ticket et le staff peuvent le fermer.';
        if (m[3] === 'closed') return 'Ce ticket est déjà fermé.';
        // Keep the history and membership privacy; make the requester read-only.
        await api.put(Routes.channelPermission(channel.id, m[1]), { body: {
          type: 1, allow: String(P.ViewChannel | P.ReadMessageHistory),
          deny: String(P.SendMessages | P.AddReactions | P.CreatePublicThreads | P.CreatePrivateThreads | P.SendMessagesInThreads),
        } });
        await api.patch(Routes.channel(channel.id), { body: {
          name: 'ferme-' + channel.name.replace(/^ferme-/, '').slice(0, 90),
          topic: 'kr-ticket:' + m[1] + ':' + m[2] + ':closed',
        } });
        return 'Ticket fermé. L’historique reste accessible en lecture ; le staff pourra supprimer le salon si nécessaire.';
      });
    }
    return reply('Cette action n’est plus disponible.');
  };
}
function replyWithConfirmation() {
  return Response.json({ type: 4, data: { flags: 64,
    content: 'Fermer ce ticket ? Tu pourras encore le lire, mais plus y écrire.',
    components: [row(button('kr-ticket:confirm-close', 'Confirmer la fermeture', 4))],
    allowed_mentions: { parse: [] },
  } });
}
export const routeTicket = createTicketRouter();
