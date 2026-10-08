'use strict';
const { db, bool, json, now } = require('../../db');
const { distanceMeters, pointInPolygon } = require('../../utils/geo');
const { getSettings } = require('../settings/service');

const ZONE_KINDS = ['province', 'municipality', 'sector', 'custom'];

function currentRateSubquery() {
  return db('delivery_rates as r')
    .select('r.price')
    .whereRaw('r.zone_id = z.id')
    .orderBy([{ column: 'r.effective_from', order: 'desc' }, { column: 'r.created_at', order: 'desc' }])
    .limit(1);
}

function mapZone(z) {
  return {
    id: z.id,
    name: z.name,
    kind: z.kind,
    province_id: z.province_id,
    province_name: z.province_name ?? null,
    municipality_id: z.municipality_id,
    municipality_name: z.municipality_name ?? null,
    sector_id: z.sector_id,
    sector_name: z.sector_name ?? null,
    geometry_type: z.geometry_type,
    polygon: json(z.polygon, null),
    center_lat: z.center_lat,
    center_lng: z.center_lng,
    radius_m: z.radius_m,
    priority: z.priority,
    color: z.color,
    active: bool(z.active),
    price: z.price == null ? null : Number(z.price),
    created_at: z.created_at,
    updated_at: z.updated_at,
  };
}

function zonesQuery() {
  return db('delivery_zones as z')
    .leftJoin('provinces as p', 'p.id', 'z.province_id')
    .leftJoin('municipalities as m', 'm.id', 'z.municipality_id')
    .leftJoin('sectors as s', 's.id', 'z.sector_id')
    .select('z.*', 'p.name as province_name', 'm.name as municipality_name', 's.name as sector_name', currentRateSubquery().as('price'));
}

async function listZones({ q, kind, active, provinceId } = {}) {
  const query = zonesQuery().orderBy('z.name');
  if (kind) query.where('z.kind', kind);
  if (active === true || active === false) query.where('z.active', active);
  if (provinceId) query.where('z.province_id', provinceId);
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    query.where((w) =>
      w.whereRaw('lower(z.name) like ?', [like])
        .orWhereRaw('lower(p.name) like ?', [like])
        .orWhereRaw('lower(m.name) like ?', [like])
        .orWhereRaw('lower(s.name) like ?', [like])
    );
  }
  return (await query).map(mapZone);
}

async function getZone(id) {
  const z = await zonesQuery().where('z.id', id).first();
  return z ? mapZone(z) : null;
}

function approxArea(zone) {
  if (zone.geometry_type === 'circle') return Math.PI * zone.radius_m ** 2;
  if (zone.geometry_type === 'polygon' && zone.polygon?.length >= 3) {
    // Área aproximada (proyección equirectangular local), solo para desempatar.
    const lat0 = (zone.polygon[0][0] * Math.PI) / 180;
    let sum = 0;
    for (let i = 0, j = zone.polygon.length - 1; i < zone.polygon.length; j = i++) {
      const [yi, xi] = zone.polygon[i];
      const [yj, xj] = zone.polygon[j];
      sum += xj * Math.cos(lat0) * yi - xi * Math.cos(lat0) * yj;
    }
    return Math.abs(sum / 2) * 111320 * 111320;
  }
  return Number.MAX_SAFE_INTEGER;
}

function zoneMatches(zone, point) {
  const { lat, lng } = point;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  // Con coordenadas manda el área dibujada; sin coordenadas (dirección escrita a mano)
  // se recurre a la provincia/municipio/sector de la zona.
  if (hasCoords && zone.geometry_type === 'polygon' && zone.polygon) {
    return pointInPolygon(lat, lng, zone.polygon) ? 'geometry' : null;
  }
  if (hasCoords && zone.geometry_type === 'circle' && zone.center_lat != null && zone.radius_m) {
    return distanceMeters(lat, lng, zone.center_lat, zone.center_lng) <= zone.radius_m ? 'geometry' : null;
  }
  if (zone.kind === 'sector' && zone.sector_id && zone.sector_id === point.sector_id) return 'administrative';
  if (zone.kind === 'municipality' && zone.municipality_id && zone.municipality_id === point.municipality_id) return 'administrative';
  if (zone.kind === 'province' && zone.province_id && zone.province_id === point.province_id) return 'administrative';
  return null;
}

/**
 * Detecta la zona tarifaria de un punto y calcula el precio del delivery.
 * Prioridad configurable (por defecto: personalizada > sector > municipio > provincia),
 * luego la prioridad numérica de la zona y por último la zona más pequeña.
 */
async function quote(point) {
  const settings = await getSettings();
  const zones = (await zonesQuery().where('z.active', true)).map(mapZone).filter((z) => z.price != null);
  const order = settings.zone_priority || ['custom', 'sector', 'municipality', 'province'];
  const rank = (k) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };

  const matches = zones
    .map((z) => ({ zone: z, how: zoneMatches(z, point) }))
    .filter((m) => m.how)
    .sort((a, b) => rank(a.zone.kind) - rank(b.zone.kind) || b.zone.priority - a.zone.priority || approxArea(a.zone) - approxArea(b.zone));

  const warnings = [];
  let zone = matches[0]?.zone || null;
  let fee = zone ? zone.price : null;
  let source = zone ? `zone_${matches[0].how}` : 'none';

  if (!zone && settings.default_fee_enabled) {
    fee = Number(settings.default_fee) || 0;
    source = 'default';
    warnings.push('La dirección no pertenece a ninguna zona; se aplicó la tarifa predeterminada.');
  }
  if (!zone && !settings.default_fee_enabled) {
    warnings.push('La dirección está fuera de las zonas de cobertura configuradas.');
  }
  const minFee = Number(settings.min_delivery_fee) || 0;
  if (fee != null && fee < minFee) {
    fee = minFee;
    warnings.push(`Se aplicó el precio mínimo de delivery (${settings.currency_symbol}${minFee}).`);
  }

  let distanceKm = null;
  if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
    const branches = await db('branches').where({ active: true }).whereNotNull('lat');
    for (const b of branches) {
      const d = distanceMeters(point.lat, point.lng, b.lat, b.lng) / 1000;
      if (distanceKm == null || d < distanceKm) distanceKm = Math.round(d * 10) / 10;
    }
    const max = Number(settings.max_distance_km) || 0;
    if (max > 0 && distanceKm != null && distanceKm > max) {
      warnings.push(`La dirección está a ${distanceKm} km, por encima de la distancia máxima (${max} km).`);
    }
  }

  return {
    zone: zone ? { id: zone.id, name: zone.name, kind: zone.kind, price: zone.price } : null,
    candidates: matches.map((m) => ({ id: m.zone.id, name: m.zone.name, kind: m.zone.kind, price: m.zone.price, match: m.how })),
    fee,
    currency: settings.currency_symbol,
    source,
    covered: fee != null,
    distance_km: distanceKm,
    warnings,
  };
}

async function setRate(trx, zoneId, price, userId) {
  const ts = now();
  await trx('delivery_rates').insert({
    id: require('../../utils/crypto').uuid(),
    zone_id: zoneId,
    price,
    currency: 'DOP',
    created_by: userId || null,
    effective_from: ts,
    created_at: ts,
  });
}

module.exports = { ZONE_KINDS, listZones, getZone, quote, setRate, mapZone };
