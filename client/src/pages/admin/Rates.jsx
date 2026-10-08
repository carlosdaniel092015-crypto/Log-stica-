import { useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { money, ZONE_KINDS } from '../../lib/format';
import { Empty, Spinner, useAction, useAsync } from '../../components/ui';
import { ZoneFormModal } from '../../components/ZoneEditor';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

function PriceCell({ zone, onSaved, editable }) {
  const { currency } = useApp();
  const [value, setValue] = useState(null);
  const [busy, run] = useAction();
  if (!editable || value === null) {
    return (
      <button className="btn btn-sm btn-ghost mono bold" disabled={!editable} onClick={() => setValue(String(zone.price ?? ''))} title={editable ? 'Cambiar precio' : undefined}>
        {money(zone.price, currency)}
      </button>
    );
  }
  const save = () => run(async () => { onSaved(await api.patch(`/api/zones/${zone.id}/price`, { price: Number(value) })); setValue(null); }, `Precio de ${zone.name} actualizado.`);
  return (
    <span className="row" style={{ gap: 4 }}>
      <input className="input" style={{ width: 100, minHeight: 32 }} type="number" min="0" value={value} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setValue(null); }} />
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={save} aria-label="Guardar"><Icon name="check" /></button>
      <button className="btn btn-sm btn-ghost" onClick={() => setValue(null)} aria-label="Cancelar"><Icon name="x" /></button>
    </span>
  );
}

export default function Rates() {
  const { user } = useApp();
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
          <p>Precios en RD$ por provincia, municipio, sector o zona personalizada. Los cambios aplican a los pedidos nuevos.</p>
        </div>
        <div className="row-wrap">
          <a className="btn" href="/api/zones/export" download><Icon name="download" /> Exportar CSV</a>
          <a className="btn" href="/api/zones/export?format=json" download><Icon name="download" /> JSON</a>
          {editable && (
            <>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" /> Importar CSV</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
              <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Nueva zona</button>
            </>
          )}
        </div>
      </div>
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
              <thead><tr><th>Zona</th><th>Tipo</th><th>Provincia</th><th>Municipio</th><th>Sector</th><th>Área</th><th className="num">Precio</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {(zones.data || []).map((z) => (
                  <tr key={z.id} style={{ opacity: z.active ? 1 : 0.55 }}>
                    <td className="bold"><span className="row" style={{ gap: 8 }}><span className="color-dot" style={{ background: z.color }} />{z.name}</span></td>
                    <td>{ZONE_KINDS[z.kind]}</td>
                    <td className="small">{z.province_name || '—'}</td>
                    <td className="small">{z.municipality_name || '—'}</td>
                    <td className="small">{z.sector_name || '—'}</td>
                    <td className="small">{z.geometry_type === 'polygon' ? 'Polígono' : z.geometry_type === 'circle' ? `Círculo ${(z.radius_m / 1000).toFixed(1)} km` : 'Por división'}</td>
                    <td className="num"><PriceCell zone={z} editable={editable} onSaved={replace} /></td>
                    <td>
                      <button className="badge" style={{ '--c': z.active ? 'var(--success)' : 'var(--muted)', cursor: editable ? 'pointer' : 'default', font: 'inherit', fontSize: '0.76rem' }} disabled={!editable || busy} onClick={() => run(async () => replace(await api.patch(`/api/zones/${z.id}/active`, { active: !z.active })), z.active ? 'Zona desactivada.' : 'Zona activada.')}>
                        {z.active ? 'Activa' : 'Inactiva'}
                      </button>
                    </td>
                    <td className="nowrap">
                      {editable && <button className="btn btn-sm" onClick={() => setEditing(z)}><Icon name="edit" /> Editar</button>}{' '}
                      {editable && <button className="btn btn-sm btn-ghost" aria-label="Eliminar" onClick={() => window.confirm(`¿Eliminar la zona "${z.name}"? Puedes desactivarla en su lugar.`) && run(async () => { await api.del(`/api/zones/${z.id}`); zones.reload(true); }, 'Zona eliminada.')}><Icon name="trash" /></button>}
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
