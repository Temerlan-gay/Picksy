const apiBaseUrl = import.meta.env.VITE_API_URL || '';

export async function apiRequest(path, { body, headers, ...options } = {}) {
  const requestHeaders = new Headers(headers || {});
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
