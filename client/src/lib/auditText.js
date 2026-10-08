/** Traduce registros de auditoría a frases claras (acción, entidad y detalle). */
const ACTIONS = {
  'order.create': 'Creó el pedido',
  'order.update': 'Editó el pedido',
  'order.assign': 'Asignó mensajero',
  'order.reassign': 'Cambió el mensajero',
  'order.unassign': 'Quitó el mensajero',
  'order.route_order': 'Ordenó la ruta',
  'order.customer_location': 'El cliente ajustó su ubicación',
  'order.customer_confirm_location': 'El cliente confirmó su ubicación',
  'order.customer_reference': 'El cliente agregó una referencia',
  'tracking_link.regenerate': 'Generó un enlace nuevo',
  'tracking_link.revoke': 'Revocó el enlace de seguimiento',
  'zone.create': 'Creó zona',
  'zone.update': 'Editó zona',
  'zone.update_price': 'Cambió tarifa',
  'zone.activate': 'Activó zona',
  'zone.deactivate': 'Desactivó zona',
  'zone.delete': 'Eliminó zona',
  'zone.import': 'Importó tarifas',
  'product.create': 'Creó producto',
  'product.update': 'Editó producto',
  'product.delete': 'Eliminó producto',
  'product.stock_adjust': 'Ajustó el almacén',
  'inventory.assign': 'Asignó inventario',
  'inventory.return': 'Recibió devolución',
  'inventory.request_approve': 'Aprobó solicitud',
  'inventory.request_reject': 'Rechazó solicitud',
  'user.create': 'Creó usuario',
  'user.update': 'Editó usuario',
  'user.activate': 'Activó usuario',
  'user.deactivate': 'Desactivó usuario',
  'user.password_reset': 'Restableció contraseña',
  'role.update': 'Cambió permisos',
  'customer.create': 'Registró cliente',
  'customer.update': 'Editó cliente',
  'customer.activate': 'Activó cliente',
  'customer.deactivate': 'Desactivó cliente',
  'customer.link_account': 'Vinculó historial',
  'address.create': 'Agregó dirección',
  'address.update': 'Editó dirección',
  'address.delete': 'Eliminó dirección',
  'courier.shift_start': 'Inició jornada',
  'courier.shift_end': 'Terminó jornada',
  'courier.location_on': 'Activó su ubicación',
  'courier.location_off': 'Dejó de compartir ubicación',
  'courier.pause': 'Pausó la jornada',
  'courier.resume': 'Reanudó la jornada',
  'auth.login': 'Inició sesión',
  'auth.login_failed': 'Intento de acceso fallido',
  'auth.password_change': 'Cambió su contraseña',
  'settings.update': 'Cambió la configuración',
  'branch.create': 'Creó sucursal',
  'branch.update': 'Editó sucursal',
};
const STATUS_ACTIONS = {
  delivered: 'Marcó entregado',
  failed: 'Marcó no entregado',
  customer_unavailable: 'Marcó cliente no disponible',
  en_route: 'Salió hacia el cliente',
  arriving: 'Mensajero llegando',
  arrived: 'Llegó al destino',
  cancelled: 'Canceló el pedido',
  rescheduled: 'Reprogramó el pedido',
};
const ENTITIES = { order: 'Pedido', zone: 'Zona', product: 'Producto', user: 'Usuario', customer: 'Cliente', courier: 'Mensajero', settings: 'Configuración', inventory_request: 'Solicitud', role: 'Rol', province: 'Provincia', municipality: 'Municipio', sector: 'Sector', branch: 'Sucursal', customer_address: 'Dirección' };

const rd = (v) => (v == null ? '—' : `RD$${Number(v).toLocaleString('es-DO')}`);

export function auditText(a, statuses = {}) {
  const nv = a.new_value && typeof a.new_value === 'object' ? a.new_value : {};
  const ov = a.old_value && typeof a.old_value === 'object' ? a.old_value : {};
  let action = ACTIONS[a.action] || a.action;
  if (a.action === 'order.status') action = STATUS_ACTIONS[nv.status] || `Cambió estado a ${statuses[nv.status] || nv.status}`;
  if (a.action.startsWith('province.') || a.action.startsWith('municipality.') || a.action.startsWith('sector.')) {
    action = { create: 'Creó', update: 'Editó', delete: 'Eliminó' }[a.action.split('.')[1]] || action;
  }
  let detail = '';
  if (a.action === 'zone.update_price' || (a.action === 'zone.update' && ov.price !== undefined && ov.price !== nv.price)) detail = `${rd(ov.price)} → ${rd(nv.price)}`;
  else if (a.action === 'zone.create') detail = `${nv.kind || ''} · ${rd(nv.price)}`;
  else if (a.action === 'order.create') detail = [nv.zone && `Zona detectada: ${nv.zone}`, nv.delivery_fee != null && rd(nv.delivery_fee)].filter(Boolean).join(' · ');
  else if (a.action === 'order.status') detail = [statuses[ov.status] && `${statuses[ov.status]} → ${statuses[nv.status] || nv.status}`, nv.note].filter(Boolean).join(' · ');
  else if (a.action === 'user.create') detail = `Rol: ${{ admin: 'Administrador', dispatcher: 'Despachador', courier: 'Mensajero' }[nv.role] || nv.role}`;
  else if (a.action === 'courier.shift_start') detail = nv.sharing_location ? 'Ubicación activa' : 'Sin compartir ubicación';
  else if (a.action === 'inventory.request_reject' && nv.note) detail = nv.note;
  else if (a.action === 'zone.import') detail = `${nv.created || 0} creadas · ${nv.updated || 0} actualizadas`;
  else if (a.action === 'product.stock_adjust') detail = `${nv.delta > 0 ? '+' : ''}${nv.delta}${nv.note ? ` · ${nv.note}` : ''}`;
  else if (a.action === 'order.customer_reference') detail = nv.reference || '';
  else if (a.action === 'order.update') detail = Object.keys(nv).slice(0, 3).join(', ');
  return { action, entity: ENTITIES[a.entity] || a.entity, detail };
}
