import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

const asset = (name) => fileURLToPath(new URL('./assets/' + name, import.meta.url));
GlobalFonts.registerFromPath(asset('welcome-bold.ttf'), 'KartWelcome');
const logo = loadImage(asset('kart-rivals-logo.png'));
const lime = '#dfff00';

export async function fetchAvatar(url, fetcher = fetch) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'cdn.discordapp.com') throw new Error('Invalid avatar host');
  const response = await fetcher(target, { signal: AbortSignal.timeout(4000), redirect: 'error' });
  if (!response.ok || !/^image\/(png|webp|jpeg)/.test(response.headers.get('content-type') ?? '')) throw new Error('Avatar unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error('Avatar too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

function label(ctx, text, x, y, size, color = '#f5f7fa') {
  ctx.font = size + 'px KartWelcome'; ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function fitName(ctx, raw, maxWidth) {
  let text = String(raw || 'Nouveau pilote').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 100) || 'Nouveau pilote';
  let size = 36;
  for (; size > 24; size--) { ctx.font = size + 'px KartWelcome'; if (ctx.measureText(text).width <= maxWidth) break; }
  const chars = [...text];
  while (chars.length && ctx.measureText(chars.join('')).width > maxWidth) { chars.pop(); text = chars.join('') + '…'; if (ctx.measureText(text).width <= maxWidth) return { text, size }; }
  return { text: chars.join(''), size };
}

// A fresh image is rendered per member. No generated placeholder replaces their avatar.
export async function renderWelcomeBanner(member, { avatarBuffer, fetcher = fetch } = {}) {
  const canvas = createCanvas(1200, 440);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101417'; ctx.fillRect(0, 0, 1200, 440);
  // Quiet racing lines keep the text readable at Discord mobile sizes.
  ctx.strokeStyle = '#22292d'; ctx.lineWidth = 2;
  for (let x = 640; x < 1500; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 260, 440); ctx.stroke(); }
  ctx.fillStyle = '#151b1e'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(350, 0); ctx.lineTo(280, 440); ctx.lineTo(0, 440); ctx.fill();
  ctx.fillStyle = lime; ctx.fillRect(0, 0, 10, 440);
  ctx.fillRect(380, 80, 38, 4);
  label(ctx, 'LA GRILLE S’AGRANDIT', 432, 90, 18, lime);
  // Original supplied logo, unchanged, on a matching dark panel.
  ctx.drawImage(await logo, 1048, 28, 112, 112);

  const cx = 190, cy = 220, radius = 116;
  ctx.beginPath(); ctx.arc(cx, cy, radius + 13, 0, Math.PI * 2);
  ctx.strokeStyle = '#303a26'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, radius + 5, -Math.PI / 2, Math.PI * 1.5);
  ctx.strokeStyle = lime; ctx.lineWidth = 5; ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#252e33'; ctx.fillRect(cx-radius, cy-radius, radius*2, radius*2);
  try {
    const bytes = avatarBuffer ?? await fetchAvatar(member.user.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true }), fetcher);
    const avatar = await loadImage(bytes);
    const side = Math.min(avatar.width, avatar.height);
    ctx.drawImage(avatar, (avatar.width-side)/2, (avatar.height-side)/2, side, side, cx-radius, cy-radius, radius*2, radius*2);
  } catch {
    // Network failure: use a neutral silhouette, never a different member's photo.
    ctx.fillStyle = '#abb6be'; ctx.beginPath(); ctx.arc(cx, cy-25, 38, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy+100, 86, 78, 0, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
  label(ctx, 'BIENVENUE', 378, 176, 70);
  label(ctx, 'SUR KART RIVALS', 380, 228, 40, lime);
  const name = fitName(ctx, member.displayName || member.user.globalName || member.user.username, 700);
  label(ctx, name.text, 382, 291, name.size);
  label(ctx, 'Ta place est sur la grille.', 382, 328, 20, '#aab6bd');
  ctx.fillStyle = '#2a3338'; ctx.fillRect(380, 368, 755, 1);
  label(ctx, 'KARTING  /  CHRONOS  /  COMMUNAUTÉ', 382, 402, 15, '#9ba7ae');
  for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
    if ((row + col) % 2 === 0) { ctx.fillStyle = lime; ctx.fillRect(1050+col*14, 386+row*14, 14, 14); }
  }
  return canvas.encode('png');
}
