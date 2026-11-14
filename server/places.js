import { AppError, requireValue } from './errors.js';
import { currentUser } from './auth.js';

const nearbySearchUrl = 'https://places.googleapis.com/v1/places:searchNearby';
const fieldMask = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.types',
  'places.priceLevel'
].join(',');
const categories = {
  sit: ['cafe', 'restaurant', 'bakery', 'bar'],
  play: ['bowling_alley', 'amusement_park', 'movie_theater', 'museum'],
  walk: ['park', 'tourist_attraction', 'zoo']
};
const levels = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };

function distanceMeters(from, to) {
  const radians = degree => degree * Math.PI / 180;
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitude / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, value));
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded)));
}

function formatPlace(place, origin) {
  let mapsUri = null;
  try {
    if (typeof place.googleMapsUri === 'string') mapsUri = new URL(place.googleMapsUri);
  } catch {
    return null;
  }
  if (!mapsUri || mapsUri.protocol !== 'https:' || !['maps.google.com', 'www.google.com', 'google.com'].includes(mapsUri.hostname)) return null;
  if (typeof place.id !== 'string' || typeof place.displayName?.text !== 'string' || typeof place.formattedAddress !== 'string') return null;
  if (!Number.isFinite(place.rating) || place.rating < 4 || !Number.isInteger(place.userRatingCount) || place.userRatingCount < 10) return null;
  if (!Number.isFinite(place.location?.latitude) || !Number.isFinite(place.location?.longitude)) return null;
  const meters = distanceMeters(origin, place.location);
  return {
    id: place.id.slice(0, 255),
    name: place.displayName.text.slice(0, 160),
    address: place.formattedAddress.slice(0, 300),
    rating: place.rating,
    ratingCount: place.userRatingCount,
    distanceMeters: meters,
    priceLevel: levels[place.priceLevel] ?? null,
    category: Array.isArray(place.types) ? place.types.find(type => Object.values(categories).flat().includes(type)) || 'place' : 'place',
    mapsUrl: mapsUri.href
  };
}

function validateLocation(body) {
  requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Не удалось прочитать местоположение.');
  requireValue(typeof body.latitude === 'number' && Number.isFinite(body.latitude) && body.latitude >= -90 && body.latitude <= 90, 400, 'INVALID_LOCATION', 'Некорректная широта.');
  requireValue(typeof body.longitude === 'number' && Number.isFinite(body.longitude) && body.longitude >= -180 && body.longitude <= 180, 400, 'INVALID_LOCATION', 'Некорректная долгота.');
  const category = body.category;
  requireValue(typeof category === 'string' && Object.hasOwn(categories, category), 400, 'INVALID_CATEGORY', 'Выберите подходящую подборку.');
  const radiusMeters = body.radiusMeters === undefined ? 5000 : body.radiusMeters;
  requireValue(Number.isInteger(radiusMeters) && radiusMeters >= 1000 && radiusMeters <= 20000, 400, 'INVALID_RADIUS', 'Радиус поиска должен быть от 1 до 20 км.');
  return { latitude: body.latitude, longitude: body.longitude, category, radiusMeters };
}

export async function handlePlaces(db, request, url, body, {
  placesApiKey = process.env.GOOGLE_PLACES_API_KEY,
  fetchImpl = fetch
} = {}) {
  if (!url.pathname.startsWith('/api/places/')) return null;
  if (request.method === 'GET' && url.pathname === '/api/places/status') {
    return { enabled: Boolean(placesApiKey) };
  }
  if (request.method !== 'POST' || url.pathname !== '/api/places/nearby') {
    throw new AppError(404, 'NOT_FOUND', 'Страница не найдена.');
  }
  if (!currentUser(db, request)) throw new AppError(401, 'AUTH_REQUIRED', 'Войдите, чтобы искать места рядом.');
  if (!placesApiKey) throw new AppError(503, 'PLACES_NOT_CONFIGURED', 'Поиск мест пока не настроен. Администратору нужно включить Google Places API.');

  const location = validateLocation(body);
  let response;
  try {
    response = await fetchImpl(nearbySearchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': placesApiKey,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify({
        includedTypes: categories[location.category],
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: location.latitude, longitude: location.longitude },
            radius: location.radiusMeters
          }
        }
      }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new AppError(504, 'PLACES_TIMEOUT', 'Поиск мест занял слишком много времени. Попробуйте ещё раз.');
    }
    throw new AppError(502, 'PLACES_UNAVAILABLE', 'Сервис поиска мест сейчас недоступен. Попробуйте ещё раз.');
  }

  if (!response.ok) {
    if (response.status === 429) throw new AppError(503, 'PLACES_QUOTA', 'Поиск мест временно ограничен. Попробуйте позже.');
    if (response.status === 400 || response.status === 403) throw new AppError(503, 'PLACES_PROVIDER_CONFIG', 'Не удалось выполнить поиск. Проверьте настройки Google Places API и платёжного аккаунта.');
    throw new AppError(502, 'PLACES_UNAVAILABLE', 'Сервис поиска мест сейчас недоступен. Попробуйте ещё раз.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new AppError(502, 'PLACES_RESPONSE_INVALID', 'Сервис поиска мест вернул некорректный ответ.');
  }
  if (!Array.isArray(result.places)) throw new AppError(502, 'PLACES_RESPONSE_INVALID', 'Сервис поиска мест вернул некорректный ответ.');

  const origin = { latitude: location.latitude, longitude: location.longitude };
  const places = result.places
    .map(place => formatPlace(place, origin))
    .filter(place => place && place.distanceMeters <= location.radiusMeters)
    .sort((left, right) => right.rating - left.rating || right.ratingCount - left.ratingCount || left.distanceMeters - right.distanceMeters);

  return {
    places,
    radiusMeters: location.radiusMeters,
    minimumRating: 4,
    minimumRatingCount: 10,
    source: 'Google Maps',
    locationStored: false
  };
}
