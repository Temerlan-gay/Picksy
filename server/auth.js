import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, requireValue } from './errors.js';

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 14 * 24 * 60 * 60 * 1000;
const publicUser = user => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name,
  email: user.email
});

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const sessionCookieName = 'picksy_session';

function cookieValue(request, name) {
  const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

function sessionCookie(value, maxAge, secure) {
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function passwordShape(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128;
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function passwordMatches(password, storedHash) {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!/^[\da-f]{32}$/i.test(saltHex || '') || !/^[\da-f]{128}$/i.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(expected, actual);
}

function createSession(db, userId, request, response) {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionLifetimeMs);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, createdAt.toISOString(), expiresAt.toISOString());
  const secure = request.socket.encrypted || process.env.NODE_ENV === 'production';
  response.setHeader('Set-Cookie', sessionCookie(token, Math.floor(sessionLifetimeMs / 1000), secure));
}

export function currentUser(db, request) {
  const token = cookieValue(request, sessionCookieName);
  if (!token || token.length > 200) return null;

  const session = db.prepare(`
    SELECT users.id, users.username, users.display_name, users.email, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(hashToken(token));
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return publicUser(session);
}

export async function handleAuth(db, request, response, url, body) {
  const secure = request.socket.encrypted || process.env.NODE_ENV === 'production';

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    return { user: currentUser(db, request) };
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Проверьте данные формы.');
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const password = body.password;

    requireValue(/^[a-z0-9_]{3,24}$/.test(username), 400, 'INVALID_USERNAME', 'Имя пользователя: 3–24 символа, латиница, цифры и _.');
    requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 400, 'INVALID_EMAIL', 'Введите корректный email.');
    requireValue(displayName.length >= 1 && displayName.length <= 50, 400, 'INVALID_NAME', 'Имя должно содержать от 1 до 50 символов.');
    requireValue(passwordShape(password), 400, 'INVALID_PASSWORD', 'Пароль должен содержать от 10 до 128 символов.');

    const passwordHashValue = await passwordHash(password);
    const user = { id: randomUUID(), username, email, display_name: displayName };
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('INSERT INTO users (id, username, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, username, email, displayName, passwordHashValue, new Date().toISOString());
      createSession(db, user.id, request, response);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
    return { status: 201, body: { user: publicUser(user) } };
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Проверьте данные формы.');
    const login = typeof body.login === 'string' ? body.login.trim().toLowerCase() : '';
    const password = body.password;
    requireValue(login.length > 0 && login.length <= 254 && typeof password === 'string' && password.length <= 128, 400, 'INVALID_CREDENTIALS', 'Введите email или имя пользователя и пароль.');

    const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ? COLLATE NOCASE').get(login, login);
    const matches = user ? await passwordMatches(password, user.password_hash) : false;
    if (!matches) throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.');
    createSession(db, user.id, request, response);
    return { user: publicUser(user) };
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = cookieValue(request, sessionCookieName);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    response.setHeader('Set-Cookie', sessionCookie('', 0, secure));
    return { ok: true };
  }

  return null;
}
