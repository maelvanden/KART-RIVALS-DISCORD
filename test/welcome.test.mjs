import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomePayload, createWelcomeHandler, DEFAULT_WELCOME_CHANNEL_ID } from '../welcome.mjs';
const guildId = '1570441175746347010';
const member = { id: '111111111111111111', joinedTimestamp: 1000,
 user: { bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
 guild: { id: guildId, channels: { cache: new Map([
  ['rules', { id: '222222222222222222', name: '📜│règlement', isTextBased: () => true }],
  ['general', { id: '333333333333333333', name: '💬│général', isTextBased: () => true }],
 ]) } },
};
test('welcome embed uses avatar, real channel mentions and only pings newcomer', () => {
 const payload = welcomePayload(member);
 assert.deepEqual(payload.allowed_mentions, { parse: [], users: [member.id] });
 assert.equal(payload.embeds[0].color, 0xdfff00);
 assert.match(payload.embeds[0].thumbnail.url, /^https:/);
 assert.match(JSON.stringify(payload), /<#222222222222222222>/);
 assert.match(JSON.stringify(payload), /<#333333333333333333>/);
 assert.equal(payload.enforce_nonce, true);
 assert.ok(payload.nonce.length <= 25);
 assert.equal(payload.nonce, welcomePayload(member).nonce);
 assert.notEqual(payload.nonce, welcomePayload({ ...member, joinedTimestamp: 2000 }).nonce);
 const fallback = welcomePayload({ ...member, guild: { ...member.guild, channels: { cache: new Map() } } });
 assert.doesNotMatch(JSON.stringify(fallback), /<#/);
 assert.match(JSON.stringify(fallback), /règlement/);
});
test('only welcomes new humans in target guild, suppresses duplicates and allows later rejoin', async () => {
 const sent = [];
 const handle = createWelcomeHandler({ guildId, channelId: DEFAULT_WELCOME_CHANNEL_ID,
  renderBanner: async () => Buffer.from("png-test"),
  send: async (...args) => { sent.push(args); }, log: { info() {}, error() {} } });
 await handle({ ...member, guild: { ...member.guild, id: '999999999999999999' } });
 await handle({ ...member, user: { ...member.user, bot: true } });
 assert.equal(sent.length, 0);
 await Promise.all([handle(member), handle(member)]);
 assert.equal(sent.length, 1);
 assert.equal(sent[0][0], '1571089851330068500');
 await handle({ ...member, joinedTimestamp: 2000 });
 assert.equal(sent.length, 2);
});
test('permission failures are caught without logging token or request content', async () => {
 const logs = [];
 const handle = createWelcomeHandler({ guildId, channelId: DEFAULT_WELCOME_CHANNEL_ID,
  renderBanner: async () => Buffer.from("png-test"),
  send: async () => { throw Object.assign(new Error('secret-token'), { code: 50013 }); },
  log: { info() {}, error: (...values) => logs.push(values) } });
 await handle(member);
 assert.equal(logs.length, 1);
 assert.match(JSON.stringify(logs), /50013/);
 assert.doesNotMatch(JSON.stringify(logs), /secret-token/);
});
