import { createServer } from 'node:http';
import { registerCommands } from './commands.mjs';
import { startWelcome } from './welcome.mjs';
import { handleInteraction } from './interactions.ts';

const port = Number(process.env.PORT ?? 3000);
createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === '/health' && incoming.method === 'GET') {
      outgoing.writeHead(200).end('OK');
      return;
    }
    if (incoming.url !== '/interactions') {
      outgoing.writeHead(404).end();
      return;
    }

    const method = incoming.method;
    if (method !== 'POST') {
      outgoing.writeHead(405).end();
      return;
    }
    const parts = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 64 * 1024) {
        outgoing.writeHead(413).end();
        return;
      }
      parts.push(chunk);
    }
    const response = await handleInteraction(new Request('http://localhost/interactions', {
      method,
      headers: incoming.headers,
      body: Buffer.concat(parts),
    }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500).end();
  }
}).listen(port, '0.0.0.0', () => console.log('Kart Rivals Discord · port ' + port));

// Optional: install/update slash commands after deployment without a local terminal.
// Missing token does not prevent the HTTP interactions server from running.
if (process.env.DISCORD_BOT_TOKEN) {
  void registerCommands().catch((error) => console.error('Command registration failed:', error.message));
}

const welcomeClient = startWelcome();
process.once('SIGTERM', () => { welcomeClient?.destroy(); process.exit(0); });
process.once('SIGINT', () => { welcomeClient?.destroy(); process.exit(0); });
