import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { handleInteraction } from '../interactions.ts';
import { commands, registerCommands } from '../commands.mjs';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
Object.assign(process.env, { DISCORD_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
  DISCORD_GUILD_ID: '111111111111111111', DISCORD_TEST_CHANNEL_ID: '222222222222222222',
  KART_RIVALS_API_URL: 'https://api.example/data', KART_RIVALS_BOT_KEY: 'test' });
const id = '00000000-0000-0000-0000-000000000001';
const otherId = '00000000-0000-0000-0000-000000000002';
const pilot = { id, username: 'Mael', elo: 1230, rank: 'bronze', wins: 3, losses: 1, draws: 0, matches_played: 4 };
const track = { id, name: 'Inwall Kart', city: 'Angers', is_indoor: true, length_m: 500, website: 'https://example.com', description: 'Piste' };
const options = (values) => Object.entries(values).map(([name, value]) => ({ name, value }));
async function send(name, values = {}, extra = {}) {
  const body = JSON.stringify({ type: 2, application_id: '333333333333333333', token: 'token',
    guild_id: process.env.DISCORD_GUILD_ID, channel_id: process.env.DISCORD_TEST_CHANNEL_ID,
    data: { name, options: options(values) }, ...extra });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return handleInteraction(new Request('https://bot.example/interactions', { method: 'POST', body,
    headers: { 'x-signature-timestamp': timestamp,
      'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), privateKey).toString('hex') } }));
}
function mockAPI(data) {
  let resolve;
  const patched = new Promise((r) => { resolve = r; });
  global.fetch = async (url, init) => {
    if (String(url).startsWith('https://discord.com/')) {
      const result = JSON.parse(init.body);
      assert.deepEqual(result.allowed_mentions, { parse: [] });
      for (const embed of result.embeds) {
        assert.ok(embed.title.length <= 256);
        assert.ok(embed.description.length <= 4096);
        for (const field of embed.fields ?? []) {
          assert.ok(field.name.length <= 256);
          assert.ok(field.value.length <= 1024);
        }
      }
      resolve(result.embeds[0]);
      return Response.json({});
    }
    if (data instanceof Error) throw data;
    return Response.json(data);
  };
  return patched;
}
async function run(name, values, data) {
  const result = mockAPI(data);
  const response = await send(name, values);
  assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
  return result;
}
test('all five commands render embeds, empty states, gaps and ties', async () => {
  let embed = await run('records', { circuit: id }, { track, laps: [{ position: 1, username: 'Mael', lap_ms: 34455 }] });
  assert.match(JSON.stringify(embed), /0:34.455/);
  embed = await run('profil', { pilote: id }, { pilot, records: [{ track_name: 'Inwall', lap_ms: 34455, position: 12 }] });
  assert.match(embed.description, /75 %/);
  assert.match(JSON.stringify(embed), /#12/);
  embed = await run('profil', { pilote: id }, { pilot: { ...pilot, matches_played: 0 }, records: [] });
  assert.match(JSON.stringify(embed), /Aucun chrono/);
  assert.doesNotMatch(JSON.stringify(embed), /NaN|Infinity/);
  embed = await run('profil', { pilote: id }, { unavailable: true });
  assert.match(embed.title, /indisponible/);
  embed = await run('classement', {}, { pilots: Array.from({ length: 10 }, (_, i) => ({ ...pilot, position: i + 1 })) });
  assert.equal(embed.fields.length, 10);
  embed = await run('classement', {}, { pilots: [] });
  assert.match(JSON.stringify(embed), /Aucun pilote/);
  embed = await run('circuit', { circuit: id }, { track, laps: [] });
  assert.match(JSON.stringify(embed), /500 m/);
  embed = await run('circuit', { circuit: id }, { track: { ...track, website: 'javascript:alert(1)', description: '*'.repeat(1500) }, laps: [] });
  assert.doesNotMatch(JSON.stringify(embed), /javascript/);
  const compare = { track, first: { pilot, lap_ms: 34455 }, second: { pilot: { ...pilot, id: otherId, username: 'Rival' }, lap_ms: 35000 } };
  embed = await run('comparaison', { pilote1: id, pilote2: otherId, circuit: id }, compare);
  assert.match(JSON.stringify(embed), /0.545 s/);
  compare.second.lap_ms = 34455;
  embed = await run('comparaison', { pilote1: id, pilote2: otherId, circuit: id }, compare);
  assert.match(JSON.stringify(embed), /Égalité/);
  compare.second.lap_ms = null;
  embed = await run('comparaison', { pilote1: id, pilote2: otherId, circuit: id }, compare);
  assert.match(JSON.stringify(embed), /Il faut un chrono/);
  embed = await run('classement', {}, new Error('network unavailable'));
  assert.match(embed.title, /Arrêt aux stands/);
});
test('authorization, invalid input and autocomplete', async () => {
  global.fetch = async () => { throw new Error('unexpected backend access'); };
  assert.equal((await handleInteraction(new Request('https://bot.example', { method: 'POST', body: '{}' }))).status, 401);
  let response = await send('classement', {}, { channel_id: 'wrong' });
  assert.equal((await response.json()).type, 4);
  response = await send('profil', { pilote: 'not-an-id' });
  assert.equal((await response.json()).type, 4);
  response = await send('comparaison', { pilote1: id, pilote2: id, circuit: id });
  assert.equal((await response.json()).type, 4);
  let requests = 0;
  global.fetch = async (url) => { requests++; assert.equal(new URL(url).searchParams.get('action'), 'pilots'); return Response.json([{ id, username: 'Mael' }]); };
  response = await send('profil', {}, { type: 4, data: { name: 'profil', options: [{ name: 'pilote', value: 'ma', focused: true }] } });
  assert.deepEqual(await response.json(), { type: 8, data: { choices: [{ name: 'Mael', value: id }] } });
  assert.equal(requests, 1);
  global.fetch = async () => { requests++; return Response.json([track]); };
  for (const term of ['inw', 'inwa']) {
    response = await send('circuit', {}, { type: 4, data: { name: 'circuit', options: [{ name: 'circuit', value: term, focused: true }] } });
    assert.equal((await response.json()).data.choices[0].value, id);
  }
  assert.equal(requests, 2, 'complete prefix cache avoids second lookup');
});
test('registration upserts ten commands and preserves unrelated commands', async () => {
  const registered = [];
  await registerCommands({ DISCORD_APPLICATION_ID: '333333333333333333', DISCORD_GUILD_ID: '111111111111111111', DISCORD_BOT_TOKEN: 'test' }, async (url, init) => {
    assert.equal(init.method, 'POST');
    registered.push(JSON.parse(init.body));
    return Response.json({});
  });
  assert.deepEqual(registered.map((c) => c.name), ['records', 'profil', 'classement', 'circuit', 'comparaison', 'mesrecords', 'rival', 'dernierschronos', 'circuits', 'aide']);
  for (const c of commands) assert.ok(c.description.length <= 100);
});
test('new commands: pagination, rivals, recent laps and help', async () => {
  let embed = await run('mesrecords', { pilote: id, page: 2 }, { pilot, records: Array.from({ length: 10 }, () => ({ track_name: '*'.repeat(100), lap_ms: 34455, position: 14 })), has_more: true });
  assert.equal(embed.fields.length, 10);
  assert.match(embed.footer.text, /page:3/);
  embed = await run('mesrecords', { pilote: id, page: 3 }, { pilot, records: [], has_more: false });
  assert.match(JSON.stringify(embed), /page précédente/);
  embed = await run('circuits', { ville: 'Angers' }, { city: 'Angers', tracks: [track], has_more: false });
  assert.match(JSON.stringify(embed), /Inwall/);
  embed = await run('circuits', { ville: 'Angers' }, { tracks: [], has_more: false });
  assert.match(JSON.stringify(embed), /autre ville/);
  const rival = { pilot, track, lap_ms: 35000, rival: { username: 'Other', lap_ms: 34455 } };
  embed = await run('rival', { pilote: id, circuit: id }, rival);
  assert.match(JSON.stringify(embed), /0.545 s/);
  assert.match(JSON.stringify(embed), /0.546 s/);
  embed = await run('rival', { pilote: id, circuit: id }, { ...rival, rival: null });
  assert.match(JSON.stringify(embed), /En tête/);
  embed = await run('rival', { pilote: id, circuit: id }, { ...rival, lap_ms: null, rival: null });
  assert.match(JSON.stringify(embed), /Premier objectif/);
  embed = await run('rival', { pilote: id, circuit: id }, { unavailable: true });
  assert.match(embed.title, /indisponible/);
  embed = await run('dernierschronos', {}, { laps: [{ username: 'Mael', track_name: 'Inwall', lap_ms: 34455, confirmed_at: '2026-11-15T12:00:00Z' }] });
  assert.match(JSON.stringify(embed), /0:34.455/);
  assert.match(JSON.stringify(embed), /<t:\d+:R>/);
  embed = await run('dernierschronos', {}, { laps: [] });
  assert.match(JSON.stringify(embed), /piste est calme/);
  embed = await run('aide', {}, new Error('must not query API'));
  for (const command of commands) if (command.name !== 'aide') assert.ok(JSON.stringify(embed).includes('/' + command.name));
  global.fetch = async () => { throw new Error('should not query API'); };
  for (const page of [0, -1, 1.2, '2', 10001]) assert.equal((await (await send('mesrecords', { pilote: id, page })).json()).type, 4);
  assert.equal((await (await send('circuits', { ville: '*' })).json()).type, 4);
});
