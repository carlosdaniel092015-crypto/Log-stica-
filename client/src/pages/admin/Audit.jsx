import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { fullDateTime } from '../../lib/format';
import { Empty, Spinner, useAsync } from '../../components/ui';

const ENTITIES = { order: 'Pedidos', zone: 'Zonas y tarifas', user: 'Usuarios', customer: 'Clientes', courier: 'Mensajeros', settings: 'Configuración', province: 'Provincias', municipality: 'Municipios', sector: 'Sectores', role: 'Roles', branch: 'Sucursales' };

function show(v) {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export default function Audit() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const { data, loading } = useAsync(() => api.get(`/api/audit${qs({ entity, action, from: from ? new Date(`${from}T00:00:00-04:00`).toISOString() : '', limit: 500 })}`), [entity, action, from]);
  return (
    <div>
      <div className="page-header"><div><h1>Auditoría</h1><p>Registro de cambios importantes: usuario, acción, fecha, hora, pedido, valor anterior y nuevo.</p></div></div>
      <div className="filters">
        <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entidad"><option value="">Todas las entidades</option>{Object.entries(ENTITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" placeholder="Acción (ej. order.status)" value={action} onChange={(e) => setAction(e.target.value)} />
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
      </div>
      <div className="card">
        {loading && !data ? <Spinner center /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Pedido</th><th>Valor anterior</th><th>Valor nuevo</th><th>IP</th></tr></thead>
              <tbody>
                {(data || []).map((a) => (
                  <tr key={a.id}>
                    <td className="small nowrap">{fullDateTime(a.created_at)}</td>
                    <td className="small">{a.user_name || 'Sistema'}</td>
                    <td><code className="small">{a.action}</code></td>
                    <td className="small">{a.order_id ? <Link to={`/admin/pedidos/${a.order_id}`}>Ver</Link> : '—'}</td>
                    <td className="tiny mono" style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{show(a.old_value)}</td>
                    <td className="tiny mono" style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{show(a.new_value)}</td>
                    <td className="tiny muted">{a.ip || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.length === 0 && <Empty icon="shield" title="Sin registros" />}
          </div>
        )}
      </div>
    </div>
  );
}
