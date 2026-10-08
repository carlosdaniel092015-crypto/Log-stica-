/**
 * Carga de Google Maps JavaScript API (bootstrap dinámico con importLibrary).
 * Usa la clave pública del navegador, que debe estar restringida por dominio
 * (HTTP referrer) y por API en Google Cloud Console.
 */
let loading = null;

export const DR_CENTER = { lat: 18.85, lng: -70.4 };
export const SD_CENTER = { lat: 18.4861, lng: -69.9312 };

export function loadGoogleMaps(key) {
  if (!key) return Promise.reject(new Error('NO_KEY'));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = `__gmapsReady${Date.now()}`;
    window[cb] = () => {
      delete window[cb];
      resolve(window.google.maps);
    };
    window.gm_authFailure = () => reject(new Error('AUTH_FAILURE'));
    const s = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', language: 'es', region: 'DO', loading: 'async', callback: cb });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('LOAD_ERROR'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Crea el contenido HTML de un marcador avanzado. */
export function pinElement({ color = '#2f80ed', label = '', title = '', pulse = false, size = 34 } = {}) {
  const el = document.createElement('div');
  el.className = `map-pin${pulse ? ' map-pin--pulse' : ''}`;
  el.style.setProperty('--pin', color);
  el.style.setProperty('--size', `${size}px`);
  el.title = title;
  const span = document.createElement('span');
  span.textContent = label;
  el.appendChild(span);
  return el;
}

export function courierColor(status) {
  return { available: '#16a34a', en_route: '#2563eb', delivering: '#0891b2', paused: '#d97706', off_duty: '#64748b' }[status] || '#64748b';
}

export function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/** Decodifica una polilínea codificada de Google (Routes API). */
export function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0;
  const out = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}
