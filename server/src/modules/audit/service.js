'use strict';
const { db, now } = require('../../db');
const { uuid } = require('../../utils/crypto');

function serialize(v) {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Registra una acción importante en la bitácora de auditoría.
 * `ctx` puede ser el `req` de Express o un objeto { user, ip, userAgent }.
 */
async function audit(ctx, { action, entity, entityId, orderId, oldValue, newValue }, trx = db) {
  const user = ctx?.user || null;
  await trx('audit_logs').insert({
    id: uuid(),
    user_id: user?.id || null,
    user_name: user?.name || ctx?.actorName || null,
    action,
    entity,
    entity_id: entityId ? String(entityId) : null,
    order_id: orderId || null,
    old_value: serialize(oldValue),
    new_value: serialize(newValue),
    ip: ctx?.ip || null,
    user_agent: (ctx?.get?.('user-agent') || ctx?.userAgent || '').slice(0, 300) || null,
    created_at: now(),
  });
}

/** Devuelve solo los campos que cambiaron entre dos objetos. */
function diff(before, after) {
  const oldValue = {};
  const newValue = {};
  for (const key of Object.keys(after)) {
    const a = before?.[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      oldValue[key] = a ?? null;
      newValue[key] = b ?? null;
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
}

module.exports = { audit, diff };
