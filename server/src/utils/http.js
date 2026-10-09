'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Debes iniciar sesión.') => new HttpError(401, msg);
const forbidden = (msg = 'No tienes permiso para realizar esta acción.') => new HttpError(403, msg);
const notFound = (msg = 'Recurso no encontrado.') => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);

/** Envuelve handlers async para que los errores lleguen al middleware de errores. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, ah };
