import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';
import { createTicketRouter, ticketOverwrites } from '../tickets.mjs';
const guild='111111111111111111', owner='222222222222222222', role='333333333333333333', bot='444444444444444444', channel='555555555555555555';
const env={DISCORD_GUILD_ID:guild,DISCORD_APPLICATION_ID:bot,DISCORD_BOT_TOKEN:'secret'};
const base={type:5,guild_id:guild,channel_id:channel,application_id:bot,token:'interaction',member:{user:{id:owner},roles:[],permissions:'0'},data:{custom_id:'kr-ticket:submit:bug:'+role,components:[{components:[{custom_id:'details',value:'Voici un problème à vérifier.'}]}]}};
function harness(channels=[]) {
 const calls=[];let done;const finished=new Promise(r=>done=r);
 const api={
  async get(path) { calls.push(['get',path]);if(path.endsWith('/roles'))return [{id:role,managed:false}]; if(path.startsWith('/guilds/'))return channels;return channels[0]; },
  async post(path,args) { calls.push(['post',path,args]);return {id:channel}; },
  async put(path,args) { calls.push(['put',path,args]); },
  async patch(path,args) { calls.push(['patch',path,args]);if(path.includes('/webhooks/'))done(args.body); },
 };
 return {calls,api,finished,route:createTicketRouter({env,rest:api,log:{error(){}}})};
}
test('privacy overwrites deny everyone and allow only requester, chosen role and bot',()=>{
 const a=ticketOverwrites(guild,owner,role,bot);
 assert.deepEqual(a.map(x=>x.id),[guild,owner,role,bot]);assert.equal(BigInt(a[0].deny)&P.ViewChannel,P.ViewChannel);
 assert.ok(a.slice(1).every(x=>(BigInt(x.allow)&P.ViewChannel)!==0n));
});
test('setup is admin only, foreign guild rejected and modal makes no API request',async()=>{
 const h=harness();
 assert.match((await h.route({...base,type:2,data:{name:'tickets'}}).json()).data.content,/administrateurs/);
 assert.match((await h.route({...base,guild_id:owner}).json()).data.content,/uniquement/);
 const modal=h.route({...base,type:3,message:{author:{id:bot}},data:{custom_id:'kr-ticket:new:chrono:'+role}});
 assert.equal((await modal.json()).type,9);assert.equal(h.calls.length,0);
});
test('creation acknowledges privately and channel is private at creation, concurrent duplicates blocked',async()=>{
 const h=harness();assert.equal((await h.route(base).json()).type,5);
 assert.equal((await h.route(base).json()).type,4);
 const result=await h.finished;assert.match(result.content,/<#555555555555555555>/);
 const create=h.calls.find(c=>c[0]==='post'&&c[1].endsWith('/channels'));
 assert.deepEqual(create[2].body.permission_overwrites,ticketOverwrites(guild,owner,role,bot));
 assert.equal(create[2].body.topic,`kr-ticket:${owner}:${role}:open`);
});
test('existing tickets survive restart and prevent another channel',async()=>{
 const h=harness([{id:channel,topic:`kr-ticket:${owner}:${role}:open`}]);h.route(base);
 assert.match((await h.finished).content,/déjà/);assert.equal(h.calls.filter(c=>c[0]==='post').length,0);
});
test('outsider cannot close and owner closure retains history without deleting channel',async()=>{
 const saved={id:channel,guild_id:guild,name:'ticket-bug',topic:`kr-ticket:${owner}:${role}:open`};
 const i={...base,type:3,data:{custom_id:'kr-ticket:confirm-close'}};
 const h=harness([saved]);h.route({...i,member:{user:{id:bot},roles:[],permissions:'0'}});
 assert.match((await h.finished).content,/Seuls/);assert.equal(h.calls.filter(c=>c[0]==='put').length,0);
 const ok=harness([saved]);ok.route(i);assert.match((await ok.finished).content,/fermé/);
 const lock=ok.calls.find(c=>c[0]==='put')[2].body;assert.ok((BigInt(lock.deny)&P.SendMessages)!==0n);
 assert.equal(ok.calls.find(c=>c[0]==='patch'&&!c[1].includes('webhooks'))[2].body.topic,`kr-ticket:${owner}:${role}:closed`);
});
test('API errors never expose secrets and creation lock is released',async()=>{
 const h=harness();h.api.get=async()=>{throw Object.assign(new Error('secret'),{code:50013});};h.route(base);
 const result=await h.finished;assert.doesNotMatch(result.content,/secret/);
 assert.equal((await h.route(base).json()).type,5);
});
test('admin publishes panel with all four buttons and no role ping',async()=>{
 const h=harness([{id:channel,guild_id:guild,type:0}]);
 h.route({...base,type:2,member:{...base.member,permissions:'8'},data:{name:'tickets',options:[{name:'staff',value:role}]}});
 assert.match((await h.finished).content,/publié/);
 const panel=h.calls.find(c=>c[0]==='post')[2].body;
 assert.equal(panel.components[0].components.length,4);assert.deepEqual(panel.allowed_mentions,{parse:[]});
});
test('deleted staff role fails closed without creating a channel',async()=>{
 const h=harness();h.api.get=async()=>[];h.route(base);
 assert.match((await h.finished).content,/rôle staff/);assert.equal(h.calls.filter(c=>c[0]==='post').length,0);
});
test('configured staff member can close a ticket',async()=>{
 const h=harness([{id:channel,guild_id:guild,name:'ticket-bug',topic:`kr-ticket:${owner}:${role}:open`}]);
 h.route({...base,type:3,member:{user:{id:bot},roles:[role],permissions:'0'},data:{custom_id:'kr-ticket:confirm-close'}});
 assert.match((await h.finished).content,/fermé/);
});

test('partnership opens its tailored form and creates a private ticket',async()=>{
 const h=harness();
 const modal=await h.route({...base,type:3,message:{author:{id:bot}},data:{custom_id:'kr-ticket:new:partenariat:'+role}}).json();
 assert.match(modal.data.title,/partenariat/);
 assert.match(modal.data.components[0].components[0].placeholder,/projet ou serveur/);
 h.route({...base,data:{...base.data,custom_id:modal.data.custom_id}});
 await h.finished;
 const create=h.calls.find(c=>c[0]==='post'&&c[1].endsWith('/channels'));
 assert.match(create[2].body.name,/ticket-partenariat/);
 assert.deepEqual(create[2].body.permission_overwrites,ticketOverwrites(guild,owner,role,bot));
});
