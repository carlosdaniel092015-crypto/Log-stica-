'use strict';
const express = require('express');
const { z } = require('zod');
const { ah, notFound, badRequest } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const maps = require('./google');
const { reverseOsm } = require('./osm');
const { resolveLocationText } = require('./links');
const { resolveAdministrative } = require('../geo/resolver');

/** Proxy autenticado hacia Geocoding API (la clave de servidor nunca sale del backend). */
const router = express.Router();
router.use(requireAuth);

router.post('/geocode', validate(z.object({ address: z.string().trim().min(3).max(300) })), ah(async (req, res) => {
  const r = await maps.geocode(req.body.address);
  if (!r) throw notFound('No se encontró la dirección.');
  res.json({ ...r, admin: await resolveAdministrative(r) });
}));

router.post('/reverse', validate(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })), ah(async (req, res) => {
  const r = (await maps.reverseGeocode(req.body.lat, req.body.lng)) || (await reverseOsm(req.body.lat, req.body.lng));
  const admin = await resolveAdministrative({ lat: req.body.lat, lng: req.body.lng, components: r?.components || [] });
  res.json({ ...(r || { formatted_address: null, lat: req.body.lat, lng: req.body.lng }), admin });
}));

/** Ubicación pegada (enlace de WhatsApp/Google Maps/Waze o coordenadas) → coordenadas. */
router.post('/parse-location', validate(z.object({ text: z.string().trim().min(3).max(2000) })), ah(async (req, res) => {
  let found = null;
  try {
    found = await resolveLocationText(req.body.text);
  } catch {
    found = null;
  }
  if (!found) throw badRequest('No encontramos coordenadas en ese texto. Pega el enlace de ubicación que envió el cliente (ej. https://www.google.com/maps?q=18.51,-70.04) o las coordenadas.');
  res.json(found);
}));

module.exports = router;
