'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, unauthorized, badRequest, conflict, forbidden } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { signSession, setSessionCookie, clearSessionCookie, requireAuth } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const { getSettings } = require('../settings/service');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);
const password = z.string().min(8, 'debe tener al menos 8 caracteres').max(100);

router.post(
  '/login',
  loginLimiter,
  validate(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(100) })),
  ah(async (req, res) => {
    const user = await db('users').where({ email: req.body.email }).first();
    // Comparación siempre ejecutada para no revelar si el correo existe (timing).
    const ok = await bcrypt.compare(req.body.password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok) {
      await audit({ ip: req.ip, userAgent: req.get('user-agent'), actorName: req.body.email }, { action: 'auth.login_failed', entity: 'user', entityId: user?.id });
      throw unauthorized('Correo o contraseña incorrectos.');
    }
    if (!bool(user.active)) throw forbidden('Tu cuenta está desactivada. Contacta al administrador.');
    await db('users').where({ id: user.id }).update({ last_login_at: now() });
    setSessionCookie(res, signSession(user));
    req.user = { id: user.id, name: user.name };
    await audit(req, { action: 'auth.login', entity: 'user', entityId: user.id });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role_id } });
  })
);

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

/** Registro opcional de clientes frecuentes. */
router.post(
  '/register',
  loginLimiter,
  validate(z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(7).max(40),
    password,
  })),
  ah(async (req, res) => {
    const settings = await getSettings();
    if (!settings.allow_customer_signup) throw forbidden('El registro de clientes no está habilitado.');
    if (await db('users').where({ email: req.body.email }).first()) throw conflict('Ya existe una cuenta con ese correo.');
    const ts = now();
    const user = {
      id: uuid(), role_id: 'customer', name: req.body.name, email: req.body.email, phone: req.body.phone,
      password_hash: await bcrypt.hash(req.body.password, 12), active: true, token_version: 0, created_at: ts, updated_at: ts,
    };
    await db.transaction(async (trx) => {
      await trx('users').insert(user);
      // No se vinculan pedidos previos por teléfono automáticamente: sin verificar el número,
      // cualquiera podría ver pedidos ajenos. El personal puede vincularlos desde el panel.
      await trx('customers').insert({ id: uuid(), user_id: user.id, name: user.name, phone: user.phone, whatsapp: user.phone, email: user.email, active: true, created_at: ts, updated_at: ts });
      await audit({ user, ip: req.ip, userAgent: req.get('user-agent') }, { action: 'auth.register', entity: 'user', entityId: user.id }, trx);
    });
    setSessionCookie(res, signSession(user));
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: 'customer' } });
  })
);

router.put(
  '/me/password',
  requireAuth,
  validate(z.object({ current_password: z.string().min(1), new_password: password })),
  ah(async (req, res) => {
    const user = await db('users').where({ id: req.user.id }).first();
    if (!(await bcrypt.compare(req.body.current_password, user.password_hash))) throw badRequest('La contraseña actual no es correcta.');
    const updated = { password_hash: await bcrypt.hash(req.body.new_password, 12), token_version: user.token_version + 1, updated_at: now() };
    await db('users').where({ id: user.id }).update(updated);
    setSessionCookie(res, signSession({ ...user, ...updated }));
    await audit(req, { action: 'auth.password_change', entity: 'user', entityId: user.id });
    res.json({ ok: true });
  })
);

module.exports = router;
