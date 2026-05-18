// Production entry point.
// Run after `npm run build`: node server.js
// cPanel Node.js app startup file: server.js

import { handler } from './build/handler.js';
import { createRelay } from './build/relay.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const port = process.env.PORT ?? 3000;

const server = createServer(handler);

const wss = new WebSocketServer({ noServer: true });
createRelay(wss);

server.on('upgrade', (request, socket, head) => {
	if (request.url === '/ws') {
		wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
	}
	// Other upgrade paths (none expected in production) are left unhandled
});

server.listen(port, () => {
	console.log(`Tank Royale listening on port ${port}`);
	// Temporary: write port to file so it can be read from cPanel File Manager
	import('fs').then(({ writeFileSync }) => {
		try { writeFileSync(new URL('./port.txt', import.meta.url), String(port)); } catch {}
	});
});
