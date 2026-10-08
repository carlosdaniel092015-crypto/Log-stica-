'use strict';
/**
 * Punto central para emitir eventos en tiempo real (Socket.IO).
 * Salas:
 *   staff               → administradores y despachadores
 *   user:<userId>       → un usuario concreto
 *   courier:<courierId> → un mensajero
 *   track:<orderId>     → clientes viendo el seguimiento de un pedido
 */
let io = null;

function setIO(instance) {
  io = instance;
}

function emit(room, event, payload) {
  if (io) io.to(room).emit(event, payload);
}

module.exports = {
  setIO,
  getIO: () => io,
  toStaff: (event, payload) => emit('staff', event, payload),
  toUser: (userId, event, payload) => emit(`user:${userId}`, event, payload),
  toCourier: (courierId, event, payload) => emit(`courier:${courierId}`, event, payload),
  toTracking: (orderId, event, payload) => emit(`track:${orderId}`, event, payload),
  /** Cierra el seguimiento público: último aviso y salida de la sala. */
  closeTracking: (orderId, payload) => {
    if (!io) return;
    io.to(`track:${orderId}`).emit('tracking:closed', payload);
    io.in(`track:${orderId}`).socketsLeave(`track:${orderId}`);
  },
};
