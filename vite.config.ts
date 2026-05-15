import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createRelay } from './src/lib/relay.js';

function relayPlugin(): Plugin {
	return {
		name: 'relay',
		configureServer(server) {
			const wss = new WebSocketServer({ noServer: true });
			createRelay(wss);

			server.httpServer?.on('upgrade', (request, socket, head) => {
				if (request.url === '/ws') {
					wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
				}
				// All other upgrade requests (Vite HMR) are left untouched
			});
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), relayPlugin()],
	server: {
		host: true
	}
});
