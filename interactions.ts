import { routeTicket } from './tickets.mjs';
type Interaction = {
  type: number;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  token: string;
  member?: { user?: { id?: string } };
  data?: { name: string; options?: { name: string; value: string | number; focused?: boolean }[] };
};

type Track = { id: string; name: string; city: string | null };
type Pilot = { id: string; username: string; elo: number; rank: string;
  wins: number; losses: number; draws: number; matches_played: number; position?: number };
type PersonalRecord = { track_id: string; track_name: string; lap_ms: number; position: number };
type Circuit = Track & { region?: string; address?: string; length_m?: number;
  is_indoor?: boolean; website?: string; description?: string };
type Lap = { position: number; username: string; lap_ms: number };

type Embed = {
  color: number;
  author: { name: string };
  title: string;
  description: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

const ephemeral = 64;
const encoder = new TextEncoder();
const snowflake = /^\d{17,20}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function fromHex(value: string, bytes: number) {
  if (value.length !== bytes * 2 || !/^[a-f0-9]+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}

let verificationKey: Promise<CryptoKey> | undefined;

async function verify(request: Request, body: string) {
  const signature = fromHex(request.headers.get('x-signature-ed25519') ?? '', 64);
  const timestamp = request.headers.get('x-signature-timestamp') ?? '';
  const publicKey = fromHex(process.env['DISCORD_PUBLIC_KEY'] ?? '', 32);
  if (!signature || !publicKey || !/^\d{10,11}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  verificationKey ??= crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
  return crypto.subtle.verify('Ed25519', await verificationKey, signature, encoder.encode(timestamp + body));
}

async function query<T>(params: URLSearchParams, timeout = 1800): Promise<T> {
  const endpoint = process.env.KART_RIVALS_API_URL;
  const key = process.env.KART_RIVALS_BOT_KEY;
  if (!endpoint || !key) throw new Error('Kart Rivals configuration missing');

  const url = new URL(endpoint);
  url.search = params.toString();
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + key },
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error('Kart Rivals HTTP ' + response.status);
  return response.json();
}

async function accountQuery(action: 'link' | 'unlink' | 'linked', discordId: string, code?: string): Promise<{ status?: string; profile_id?: string }> {
  const endpoint = process.env.KART_RIVALS_API_URL;
  const key = process.env.KART_RIVALS_BOT_KEY;
  if (!endpoint || !key || !snowflake.test(discordId)) throw new Error('Account configuration missing');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, discord_id: discordId, ...(code ? { code } : {}) }),
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Account service unavailable');
  return response.json();
}

function displayText(value: string, limit: number) {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, limit).replace(/[\\`*_~|<>\[\]]/g, '\\$&');
}

function formatLap(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return minutes + ':' + seconds + '.' + String(ms % 1000).padStart(3, '0');
}

function notice(title: string, description: string): Embed {
  return { color: 0xf59e0b, author: { name: 'KART RIVALS' }, title, description };
}

function reply(content: string) {
  return Response.json({
    type: 4,
    data: {
      embeds: [notice('🏁 Avant de prendre la piste', content)],
      flags: ephemeral,
      allowed_mentions: { parse: [] },
    },
  });
}

function recordsEmbed(track: Track, laps: Lap[]): Embed {
  const results = [...laps].sort((a, b) => a.lap_ms - b.lap_ms).slice(0, 10);
  const embed: Embed = {
    color: 0xfacc15,
    author: { name: 'KART RIVALS • RECORDS' },
    title: '🏁 ' + displayText(track.name, 100),
    description: track.city ? '📍 ' + displayText(track.city, 100) : 'Les meilleurs tours du circuit.',
    footer: { text: 'Chronos validés • Kart Rivals' },
    timestamp: new Date().toISOString(),
  };
  if (!results.length) {
    embed.fields = [{
      name: '⏱️ Le record reste à établir',
      value: 'Aucun chrono validé pour le moment.\nPrends la piste et signe le premier temps !',
    }];
    return embed;
  }

  const best = results[0];
  const medals = ['🥇', '🥈', '🥉'];
  const rows = results.map((lap) => {
    const badge = medals[lap.position - 1] ?? '**' + lap.position + '.**';
    const gap = lap.lap_ms === best.lap_ms
      ? 'Record'
      : '+' + ((lap.lap_ms - best.lap_ms) / 1000).toFixed(3) + ' s';
    return badge + ' **' + displayText(lap.username, 50) + '**\n' +
      '↳ `' + formatLap(lap.lap_ms) + '` · ' + gap;
  });
  embed.fields = [
    { name: '⏱️ Temps de référence', value: '`' + formatLap(best.lap_ms) + '`', inline: true },
    { name: '🏆 Classement', value: 'Top ' + results.length, inline: true },
    { name: '🏎️ Les meilleurs tours', value: rows.slice(0, 5).join('\n\n') },
  ];
  if (rows.length > 5) {
    embed.fields.push({ name: 'Suite du classement', value: rows.slice(5).join('\n\n') });
  }
  return embed;
}

function card(section: string, title: string, description: string): Embed {
  return { color: 0xd4ff00, author: { name: 'KART RIVALS • ' + section }, title, description,
    footer: { text: 'Kart Rivals • Données de l’application' }, timestamp: new Date().toISOString() };
}
function pilotStats(pilot: Pilot) {
  const rate = pilot.matches_played ? Math.round(100 * pilot.wins / pilot.matches_played) + ' %' : '—';
  return '**' + pilot.elo + ' Elo** · ' + displayText(pilot.rank, 30) + '\n' +
    pilot.wins + ' V · ' + pilot.losses + ' D · ' + pilot.draws + ' N\n' +
    pilot.matches_played + ' matchs · ' + rate + ' de victoires';
}
async function commandEmbed(interaction: Interaction): Promise<Embed> {
  const name = interaction.data!.name;
  const discordId = interaction.member?.user?.id ?? '';
  if (name === 'lier' || name === 'delier') {
    const code = String(interaction.data?.options?.find((o) => o.name === 'code')?.value ?? '');
    const result = await accountQuery(name === 'lier' ? 'link' : 'unlink', discordId, code);
    if (result.status === 'linked') return notice('🔗 Compte lié !', 'Tu peux maintenant utiliser **/profil**, **/mesrecords** et **/rival circuit** sans préciser ton pseudo. Les données privées restent masquées.');
    if (result.status === 'unlinked') return notice('Compte dissocié', 'Ton compte Discord n’est plus lié à Kart Rivals.');
    if (result.status === 'limited') return notice('Patiente un instant', 'Trop de tentatives. Réessaie dans 15 minutes avec un nouveau code.');
    if (result.status === 'already_linked') return notice('Compte déjà lié', 'Utilise **/delier** avant de relier un autre compte.');
    return notice('Code invalide ou expiré', 'Dans Kart Rivals, ouvre **Modifier ma licence → Mon compte Discord**, génère un code puis utilise **/lier code**. Le code est valable 10 minutes, une seule fois.');
  }
  if (['profil', 'mesrecords', 'rival'].includes(name) && !interaction.data!.options?.some((o) => o.name === 'pilote')) {
    const linked = await accountQuery('linked', discordId);
    if (!uuid.test(linked.profile_id ?? '')) return notice('Lie ton compte Kart Rivals', 'Dans Kart Rivals : **Modifier ma licence → Mon compte Discord**. Génère un code puis saisis **/lier code** ici. Tu peux aussi choisir un pilote dans la commande.');
    interaction.data!.options = [...(interaction.data!.options ?? []), { name: 'pilote', value: linked.profile_id! }];
  }

  const option = (key: string) => String(interaction.data!.options?.find((o) => o.name === key)?.value ?? '');
  if (name === 'aide') {
    const embed = card('AIDE', '🏁 Ton paddock Kart Rivals', 'Choisis une commande et prends la piste !');
    embed.fields = [
      { name: '⏱️ Chronos', value: '**/records circuit** — Top 10 du circuit.\n**/mesrecords pilote [page]** — Tous les records personnels.\n**/dernierschronos** — Les 10 derniers chronos validés publics.' },
      { name: '⚔️ Pilotes', value: '**/profil pilote** — Statistiques et meilleurs résultats.\n**/classement** — Top 10 Elo.\n**/comparaison pilote1 pilote2 circuit** — Duel de chronos.\n**/rival pilote circuit** — Prochain temps à battre.' },
      { name: '🗺️ Circuits', value: '**/circuit circuit** — Fiche et record du circuit.\n**/circuits ville [page]** — Recherche par ville.' },
      { name: '🔗 Ton compte', value: '**/lier code** — Lier ton compte avec un code de l’application.\n**/delier** — Dissocier ton compte. Une fois lié, le pilote est facultatif pour /profil, /mesrecords et /rival.' },
      { name: '🎫 Assistance', value: '**/tickets staff** — Installer le panneau (administrateurs).\n**/fermer-ticket** — Fermer ton ticket ou celui du staff. Utilise les boutons du panneau pour ouvrir une demande privée.' },
      { name: '💡 Mode d’emploi', value: 'Les pilotes sont recherchés par pseudo Kart Rivals. Sélectionne les suggestions. Pour les listes, ajoute **page:2**, puis 3… Les réponses sont visibles uniquement par toi dans le salon de test.' },
    ];
    return embed;
  }
  if (name === 'mesrecords' || name === 'circuits') {
    const page = option('page') || '1';
    const data = await query<{ pilot?: Pilot; records?: PersonalRecord[]; tracks?: Track[]; city?: string; has_more: boolean }>(
      new URLSearchParams({ action: name, page, ...(name === 'mesrecords' ? { pilot: option('pilote') } : { city: option('ville') }) }), 8000);
    if (name === 'mesrecords' && !data.pilot) return notice('🔎 Profil indisponible', 'Ce pilote est introuvable ou son profil n’est pas public.');
    const embed = name === 'mesrecords'
      ? card('MES RECORDS', '⏱️ ' + displayText(data.pilot!.username, 50), 'Les meilleurs chronos personnels, circuit par circuit.')
      : card('CIRCUITS', '🗺️ À la recherche de ta prochaine piste', 'Ville : **' + displayText(data.city ?? option('ville'), 80) + '**');
    embed.fields = name === 'mesrecords' ? (data.records ?? []).slice(0, 10).map((r) => ({
      name: '🏁 ' + displayText(r.track_name, 100), value: '**`' + formatLap(r.lap_ms) + '`** · Rang circuit **#' + r.position + '**',
    })) : (data.tracks ?? []).slice(0, 10).map((t) => ({
      name: '🏁 ' + displayText(t.name, 100), value: '📍 ' + displayText(t.city ?? 'Ville non renseignée', 100),
    }));
    if (!embed.fields.length) embed.fields.push({ name: 'Aucun résultat sur cette page', value: Number(page) > 1
      ? 'Essaie une page précédente.' : name === 'mesrecords' ? 'Ce pilote n’a pas encore de chrono validé.' : 'Essaie une autre ville ou une partie de son nom.' });
    embed.footer = { text: 'Page ' + page + (data.has_more ? ' • Suite : relance /' + name + ' avec page:' + (Number(page) + 1) : ' • Fin des résultats') };
    return embed;
  }
  if (name === 'dernierschronos') {
    const { laps } = await query<{ laps: { username: string; track_name: string; lap_ms: number; confirmed_at: string }[] }>(
      new URLSearchParams({ action: name }), 8000);
    const embed = card('DERNIERS CHRONOS', '🔥 Ça roule sur Kart Rivals', 'Les 10 derniers chronos validés des pilotes publics.');
    embed.fields = laps.slice(0, 10).map((lap) => {
      const timestamp = Math.floor(Date.parse(lap.confirmed_at) / 1000);
      return { name: '🏁 ' + displayText(lap.track_name, 100), value: '**' + displayText(lap.username, 50) + '** · `' + formatLap(lap.lap_ms) + '`' +
        (Number.isFinite(timestamp) ? '\nValidé <t:' + timestamp + ':R>' : '') };
    });
    if (!embed.fields.length) embed.fields.push({ name: 'La piste est calme', value: 'Aucun chrono public validé pour le moment.' });
    embed.footer = { text: 'Ordre de validation • Défis, courses et Time Attack' };
    return embed;
  }
  if (name === 'rival') {
    const data = await query<{ pilot?: { username: string }; track?: Track; lap_ms: number | null; rival?: { username: string; lap_ms: number } }>(
      new URLSearchParams({ action: name, pilot: option('pilote'), track: option('circuit') }), 8000);
    if (!data.pilot || !data.track) return notice('🔎 Rival indisponible', 'Le pilote ou le circuit n’est plus disponible. Sélectionne-les à nouveau.');
    const embed = card('RIVAL', '🎯 Le prochain chrono à battre', '🏁 **' + displayText(data.track.name, 100) + '**');
    embed.fields = [{ name: '🏎️ ' + displayText(data.pilot.username, 50), value: data.lap_ms == null
      ? 'Aucun chrono validé sur ce circuit.' : '**`' + formatLap(data.lap_ms) + '`**' }];
    if (data.lap_ms == null) embed.fields.push({ name: 'Premier objectif', value: 'Publie un chrono validé sur ce circuit pour trouver le prochain rival.' });
    else if (!data.rival) embed.fields.push({ name: '🏆 En tête des pilotes publics', value: 'Aucun pilote public n’a un meilleur chrono. À toi de repousser ta limite !' });
    else {
      embed.fields.push({ name: '⚔️ ' + displayText(data.rival.username, 50), value: '**`' + formatLap(data.rival.lap_ms) + '`**' });
      const gap = data.lap_ms - data.rival.lap_ms;
      embed.fields.push({ name: '⏱️ Ton objectif', value: '**' + (gap / 1000).toFixed(3) + ' s** pour égaler ce temps.\nGagne **' + ((gap + 1) / 1000).toFixed(3) + ' s** pour le battre au millième.' });
    }
    embed.footer = { text: 'Prochain chrono strictement meilleur • Pilotes publics • Conditions potentiellement différentes' };
    return embed;
  }
  if (name === 'records' || name === 'circuit') {
    const { track, laps } = await query<{ track: Circuit | null; laps: Lap[] }>(
      new URLSearchParams({ track: option('circuit'), ...(name === 'circuit' ? { action: 'circuit' } : {}) }), 8000);
    if (!track) return notice('🔎 Circuit introuvable', 'Choisis à nouveau le circuit dans les suggestions.');
    if (name === 'records') return recordsEmbed(track, laps);
    const embed = card('CIRCUIT', '🏁 ' + displayText(track.name, 100),
      '📍 ' + displayText([track.city, track.region].filter(Boolean).join(' · '), 200));
    embed.fields = [
      { name: '🛣️ Piste', value: track.is_indoor ? 'Intérieure' : 'Extérieure', inline: true },
      { name: '📏 Longueur', value: track.length_m ? track.length_m + ' m' : 'Non renseignée', inline: true },
    ];
    if (track.address) embed.fields.push({ name: '📍 Adresse', value: displayText(track.address, 450) });
    if (track.description) embed.fields.push({ name: 'À propos', value: displayText(track.description, 450) });
    if (track.website) {
      try {
        const url = new URL(track.website);
        if (['https:', 'http:'].includes(url.protocol) && url.href.length < 500) {
          embed.fields.push({ name: '🌐 Site officiel', value: '[Consulter le site](<' + url.href.replace(/>/g, '%3E') + '>)' });
        }
      } catch { /* Omit malformed websites. */ }
    }
    const best = [...laps].sort((a, b) => a.lap_ms - b.lap_ms)[0];
    embed.fields.push({ name: '🏆 Record validé', value: best
      ? '`' + formatLap(best.lap_ms) + '` · **' + displayText(best.username, 50) + '**'
      : 'Aucun chrono validé pour le moment.' });
    return embed;
  }
  if (name === 'classement') {
    const { pilots } = await query<{ pilots: Pilot[] }>(new URLSearchParams({ action: name }), 8000);
    const embed = card('CLASSEMENT', '🏆 Les meilleurs pilotes', 'Top 10 Elo des pilotes publics ayant joué au moins un match.');
    embed.fields = pilots.length ? pilots.slice(0, 10).map((pilot) => ({
      name: (['🥇', '🥈', '🥉'][Number(pilot.position) - 1] ?? '#' + pilot.position) + ' ' + displayText(pilot.username, 50),
      value: pilotStats(pilot),
    })) : [{ name: 'La grille attend ses pilotes', value: 'Aucun pilote classé pour le moment.' }];
    return embed;
  }
  if (name === 'profil') {
    const data = await query<{ pilot?: Pilot; records?: PersonalRecord[] }>(
      new URLSearchParams({ action: name, pilot: option('pilote') }), 8000);
    if (!data.pilot) return notice('🔎 Profil indisponible', 'Ce pilote est introuvable ou son profil n’est pas public.');
    const embed = card('PROFIL', '🏎️ ' + displayText(data.pilot.username, 50), pilotStats(data.pilot));
    embed.fields = (data.records ?? []).slice(0, 5).map((record) => ({
      name: '🏁 ' + displayText(record.track_name, 100),
      value: '`' + formatLap(record.lap_ms) + '` · Rang circuit **#' + record.position + '**',
    }));
    if (!embed.fields.length) embed.fields.push({ name: '⏱️ Records personnels', value: 'Aucun chrono validé pour le moment.' });
    embed.footer = { text: 'Jusqu’à 5 circuits • Meilleures places parmi les chronos validés' };
    return embed;
  }
  type Result = { pilot: Pilot; lap_ms: number | null };
  const data = await query<{ track?: Track; first?: Result; second?: Result }>(new URLSearchParams({
    action: 'comparaison', pilot: option('pilote1'), opponent: option('pilote2'), track: option('circuit'),
  }), 8000);
  if (!data.first || !data.second || !data.track) return notice('🔎 Comparaison indisponible',
    'Un pilote ou le circuit n’est plus disponible. Sélectionne-les à nouveau.');
  const { first, second, track } = data;
  const embed = card('COMPARAISON', '⚔️ Duel de chronos', '🏁 **' + displayText(track.name, 100) + '**');
  embed.fields = [first, second].map((result) => ({ name: '🏎️ ' + displayText(result.pilot.username, 50),
    value: (result.lap_ms === null ? 'Aucun chrono validé sur ce circuit' : '**`' + formatLap(result.lap_ms) + '`**') +
      '\n' + result.pilot.elo + ' Elo', inline: true }));
  let verdict = 'Il faut un chrono validé pour chaque pilote sur ce circuit pour calculer l’écart.';
  if (first.lap_ms !== null && second.lap_ms !== null) {
    const gap = Math.abs(first.lap_ms - second.lap_ms);
    verdict = gap === 0 ? '🤝 Égalité parfaite au millième !' :
      '🏆 **' + displayText((first.lap_ms < second.lap_ms ? first : second).pilot.username, 50) +
      '** a **' + (gap / 1000).toFixed(3) + ' s** d’avance.';
  }
  embed.fields.push({ name: '⏱️ Écart', value: verdict });
  embed.footer = { text: 'Records personnels • Sessions et conditions potentiellement différentes' };
  return embed;
}

async function completeCommand(interaction: Interaction) {
  let embed: Embed;
  try {
    embed = await commandEmbed(interaction);
  } catch {
    embed = notice('🔧 Arrêt aux stands', 'Les données sont momentanément indisponibles. Réessaie dans un instant.');
  }

  try {
    const response = await fetch(
      'https://discord.com/api/v10/webhooks/' + interaction.application_id + '/' +
        encodeURIComponent(interaction.token) + '/messages/@original',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '', embeds: [embed], allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) console.error('Discord reply HTTP', response.status);
  } catch {
    console.error('Discord reply request failed');
  }
}

// Reuse complete search results while the user continues typing.
// A 25-result response may be truncated, so it cannot answer a narrower search.
const searchCache = new Map<string, { tracks: Track[]; expires: number }>();
const pendingSearches = new Map<string, Promise<Track[]>>();

async function searchTracks(term: string): Promise<Track[]> {
  const cached = searchCache.get(term);
  if (cached && cached.expires > Date.now()) return cached.tracks;
  for (const [prefix, entry] of searchCache) {
    if (entry.expires > Date.now() && entry.tracks.length < 25 && term.startsWith(prefix)) {
      return entry.tracks.filter((track) =>
        track.name.toLowerCase().includes(term) || (track.city ?? '').toLowerCase().includes(term));
    }
  }
  const pending = pendingSearches.get(term);
  if (pending) return pending;

  const request = query<Track[]>(new URLSearchParams({ search: term }))
    .then((tracks) => {
      searchCache.delete(term);
      searchCache.set(term, { tracks, expires: Date.now() + 5 * 60_000 });
      if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value!);
      return tracks;
    })
    .finally(() => pendingSearches.delete(term));
  pendingSearches.set(term, request);
  return request;
}

async function autocomplete(search: string) {
  const term = search.slice(0, 80).replace(/[^\p{L}\p{M}\p{N} -]/gu, '').trim().toLowerCase();
  try {
    const tracks = await searchTracks(term);
    return tracks.slice(0, 25).map((track) => ({
      name: [track.name, track.city].filter(Boolean).join(' · ').slice(0, 100),
      value: track.id,
    }));
  } catch (error) {
    console.error('Circuit autocomplete failed', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

const pendingPilots = new Map<string, Promise<{ id: string; username: string }[]>>();
async function autocompletePilots(search: string) {
  const term = search.slice(0, 20).replace(/[^a-z0-9_]/gi, '').toLowerCase();
  try {
    let request = pendingPilots.get(term);
    if (!request) {
      request = query<{ id: string; username: string }[]>(new URLSearchParams({ action: 'pilots', search: term }))
        .finally(() => pendingPilots.delete(term));
      pendingPilots.set(term, request);
    }
    return (await request).slice(0, 25).map((pilot) => ({ name: pilot.username.slice(0, 100), value: pilot.id }));
  } catch { return []; }
}
const requiredOptions: Record<string, string[]> = {
  records: ['circuit'], circuit: ['circuit'], profil: ['pilote'], classement: [],
  comparaison: ['pilote1', 'pilote2', 'circuit'],
  lier: [], delier: [],
  mesrecords: ['pilote'], rival: ['pilote', 'circuit'], dernierschronos: [], circuits: ['ville'], aide: [],
};

export async function handleInteraction(request: Request) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const body = await request.text();
  if (!(await verify(request, body))) return new Response(null, { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (interaction.type === 1) return Response.json({ type: 1 });
  const ticketResponse = routeTicket(interaction);
  if (ticketResponse) return ticketResponse;
  if (!interaction.data || !Object.hasOwn(requiredOptions, interaction.data.name) || ![2, 4].includes(interaction.type)) {
    return new Response(null, { status: 400 });
  }

  const guild = process.env['DISCORD_GUILD_ID'];
  const channel = process.env['DISCORD_TEST_CHANNEL_ID'];
  const accountCommand = ['lier', 'delier'].includes(interaction.data.name);
  const allowed = Boolean(guild && interaction.guild_id === guild && (accountCommand || (channel && interaction.channel_id === channel)));
  const options = interaction.data.options ?? [];
  const required = requiredOptions[interaction.data.name];
  const focused = options.find((option) => option.focused);
  if (interaction.type === 4) {
    const choices = allowed && focused && typeof focused.value === 'string' && required.includes(focused.name) && focused.name !== 'ville'
      ? await (focused.name === 'circuit' ? autocomplete(focused.value) : autocompletePilots(focused.value)) : [];
    return Response.json({ type: 8, data: { choices } });
  }
  if (!allowed) return reply('Utilise cette commande dans le salon de test Kart Rivals.');
  const needsIdentity = accountCommand || (['profil', 'mesrecords', 'rival'].includes(interaction.data.name) && !options.some((o) => o.name === 'pilote'));
  if (needsIdentity && (!snowflake.test(interaction.member?.user?.id ?? '') || interaction.application_id !== process.env.DISCORD_APPLICATION_ID)) return reply('Utilise cette commande depuis ton compte dans le serveur Kart Rivals.');
  if (interaction.data.name === 'lier') {
    const code = options.find((o) => o.name === 'code')?.value;
    if (typeof code !== 'string' || code.length > 80 || !/^[A-F0-9]{32}$/.test(code.replace(/[-\s]/g, '').toUpperCase())) return reply('Copie le code depuis Kart Rivals → Modifier ma licence → Mon compte Discord.');
  }
  if (required.some((key) => {
    const value = options.find((option) => option.name === key)?.value;
    if (key === 'pilote' && value === undefined && ['profil', 'mesrecords', 'rival'].includes(interaction.data!.name)) return false;
    return typeof value !== 'string' || (key === 'ville' ? value.replace(/[^\p{L}\p{M}\p{N} -]/gu, '').trim().length < 2 || value.length > 80 : !uuid.test(value));
  })) return reply('Sélectionne les pilotes et les circuits dans les suggestions.');
  const page = options.find((o) => o.name === 'page')?.value;
  if (page !== undefined && (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 10000)) {
    return reply('Choisis un numéro de page entier entre 1 et 10000.');
  }
  if (interaction.data.name === 'comparaison' &&
    options.find((o) => o.name === 'pilote1')?.value === options.find((o) => o.name === 'pilote2')?.value) {
    return reply('Choisis deux pilotes différents pour la comparaison.');
  }
  if (!snowflake.test(interaction.application_id) || !interaction.token) {
    return new Response(null, { status: 400 });
  }

  void completeCommand(interaction);
  return Response.json({ type: 5, data: { flags: ephemeral } });
}
