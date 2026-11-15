import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderWelcomeBanner, fetchAvatar } from '../welcome-banner.mjs';
import { createWelcomeHandler } from '../welcome.mjs';
const member={id:'111111111111111111',displayName:'Maël',joinedTimestamp:1000,
 user:{bot:false,displayAvatarURL:()=> 'https://cdn.discordapp.com/embed/avatars/0.png'},
 guild:{id:'1570441175746347010',channels:{cache:new Map()}}};
test('banner includes supplied avatar in a real PNG and renders long names',async()=>{
 const avatar=createCanvas(256,256);const a=avatar.getContext('2d');a.fillStyle='#ff0000';a.fillRect(0,0,256,256);
 const buffer=await avatar.encode('png');
 for(const displayName of ['Maël','Pilote très très très très très très très très très très très très long']){
  const png=await renderWelcomeBanner({...member,displayName},{avatarBuffer:buffer});
  assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length<2*1024*1024);
  const image=await loadImage(png);assert.equal(image.width,1200);assert.equal(image.height,440);
  const canvas=createCanvas(1200,440);const c=canvas.getContext('2d');c.drawImage(image,0,0);
  assert.deepEqual([...c.getImageData(190,220,1,1).data],[255,0,0,255]);
 }
 const fallback=await renderWelcomeBanner(member,{fetcher:async()=>{throw new Error('offline');}});
 assert.equal((await loadImage(fallback)).width,1200);
});
test('avatar download is bounded and only uses Discord CDN',async()=>{
 let requests=0;
 const fetcher=async()=>{requests++;return new Response(new Uint8Array(2*1024*1024+1),{headers:{'content-type':'image/png'}});};
 await assert.rejects(fetchAvatar('https://evil.example/avatar.png',fetcher),/host/);
 assert.equal(requests,0);
 await assert.rejects(fetchAvatar('https://cdn.discordapp.com/avatars/x.png',fetcher),/large/);
 await assert.rejects(fetchAvatar('https://cdn.discordapp.com/avatars/x.png',async()=> new Response('text',{headers:{'content-type':'text/plain'}})),/unavailable/);
});
test('welcome sends image attachment and safely falls back to regular embed',async()=>{
 let sent;
 const deps={guildId:member.guild.id,channelId:'1571089851330068500',send:async(...args)=>{sent=args},log:{info(){},warn(){},error(){}}};
 await createWelcomeHandler({...deps,renderBanner:async()=>Buffer.from('png')})(member);
 assert.equal(sent[1].embeds[0].image.url,'attachment://bienvenue.png');
 assert.equal(sent[1].embeds[0].thumbnail,undefined);
 assert.equal(sent[2][0].name,sent[1].attachments[0].filename);
 assert.equal(sent[2][0].data.toString(),'png');
 await createWelcomeHandler({...deps,renderBanner:async()=>{throw new Error('render unavailable')}})(member);
 assert.equal(sent[2],undefined);assert.ok(sent[1].embeds[0].thumbnail);
 assert.equal(sent[1].embeds[0].image,undefined);
});
