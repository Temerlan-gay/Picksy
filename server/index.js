import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { handleAuth } from './auth.js';
import { googleConfigFromEnv, handleGoogleAuth } from './google-auth.js';
import { handlePolls } from './polls.js';
import { handlePlaces } from './places.js';
import { AppError } from './errors.js';

if (existsSync(resolve(process.cwd(), '.env'))) process.loadEnvFile();

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const maxBodyBytes = 64 * 1024;
const rateLimits = new Map();
const staticFiles = new Set(['/index.html', '/app.js', '/decido.css', '/app.css', '/vote.css', '/styles.css']);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function applySecurityHeaders(response, isApi) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (isApi) response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function enforceSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError(403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  if (originUrl.host !== request.headers.host || !['http:', 'https:'].includes(originUrl.protocol)) {
    throw new AppError(403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
}

function rateLimit(request, key, limit, windowMs) {
  const now = Date.now();
  const identity = request.socket.remoteAddress || 'unknown';
  const bucketKey = `${key}:${identity}`;
  if (rateLimits.size > 1000) {
    for (const [storedKey, bucket] of rateLimits) {
      if (bucket.resetAt <= now) rateLimits.delete(storedKey);
    }
  }
  const current = rateLimits.get(bucketKey);
  if (!current || current.resetAt <= now) {
    rateLimits.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new AppError(429, 'RATE_LIMITED', 'Слишком много попыток. Попробуйте позже.');
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new AppError(413, 'BODY_TOO_LARGE', 'Запрос слишком большой.');
    chunks.push(chunk);
  }
  if (!size) return {};
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Ожидался JSON-запрос.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Не удалось прочитать данные запроса.');
  }
}

async function serveStatic(pathname, response) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  if (!staticFiles.has(requestPath)) return false;
  const file = resolve(root, `.${requestPath}`);
  if (!file.startsWith(`${root}${sep}`)) return false;
  const details = await stat(file);
  if (!details.isFile()) return false;
  const content = await readFile(file);
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': 'no-cache'
  });
  response.end(content);
  return true;
}

export function createApp({
  databasePath,
  googleConfig = googleConfigFromEnv(),
  placesApiKey = process.env.GOOGLE_PLACES_API_KEY,
  fetchImpl = fetch
} = {}) {
  const db = openDatabase(databasePath);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());

  const server = createServer(async (request, response) => {
    const isApi = request.url?.startsWith('/api/');
    applySecurityHeaders(response, isApi);
    let url;
    try {
      url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (isApi) {
        if (!['GET', 'POST'].includes(request.method || '')) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
        if (url.pathname.startsWith('/api/auth/google/')) {
          if (request.method !== 'GET') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
          rateLimit(request, 'google-auth', 20, 15 * 60 * 1000);
          if (await handleGoogleAuth(db, request, response, url, { config: googleConfig, fetchImpl })) return;
        }
        if (request.method !== 'GET') enforceSameOrigin(request);
        if (url.pathname.startsWith('/api/places/')) {
          if (request.method === 'POST') rateLimit(request, 'places-search', 20, 10 * 60 * 1000);
          const body = request.method === 'POST' ? await readJson(request) : {};
          const placesResult = await handlePlaces(db, request, url, body, { placesApiKey, fetchImpl });
          if (placesResult !== null) {
            const status = placesResult.status || 200;
            sendJson(response, status, placesResult.body || placesResult);
            return;
          }
        }
        if (request.method === 'POST' && url.pathname.startsWith('/api/auth/')) rateLimit(request, 'auth', 20, 15 * 60 * 1000);
        if (request.method === 'POST' && url.pathname.startsWith('/api/polls')) rateLimit(request, 'poll-write', 60, 60 * 1000);
        const body = request.method === 'POST' ? await readJson(request) : {};
        const authResult = await handleAuth(
          db,
          request,
          response,
          url,
          body,
          Boolean(googleConfig.clientId && googleConfig.clientSecret && googleConfig.redirectUri),
          Boolean(placesApiKey)
        );
        if (authResult !== null) {
          const status = authResult.status || 200;
          const payload = authResult.body || authResult;
          sendJson(response, status, payload);
          return;
        }
        if (url.pathname === '/api/health' && request.method === 'GET') {
          sendJson(response, 200, { ok: true });
          return;
        }
        const pollResult = handlePolls(db, request, url, body);
        if (pollResult !== null) {
          const status = pollResult.status || 200;
          sendJson(response, status, pollResult.body || pollResult);
          return;
        }
        throw new AppError(404, 'NOT_FOUND', 'Страница не найдена.');
      }

      if (request.method !== 'GET') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
      if (await serveStatic(decodeURIComponent(url.pathname), response)) return;
      throw new AppError(404, 'NOT_FOUND', 'Страница не найдена.');
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof AppError) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error.errcode === 2067 || error.errcode === 1555 || error.code?.startsWith('ERR_SQLITE_CONSTRAINT_UNIQUE')) {
        sendJson(response, 409, { error: { code: 'ALREADY_EXISTS', message: 'Такой email или логин уже зарегистрирован.' } });
        return;
      }
      console.error(error);
      sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить запрос. Попробуйте ещё раз.' } });
    }
  });

  return {
    server,
    db,
    listen(listenPort = port, listenHost = host) {
      return new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(listenPort, listenHost, () => {
          server.removeListener('error', rejectListen);
          resolveListen(server.address());
        });
      });
    },
    close() {
      return new Promise((resolveClose, rejectClose) => {
        server.close(error => {
          db.close();
          if (error) rejectClose(error);
          else resolveClose();
        });
      });
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen().then(address => {
    console.log(`Picksy is running at http://${address.address}:${address.port}`);
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
