'use strict';
const { db, json, now } = require('../../db');

/**
 * Valores por defecto de configuración. Son solo el punto de partida:
 * todo se edita desde Configuración > Logística y se guarda en la tabla `settings`.
 */
const DEFAULTS = {
  company_name: 'Mi Empresa de Entregas',
  company_logo_url: '',
  company_rnc: '', // opcional: si está vacío no aparece en la factura
  company_address: '',
  invoice_note: 'Gracias por su compra.',
  company_phone: '',
  company_whatsapp: '',
  company_email: '',
  currency_symbol: 'RD$',
  currency_code: 'DOP',
  business_hours: 'Lunes a sábado, 8:00 a.m. – 6:00 p.m.',
  timezone: 'America/Santo_Domingo',
  min_delivery_fee: 0,
  default_fee_enabled: false,
  default_fee: 0,
  max_distance_km: 0, // 0 = sin límite
  zone_priority: ['custom', 'sector', 'municipality', 'province'],
  location_update_seconds: 15,
  location_retention_days: 30,
  courier_tracking_enabled: true,
  customer_can_see_courier: true,
  customer_can_see_courier_location: true,
  customer_can_contact_courier: false,
  arriving_radius_m: 500,
  average_speed_kmh: 25,
  proof_required: true,
  proof_signature_enabled: true,
  proof_photo_enabled: true,
  push_notifications_enabled: true,
  notify_customer_statuses: ['preparing', 'assigned', 'en_route', 'arriving', 'delivered', 'failed'],
  tracking_link_expiry_hours: 168,
  tracking_share_message: 'Hola {cliente}, tu pedido #{pedido} está en camino 🚚\n\nPuedes darle seguimiento aquí:\n{enlace}',
};

let cache = null;
let cacheAt = 0;

async function getSettings() {
  if (cache && Date.now() - cacheAt < 10_000) return cache;
  const rows = await db('settings').select('key', 'value');
  // Solo claves conocidas: otras filas (p. ej. claves VAPID privadas) nunca se exponen.
  const stored = Object.fromEntries(rows.filter((r) => r.key in DEFAULTS).map((r) => [r.key, json(r.value)]));
  cache = { ...DEFAULTS, ...stored };
  cacheAt = Date.now();
  return cache;
}

async function updateSettings(patch, trx = db) {
  const ts = now();
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    const existing = await trx('settings').where({ key }).first();
    if (existing) await trx('settings').where({ key }).update({ value: JSON.stringify(value), updated_at: ts });
    else await trx('settings').insert({ key, value: JSON.stringify(value), updated_at: ts });
  }
  cache = null;
  return getSettings();
}

/** Subconjunto de configuración visible públicamente (seguimiento, login). */
function publicSettings(s) {
  return {
    company_name: s.company_name,
    company_logo_url: s.company_logo_url,
    company_rnc: s.company_rnc,
    company_phone: s.company_phone,
    company_whatsapp: s.company_whatsapp,
    company_email: s.company_email,
    currency_symbol: s.currency_symbol,
    business_hours: s.business_hours,
    location_update_seconds: s.location_update_seconds,
  };
}

/**
 * Logo de la empresa: se guarda en la base (fila aparte, fuera de DEFAULTS para que no viaje
 * en cada respuesta de configuración) y se sirve en /api/public/logo.
 */
const LOGO_KEY = 'company_logo_data';
const LOGO_MAX_BYTES = 400 * 1024;
const LOGO_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };

/** Valida un data URL PNG/JPEG y devuelve { mime, buffer } o null. */
function parseLogo(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  const magic = LOGO_TYPES[m[1]];
  if (!buffer.length || buffer.length > LOGO_MAX_BYTES || !magic.every((b, i) => buffer[i] === b)) return null;
  return { mime: m[1], buffer };
}

async function getLogo() {
  const row = await db('settings').where({ key: LOGO_KEY }).first();
  const v = row && json(row.value);
  return v?.b64 ? { mime: v.mime, buffer: Buffer.from(v.b64, 'base64'), version: v.version } : null;
}

async function upsert(trx, key, value) {
  const ts = now();
  if (await trx('settings').where({ key }).first()) await trx('settings').where({ key }).update({ value, updated_at: ts });
  else await trx('settings').insert({ key, value, updated_at: ts });
}

async function setLogo({ mime, buffer }) {
  const version = Date.now().toString(36);
  await db.transaction(async (trx) => {
    await upsert(trx, LOGO_KEY, JSON.stringify({ mime, b64: buffer.toString('base64'), version }));
    await upsert(trx, 'company_logo_url', JSON.stringify(`/api/public/logo?v=${version}`));
  });
  cache = null;
  return getSettings();
}

async function clearLogo() {
  await db.transaction(async (trx) => {
    await trx('settings').where({ key: LOGO_KEY }).del();
    await upsert(trx, 'company_logo_url', JSON.stringify(''));
  });
  cache = null;
  return getSettings();
}

module.exports = { DEFAULTS, getSettings, updateSettings, publicSettings, parseLogo, getLogo, setLogo, clearLogo };
