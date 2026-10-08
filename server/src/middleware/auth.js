'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db, bool, json } = require('../db');
const { unauthorized, forbidden } = require('../utils/http');

const STAFF_ROLES = ['admin', 'dispatcher'];

let roleCache = { at: 0, map: new Map() };
async function rolePermissions(roleId) {
  if (Date.now() - roleCache.at > 30_000) {
    const rows = await db('roles').select('id', 'permissions');
    roleCache = { at: Date.now(), map: new Map(rows.map((r) => [r.id, json(r.permissions, [])])) };
  }
  return roleCache.map.get(roleId) || [];
}
function clearRoleCache() {
  roleCache.at = 0;
}

const SOCKET_AUDIENCE = 'logistica-rd-socket';

function signSession(user) {
  return jwt.sign({ sub: user.id, role: user.role_id, tv: user.token_version }, config.auth.jwtSecret, {
    expiresIn: `${config.auth.sessionHours}h`,
    audience: 'logistica-rd',
  });
}

/**
 * Token corto (2 min) solo para abrir el socket de tiempo real cuando el frontend está en
 * otro dominio (p. ej. Vercel) y la cookie no llega al backend. No sirve para la API.
 */
function signSocketToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, config.auth.jwtSecret, { expiresIn: '2m', audience: SOCKET_AUDIENCE });
}

/** `remember=false` crea una cookie de sesión del navegador (se borra al cerrarlo). */
function setSessionCookie(res, token, { remember = true } = {}) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    secure: config.forceHttps,
    sameSite: 'lax',
    ...(remember ? { maxAge: config.auth.sessionHours * 3600 * 1000 } : {}),
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.auth.cookieName, { path: '/' });
}

function readToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[config.auth.cookieName] || null;
}

/** Resuelve el usuario de la sesión. Devuelve null si no es válida. */
async function resolveSession(token, { audience = 'logistica-rd' } = {}) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, { audience });
  } catch {
    return null;
  }
  const user = await db('users').where({ id: payload.sub }).first();
  if (!user || !bool(user.active) || user.token_version !== payload.tv) return null;
  if (!['admin', 'dispatcher', 'courier'].includes(user.role_id)) return null;
  const permissions = await rolePermissions(user.role_id);
  const session = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role_id,
    permissions,
    isStaff: STAFF_ROLES.includes(user.role_id),
  };
  if (user.role_id === 'courier') {
    const courier = await db('couriers').where({ user_id: user.id }).first('id');
    session.courierId = courier?.id || null;
  }
  return session;
}

async function authOptional(req, _res, next) {
  try {
    req.user = await resolveSession(readToken(req));
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function hasPermission(user, perm) {
  return !!user && (user.permissions.includes('*') || user.permissions.includes(perm));
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

function requirePermission(perm) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!hasPermission(req.user, perm)) return next(forbidden());
    next();
  };
}

const requireStaff = requireRole(...STAFF_ROLES);

module.exports = {
  STAFF_ROLES,
  SOCKET_AUDIENCE,
  signSession,
  signSocketToken,
  setSessionCookie,
  clearSessionCookie,
  readToken,
  resolveSession,
  authOptional,
  requireAuth,
  requireRole,
  requirePermission,
  requireStaff,
  hasPermission,
  clearRoleCache,
};
