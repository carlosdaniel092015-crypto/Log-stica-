'use strict';

const STATUS_LABELS = {
  new: 'Nuevo',
  preparing: 'Preparando',
  ready: 'Listo para despacho',
  assigned: 'Asignado',
  en_route: 'En camino',
  arriving: 'Llegando',
  arrived: 'Llegué al destino',
  delivered: 'Entregado',
  failed: 'No entregado',
  customer_unavailable: 'Cliente no disponible',
  rescheduled: 'Reprogramado',
  cancelled: 'Cancelado',
};

const STATUSES = Object.keys(STATUS_LABELS);
const PENDING = ['new', 'preparing', 'ready', 'rescheduled'];
const ACTIVE_ROUTE = ['en_route', 'arriving', 'arrived'];
const OPEN = ['new', 'preparing', 'ready', 'assigned', 'en_route', 'arriving', 'arrived', 'rescheduled', 'failed', 'customer_unavailable'];
const FINAL = ['delivered', 'cancelled'];
const OUTCOMES = ['delivered', 'failed', 'customer_unavailable'];

/** Transiciones permitidas para el personal administrativo. */
const STAFF_TRANSITIONS = {
  new: ['preparing', 'ready', 'assigned', 'cancelled', 'rescheduled'],
  preparing: ['ready', 'assigned', 'cancelled', 'rescheduled', 'new'],
  ready: ['preparing', 'assigned', 'cancelled', 'rescheduled'],
  assigned: ['ready', 'en_route', 'cancelled', 'rescheduled'],
  en_route: ['assigned', 'arriving', 'arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled', 'cancelled'],
  arriving: ['en_route', 'arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled', 'cancelled'],
  arrived: ['delivered', 'failed', 'customer_unavailable', 'rescheduled', 'cancelled'],
  delivered: [],
  failed: ['rescheduled', 'assigned', 'ready', 'cancelled'],
  customer_unavailable: ['rescheduled', 'assigned', 'en_route', 'ready', 'cancelled'],
  rescheduled: ['preparing', 'ready', 'assigned', 'cancelled'],
  cancelled: ['new'],
};

/** Transiciones que puede ejecutar el mensajero sobre sus pedidos asignados. */
const COURIER_TRANSITIONS = {
  assigned: ['en_route'],
  en_route: ['assigned', 'arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled'],
  arriving: ['arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled'],
  arrived: ['delivered', 'failed', 'customer_unavailable', 'rescheduled'],
  failed: ['en_route'],
  customer_unavailable: ['en_route', 'delivered'],
};

function canTransition(from, to, role) {
  const table = role === 'courier' ? COURIER_TRANSITIONS : STAFF_TRANSITIONS;
  if (role === 'system') return to === 'arriving' && from === 'en_route';
  return (table[from] || []).includes(to);
}

/** Pasos visibles para el cliente en la pantalla de seguimiento. */
function customerSteps(status, history = []) {
  const reached = new Set(history.map((h) => h.to_status));
  reached.add(status);
  const steps = [
    { key: 'received', label: 'Pedido recibido', statuses: ['new'] },
    { key: 'preparing', label: 'Preparando', statuses: ['preparing', 'ready'] },
    { key: 'assigned', label: 'Mensajero asignado', statuses: ['assigned'] },
    { key: 'en_route', label: 'En camino', statuses: ['en_route'] },
    { key: 'arriving', label: 'Llegando', statuses: ['arriving', 'arrived'] },
    { key: 'delivered', label: 'Entregado', statuses: ['delivered'] },
  ];
  const currentIndex = steps.findIndex((s) => s.statuses.includes(status));
  let lastReached = -1;
  steps.forEach((s, i) => {
    if (s.statuses.some((st) => reached.has(st))) lastReached = Math.max(lastReached, i);
  });
  const idx = currentIndex >= 0 ? currentIndex : lastReached;
  return steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: status === 'delivered' && i === steps.length - 1 ? 'done' : i < idx ? 'done' : i === idx ? 'current' : 'pending',
  }));
}

module.exports = { STATUS_LABELS, STATUSES, PENDING, ACTIVE_ROUTE, OPEN, FINAL, OUTCOMES, canTransition, customerSteps, STAFF_TRANSITIONS, COURIER_TRANSITIONS };
