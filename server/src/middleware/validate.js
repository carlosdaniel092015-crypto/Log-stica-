'use strict';
const { badRequest } = require('../utils/http');

/** Valida req.body / req.query con un esquema zod y reemplaza el valor por el resultado parseado. */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(badRequest('Datos inválidos: ' + details.map((d) => `${d.path || 'campo'} ${d.message}`).join('; '), details));
    }
    if (source === 'query') req.validQuery = result.data;
    else req[source] = result.data;
    next();
  };
}

module.exports = { validate };
