// Library Card relay Worker: routes /v1/rooms/:roomId/… to the room's Durable Object and applies
// CORS. It stores nothing itself and never logs requests, tokens or bodies.
//
// Copied from Peek Budget's relay/src/index.js (tcjabc/substracker f0385ee) and changed: see VENDORED.md.

import { LibraryRoom } from './room.js';
import { LIMITS, originAllowed, parseRoute } from './room-logic.js';

export { LibraryRoom };

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Sync-Client',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Bodies bigger than this are refused from Content-Length alone, before reaching the room. */
const MAX_BODY = { push: LIMITS.maxBodyBytes, putBlob: LIMITS.maxBlobBytes };

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
  // A browser page from another origin gets a plain refusal; native and command-line clients send no Origin.
  if (origin && !allowed) return json(403, { error: 'origin_not_allowed', message: 'This origin may not use the relay.' }, { Vary: 'Origin' });
  const cors = allowed ? corsHeaders(origin) : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  // A health check for deploys and monitoring: no room, no token, no storage.
  if (url.pathname === '/v1/health' && request.method === 'GET') return json(200, { ok: true }, cors);

  const route = parseRoute(url.pathname, request.method);
  if (route.reply) return json(route.reply.status, route.reply.body, { ...cors, ...route.reply.headers });
  if (route.action === 'live' && request.headers.get('Upgrade') !== 'websocket') {
    return json(426, { error: 'upgrade_required', message: 'Open /live as a WebSocket.' }, cors);
  }
  const max = MAX_BODY[route.action];
  if (max && Number(request.headers.get('Content-Length') ?? 0) > max) {
    return json(413, { error: 'too_large', message: `The body may be at most ${max} bytes.` }, cors);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(route.roomId));
  const res = await stub.fetch(request);
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      // Name only: messages could in principle echo input.
      console.error(`relay: unexpected ${err?.name ?? 'error'}`);
      return json(500, { error: 'internal', message: 'The relay had a problem. Try again later.' });
    }
  },
};
