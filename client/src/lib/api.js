/** Cliente HTTP de la API. Envía cookies de sesión y JSON; maneja errores en español. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor. Verifica tu internet.');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url, body) => request('DELETE', url, body),
};

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

/* ------------------------------------------------------------------
 * Bandeja de salida offline (mensajero): si no hay conexión, las acciones
 * se guardan localmente y se envían en orden cuando vuelve internet.
 * ------------------------------------------------------------------ */
const OUTBOX_KEY = 'lrd_outbox';

function readOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeOutbox(items) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    /* almacenamiento no disponible */
  }
  window.dispatchEvent(new CustomEvent('outbox:changed', { detail: items.length }));
}

export function outboxSize() {
  return readOutbox().length;
}

/** Intenta enviar; si falla por red, encola y devuelve { queued: true }. */
export async function postOrQueue(url, body, label) {
  if (!navigator.onLine) {
    writeOutbox([...readOutbox(), { url, body: { ...body, client_ts: new Date().toISOString() }, label, at: Date.now() }]);
    navigator.serviceWorker?.ready.then((r) => r.sync?.register('outbox')).catch(() => {});
    return { queued: true };
  }
  try {
    return await api.post(url, body);
  } catch (err) {
    if (err.status === 0) {
      writeOutbox([...readOutbox(), { url, body: { ...body, client_ts: new Date().toISOString() }, label, at: Date.now() }]);
      return { queued: true };
    }
    throw err;
  }
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return { sent: 0, failed: [] };
  flushing = true;
  const items = readOutbox();
  const failed = [];
  let sent = 0;
  try {
    for (let i = 0; i < items.length; i++) {
      try {
        await api.post(items[i].url, items[i].body);
        sent++;
      } catch (err) {
        if (err.status === 0) {
          writeOutbox(items.slice(i));
          return { sent, failed };
        }
        failed.push({ ...items[i], error: err.message });
      }
    }
    writeOutbox([]);
    return { sent, failed };
  } finally {
    flushing = false;
  }
}
