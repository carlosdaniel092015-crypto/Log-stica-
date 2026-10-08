/**
 * Motor de mapas unificado.
 *  - "osm": OpenFreeMap (mapas vectoriales gratis, sin clave) con MapLibre GL.
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
/* OpenFreeMap con MapLibre GL nativo (acelerado por GPU: zoom suave)   */
/* ------------------------------------------------------------------ */
let maplibreLoading = null;
function loadMaplibre() {
  if (!maplibreLoading) {
    maplibreLoading = Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([m]) => m.default || m);
  }
  return maplibreLoading;
}

// MapLibre usa teselas de 512 px: su zoom equivale al de Google/Leaflet menos 1.
const toGL = (z) => z - 1;
const fromGL = (z) => z + 1;
const EARTH = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/** Círculo como polígono de 64 lados (GeoJSON no tiene círculos). */
function circleRing(lat, lng, radius, steps = 64) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos(rad(lat)));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

function shapeFeature(s, props) {
  if (s.type === 'circle' && s.center && s.radius) {
    const [lat, lng] = s.center;
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [circleRing(lat, lng, s.radius)] } };
  }
  if (s.type === 'polygon' && s.points?.length > 1) {
    const ring = s.points.map(([lat, lng]) => [lng, lat]);
    if (ring.length < 3) return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: ring } };
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
  }
  return null;
}

const collection = (features) => ({ type: 'FeatureCollection', features: features.filter(Boolean) });
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9eef3' } }] };

async function createOsmMap(container, { center, zoom, dark }) {
  const maplibregl = await loadMaplibre();
  let theme = dark ? 'dark' : 'light';
  const map = new maplibregl.Map({
    container,
    style: OFM_STYLES[theme],
    center: [center.lng, center.lat],
    zoom: toGL(zoom),
    maxZoom: toGL(20),
    attributionControl: { compact: true, customAttribution: ATTRIBUTION },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  container.classList.toggle('map-dark', theme === 'dark');

  // Si el estilo no carga (sin internet / servicio caído) se usa un fondo liso: marcadores y zonas siguen funcionando.
  map.on('error', () => {
    if (!map.isStyleLoaded() && !map._lrdFallback) {
      map._lrdFallback = true;
      map.setStyle(FALLBACK_STYLE);
    }
  });

  const state = { shapes: [], lines: [], edit: null };
  const shapeClicks = new Map();
  const markers = new Map();
  const clickCbs = new Set();

  const SOURCES = {
    'lrd-shapes': () => collection(state.shapes.map((s, i) => shapeFeature(s, { i, color: s.color || '#2563eb', fo: s.fillOpacity ?? 0.18, so: s.strokeOpacity ?? 0.9, dashed: !!s.dashed, click: !!s.onClick }))),
    'lrd-lines': () => collection(state.lines.map((l) => ({ type: 'Feature', properties: { color: l.color || '#2563eb' }, geometry: { type: 'LineString', coordinates: [[l.from[1], l.from[0]], [l.to[1], l.to[0]]] } }))),
    'lrd-edit': () => collection(state.edit ? [shapeFeature(state.edit, { color: state.edit.color || '#2563eb' })] : []),
  };
  const refresh = (id) => map.getSource(id)?.setData(SOURCES[id]());

  // Capas propias: se vuelven a crear cada vez que cambia el estilo (tema claro/oscuro).
  map.on('style.load', () => {
    for (const id of Object.keys(SOURCES)) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: SOURCES[id]() });
    const add = (layer) => !map.getLayer(layer.id) && map.addLayer(layer);
    add({ id: 'lrd-shapes-fill', type: 'fill', source: 'lrd-shapes', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fo'] } });
    add({ id: 'lrd-shapes-line', type: 'line', source: 'lrd-shapes', filter: ['!=', 'dashed', true], paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'so'], 'line-width': 2 } });
    add({ id: 'lrd-shapes-dash', type: 'line', source: 'lrd-shapes', filter: ['==', 'dashed', true], paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'so'], 'line-width': 2, 'line-dasharray': [3, 3] } });
    add({ id: 'lrd-lines', type: 'line', source: 'lrd-lines', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [2, 2] } });
    add({ id: 'lrd-edit-fill', type: 'fill', source: 'lrd-edit', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } });
    add({ id: 'lrd-edit-line', type: 'line', source: 'lrd-edit', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
    for (const id of Object.keys(SOURCES)) refresh(id);
  });

  const clickableAt = (point) => {
    if (!map.getLayer('lrd-shapes-fill')) return null;
    const hits = map.queryRenderedFeatures(point, { layers: ['lrd-shapes-fill', 'lrd-shapes-line', 'lrd-shapes-dash'] });
    return hits.find((f) => f.properties.click) || null;
  };
  map.on('click', (e) => {
    if (e.originalEvent?.target?.closest?.('.maplibregl-marker, .maplibregl-popup')) return;
    const hit = clickableAt(e.point);
    if (hit) {
      state.shapes[hit.properties.i]?.onClick?.(e.lngLat.lat, e.lngLat.lng);
      return;
    }
    for (const cb of clickCbs) cb(e.lngLat.lat, e.lngLat.lng);
  });
  map.on('mousemove', (e) => {
    map.getCanvas().style.cursor = clickableAt(e.point) ? 'pointer' : '';
  });

  const markerEl = (m) => {
    const b = markerBox(m);
    const el = document.createElement('div');
    el.className = 'mk-icon';
    el.style.width = `${b.w}px`;
    el.style.height = `${b.h}px`;
    el.innerHTML = markerHtml(m);
    if (m.title) el.title = m.title;
    return { el, offset: b.drop ? [0, -Math.round(b.h * Math.SQRT1_2)] : [0, 0] };
  };
  const newMarker = (m, { draggable = !!m.draggable } = {}) => {
    const { el, offset } = markerEl(m);
    el.style.zIndex = String(m.zIndex ?? (m.kind === 'courier' || m.kind === 'moto' ? 500 : m.kind === 'vertex' ? 900 : 1));
    return new maplibregl.Marker({ element: el, offset, draggable });
  };

  let editMarkers = [];

  const handle = {
    engine: 'osm',
    map,
    setTheme(isDark) {
      const t = isDark ? 'dark' : 'light';
      if (t === theme) return;
      theme = t;
      container.classList.toggle('map-dark', t === 'dark');
      map._lrdFallback = false;
      map.setStyle(OFM_STYLES[t]);
    },
    setMarkers(list) {
      const seen = new Set();
      for (const m of list) {
        if (m.lat == null || m.lng == null) continue;
        seen.add(m.id);
        let mk = markers.get(m.id);
        if (mk && mk._sig !== sig(m)) {
          mk.remove();
          mk = null;
        }
        if (!mk) {
          mk = newMarker(m).setLngLat([m.lng, m.lat]).addTo(map);
          mk._sig = sig(m);
          mk.getElement().addEventListener('click', (ev) => {
            ev.stopPropagation();
            mk._onClick?.();
          });
          mk.on('dragend', () => {
            const p = mk.getLngLat();
            mk._onDragEnd?.(p.lat, p.lng);
          });
          markers.set(m.id, mk);
        } else {
          const cur = mk.getLngLat();
          if (Math.abs(cur.lat - m.lat) > 1e-7 || Math.abs(cur.lng - m.lng) > 1e-7) mk.setLngLat([m.lng, m.lat]);
          if (m.title) mk.getElement().title = m.title;
        }
        mk._onClick = m.onClick || null;
        mk._onDragEnd = m.onDragEnd || null;
      }
      for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
    },
    setLines(list) {
      state.lines = list.filter((l) => l.from && l.to);
      refresh('lrd-lines');
    },
    setShapes(list) {
      state.shapes = list.filter((s) => (s.type === 'polygon' && s.points?.length) || (s.type === 'circle' && s.center && s.radius));
      refresh('lrd-shapes');
    },
    setEditable(shape, onChange) {
      for (const mk of editMarkers) mk.remove();
      editMarkers = [];
      state.edit = null;
      if (!shape) return refresh('lrd-edit');
      const color = shape.color || '#2563eb';
      const vertex = () => newMarker({ kind: 'vertex', color }, { draggable: true });
      if (shape.type === 'polygon') {
        const pts = (shape.points || []).map((p) => [...p]);
        state.edit = { type: 'polygon', points: pts, color };
        pts.forEach((p, i) => {
          const v = vertex().setLngLat([p[1], p[0]]).addTo(map);
          v.on('drag', () => { const ll = v.getLngLat(); pts[i] = [ll.lat, ll.lng]; refresh('lrd-edit'); });
          v.on('dragend', () => onChange({ type: 'polygon', points: pts.map(([a, b]) => [Number(a.toFixed(6)), Number(b.toFixed(6))]) }));
          editMarkers.push(v);
        });
      }
      if (shape.type === 'circle' && shape.center) {
        let c = { lat: shape.center[0], lng: shape.center[1] };
        let radius = shape.radius || 1000;
        const handlePos = () => [c.lng + radius / (111320 * Math.cos(rad(c.lat))), c.lat];
        const sync = () => { state.edit = { type: 'circle', center: [c.lat, c.lng], radius, color }; refresh('lrd-edit'); };
        sync();
        const emit = () => onChange({ type: 'circle', center: [Number(c.lat.toFixed(6)), Number(c.lng.toFixed(6))], radius: Math.round(radius) });
        const cm = vertex().setLngLat([c.lng, c.lat]).addTo(map);
        const rm = vertex().setLngLat(handlePos()).addTo(map);
        cm.on('drag', () => { const ll = cm.getLngLat(); c = { lat: ll.lat, lng: ll.lng }; rm.setLngLat(handlePos()); sync(); });
        cm.on('dragend', emit);
        rm.on('drag', () => { radius = Math.max(50, distanceM(c, rm.getLngLat())); sync(); });
        rm.on('dragend', () => { rm.setLngLat(handlePos()); emit(); });
        editMarkers.push(cm, rm);
      }
      refresh('lrd-edit');
    },
    onClick(cb) {
      clickCbs.add(cb);
      return () => clickCbs.delete(cb);
    },
    fit(points, { maxZoom = 15, padding = 50 } = {}) {
      const valid = points.filter((p) => p && p.lat != null && p.lng != null);
      if (!valid.length) return;
      if (valid.length === 1) return map.jumpTo({ center: [valid[0].lng, valid[0].lat], zoom: toGL(Math.min(maxZoom, 15)) });
      const b = new maplibregl.LngLatBounds();
      for (const p of valid) b.extend([p.lng, p.lat]);
      const box = container.getBoundingClientRect();
      const pad = Math.max(0, Math.min(padding, box.width / 4, box.height / 4));
      map.fitBounds(b, { padding: pad, maxZoom: toGL(maxZoom), duration: 0 });
    },
    setView(c, z) {
      map.jumpTo({ center: [c.lng, c.lat], zoom: z != null ? toGL(z) : map.getZoom() });
    },
    getZoom: () => fromGL(map.getZoom()),
    popup(markerId, html) {
      const mk = markers.get(markerId);
      if (!mk) return;
      mk.setPopup(new maplibregl.Popup({ offset: 20, maxWidth: '280px' }).setHTML(html));
      if (!mk.getPopup().isOpen()) mk.togglePopup();
    },
    invalidate: () => map.resize(),
    destroy() {
      map.remove();
    },
  };
  // Recalcula el tamaño cuando el contenedor cambia (modales, pestañas, paneles).
  const ro = new ResizeObserver(() => map.resize());
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
