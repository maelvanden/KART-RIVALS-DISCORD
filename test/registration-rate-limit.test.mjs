import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, registerCommands } from '../commands.mjs';
const env = { DISCORD_APPLICATION_ID: '333333333333333333', DISCORD_GUILD_ID: '111111111111111111', DISCORD_BOT_TOKEN: 'test' };
test('429 on profil retries that command then registers the remaining commands', async () => {
  const calls = [], waits = [];
  let limited = false;
  await registerCommands(env, async (_url, init) => {
    const c = JSON.parse(init.body);
    calls.push(c.name);
    if (c.name === 'profil' && !limited) {
      limited = true;
      return Response.json({ retry_after: 1.5 }, { status: 429 });
    }
    if (c.name === 'profil') assert.equal(c.options[0].required, false);
    return Response.json({});
  }, async (ms) => waits.push(ms));
  assert.deepEqual(calls, [...commands.slice(0, 6).map(c => c.name), ...commands.slice(5).map(c => c.name)]);
  assert.deepEqual(waits, [1750]);
});
test('honours header-only limits and exhausted buckets', async () => {
  let count = 0;
  const waits = [];
  await registerCommands(env, async () => {
    count++;
    if (count === 1) return new Response('', { status: 429, headers: { 'Retry-After': '2' } });
    if (count === 2) return Response.json({}, { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.5' } });
    return Response.json({});
  }, async ms => waits.push(ms));
  assert.deepEqual(waits, [2250, 750]);
});
test('persistent limits have bounded retries and do not skip to other commands', async () => {
  let calls = 0;
  await assert.rejects(registerCommands(env, async () => {
    calls++;
    return Response.json({ retry_after: 0.1 }, { status: 429 });
  }, async () => {}), /limite Discord persistante/);
  assert.equal(calls, 11);
});
test('authentication errors fail without retrying', async () => {
  await assert.rejects(registerCommands(env, async () => new Response('', { status: 401 }), async () => {
    assert.fail('must not retry');
  }), /HTTP 401/);
});
