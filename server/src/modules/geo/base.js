'use strict';
const { db, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const base = require('../../db/data/rd-base.json');

const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * División territorial base de RD (32 provincias, 158 municipios + distritos municipales
 * y sectores principales). Solo agrega lo que falta: nunca cambia ni borra lo que el
 * administrador ya editó. Devuelve cuántos registros se agregaron.
 */
async function loadBaseGeography(trx = db) {
  const ts = now();
  const stamp = { active: true, created_at: ts, updated_at: ts };
  const added = { provinces: 0, municipalities: 0, sectors: 0 };

  const provinces = await trx('provinces').select('id', 'name', 'code');
  const provinceId = {};
  for (const p of provinces) provinceId[key(p.name)] = p.id;
  for (const p of base.provinces) {
    const existing = provinces.find((x) => key(x.name) === key(p.name) || (p.code && x.code === p.code));
    if (existing) {
      provinceId[key(p.name)] = existing.id;
      continue;
    }
    const id = uuid();
    await trx('provinces').insert({ id, name: p.name, code: p.code, lat: p.lat, lng: p.lng, ...stamp });
    provinceId[key(p.name)] = id;
    added.provinces++;
  }

  const municipalities = await trx('municipalities').select('id', 'name', 'province_id');
  const municipalityId = {};
  for (const m of base.municipalities) {
    const pid = provinceId[key(m.province)];
    if (!pid) continue;
    const existing = municipalities.find((x) => x.province_id === pid && key(x.name) === key(m.name));
    if (existing) {
      municipalityId[key(m.name)] = existing.id;
      continue;
    }
    const id = uuid();
    await trx('municipalities').insert({ id, province_id: pid, name: m.name, kind: m.kind, lat: m.lat, lng: m.lng, ...stamp });
    municipalityId[key(m.name)] = id;
    added.municipalities++;
  }

  const sectors = await trx('sectors').select('id', 'name', 'municipality_id');
  for (const s of base.sectors) {
    const mid = municipalityId[key(s.municipality)];
    if (!mid || sectors.some((x) => x.municipality_id === mid && key(x.name) === key(s.name))) continue;
    await trx('sectors').insert({ id: uuid(), municipality_id: mid, name: s.name, lat: s.lat, lng: s.lng, ...stamp });
    added.sectors++;
  }
  return added;
}

/** Zonas y precios sugeridos (se editan después). Sin área dibujada: se aplican por provincia, municipio o sector. */
const SUGGESTED_ZONES = [
  { name: 'Distrito Nacional', kind: 'province', province: 'Distrito Nacional', price: 250, color: '#0891b2' },
  { name: 'Provincia Santo Domingo', kind: 'province', province: 'Santo Domingo', price: 350, color: '#64748b' },
  { name: 'Santo Domingo Este', kind: 'municipality', province: 'Santo Domingo', municipality: 'Santo Domingo Este', price: 300, color: '#9333ea' },
  { name: 'Santo Domingo Norte', kind: 'municipality', province: 'Santo Domingo', municipality: 'Santo Domingo Norte', price: 300, color: '#6366f1' },
  { name: 'Santo Domingo Oeste', kind: 'municipality', province: 'Santo Domingo', municipality: 'Santo Domingo Oeste', price: 250, color: '#0ea5e9' },
  { name: 'Los Alcarrizos', kind: 'municipality', province: 'Santo Domingo', municipality: 'Los Alcarrizos', price: 200, color: '#16a34a' },
  { name: 'Boca Chica', kind: 'municipality', province: 'Santo Domingo', municipality: 'Boca Chica', price: 500, color: '#dc2626' },
  { name: 'Haina', kind: 'municipality', province: 'San Cristóbal', municipality: 'Bajos de Haina', price: 350, color: '#d97706' },
  { name: 'Santiago', kind: 'province', province: 'Santiago', price: 700, color: '#ea580c' },
  { name: 'Herrera', kind: 'sector', province: 'Santo Domingo', municipality: 'Santo Domingo Oeste', sector: 'Herrera', price: 250, color: '#2563eb' },
  { name: 'San Isidro', kind: 'sector', province: 'Santo Domingo', municipality: 'Santo Domingo Este', sector: 'San Isidro', price: 350, color: '#475569' },
  { name: 'Autopista Duarte Km 9', kind: 'custom', province: 'Santo Domingo', circle: { center: [18.4935, -69.969], radius: 1500 }, price: 250, color: '#0d9488' },
];

/**
 * Tarifas sugeridas para empezar (Gran Santo Domingo, San Cristóbal y Santiago).
 * Se crean solo las zonas cuyo nombre no existe; después se editan los precios libremente.
 */
async function loadSuggestedZones(trx = db, userId = null) {
  await loadBaseGeography(trx);
  const [provinces, municipalities, sectors, zones] = await Promise.all([
    trx('provinces').select('id', 'name'),
    trx('municipalities').select('id', 'name', 'province_id'),
    trx('sectors').select('id', 'name', 'municipality_id'),
    trx('delivery_zones').select('id', 'name', 'geometry_type', 'province_id', 'municipality_id', 'sector_id'),
  ]);
  const find = (list, name, extra = () => true) => list.find((x) => key(x.name) === key(name) && extra(x));
  const ts = now();
  let created = 0;
  let repaired = 0;
  for (const z of SUGGESTED_ZONES) {
    const province = z.province ? find(provinces, z.province) : null;
    const municipality = z.municipality ? find(municipalities, z.municipality, (m) => !province || m.province_id === province.id) : null;
    const sector = z.sector ? find(sectors, z.sector, (s) => !municipality || s.municipality_id === municipality.id) : null;
    const same = zones.find((x) => key(x.name) === key(z.name));
    if (same) {
      // Zona con el mismo nombre que no cubre nada (creada cuando no había provincias):
      // se le asigna su provincia/municipio/sector y se conserva su precio.
      const unlinked = same.geometry_type === 'none' && !same.province_id && !same.municipality_id && !same.sector_id;
      if (unlinked && !z.circle) {
        await trx('delivery_zones').where({ id: same.id }).update({ kind: z.kind, province_id: province?.id || null, municipality_id: municipality?.id || null, sector_id: sector?.id || null, updated_at: now() });
        repaired++;
      }
      continue;
    }
    const id = uuid();
    await trx('delivery_zones').insert({
      id,
      name: z.name,
      kind: z.kind,
      province_id: province?.id || null,
      municipality_id: municipality?.id || null,
      sector_id: sector?.id || null,
      geometry_type: z.circle ? 'circle' : 'none',
      polygon: null,
      center_lat: z.circle ? z.circle.center[0] : null,
      center_lng: z.circle ? z.circle.center[1] : null,
      radius_m: z.circle ? z.circle.radius : null,
      priority: 0,
      color: z.color,
      active: true,
      created_at: ts,
      updated_at: ts,
    });
    await trx('delivery_rates').insert({ id: uuid(), zone_id: id, price: z.price, currency: 'DOP', created_by: userId, effective_from: ts, created_at: ts });
    created++;
  }
  return { created, repaired };
}

module.exports = { loadBaseGeography, loadSuggestedZones, SUGGESTED_ZONES, BASE_SOURCE: base.source };
