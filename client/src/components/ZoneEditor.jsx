import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { money, ZONE_KINDS } from '../lib/format';
import { SD_CENTER } from '../lib/maps';
import { MapView } from './Map';
import { Field, Modal, useAction, useAsync } from './ui';
import { getGeoTree } from './AddressPicker';
import Icon from './Icon';
import { useApp } from '../context/AppContext';

/** Convierte zonas de la API en figuras para el mapa (polígonos y círculos). */
export function zoneShapes(zones, { faded = false, onClick } = {}) {
  return zones
    .filter((z) => z.geometry_type !== 'none')
    .map((z) => ({
      id: z.id,
      type: z.geometry_type,
      points: z.polygon,
      center: z.center_lat != null ? [z.center_lat, z.center_lng] : null,
      radius: z.radius_m,
      color: z.color,
      fillOpacity: faded ? 0.06 : z.active ? 0.18 : 0.05,
      strokeOpacity: faded ? 0.35 : z.active ? 0.9 : 0.4,
      dashed: !z.active,
      onClick: onClick ? (lat, lng) => onClick(z, lat, lng) : undefined,
    }));
}

/** Encaja el mapa a una zona. */
export function fitZone(h, z) {
  if (!h || !z) return;
  if (z.geometry_type === 'circle') h.setView({ lat: z.center_lat, lng: z.center_lng }, 13);
  else if (z.polygon?.length) h.fit(z.polygon.map(([lat, lng]) => ({ lat, lng })), { maxZoom: 15, padding: 40 });
}

/**
 * Herramienta de dibujo (funciona con OpenFreeMap y con Google Maps):
 *  - Polígono: toca el mapa para agregar vértices; arrastra los puntos para ajustar.
 *  - Círculo: toca el centro y arrastra el punto del borde para cambiar el radio.
 */
function ZoneDrawer({ geometry, onChange, color, otherZones }) {
  const [tool, setTool] = useState(geometry.type === 'none' ? null : geometry.type);
  const hRef = useRef(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const geomRef = useRef(geometry);
  geomRef.current = geometry;

  const toShape = (g) =>
    g.type === 'polygon' ? { type: 'polygon', points: g.polygon || [], color } : g.type === 'circle' && g.center_lat != null ? { type: 'circle', center: [g.center_lat, g.center_lng], radius: g.radius_m, color } : null;
  const fromShape = useCallback(
    (s) => onChange(s.type === 'polygon' ? { type: 'polygon', polygon: s.points } : { type: 'circle', center_lat: s.center[0], center_lng: s.center[1], radius_m: s.radius }),
    [onChange]
  );

  // Redibuja la figura editable cuando cambia la cantidad de vértices, el tipo o el color.
  useEffect(() => {
    hRef.current?.setEditable(toShape(geometry), fromShape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry.type, geometry.polygon?.length, geometry.center_lat, color]);

  const onReady = (h) => {
    hRef.current = h;
    h.setShapes(zoneShapes(otherZones, { faded: true }));
    h.onClick((lat, lng) => {
      const g = geomRef.current;
      const p = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
      if (toolRef.current === 'polygon') onChange({ type: 'polygon', polygon: [...(g.type === 'polygon' ? g.polygon || [] : []), p] });
      else if (toolRef.current === 'circle' && g.type !== 'circle') onChange({ type: 'circle', center_lat: p[0], center_lng: p[1], radius_m: 1500 });
    });
    h.setEditable(toShape(geomRef.current), fromShape);
    const g = geomRef.current;
    if (g.type === 'polygon' && g.polygon?.length) h.fit(g.polygon.map(([lat, lng]) => ({ lat, lng })), { maxZoom: 15, padding: 40 });
    else if (g.type === 'circle' && g.center_lat != null) h.setView({ lat: g.center_lat, lng: g.center_lng }, 13);
  };

  const points = geometry.type === 'polygon' ? geometry.polygon?.length || 0 : 0;
  return (
    <div className="stack-sm">
      <div className="row-wrap">
        <button type="button" className={`btn btn-sm ${tool === 'polygon' ? 'btn-primary' : ''}`} onClick={() => { setTool('polygon'); if (geometry.type !== 'polygon') onChange({ type: 'polygon', polygon: [] }); }}><Icon name="polygon" /> Polígono</button>
        <button type="button" className={`btn btn-sm ${tool === 'circle' ? 'btn-primary' : ''}`} onClick={() => { setTool('circle'); if (geometry.type !== 'circle') onChange({ type: 'none' }); }}><Icon name="circle" /> Círculo</button>
        {points > 0 && <button type="button" className="btn btn-sm" onClick={() => onChange({ type: 'polygon', polygon: geometry.polygon.slice(0, -1) })}>Deshacer punto</button>}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setTool(null); onChange({ type: 'none' }); }}>Quitar área</button>
      </div>
      <div className="small muted">
        {tool === 'polygon' && (points < 3 ? `Toca el mapa para agregar los vértices del área (${points}/3 mínimo).` : `${points} vértices. Arrastra los puntos para ajustar o toca el mapa para agregar más.`)}
        {tool === 'circle' && (geometry.type === 'circle' ? `Radio: ${(geometry.radius_m / 1000).toFixed(2)} km. Arrastra el centro o el punto del borde para ajustar.` : 'Toca el mapa para colocar el centro del círculo.')}
        {!tool && 'Sin área dibujada: la zona se detectará por provincia, municipio o sector.'}
      </div>
      <MapView className="map" center={SD_CENTER} zoom={11} onReady={onReady} />
    </div>
  );
}

/** Formulario de zona tarifaria (datos, precio y área en el mapa). */
export function ZoneFormModal({ zone, allZones = [], onClose, onSaved }) {
  const { currency } = useApp();
  const tree = useAsync(() => getGeoTree(), []);
  const [form, setForm] = useState({
    name: zone?.name || '', kind: zone?.kind || 'custom', province_id: zone?.province_id || '', municipality_id: zone?.municipality_id || '', sector_id: zone?.sector_id || '',
    price: zone?.price ?? '', priority: zone?.priority ?? 0, color: zone?.color || '#2563eb', active: zone?.active ?? true,
  });
  const [geometry, setGeometry] = useState(
    zone?.geometry_type === 'polygon' ? { type: 'polygon', polygon: zone.polygon } : zone?.geometry_type === 'circle' ? { type: 'circle', center_lat: zone.center_lat, center_lng: zone.center_lng, radius_m: zone.radius_m } : { type: 'none' }
  );
  const [busy, run] = useAction();
  const rates = useAsync(() => (zone?.id ? api.get(`/api/zones/${zone.id}/rates`) : Promise.resolve([])), [zone?.id]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const t = tree.data;
  const municipalities = useMemo(() => (t?.municipalities || []).filter((m) => !form.province_id || m.province_id === form.province_id), [t, form.province_id]);
  const sectors = useMemo(() => (t?.sectors || []).filter((s) => !form.municipality_id || s.municipality_id === form.municipality_id), [t, form.municipality_id]);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = {
        name: form.name, kind: form.kind, province_id: form.province_id || null, municipality_id: form.municipality_id || null, sector_id: form.sector_id || null,
        price: Number(form.price), priority: Number(form.priority) || 0, color: form.color, active: !!form.active, geometry_type: geometry.type,
        polygon: geometry.type === 'polygon' ? geometry.polygon : null,
        center_lat: geometry.type === 'circle' ? geometry.center_lat : null, center_lng: geometry.type === 'circle' ? geometry.center_lng : null, radius_m: geometry.type === 'circle' ? geometry.radius_m : null,
      };
      if (geometry.type === 'polygon' && (geometry.polygon?.length || 0) < 3) throw new Error('El polígono necesita al menos 3 puntos.');
      const saved = zone?.id ? await api.put(`/api/zones/${zone.id}`, body) : await api.post('/api/zones', body);
      onSaved(saved);
    }, zone?.id ? 'Zona actualizada.' : 'Zona creada.');
  };

  return (
    <Modal title={zone?.id ? `Editar zona: ${zone.name}` : 'Nueva zona de entrega'} size="xl" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="zone-form" disabled={busy}>Guardar zona</button></>}>
      <form id="zone-form" className="grid" style={{ gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', alignItems: 'start' }} data-responsive="zone" onSubmit={submit}>
        <div className="stack">
          <Field label="Nombre de la zona"><input className="input" value={form.name} onChange={set('name')} required placeholder="Ej.: Los Alcarrizos" /></Field>
          <Field label="Tipo">
            <select className="select" value={form.kind} onChange={set('kind')}>{Object.entries(ZONE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Provincia">
            <select className="select" value={form.province_id} onChange={(e) => setForm({ ...form, province_id: e.target.value, municipality_id: '', sector_id: '' })}>
              <option value="">—</option>{(t?.provinces || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {['municipality', 'sector', 'custom'].includes(form.kind) && (
            <Field label="Municipio / Distrito municipal">
              <select className="select" value={form.municipality_id} onChange={(e) => setForm({ ...form, municipality_id: e.target.value, sector_id: '' })}>
                <option value="">—</option>{municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
          {['sector', 'custom'].includes(form.kind) && (
            <Field label="Sector">
              <select className="select" value={form.sector_id} onChange={set('sector_id')}>
                <option value="">—</option>{sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <div className="form-grid">
            <Field label={`Precio (${currency})`}><input className="input" type="number" min="0" step="1" value={form.price} onChange={set('price')} required /></Field>
            <Field label="Prioridad" hint="Desempate: mayor gana"><input className="input" type="number" min="-100" max="100" value={form.priority} onChange={set('priority')} /></Field>
          </div>
          <div className="row-wrap">
            <label className="row small">Color <input type="color" value={form.color} onChange={set('color')} style={{ width: 44, height: 32, border: 0, background: 'none' }} /></label>
            <label className="check small"><input type="checkbox" checked={form.active} onChange={set('active')} /> Zona activa</label>
          </div>
          <div className="alert alert-info small">
            Una dirección pertenece a la zona si cae dentro del área dibujada. Sin área, se usa la provincia, el municipio o el sector seleccionado. Si coincide con varias zonas se aplica la prioridad configurada (por defecto: personalizada &gt; sector &gt; municipio &gt; provincia).
          </div>
          {rates.data?.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Historial de precios</div>
              {rates.data.map((r) => <div key={r.id} className="small">{money(r.price, currency)} · <span className="muted">{new Date(r.effective_from).toLocaleString('es-DO')} {r.created_by_name ? `· ${r.created_by_name}` : ''}</span></div>)}
            </div>
          )}
        </div>
        <ZoneDrawer geometry={geometry} onChange={setGeometry} color={form.color} otherZones={allZones.filter((z) => z.id !== zone?.id)} />
      </form>
      <style>{`@media (max-width: 900px) { [data-responsive="zone"] { grid-template-columns: 1fr !important; } }`}</style>
    </Modal>
  );
}
