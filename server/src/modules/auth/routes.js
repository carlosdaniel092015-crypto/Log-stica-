'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, bool, now } = require('../../db');
const { ah, unauthorized, badRequest, forbidden } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { signSession, setSessionCookie, clearSessionCookie, requireAuth } = require('../../middleware/auth');
const { audit } = require('../audit/service');

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
    // Los clientes no tienen cuenta: siguen su pedido solo con el enlace privado.
    if (!['admin', 'dispatcher', 'courier'].includes(user.role_id)) throw forbidden('Esta cuenta no tiene acceso a la plataforma.');
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
