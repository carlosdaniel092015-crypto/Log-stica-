'use strict';
const config = require('../../config');

/**
 * Dirección escrita a partir de coordenadas con OpenStreetMap (Nominatim) cuando no hay
 * clave de servidor de Google. Respeta su política de uso: máximo 1 petición por segundo,
 * identificación propia y caché; es para el volumen de una empresa, no para uso masivo.
 */
const cache = new Map();
let queue = Promise.resolve();
let lastAt = 0;

function toResult(body, lat, lng) {
  const a = body?.address;
  if (!a) return null;
  const road = a.road || a.pedestrian || a.residential || a.footway || a.path;
  const street = road ? `${road}${a.house_number ? ` #${a.house_number}` : ''}` : null;
  const sector = a.neighbourhood || a.suburb || a.quarter || a.hamlet || a.village || a.city_district;
  const city = a.city || a.town || a.municipality || a.county;
  const formatted = [street, sector, city].filter(Boolean).join(', ') || body.display_name || null;
  const comp = (name, types) => (name ? { long_name: name, short_name: name, types } : null);
  return {
    formatted_address: formatted,
    lat,
    lng,
    place_id: null,
    source: 'osm',
    components: [
      comp(a.state, ['administrative_area_level_1']),
      comp(a.county, ['administrative_area_level_2']),
      comp(city, ['locality']),
      comp(a.suburb, ['sublocality_level_1', 'sublocality']),
      comp(a.neighbourhood || a.quarter, ['neighborhood']),
      comp(road, ['route']),
    ].filter(Boolean),
  };
}

async function reverseOsm(lat, lng, { fetchImpl = fetch } = {}) {
  if (!config.osmGeocoder) return null;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const run = async () => {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1', 'accept-language': 'es' }).toString();
    const res = await fetchImpl(url, { headers: { 'User-Agent': `LogisticaRD/1.0 (${config.publicBaseUrl})` }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return toResult(await res.json(), lat, lng);
  };
  const p = queue.then(run, run).catch(() => null);
  queue = p;
  const result = await p;
  if (result) {
    cache.set(key, result);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
  return result;
}

module.exports = { reverseOsm, toResult };
