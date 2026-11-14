const apiBaseUrl = import.meta.env.VITE_API_URL || '';
const guestStorageKey = 'picksy-room-guests';
const pollInviteStorageKey = 'picksy-poll-invitations';

function readSessionMap(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; }
}

export function saveRoomGuestToken(roomId, token) {
  const sessions = readSessionMap(guestStorageKey);
  sessions[roomId] = token;
  sessionStorage.setItem(guestStorageKey, JSON.stringify(sessions));
}

export function hasRoomGuestToken(roomId) {
  return Boolean(readSessionMap(guestStorageKey)[roomId]);
}

export function savePollInviteToken(pollId, token) {
  const invitations = readSessionMap(pollInviteStorageKey);
  invitations[pollId] = token;
  sessionStorage.setItem(pollInviteStorageKey, JSON.stringify(invitations));
}

export function getPollInviteToken(pollId) {
  return readSessionMap(pollInviteStorageKey)[pollId] || '';
}

function addRoomGuestHeader(path, requestHeaders) {
  const roomId = path.match(/^\/api\/rooms\/([0-9a-f-]{36})/i)?.[1];
  if (!roomId) return;
  const token = readSessionMap(guestStorageKey)[roomId];
  if (token) requestHeaders.set('X-Room-Guest', token);
}

function addPollInviteHeader(path, requestHeaders) {
  const pollId = path.match(/^\/api\/polls\/([0-9a-f-]{36})/i)?.[1];
  if (!pollId) return;
  const token = readSessionMap(pollInviteStorageKey)[pollId];
  if (token) requestHeaders.set('X-Poll-Invite', token);
}

export async function apiRequest(path, { body, headers, ...options } = {}) {
  const requestHeaders = new Headers(headers || {});
  addRoomGuestHeader(path, requestHeaders);
  addPollInviteHeader(path, requestHeaders);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: requestHeaders,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверьте, что backend запущен.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || 'Не удалось выполнить запрос.');
  }
  return payload;
}
