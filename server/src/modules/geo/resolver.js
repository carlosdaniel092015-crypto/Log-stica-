'use strict';
const { db } = require('../../db');
const { distanceMeters, normalizeName } = require('../../utils/geo');

function nearest(rows, lat, lng, maxMeters) {
  let best = null;
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const d = distanceMeters(lat, lng, r.lat, r.lng);
    if (d <= maxMeters && (!best || d < best.d)) best = { row: r, d };
  }
  return best?.row || null;
}

function byName(rows, names) {
  const wanted = names.map(normalizeName).filter(Boolean);
  if (!wanted.length) return null;
  for (const w of wanted) {
    const hit = rows.find((r) => normalizeName(r.name) === w);
    if (hit) return hit;
  }
  return null;
}

/**
 * Determina provincia, municipio y sector a partir de coordenadas y, si existen,
 * los componentes de dirección devueltos por Google (address_components).
 * Primero intenta por nombre; si no hay coincidencia usa el centroide más cercano
 * registrado en la base de datos (aproximado).
 */
async function resolveAdministrative({ lat, lng, components = [] }) {
  const [provinces, municipalities, sectors] = await Promise.all([
    db('provinces').where({ active: true }).select('id', 'name', 'lat', 'lng'),
    db('municipalities').where({ active: true }).select('id', 'province_id', 'name', 'lat', 'lng'),
    db('sectors').where({ active: true }).select('id', 'municipality_id', 'name', 'lat', 'lng'),
  ]);

  const names = (types) =>
    components.filter((c) => (c.types || []).some((t) => types.includes(t))).flatMap((c) => [c.long_name || c.longText, c.short_name || c.shortText]);

  let province = byName(provinces, names(['administrative_area_level_1']));
  let municipality = byName(
    province ? municipalities.filter((m) => m.province_id === province.id) : municipalities,
    names(['administrative_area_level_2', 'locality', 'administrative_area_level_3', 'sublocality_level_1'])
  );
  let sector = byName(
    municipality ? sectors.filter((s) => s.municipality_id === municipality.id) : sectors,
    names(['neighborhood', 'sublocality', 'sublocality_level_1', 'sublocality_level_2', 'route', 'premise'])
  );
  let approximate = false;

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  if (hasCoords) {
    if (!sector) {
      const pool = municipality ? sectors.filter((s) => s.municipality_id === municipality.id) : sectors;
      sector = nearest(pool, lat, lng, 2500);
      if (sector) approximate = true;
    }
    if (!municipality) {
      municipality = sector
        ? municipalities.find((m) => m.id === sector.municipality_id)
        : nearest(province ? municipalities.filter((m) => m.province_id === province.id) : municipalities, lat, lng, 12000);
      if (municipality) approximate = true;
    }
    if (!province) {
      province = municipality
        ? provinces.find((p) => p.id === municipality.province_id)
        : nearest(provinces, lat, lng, 60000);
      if (province) approximate = true;
    }
  }

  return {
    province_id: province?.id || null,
    province_name: province?.name || null,
    municipality_id: municipality?.id || null,
    municipality_name: municipality?.name || null,
    sector_id: sector?.id || null,
    sector_name: sector?.name || null,
    approximate,
  };
}

module.exports = { resolveAdministrative };
