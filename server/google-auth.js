import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import { AppError } from './errors.js';
import { createSession, currentUser } from './auth.js';

const stateCookieName = 'picksy_google_state';
const nonceCookieName = 'picksy_google_nonce';
const verifierCookieName = 'picksy_google_verifier';
const intentCookieName = 'picksy_google_intent';
const authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const keysEndpoint = 'https://www.googleapis.com/oauth2/v3/certs';
const stateLifetimeSeconds = 600;

let cachedKeys;
let cachedKeysExpireAt = 0;

export function googleConfigFromEnv() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI
  };
}

export function isGoogleConfigured(config) {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

function cookieMap(request) {
  return new Map((request.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const separator = part.indexOf('=');
      return separator < 0 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)];
    }));
}

function secureCookie(request, name, value, maxAge) {
  const secure = request.socket.encrypted || process.env.NODE_ENV === 'production';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function constantTimeMatch(left, right) {
  if (!left || !right) return false;
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': cookies });
  response.end();
}

function clearStateCookies(request) {
  return [
    secureCookie(request, stateCookieName, '', 0),
    secureCookie(request, nonceCookieName, '', 0),
    secureCookie(request, verifierCookieName, '', 0),
    secureCookie(request, intentCookieName, '', 0)
  ];
}

async function googleKeys(fetchImpl) {
  if (cachedKeys && cachedKeysExpireAt > Date.now()) return cachedKeys;
  const response = await fetchImpl(keysEndpoint);
  if (!response.ok) throw new AppError(502, 'GOOGLE_KEYS_UNAVAILABLE', 'Не удалось проверить ответ Google.');
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new AppError(502, 'GOOGLE_KEYS_INVALID', 'Не удалось проверить ответ Google.');
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  cachedKeys = payload.keys;
  cachedKeysExpireAt = Date.now() + Math.min(maxAge, 3600) * 1000;
  return cachedKeys;
}

async function verifyIdentityToken(token, expectedNonce, config, fetchImpl) {
  if (typeof token !== 'string' || token.length > 16_384) throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Не удалось подтвердить аккаунт Google.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Не удалось подтвердить аккаунт Google.');

  let header;
  let claims;
  let signature;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Не удалось подтвердить аккаунт Google.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Не удалось подтвердить аккаунт Google.');

  const keys = await googleKeys(fetchImpl);
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) {
    cachedKeysExpireAt = 0;
    throw new AppError(401, 'GOOGLE_KEY_NOT_FOUND', 'Не удалось подтвердить подпись Google.');
  }
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const validSignature = verify('RSA-SHA256', signingInput, createPublicKey({ key: jwk, format: 'jwk' }), signature);
  if (!validSignature) throw new AppError(401, 'GOOGLE_SIGNATURE_INVALID', 'Не удалось подтвердить подпись Google.');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const audienceMatches = Array.isArray(claims.aud)
    ? claims.aud.includes(config.clientId)
      && (claims.aud.length === 1 || claims.azp === config.clientId)
    : claims.aud === config.clientId;
  const issuerMatches = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issuerMatches || !audienceMatches
    || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds
    || !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 60
    || typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 255
    || !constantTimeMatch(claims.nonce, expectedNonce)
    || typeof claims.email !== 'string'
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)
    || claims.email_verified !== true) {
    throw new AppError(401, 'GOOGLE_CLAIMS_INVALID', 'Google не вернул подтверждённый аккаунт. Попробуйте ещё раз.');
  }
  return {
    subject: claims.sub,
    email: claims.email.trim().toLowerCase(),
    displayName: typeof claims.name === 'string' && claims.name.trim()
      ? [...claims.name.trim()].slice(0, 50).join('')
      : claims.email.split('@')[0].slice(0, 50)
  };
}

function usernameBase(email) {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 17);
  return base.length >= 3 ? base : `user_${base}`.slice(0, 17);
}

function findOrCreateGoogleUser(db, identity) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(identity.subject);
    if (!user) {
      const existingEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(identity.email);
      if (existingEmail) {
        throw new AppError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'Аккаунт с таким email уже существует. Войдите по паролю и подключите Google в профиле.');
      } else {
        const base = usernameBase(identity.email);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const suffix = randomBytes(4).toString('hex');
          const username = `${base.slice(0, 24 - suffix.length - 1)}_${suffix}`;
          try {
            const id = randomUUID();
            db.prepare(`
              INSERT INTO users (id, username, email, display_name, password_hash, created_at, google_sub)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(id, username, identity.email, identity.displayName, `google-only:${randomBytes(32).toString('hex')}`, new Date().toISOString(), identity.subject);
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
            break;
          } catch (error) {
            if (error.errcode === 2067 && db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(identity.email)) {
              throw new AppError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'Аккаунт с таким email уже существует. Войдите по паролю и подключите Google в профиле.');
            }
            if (error.errcode !== 2067 || attempt === 4) throw error;
          }
        }
      }
    }

    if (!user) throw new AppError(500, 'GOOGLE_USER_CREATE_FAILED', 'Не удалось создать аккаунт Picksy.');
    db.exec('COMMIT;');
    return user;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function linkGoogleAccount(db, user, identity) {
  if (user.email.toLowerCase() !== identity.email) {
    throw new AppError(409, 'GOOGLE_EMAIL_MISMATCH', 'Для безопасной привязки используйте Google-аккаунт с тем же email.');
  }
  const linkedUser = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(identity.subject);
  if (linkedUser && linkedUser.id !== user.id) {
    throw new AppError(409, 'GOOGLE_ACCOUNT_LINKED', 'Этот аккаунт Google уже связан с другим профилем Picksy.');
  }
  db.prepare('UPDATE users SET google_sub = ? WHERE id = ? AND (google_sub IS NULL OR google_sub = ?)')
    .run(identity.subject, user.id, identity.subject);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!updatedUser || updatedUser.google_sub !== identity.subject) {
    throw new AppError(409, 'GOOGLE_ACCOUNT_LINKED', 'Не удалось привязать этот аккаунт Google.');
  }
  return updatedUser;
}

function failureReason(error) {
  if (error instanceof AppError && error.code === 'GOOGLE_NOT_CONFIGURED') return 'not_configured';
  if (error instanceof AppError && error.status === 409) return 'account_conflict';
  return 'sign_in_failed';
}

export async function handleGoogleAuth(db, request, response, url, {
  config = googleConfigFromEnv(),
  fetchImpl = fetch
} = {}) {
  if (request.method === 'GET' && url.pathname === '/api/auth/google/start') {
    if (!isGoogleConfigured(config)) {
      redirect(response, '/?google_error=not_configured');
      return true;
    }
    const intent = url.searchParams.get('intent') === 'link' ? 'link' : 'login';
    const linkUser = intent === 'link' ? currentUser(db, request) : null;
    if (intent === 'link' && !linkUser) {
      redirect(response, '/?google_error=login_required');
      return true;
    }
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorization = new URL(authorizationEndpoint);
    authorization.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    }).toString();
    redirect(response, authorization.toString(), [
      secureCookie(request, stateCookieName, state, stateLifetimeSeconds),
      secureCookie(request, nonceCookieName, nonce, stateLifetimeSeconds),
      secureCookie(request, verifierCookieName, verifier, stateLifetimeSeconds),
      secureCookie(request, intentCookieName, intent, stateLifetimeSeconds)
    ]);
    return true;
  }

  if (request.method !== 'GET' || url.pathname !== '/api/auth/google/callback') return false;

  const cookies = cookieMap(request);
  const state = url.searchParams.get('state');
  const expectedState = cookies.get(stateCookieName);
  const expectedNonce = cookies.get(nonceCookieName);
  const expectedVerifier = cookies.get(verifierCookieName);
  const intent = cookies.get(intentCookieName);
  const initialSessionUser = intent === 'link' ? currentUser(db, request) : null;
  const clearCookies = clearStateCookies(request);
  if (!isGoogleConfigured(config)) {
    redirect(response, '/?google_error=not_configured', clearCookies);
    return true;
  }
  if (!constantTimeMatch(state, expectedState) || !expectedNonce || !expectedVerifier || !['login', 'link'].includes(intent)) {
    redirect(response, '/?google_error=invalid_state', clearCookies);
    return true;
  }
  if (intent === 'link' && !initialSessionUser) {
    redirect(response, '/?google_error=login_required', clearCookies);
    return true;
  }
  if (url.searchParams.has('error')) {
    redirect(response, '/?google_error=cancelled', clearCookies);
    return true;
  }
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) {
    redirect(response, '/?google_error=sign_in_failed', clearCookies);
    return true;
  }

  try {
    const tokenResponse = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: expectedVerifier
      })
    });
    if (!tokenResponse.ok) throw new AppError(502, 'GOOGLE_TOKEN_EXCHANGE_FAILED', 'Google не завершил вход.');
    const tokenPayload = await tokenResponse.json();
    const identity = await verifyIdentityToken(tokenPayload.id_token, expectedNonce, config, fetchImpl);
    let user;
    if (intent === 'link') {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const latestUser = currentUser(db, request);
        if (!latestUser || latestUser.id !== initialSessionUser.id) {
          throw new AppError(401, 'SESSION_CHANGED', 'Сессия изменилась. Войдите и попробуйте привязать Google снова.');
        }
        user = linkGoogleAccount(db, db.prepare('SELECT * FROM users WHERE id = ?').get(latestUser.id), identity);
        db.exec('COMMIT;');
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
    } else {
      user = findOrCreateGoogleUser(db, identity);
      createSession(db, user.id, request, response);
    }
    const sessionCookie = response.getHeader('Set-Cookie');
    redirect(response, '/?google_login=success', [
      ...clearCookies,
      ...(Array.isArray(sessionCookie) ? sessionCookie : [sessionCookie]).filter(Boolean)
    ]);
  } catch (error) {
    if (!(error instanceof AppError)) console.error(error);
    redirect(response, `/?google_error=${failureReason(error)}`, clearCookies);
  }
  return true;
}
