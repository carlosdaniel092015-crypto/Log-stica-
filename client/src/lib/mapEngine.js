/**
 * Motor de mapas unificado.
 *  - "osm": OpenFreeMap (mapas vectoriales gratis, sin clave) con Leaflet + MapLibre.
 *  - "google": Google Maps JavaScript API, si hay GOOGLE_MAPS_BROWSER_KEY.
 * Nunca se mezclan en un mismo mapa (los términos de Google no permiten usar
 * su contenido sobre mapas de terceros).
 *
 * API común del "handle":
 *   setMarkers([{ id, lat, lng, kind, color, label, pulse, size, title, draggable, onDragEnd, onClick, zIndex }])
 *   setLines([{ id, from:[lat,lng], to:[lat,lng], color }])
 *   setShapes([{ id, type:'polygon'|'circle', points, center, radius, color, fillOpacity, dashed, onClick }])
 *   setEditable(shape|null, onChange)   → polígono o círculo editable (vértices / centro y radio arrastrables)
 *   onClick(cb(lat,lng)) → función para quitar el listener
 *   fit(points, { maxZoom, padding }), setView(center, zoom), popup(markerId, html), setTheme(dark), destroy()
 */
import { loadGoogleMaps } from './maps';

export const OFM_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** HTML de los marcadores (mismo estilo en ambos motores). */
export function markerHtml(m) {
  const c = m.color || '#2563eb';
  if (m.kind === 'courier') {
    return `<div class="mk mk-courier" style="--c:${c}">${m.pulse ? '<span class="mk-pulse"></span>' : ''}<span class="mk-dot">${esc(m.label || '')}</span></div>`;
  }
  if (m.kind === 'moto') {
    return `<div class="mk mk-moto" style="--c:${c}"><span class="mk-pulse"></span><span class="mk-dot">🛵</span></div>`;
  }
  if (m.kind === 'vertex') return `<span class="mk-vertex" style="--c:${c}"></span>`;
  if (m.kind === 'dot') return `<span class="mk-small" style="--c:${c}"></span>`;
  const sz = m.size || 30;
  return `<div class="mk-drop" style="--c:${c};--s:${sz}px">${m.label ? `<span>${esc(m.label)}</span>` : ''}</div>`;
}

function markerBox(m) {
  if (m.kind === 'courier') return { w: 36, h: 36, drop: false };
  if (m.kind === 'moto') return { w: 40, h: 40, drop: false };
  if (m.kind === 'vertex') return { w: 14, h: 14, drop: false };
  if (m.kind === 'dot') return { w: 16, h: 16, drop: false };
  const s = m.size || 30;
  return { w: s, h: s, drop: true };
}

const sig = (m) => [m.kind, m.color, m.label, m.pulse, m.size, m.draggable].join('|');

/* ------------------------------------------------------------------ */
/* OpenFreeMap (Leaflet + MapLibre)                                     */
/* ------------------------------------------------------------------ */
let leafletLoading = null;
async function loadLeaflet() {
  if (!leafletLoading) {
    leafletLoading = (async () => {
      const [{ default: L }, maplibre] = await Promise.all([import('leaflet'), import('maplibre-gl')]);
      await Promise.all([import('leaflet/dist/leaflet.css'), import('maplibre-gl/dist/maplibre-gl.css')]);
      // El complemento usa las variables globales L y maplibregl.
      window.L = L;
      window.maplibregl = maplibre.default || maplibre;
      await import('@maplibre/maplibre-gl-leaflet');
      return L;
    })();
  }
  return leafletLoading;
}

async function createOsmMap(container, { center, zoom, dark }) {
  const L = await loadLeaflet();
  const map = L.map(container, { zoomControl: true, attributionControl: true, maxZoom: 19 }).setView([center.lat, center.lng], zoom);
  map.attributionControl.setPrefix(false);
  let tiles = null;
  let theme = null;
  const setTheme = (isDark) => {
    const t = isDark ? 'dark' : 'light';
    if (t === theme) return;
    if (tiles) map.removeLayer(tiles);
    tiles = L.maplibreGL({ style: OFM_STYLES[t], attribution: ATTRIBUTION }).addTo(map);
    container.classList.toggle('map-dark', t === 'dark');
    theme = t;
  };
  setTheme(dark);

  const markers = new Map();
  const lines = new Map();
  let shapeLayer = L.layerGroup().addTo(map);
  let editLayer = L.layerGroup().addTo(map);

  const iconFor = (m) => {
    const b = markerBox(m);
    return L.divIcon({ className: 'mk-icon', html: markerHtml(m), iconSize: [b.w, b.h], iconAnchor: b.drop ? [b.w / 2, Math.round(b.h / 2 + b.h * Math.SQRT1_2)] : [b.w / 2, b.h / 2] });
  };

  const handle = {
    engine: 'osm',
    map,
    setTheme,
    setMarkers(list) {
      const seen = new Set();
      for (const m of list) {
        if (m.lat == null || m.lng == null) continue;
        seen.add(m.id);
        let mk = markers.get(m.id);
        if (mk && mk._sig !== sig(m)) {
          map.removeLayer(mk);
          mk = null;
        }
        if (!mk) {
          mk = L.marker([m.lat, m.lng], { icon: iconFor(m), draggable: !!m.draggable, zIndexOffset: m.zIndex ?? (m.kind === 'courier' || m.kind === 'moto' ? 500 : 0), keyboard: false });
          if (m.title) mk.bindTooltip(m.title, { direction: 'top', offset: [0, -18] });
          mk._sig = sig(m);
          mk.addTo(map);
          markers.set(m.id, mk);
        } else {
          const cur = mk.getLatLng();
          if (Math.abs(cur.lat - m.lat) > 1e-7 || Math.abs(cur.lng - m.lng) > 1e-7) mk.setLatLng([m.lat, m.lng]);
          if (m.title) mk.setTooltipContent(m.title);
        }
        mk.off('dragend').off('click');
        if (m.onDragEnd) mk.on('dragend', (e) => { const p = e.target.getLatLng(); m.onDragEnd(p.lat, p.lng); });
        if (m.onClick) mk.on('click', () => m.onClick());
      }
      for (const [id, mk] of markers) if (!seen.has(id)) { map.removeLayer(mk); markers.delete(id); }
    },
    setLines(list) {
      const seen = new Set();
      for (const l of list) {
        if (!l.from || !l.to) continue;
        seen.add(l.id);
        let pl = lines.get(l.id);
        if (!pl) {
          pl = L.polyline([l.from, l.to], { color: l.color || '#2563eb', weight: 3, dashArray: '7 8', opacity: 0.9, interactive: false }).addTo(map);
          lines.set(l.id, pl);
        } else pl.setLatLngs([l.from, l.to]);
      }
      for (const [id, pl] of lines) if (!seen.has(id)) { map.removeLayer(pl); lines.delete(id); }
    },
    setShapes(list) {
      shapeLayer.clearLayers();
      for (const z of list) {
        const o = { color: z.color, weight: 2, fillColor: z.color, fillOpacity: z.fillOpacity ?? 0.18, opacity: z.strokeOpacity ?? 0.9, dashArray: z.dashed ? '6 6' : null, interactive: !!z.onClick };
        let layer = null;
        if (z.type === 'polygon' && z.points?.length) layer = z.points.length > 2 ? L.polygon(z.points, o) : L.polyline(z.points, o);
        if (z.type === 'circle' && z.center && z.radius) layer = L.circle(z.center, { ...o, radius: z.radius });
        if (layer) {
          if (z.onClick) layer.on('click', (e) => { L.DomEvent.stopPropagation(e); z.onClick(e.latlng.lat, e.latlng.lng); });
          shapeLayer.addLayer(layer);
        }
      }
    },
    setEditable(shape, onChange) {
      editLayer.clearLayers();
      if (!shape) return;
      const color = shape.color || '#2563eb';
      const style = { color, weight: 2, fillColor: color, fillOpacity: 0.25, interactive: false };
      const vIcon = L.divIcon({ className: 'mk-icon', html: markerHtml({ kind: 'vertex', color }), iconSize: [14, 14], iconAnchor: [7, 7] });
      if (shape.type === 'polygon') {
        const pts = (shape.points || []).map((p) => [...p]);
        const poly = pts.length > 2 ? L.polygon(pts, style) : L.polyline(pts, style);
        editLayer.addLayer(poly);
        pts.forEach((p, i) => {
          const v = L.marker(p, { icon: vIcon, draggable: true, zIndexOffset: 900 });
          v.on('drag', (e) => { const ll = e.target.getLatLng(); pts[i] = [ll.lat, ll.lng]; poly.setLatLngs(pts); });
          v.on('dragend', () => onChange({ type: 'polygon', points: pts.map(([a, b]) => [Number(a.toFixed(6)), Number(b.toFixed(6))]) }));
          editLayer.addLayer(v);
        });
      }
      if (shape.type === 'circle' && shape.center) {
        let center = L.latLng(shape.center);
        let radius = shape.radius || 1000;
        const circle = L.circle(center, { ...style, radius });
        editLayer.addLayer(circle);
        const handlePos = () => { const b = circle.getBounds(); return L.latLng(center.lat, b.getEast()); };
        const c = L.marker(center, { icon: vIcon, draggable: true, zIndexOffset: 900 });
        const r = L.marker(handlePos(), { icon: vIcon, draggable: true, zIndexOffset: 900 });
        const emit = () => onChange({ type: 'circle', center: [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))], radius: Math.round(radius) });
        c.on('drag', (e) => { center = e.target.getLatLng(); circle.setLatLng(center); r.setLatLng(handlePos()); });
        c.on('dragend', emit);
        r.on('drag', (e) => { radius = Math.max(50, map.distance(center, e.target.getLatLng())); circle.setRadius(radius); });
        r.on('dragend', () => { r.setLatLng(handlePos()); emit(); });
        editLayer.addLayer(c);
        editLayer.addLayer(r);
      }
    },
    onClick(cb) {
      const fn = (e) => cb(e.latlng.lat, e.latlng.lng);
      map.on('click', fn);
      return () => map.off('click', fn);
    },
    fit(points, { maxZoom = 15, padding = 50 } = {}) {
      const valid = points.filter((p) => p && p.lat != null && p.lng != null);
      if (!valid.length) return;
      if (valid.length === 1) map.setView([valid[0].lat, valid[0].lng], Math.min(maxZoom, 15));
      else map.fitBounds(valid.map((p) => [p.lat, p.lng]), { padding: [padding, padding], maxZoom });
    },
    setView(c, z) {
      map.setView([c.lat, c.lng], z ?? map.getZoom());
    },
    getZoom: () => map.getZoom(),
    popup(markerId, html) {
      const mk = markers.get(markerId);
      if (mk) mk.unbindPopup().bindPopup(html, { maxWidth: 280 }).openPopup();
    },
    invalidate: () => map.invalidateSize(),
    destroy() {
      map.remove();
    },
  };
  // Leaflet necesita recalcular el tamaño cuando el contenedor cambia (modales, pestañas).
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(container);
  const destroy = handle.destroy;
  handle.destroy = () => { ro.disconnect(); destroy(); };
  return handle;
}

/* ------------------------------------------------------------------ */
/* Google Maps                                                          */
/* ------------------------------------------------------------------ */
async function createGoogleMap(container, { key, mapId, center, zoom, dark }) {
  const google = await loadGoogleMaps(key);
  const [maps, marker, places] = await Promise.all([google.importLibrary('maps'), google.importLibrary('marker'), google.importLibrary('places')]);
  const map = new maps.Map(container, {
    center, zoom, mapId: mapId || 'DEMO_MAP_ID', gestureHandling: 'greedy', streetViewControl: false, mapTypeControl: false,
    fullscreenControl: true, clickableIcons: false, colorScheme: dark ? 'DARK' : 'LIGHT',
  });
  const markers = new Map();
  const lines = new Map();
  let shapes = [];
  let editing = [];
  let info = null;

  const content = (m) => {
    const b = markerBox(m);
    const el = document.createElement('div');
    el.innerHTML = markerHtml(m);
    // AdvancedMarkerElement ancla el borde inferior del contenido: se ajusta para gotas y círculos.
    el.style.cssText = b.drop ? `width:${b.w}px;height:${Math.round(b.h / 2 + b.h * Math.SQRT1_2)}px` : `width:${b.w}px;height:${b.h}px;transform:translateY(50%)`;
    return el;
  };

  return {
    engine: 'google',
    map,
    gm: { maps, marker, places, core: google },
    setTheme() {
      /* El esquema de color de Google se fija al crear el mapa. */
    },
    setMarkers(list) {
      const seen = new Set();
      for (const m of list) {
        if (m.lat == null || m.lng == null) continue;
        seen.add(m.id);
        let mk = markers.get(m.id);
        if (mk && mk._sig !== sig(m)) { mk.map = null; mk = null; }
        if (!mk) {
          mk = new marker.AdvancedMarkerElement({ map, position: { lat: m.lat, lng: m.lng }, content: content(m), title: m.title || '', gmpDraggable: !!m.draggable, zIndex: m.zIndex ?? (m.kind === 'courier' ? 500 : 0) });
          mk._sig = sig(m);
          markers.set(m.id, mk);
        } else {
          mk.position = { lat: m.lat, lng: m.lng };
          mk.title = m.title || '';
        }
        google.event.clearListeners(mk, 'dragend');
        google.event.clearListeners(mk, 'click');
        if (m.onDragEnd) mk.addListener('dragend', () => { const p = mk.position; m.onDragEnd(typeof p.lat === 'function' ? p.lat() : p.lat, typeof p.lng === 'function' ? p.lng() : p.lng); });
        if (m.onClick) mk.addListener('click', () => m.onClick());
      }
      for (const [id, mk] of markers) if (!seen.has(id)) { mk.map = null; markers.delete(id); }
    },
    setLines(list) {
      const seen = new Set();
      for (const l of list) {
        if (!l.from || !l.to) continue;
        seen.add(l.id);
        const path = [{ lat: l.from[0], lng: l.from[1] }, { lat: l.to[0], lng: l.to[1] }];
        let pl = lines.get(l.id);
        if (!pl) {
          pl = new maps.Polyline({ map, path, strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: l.color || '#2563eb', scale: 3 }, offset: '0', repeat: '14px' }] });
          lines.set(l.id, pl);
        } else pl.setPath(path);
      }
      for (const [id, pl] of lines) if (!seen.has(id)) { pl.setMap(null); lines.delete(id); }
    },
    setShapes(list) {
      shapes.forEach((s) => s.setMap(null));
      shapes = [];
      for (const z of list) {
        const st = { strokeColor: z.color, strokeOpacity: z.strokeOpacity ?? 0.9, strokeWeight: 2, fillColor: z.color, fillOpacity: z.fillOpacity ?? 0.18, clickable: !!z.onClick, map };
        let o = null;
        if (z.type === 'polygon' && z.points?.length > 2) o = new maps.Polygon({ ...st, paths: z.points.map(([lat, lng]) => ({ lat, lng })) });
        if (z.type === 'circle' && z.center && z.radius) o = new maps.Circle({ ...st, center: { lat: z.center[0], lng: z.center[1] }, radius: z.radius });
        if (o) {
          if (z.onClick) o.addListener('click', (e) => z.onClick(e.latLng.lat(), e.latLng.lng()));
          shapes.push(o);
        }
      }
    },
    setEditable(shape, onChange) {
      editing.forEach((s) => s.setMap(null));
      editing = [];
      if (!shape) return;
      const color = shape.color || '#2563eb';
      const st = { strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: 0.25, editable: true, draggable: true, map };
      if (shape.type === 'polygon' && shape.points?.length) {
        if (shape.points.length < 3) {
          editing.push(new maps.Polyline({ map, strokeColor: color, strokeWeight: 2, path: shape.points.map(([lat, lng]) => ({ lat, lng })) }));
          return;
        }
        const poly = new maps.Polygon({ ...st, paths: shape.points.map(([lat, lng]) => ({ lat, lng })) });
        const emit = () => onChange({ type: 'polygon', points: poly.getPath().getArray().map((p) => [Number(p.lat().toFixed(6)), Number(p.lng().toFixed(6))]) });
        ['set_at', 'insert_at', 'remove_at'].forEach((ev) => poly.getPath().addListener(ev, emit));
        poly.addListener('dragend', emit);
        editing.push(poly);
      }
      if (shape.type === 'circle' && shape.center) {
        const circle = new maps.Circle({ ...st, center: { lat: shape.center[0], lng: shape.center[1] }, radius: shape.radius || 1000 });
        const emit = () => { const c = circle.getCenter(); onChange({ type: 'circle', center: [Number(c.lat().toFixed(6)), Number(c.lng().toFixed(6))], radius: Math.round(circle.getRadius()) }); };
        circle.addListener('radius_changed', emit);
        circle.addListener('dragend', emit);
        editing.push(circle);
      }
    },
    onClick(cb) {
      const l = map.addListener('click', (e) => cb(e.latLng.lat(), e.latLng.lng()));
      return () => google.event.removeListener(l);
    },
    fit(points, { maxZoom = 15, padding = 50 } = {}) {
      const valid = points.filter((p) => p && p.lat != null && p.lng != null);
      if (!valid.length) return;
      if (valid.length === 1) {
        map.setCenter(valid[0]);
        map.setZoom(Math.min(maxZoom, 15));
        return;
      }
      const bounds = new google.LatLngBounds();
      valid.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, padding);
      const once = map.addListener('idle', () => { if (map.getZoom() > maxZoom) map.setZoom(maxZoom); google.event.removeListener(once); });
    },
    setView(c, z) {
      map.setCenter(c);
      if (z != null) map.setZoom(z);
    },
    getZoom: () => map.getZoom(),
    popup(markerId, html) {
      const mk = markers.get(markerId);
      if (!mk) return;
      info ||= new maps.InfoWindow();
      info.setContent(`<div class="gm-info">${html}</div>`);
      info.open({ map, anchor: mk });
    },
    invalidate() {},
    destroy() {
      markers.forEach((m) => { m.map = null; });
      shapes.forEach((s) => s.setMap(null));
    },
  };
}

/** Crea el mapa con el motor que corresponda según la configuración. */
export async function createMap(container, { googleKey, mapId, center, zoom, dark }) {
  if (googleKey) return createGoogleMap(container, { key: googleKey, mapId, center, zoom, dark });
  return createOsmMap(container, { center, zoom, dark });
}
