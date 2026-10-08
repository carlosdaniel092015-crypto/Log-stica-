'use strict';
/**
 * Lee coordenadas de lo que el cliente comparte por WhatsApp u otra app:
 *  - https://www.google.com/maps?q=18.5175,-70.0450&z=17   (ubicación de WhatsApp)
 *  - https://www.google.com/maps/place/…/@18.47,-69.93,17z/data=…!3d18.4712!4d-69.9301
 *  - https://www.google.com/maps/search/?api=1&query=18.47,-69.93 · …/dir/?destination=…
 *  - https://maps.app.goo.gl/… y https://goo.gl/maps/… (enlaces cortos: se siguen solo hacia Google)
 *  - https://waze.com/ul?ll=18.47,-69.93 · https://maps.apple.com/?ll=18.47,-69.93 · geo:18.47,-69.93
 *  - "18.4712, -69.9301" escrito a mano
 */

// Con decimales: así "Calle 5, 10" no se confunde con coordenadas.
const NUM = '(-?\\d{1,3}\\.\\d+)';
const PAIR = new RegExp(`${NUM}\\s*,\\s*${NUM}`);

function valid(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function pair(text) {
  const m = PAIR.exec(String(text || '').replace(/%2C/gi, ','));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}

/** Si el texto trae un enlace dentro (p. ej. "Mi ubicación: https://…"), usa el enlace. */
function extractLink(input) {
  const text = String(input || '').trim();
  const m = /(https?:\/\/[^\s<>"]+|geo:[^\s<>"]+)/i.exec(text);
  return m && m[0] !== text ? m[0].replace(/[).,;]+$/, '') : text;
}

/** Coordenadas dentro de un texto o URL (sin hacer peticiones). */
function parseLocation(input) {
  const text = extractLink(input);
  if (!text) return null;

  // Punto exacto del lugar en enlaces de Google Maps: …!3d18.47!4d-69.93
  const place = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(text);
  if (place && valid(Number(place[1]), Number(place[2]))) return { lat: Number(place[1]), lng: Number(place[2]) };

  let url = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (url) {
    if (url.protocol === 'geo:') return pair(url.pathname || text.slice(4));
    for (const key of ['q', 'query', 'll', 'destination', 'daddr', 'center', 'sll', 'loc']) {
      const value = url.searchParams.get(key);
      const found = value && pair(value.replace(/^loc:/, ''));
      if (found) return found;
    }
    // Centro del mapa: …/@18.47,-69.93,17z
    const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
    if (at && valid(Number(at[1]), Number(at[2]))) return { lat: Number(at[1]), lng: Number(at[2]) };
    const inPath = pair(decodeURIComponent(url.pathname));
    if (inPath) return inPath;
    return null;
  }
  if (/^geo:/i.test(text)) return pair(text.slice(4));
  // Texto con solo coordenadas (con o sin espacios/paréntesis).
  return /^[\s(]*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+[\s)]*$/.test(text) ? pair(text) : null;
}

// Solo se siguen enlaces cortos hacia dominios de Google (evita usar el servidor como proxy).
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
const GOOGLE_HOST = /(^|\.)google\.[a-z.]{2,6}$|(^|\.)goo\.gl$|(^|\.)g\.co$/i;

function isShortLink(text) {
  try {
    const u = new URL(String(text).trim());
    return u.protocol === 'https:' && SHORT_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Sigue las redirecciones de un enlace corto (máx. 5 saltos, solo https y dominios de Google). */
async function expandShortLink(text, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  let current = new URL(String(text).trim());
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== 'https:' || !GOOGLE_HOST.test(current.hostname)) return null;
    const found = parseLocation(current.href);
    if (found && hop > 0) return current.href;
    const res = await fetchImpl(current.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (LogisticaRD)' } });
    const location = res.headers.get('location');
    if (!location || res.status < 300 || res.status >= 400) return current.href;
    current = new URL(location, current);
  }
  return current.href;
}

/** Coordenadas de un texto pegado; expande enlaces cortos si hace falta. */
async function resolveLocationText(input, opts) {
  const text = extractLink(input);
  const direct = parseLocation(text);
  if (direct) return { ...direct, source: 'link' };
  if (!isShortLink(text)) return null;
  const finalUrl = await expandShortLink(text, opts);
  const found = finalUrl && parseLocation(finalUrl);
  return found ? { ...found, source: 'short_link' } : null;
}

module.exports = { parseLocation, isShortLink, expandShortLink, resolveLocationText };
