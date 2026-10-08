'use strict';

const EARTH_RADIUS_M = 6371000;

function toRad(d) {
  return (d * Math.PI) / 180;
}

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Punto dentro de polígono (ray casting). polygon = [[lat, lng], ...].
 * Suficientemente preciso para zonas urbanas (escala de kilómetros).
 */
function pointInPolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Normaliza nombres geográficos para compararlos (sin tildes, minúsculas, sin prefijos). */
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(provincia|municipio|distrito municipal|sector|ensanche|ens\.|de|del|la|las|los|el)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

module.exports = { distanceMeters, pointInPolygon, normalizeName, isValidCoord };
