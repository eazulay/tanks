import { createRelay } from './build/relay.js';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 3001 });
createRelay(wss);
console.log('Tank Supremo relay listening on port 3001');
