'use strict';
/**
 * Integración del lado servidor con Google Maps Platform.
 * Usa la clave de servidor (GOOGLE_MAPS_SERVER_KEY), que nunca se envía al navegador.
 *  - Geocoding API: geocodificación y geocodificación inversa.
 *  - Routes API (computeRoutes): distancia y tiempo estimado de llegada.
 * Si no hay clave configurada se usa una estimación local (distancia en línea recta).
 */
const config = require('../../config');
const { distanceMeters } = require('../../utils/geo');

const enabled = () => !!config.google.serverKey;

async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function mapGeocodeResult(r) {
  return {
    formatted_address: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    place_id: r.place_id,
    components: r.address_components,
  };
}

async function geocode(address) {
  if (!enabled()) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'do');
  url.searchParams.set('components', 'country:DO');
  url.searchParams.set('language', 'es');
  url.searchParams.set('key', config.google.serverKey);
  const body = await fetchJson(url);
  return body.results?.length ? mapGeocodeResult(body.results[0]) : null;
}

async function reverseGeocode(lat, lng) {
  if (!enabled()) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('language', 'es');
  url.searchParams.set('key', config.google.serverKey);
  const body = await fetchJson(url);
  return body.results?.length ? mapGeocodeResult(body.results[0]) : null;
}

function estimateLocally(from, to, avgSpeedKmh) {
  // Factor 1.35 para aproximar la distancia por calles a partir de la línea recta.
  const meters = distanceMeters(from.lat, from.lng, to.lat, to.lng) * 1.35;
  const seconds = Math.round(meters / ((avgSpeedKmh * 1000) / 3600));
  return { distance_m: Math.round(meters), duration_s: seconds, source: 'estimate', polyline: null };
}

/** Calcula distancia y duración entre dos puntos (Routes API, con respaldo local). */
async function computeEta(from, to, { avgSpeedKmh = 25 } = {}) {
  if (!enabled()) return estimateLocally(from, to, avgSpeedKmh);
  try {
    const body = await fetchJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.google.serverKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'es-419',
        regionCode: 'DO',
      }),
    });
    const route = body.routes?.[0];
    if (!route) return estimateLocally(from, to, avgSpeedKmh);
    return {
      distance_m: route.distanceMeters,
      duration_s: parseInt(String(route.duration || '0').replace('s', ''), 10),
      source: 'google_routes',
      polyline: route.polyline?.encodedPolyline || null,
    };
  } catch (err) {
    if (!config.isTest) console.warn('[maps] Routes API no disponible, se usa estimación local:', err.message);
    return estimateLocally(from, to, avgSpeedKmh);
  }
}

module.exports = { enabled, geocode, reverseGeocode, computeEta };
