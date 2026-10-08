import { useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { money, ZONE_KINDS } from '../../lib/format';
import { Empty, Spinner, useAction, useAsync } from '../../components/ui';
import { ZoneFormModal } from '../../components/ZoneEditor';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

/** Precio editable en la misma tabla: se guarda al salir del campo o con Enter. */
function PriceCell({ zone, onSaved, editable }) {
  const [value, setValue] = useState(null);
  const [, run] = useAction();
  const save = () => {
    if (value === null) return;
    const n = Number(value);
    setValue(null);
    if (!Number.isFinite(n) || n < 0 || n === zone.price) return;
    run(async () => onSaved(await api.patch(`/api/zones/${zone.id}/price`, { price: n })), `Precio de ${zone.name}: RD$${n}`);
  };
  return (
    <label className="price-input">
      <span>RD$</span>
      <input value={value ?? zone.price ?? ''} disabled={!editable} inputMode="decimal" onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setValue(null); }} aria-label={`Precio de ${zone.name}`} />
    </label>
  );
}

export default function Rates() {
  const { user, toast } = useApp();
  const editable = can(user, 'zones.manage');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);
  const zones = useAsync(() => api.get(`/api/zones${qs({ q, kind, active })}`), [q, kind, active]);
  const allZones = useAsync(() => api.get('/api/zones'), []);
  const [busy, run] = useAction();

  const replace = (z) => zones.setData((list) => list.map((x) => (x.id === z.id ? z : x)));

  const loadSuggested = async () => {
    const r = await run(() => api.post('/api/zones/load-suggested'));
    if (!r) return;
    const parts = [r.created && `se crearon ${r.created} zonas`, r.repaired && `se completaron ${r.repaired} zonas que no cubrían ningún lugar`].filter(Boolean);
    toast(parts.length ? `Listo: ${parts.join(' y ')}. Ajusta los precios a los tuyos.` : 'Ya tenías todas las zonas sugeridas.', { type: 'success' });
    zones.reload(true);
    allZones.reload(true);
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const content = await file.text();
    const r = await run(() => api.post('/api/zones/import', { content }));
    if (r) {
      setImportResult(r);
      zones.reload(true);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tarifas de entrega</h1>
          <p>El precio se aplica según la zona donde cae la dirección. Si hay varias, gana la de mayor prioridad.</p>
        </div>
        <div className="row-wrap">
          <a className="btn" href="/api/zones/export" download><Icon name="download" /> Exportar CSV</a>
          <a className="btn" href="/api/zones/export?format=json" download><Icon name="download" /> JSON</a>
          {editable && (
            <>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" /> Importar CSV</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
              <button className="btn" onClick={loadSuggested} disabled={busy}><Icon name="tag" /> Tarifas sugeridas</button>
              <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Nueva zona</button>
            </>
          )}
        </div>
      </div>
      {editable && allZones.data?.some((z) => z.active && z.covers === false) && (
        <div className="banner warning" style={{ marginBottom: 12 }}>
          <span className="banner-icon"><Icon name="alert" size={18} /></span>
          <div className="spacer"><strong>Hay zonas que no cubren ningún lugar</strong> ({allZones.data.filter((z) => z.active && z.covers === false).map((z) => z.name).join(', ')}). Edítalas y elige su provincia, municipio o sector, o dibuja un área; si no, los pedidos de esas direcciones quedarán "Sin zona".</div>
        </div>
      )}
      {editable && allZones.data?.length === 0 && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <span className="banner-icon"><Icon name="tag" size={18} /></span>
          <div className="spacer"><strong>Aún no tienes zonas de entrega.</strong> Carga tarifas sugeridas para Gran Santo Domingo, San Cristóbal y Santiago (Distrito Nacional, Santo Domingo Este, Oeste, Norte, Boca Chica, Haina…) y luego ajusta los precios a los tuyos.</div>
          <button className="btn btn-sm btn-primary" onClick={loadSuggested} disabled={busy}>Cargar tarifas sugeridas</button>
        </div>
      )}
      {importResult && (
        <div className={`alert ${importResult.errors.length ? 'alert-warning' : 'alert-success'}`} style={{ marginBottom: 12 }}>
          Importación: {importResult.created} creadas, {importResult.updated} actualizadas{importResult.errors.length ? `, ${importResult.errors.length} con errores` : ''}.
          {importResult.errors.slice(0, 5).map((er) => <div key={er.line} className="small">Línea {er.line}: {er.error}</div>)}
          <div className="tiny muted" style={{ marginTop: 4 }}>Columnas: nombre, tipo (Provincia/Municipio/Sector/Personalizada), provincia, municipio, sector, precio, estado, geometria, centro_lat, centro_lng, radio_m, poligono, prioridad, color.</div>
        </div>
      )}
      <div className="filters">
        <input className="input grow" placeholder="Buscar zona, provincia, municipio o sector" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>{Object.entries(ZONE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="select" value={active} onChange={(e) => setActive(e.target.value)} aria-label="Estado">
          <option value="">Activas e inactivas</option><option value="true">Activas</option><option value="false">Inactivas</option>
        </select>
      </div>
      <div className="card">
        {zones.loading && !zones.data ? <Spinner center /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Zona</th><th>Tipo</th><th>Provincia</th><th>Municipio</th><th>Sector</th><th>Área</th><th>Precio</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {(zones.data || []).map((z) => (
                  <tr key={z.id} style={{ opacity: z.active ? 1 : 0.55 }}>
                    <td className="bold">
                      <span className="row" style={{ gap: 8 }}><span className="color-dot" style={{ background: z.color }} />{z.name}</span>
                      {z.covers === false && <span className="tiny" style={{ color: 'var(--warning)', fontWeight: 600, display: 'block', marginTop: 2 }} title="Edítala y elige su provincia/municipio/sector o dibuja un área">⚠ No cubre ningún lugar</span>}
                    </td>
                    <td>{ZONE_KINDS[z.kind]}</td>
                    <td className="small">{z.province_name || '—'}</td>
                    <td className="small">{z.municipality_name || '—'}</td>
                    <td className="small">{z.sector_name || '—'}</td>
                    <td className="small muted">{z.geometry_type === 'polygon' ? 'Polígono' : z.geometry_type === 'circle' ? 'Círculo' : 'Sin área'}</td>
                    <td><PriceCell zone={z} editable={editable} onSaved={replace} /></td>
                    <td>
                      <label className="row" style={{ gap: 8, cursor: editable ? 'pointer' : 'default' }}>
                        <span className="switch"><input type="checkbox" checked={z.active} disabled={!editable || busy} onChange={() => run(async () => replace(await api.patch(`/api/zones/${z.id}/active`, { active: !z.active })), z.active ? 'Zona desactivada.' : 'Zona activada.')} aria-label={`Zona ${z.name} activa`} /><span /></span>
                        <span className="small">{z.active ? 'Activa' : 'Inactiva'}</span>
                      </label>
                    </td>
                    <td className="nowrap">
                      {editable && <button className="btn btn-sm btn-icon" onClick={() => setEditing(z)} aria-label="Editar"><Icon name="edit" /></button>}{' '}
                      {editable && <button className="btn btn-sm btn-icon btn-ghost" aria-label="Eliminar" onClick={() => window.confirm(`¿Eliminar la zona "${z.name}"? Puedes desactivarla en su lugar.`) && run(async () => { await api.del(`/api/zones/${z.id}`); zones.reload(true); }, 'Zona eliminada.')}><Icon name="trash" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {zones.data?.length === 0 && <Empty icon="tag" title="No hay zonas con estos filtros" />}
          </div>
        )}
      </div>
      {editing && <ZoneFormModal zone={editing.id ? editing : null} allZones={allZones.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); zones.reload(true); allZones.reload(true); }} />}
    </div>
  );
}
