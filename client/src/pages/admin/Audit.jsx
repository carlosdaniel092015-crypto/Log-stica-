import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { auditText } from '../../lib/auditText';
import { Empty, Spinner, useAsync } from '../../components/ui';
import { useApp } from '../../context/AppContext';

const ENTITIES = { order: 'Pedidos', zone: 'Zonas y tarifas', product: 'Productos', inventory_request: 'Solicitudes de inventario', user: 'Usuarios', customer: 'Clientes', courier: 'Mensajeros', settings: 'Configuración', province: 'Provincias', municipality: 'Municipios', sector: 'Sectores', role: 'Roles', branch: 'Sucursales' };

function when(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: 'numeric', minute: '2-digit' })}`;
}

function entityLabel(a, t) {
  if (a.order_number) return <Link to={`/admin/pedidos/${a.order_id}`} style={{ color: 'inherit' }}>Pedido #{a.order_number}</Link>;
  const nv = a.new_value && typeof a.new_value === 'object' ? a.new_value : {};
  const ov = a.old_value && typeof a.old_value === 'object' ? a.old_value : {};
  const name = nv.name || ov.name;
  return name ? `${t.entity} ${name}` : t.entity;
}

export default function Audit() {
  const { config } = useApp();
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const { data, loading } = useAsync(() => api.get(`/api/audit${qs({ entity, from: from ? new Date(`${from}T00:00:00-04:00`).toISOString() : '', limit: 500 })}`), [entity, from]);
  return (
    <div>
      <div className="page-header"><div><h1>Auditoría</h1><p>Registro de cambios hechos por cada usuario</p></div></div>
      <div className="filters">
        <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entidad"><option value="">Todas las entidades</option>{Object.entries(ENTITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
      </div>
      <div className="card">
        {loading && !data ? <Spinner center /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
              <tbody>
                {(data || []).map((a) => {
                  const t = auditText(a, config?.statuses);
                  return (
                    <tr key={a.id}>
                      <td className="small nowrap">{when(a.created_at)}</td>
                      <td className="bold">{a.user_name || 'Sistema'}</td>
                      <td>{t.action}</td>
                      <td>{entityLabel(a, t)}</td>
                      <td className="small muted" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{t.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data?.length === 0 && <Empty icon="shield" title="Sin registros" />}
          </div>
        )}
      </div>
    </div>
  );
}
