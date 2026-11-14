type Interaction = {
  type: number;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  token: string;
  data?: { name: string; options?: { name: string; value: string; focused?: boolean }[] };
};

type Track = { id: string; name: string; city: string | null };
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

async function query<T>(params: URLSearchParams): Promise<T> {
  const endpoint = process.env.KART_RIVALS_API_URL;
  const key = process.env.KART_RIVALS_BOT_KEY;
  if (!endpoint || !key) throw new Error('Kart Rivals configuration missing');

  const url = new URL(endpoint);
  url.search = params.toString();
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + key },
    redirect: 'error',
    signal: AbortSignal.timeout(1800),
  });
  if (!response.ok) throw new Error('Kart Rivals HTTP ' + response.status);
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
    footer: { text: 'Chronos de match validés • Kart Rivals' },
    timestamp: new Date().toISOString(),
  };
  if (!results.length) {
    embed.fields = [{
      name: '⏱️ Le record reste à établir',
      value: 'Aucun chrono de match validé pour le moment.\nPrends la piste et signe le premier temps !',
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

async function completeRecords(interaction: Interaction, trackId: string) {
  let embed: Embed;
  try {
    const { track, laps } = await query<{ track: Track | null; laps: Lap[] }>(
      new URLSearchParams({ track: trackId }),
    );
    embed = track
      ? recordsEmbed(track, laps)
      : notice('🔎 Circuit introuvable', 'Relance `/records` et choisis un circuit dans les suggestions.');
  } catch {
    embed = notice(
      '🔧 Arrêt aux stands',
      'Le classement est momentanément indisponible. Réessaie dans un instant.',
    );
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
  if (interaction.data?.name !== 'records' || ![2, 4].includes(interaction.type)) {
    return new Response(null, { status: 400 });
  }

  const guild = process.env['DISCORD_GUILD_ID'];
  const channel = process.env['DISCORD_TEST_CHANNEL_ID'];
  const allowed = Boolean(guild && channel && interaction.guild_id === guild && interaction.channel_id === channel);
  const option = interaction.data.options?.find(({ name }) => name === 'circuit');
  if (interaction.type === 4) {
    const choices = allowed && option?.focused ? await autocomplete(option.value) : [];
    return Response.json({ type: 8, data: { choices } });
  }
  if (!allowed) return reply('Utilise cette commande dans le salon de test Kart Rivals.');
  if (!option || !uuid.test(option.value)) return reply('Choisis un circuit dans les suggestions.');
  if (!snowflake.test(interaction.application_id) || !interaction.token) {
    return new Response(null, { status: 400 });
  }

  void completeRecords(interaction, option.value);
  return Response.json({ type: 5, data: { flags: ephemeral } });
}
