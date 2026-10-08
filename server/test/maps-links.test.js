'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLocation, resolveLocationText } = require('../src/modules/maps/links');
const { toResult } = require('../src/modules/maps/osm');

test('lee coordenadas de los enlaces que comparten los clientes', () => {
  const cases = {
    'https://www.google.com/maps?q=18.517597198486328,-70.04505920410156&z=17&hl=es': [18.517597198486328, -70.04505920410156],
    'Mi ubicación: https://www.google.com/maps?q=18.5175,-70.045&z=17 gracias': [18.5175, -70.045],
    'https://www.google.com/maps/place/Plaza/@18.4712,-69.9301,17z/data=!3m1!4b1!8m2!3d18.4715!4d-69.9305': [18.4715, -69.9305],
    'https://www.google.com/maps/search/?api=1&query=18.47%2C-69.93': [18.47, -69.93],
    'https://waze.com/ul?ll=18.47,-69.93&navigate=yes': [18.47, -69.93],
    'https://maps.apple.com/?ll=18.47,-69.93&q=Pin': [18.47, -69.93],
    'geo:18.47,-69.93': [18.47, -69.93],
    '18.4712, -69.9301': [18.4712, -69.9301],
  };
  for (const [text, [lat, lng]] of Object.entries(cases)) assert.deepEqual(parseLocation(text), { lat, lng }, text);
  for (const text of ['Calle 5, 10 Herrera', 'https://www.google.com/maps?q=Plaza+Fermin', 'hola']) assert.equal(parseLocation(text), null, text);
});

test('enlaces cortos: solo se siguen hacia Google', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.startsWith('https://maps.app.goo.gl/')) return { status: 302, headers: new Map([['location', 'https://www.google.com/maps/place/X/@18.48,-69.94,17z/data=!3d18.4801!4d-69.9402']]) };
    return { status: 200, headers: new Map() };
  };
  fakeFetch.headersFix = true;
  const wrap = async (url, opts) => { const r = await fakeFetch(url, opts); return { status: r.status, headers: { get: (k) => r.headers.get(k) || null } }; };
  assert.deepEqual(await resolveLocationText('https://maps.app.goo.gl/abc', { fetchImpl: wrap }), { lat: 18.4801, lng: -69.9402, source: 'short_link' });
  // Redirección hacia otro dominio: no se sigue.
  const evil = async () => ({ status: 302, headers: { get: () => 'https://evil.example.com/@18.1,-69.1' } });
  assert.equal(await resolveLocationText('https://maps.app.goo.gl/xyz', { fetchImpl: evil }), null);
  // Un enlace que no es corto ni trae coordenadas no hace peticiones.
  calls.length = 0;
  assert.equal(await resolveLocationText('https://example.com/algo', { fetchImpl: wrap }), null);
  assert.equal(calls.length, 0);
});

test('dirección de OpenStreetMap en el formato de la app', () => {
  const r = toResult({ address: { road: 'Calle Duarte', house_number: '8', neighbourhood: 'Pueblo Nuevo', city: 'Los Alcarrizos', state: 'Santo Domingo' }, display_name: 'x' }, 18.52, -70.01);
  assert.equal(r.formatted_address, 'Calle Duarte #8, Pueblo Nuevo, Los Alcarrizos');
  assert.ok(r.components.some((c) => c.types.includes('administrative_area_level_1') && c.long_name === 'Santo Domingo'));
});
