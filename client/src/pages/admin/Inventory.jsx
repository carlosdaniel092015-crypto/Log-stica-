import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { fullDateTime, money, relative } from '../../lib/format';
import { Empty, Field, Modal, Spinner, useAction, useAsync, useSocketEvent } from '../../components/ui';
import Icon from '../../components/Icon';
import { useApp } from '../../context/AppContext';

const REQ_COLORS = { pending: 'var(--warning)', approved: 'var(--success)', rejected: 'var(--danger)' };

/** Editor de líneas producto + cantidad. */
export function ItemsEditor({ products, items, onChange, stock }) {
  const add = () => onChange([...items, { product_id: products[0]?.id || '', quantity: 1 }]);
  return (
    <div className="stack-sm">
      {items.map((it, i) => (
        <div key={i} className="input-group">
          <select className="select" value={it.product_id} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))} aria-label="Producto">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{stock ? ` (disp. ${stock[p.id] ?? 0})` : p.warehouse_stock != null ? ` (almacén ${p.warehouse_stock})` : ''}
              </option>
            ))}
          </select>
          <input className="input" style={{ width: 100 }} type="number" min="1" value={it.quantity} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label="Cantidad" />
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Quitar"><Icon name="x" /></button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={add} disabled={!products.length} style={{ alignSelf: 'flex-start' }}><Icon name="plus" /> Agregar producto</button>
    </div>
  );
}

/** − [cantidad] + : ajusta el almacén. Escribir un número aplica la diferencia. */
function StockStepper({ value, low, disabled, onDelta }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    const n = Math.trunc(Number(draft));
    setDraft(null);
    if (Number.isFinite(n) && n >= 0 && n !== value) onDelta(n - value);
  };
  return (
    <span className="stepper">
      <button type="button" className="btn btn-sm" disabled={disabled || value <= 0} onClick={() => onDelta(-1)} aria-label="Restar uno">−</button>
      <input className="input" style={{ color: low ? 'var(--warning)' : undefined }} value={draft ?? value} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Existencia en almacén" inputMode="numeric" />
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => onDelta(1)} aria-label="Sumar uno">+</button>
    </span>
  );
}

const cleanItems = (items) => items.filter((i) => i.product_id && Number(i.quantity) > 0).map((i) => ({ product_id: i.product_id, quantity: Math.trunc(Number(i.quantity)) }));

function StockModal({ mode, courier, products, onClose, onDone }) {
  const [items, setItems] = useState([{ product_id: products[0]?.id || '', quantity: 1 }]);
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  const assign = mode === 'assign';
  const options = assign ? products.filter((p) => p.active) : products.filter((p) => (courier.stock[p.id] || 0) > 0);
  return (
    <Modal
      title={`${assign ? 'Asignar inventario a' : 'Recibir devolución de'} ${courier.name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !cleanItems(items).length} onClick={() => run(async () => { await api.post(`/api/inventory/couriers/${courier.id}/${assign ? 'assign' : 'return'}`, { items: cleanItems(items), note: note || undefined }); onDone(); }, assign ? 'Inventario asignado.' : 'Devolución registrada.')}>{assign ? 'Asignar' : 'Registrar devolución'}</button></>}
    >
      <div className="stack">
        <p className="small muted">{assign ? 'Las cantidades salen del almacén y pasan al mensajero.' : 'Las cantidades vuelven del mensajero al almacén.'}</p>
        {options.length ? <ItemsEditor products={options} items={items} onChange={setItems} stock={assign ? undefined : courier.stock} /> : <Empty title="No hay productos disponibles" />}
        <Field label="Nota (opcional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}

function ProductModal({ product, onClose, onDone }) {
  const [form, setForm] = useState({ sku: product?.sku || '', name: product?.name || '', unit: product?.unit || 'unidad', price: product?.price ?? '', description: product?.description || '', warehouse_stock: 0, min_stock: product?.min_stock ?? 0, active: product?.active ?? true });
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { sku: form.sku, name: form.name, unit: form.unit, price: Number(form.price), min_stock: Math.max(0, Math.trunc(Number(form.min_stock) || 0)), description: form.description || null, active: form.active };
      if (product) await api.put(`/api/inventory/products/${product.id}`, body);
      else await api.post('/api/inventory/products', { ...body, warehouse_stock: Number(form.warehouse_stock) || 0 });
      onDone();
    }, 'Producto guardado.');
  };
  return (
    <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="product-form" disabled={busy}>Guardar</button></>}>
      <form id="product-form" className="form-grid" onSubmit={submit}>
        <Field label="SKU / código"><input className="input" value={form.sku} onChange={set('sku')} required /></Field>
        <Field label="Unidad"><input className="input" value={form.unit} onChange={set('unit')} required /></Field>
        <Field label="Nombre" className="full"><input className="input" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Precio (RD$)"><input className="input" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required /></Field>
        {!product && <Field label="Existencia inicial en almacén"><input className="input" type="number" min="0" value={form.warehouse_stock} onChange={set('warehouse_stock')} /></Field>}
        <Field label="Existencia mínima" hint="Al llegar a este número se avisa que se está acabando"><input className="input" type="number" min="0" value={form.min_stock} onChange={set('min_stock')} /></Field>
        <Field label="Descripción" className="full"><input className="input" value={form.description} onChange={set('description')} /></Field>
        <label className="check full"><input type="checkbox" checked={form.active} onChange={set('active')} /> Producto activo</label>
      </form>
    </Modal>
  );
}

function RequestCard({ r, onDone }) {
  const [qty, setQty] = useState(() => Object.fromEntries(r.items.map((i) => [i.product_id, i.quantity_requested])));
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  const pending = r.status === 'pending';
  return (
    <div className="card" style={{ padding: 14, borderLeft: `4px solid ${REQ_COLORS[r.status]}` }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <strong>Solicitud #{r.request_number}</strong> · <span className="muted">{r.kind_label}</span>
          <div className="small">{r.courier_name}{r.order_number ? <> · <Link to={`/admin/pedidos/${r.order_id}`}>Pedido #{r.order_number}</Link> ({r.customer_name})</> : ''}</div>
          <div className="tiny muted">{fullDateTime(r.created_at)}{r.note ? ` · ${r.note}` : ''}</div>
        </div>
        <span className="badge" style={{ '--c': REQ_COLORS[r.status] }}>{r.status_label}</span>
      </div>
      <table className="table" style={{ marginTop: 8 }}>
        <thead><tr><th>Producto</th><th className="num">Solicitado</th><th className="num">{pending ? (r.kind === 'restock' ? 'A aprobar' : '') : 'Aprobado'}</th></tr></thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.id}>
              <td>{i.product_name} <span className="tiny muted">{i.sku}</span></td>
              <td className="num bold">{i.quantity_requested}</td>
              <td className="num">
                {pending && r.kind === 'restock' ? (
                  <input className="input" style={{ width: 90, minHeight: 32 }} type="number" min="0" value={qty[i.product_id]} onChange={(e) => setQty({ ...qty, [i.product_id]: e.target.value })} aria-label="Cantidad aprobada" />
                ) : pending ? '' : i.quantity_approved}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pending ? (
        <div className="row-wrap" style={{ marginTop: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-success" disabled={busy} onClick={() => run(async () => { await api.post(`/api/inventory/requests/${r.id}/approve`, { note: note || undefined, items: r.kind === 'restock' ? r.items.map((i) => ({ product_id: i.product_id, quantity_approved: Math.max(0, Math.trunc(Number(qty[i.product_id]) || 0)) })) : undefined }); onDone(); }, 'Solicitud aprobada.')}>
            <Icon name="check" /> Aprobar
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => window.confirm(r.kind === 'delivery' ? '¿Rechazar? El inventario vuelve al mensajero.' : '¿Rechazar la solicitud?') && run(async () => { await api.post(`/api/inventory/requests/${r.id}/reject`, { note: note || undefined }); onDone(); }, 'Solicitud rechazada.')}>
            <Icon name="x" /> Rechazar
          </button>
        </div>
      ) : (
        <div className="tiny muted" style={{ marginTop: 6 }}>Revisado por {r.reviewed_by_name || '—'} · {fullDateTime(r.reviewed_at)}{r.review_note ? ` · ${r.review_note}` : ''}</div>
      )}
    </div>
  );
}

/** Feed en vivo: entregados en verde, no entregados en rojo. */
export function OutcomeFeed({ limit = 50 }) {
  const { data, setData } = useAsync(() => api.get('/api/inventory/outcomes'), []);
  useSocketEvent('order:outcome', (o) => setData((list) => [o, ...(list || []).filter((x) => x.id !== o.id)].slice(0, limit)));
  if (!data) return <Spinner center />;
  if (!data.length) return <Empty icon="truck" title="Sin entregas en las últimas 24 horas" />;
  return (
    <div className="stack-sm">
      {data.map((o) => (
        <Link key={o.id} to={`/admin/pedidos/${o.id}`} className={`outcome-card ${o.outcome}`}>
          <Icon name={o.outcome === 'success' ? 'check' : 'x'} />
          <div className="spacer">
            <div className="bold">Pedido #{o.order_number} · {o.outcome === 'success' ? 'ENTREGADO' : 'NO ENTREGADO'}</div>
            <div className="small">{o.customer_name} · {o.courier_name || '—'}</div>
          </div>
          <span className="tiny">{relative(o.at)}</span>
        </Link>
      ))}
    </div>
  );
}

export default function Inventory() {
  const { currency } = useApp();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'products');
  const overview = useAsync(() => api.get('/api/inventory/overview'), []);
  const requests = useAsync(() => api.get('/api/inventory/requests'), []);
  const movements = useAsync(() => (tab === 'movements' ? api.get('/api/inventory/movements') : Promise.resolve(null)), [tab]);
  const [modal, setModal] = useState(null);
  const [productModal, setProductModal] = useState(null);
  const [busy, run] = useAction();

  // Todo se actualiza solo: inventario, solicitudes y movimientos.
  const refresh = () => {
    overview.reload(true);
    requests.reload(true);
    if (tab === 'movements') movements.reload(true);
  };
  useSocketEvent('inventory:updated', refresh);

  if (!overview.data) return <Spinner center />;
  const { products, couriers } = overview.data;
  const pending = (requests.data || []).filter((r) => r.status === 'pending');
  const lowStock = products.filter((p) => p.low_stock);
  const adjust = (p, delta) => {
    if (!delta) return;
    run(async () => { await api.post(`/api/inventory/products/${p.id}/adjust`, { delta }); refresh(); });
  };
  const reviewed = (requests.data || []).filter((r) => r.status !== 'pending');

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div><h1>Inventario</h1><p>Existencia en almacén, inventario que lleva cada mensajero y solicitudes por aprobar</p></div>
      </div>
      {lowStock.length > 0 && (
        <div className="banner warning">
          <span className="banner-icon"><Icon name="alert" size={18} /></span>
          <div className="spacer">
            <div className="bold">{lowStock.length} producto(s) se están acabando</div>
            <div className="small">{lowStock.map((p) => `${p.name} (${p.warehouse_stock})`).join(' · ')}</div>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {[['products', 'Productos'], ['couriers', 'Inventario por mensajero'], ['requests', 'Solicitudes'], ['live', 'Entregas en vivo'], ['movements', 'Movimientos']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {l}{k === 'requests' && pending.length > 0 && <span className="tab-count">{pending.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'requests' && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <h3>Pendientes de aprobación ({pending.length})</h3>
            {pending.length === 0 && <Empty icon="check" title="No hay solicitudes pendientes" />}
            {pending.map((r) => <RequestCard key={r.id} r={r} onDone={refresh} />)}
          </div>
          <div className="stack">
            <h3>Revisadas</h3>
            {reviewed.length === 0 && <Empty title="Aún no hay solicitudes revisadas" />}
            {reviewed.slice(0, 30).map((r) => <RequestCard key={r.id} r={r} onDone={refresh} />)}
          </div>
        </div>
      )}

      {tab === 'live' && (
        <div className="card card-body">
          <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
            <h3>Últimas 24 horas</h3>
            <div className="legend"><span><i style={{ background: 'var(--success)' }} />Entregado</span><span><i style={{ background: 'var(--danger)' }} />No entregado</span></div>
          </div>
          <OutcomeFeed />
        </div>
      )}

      {tab === 'couriers' && (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Mensajero</th>{products.filter((p) => p.active).map((p) => <th key={p.id} className="num" title={p.name}>{p.sku}</th>)}<th /></tr>
              </thead>
              <tbody>
                {couriers.map((c) => (
                  <tr key={c.id}>
                    <td className="bold">{c.name}<div className="tiny muted">{c.shift_active ? 'En jornada' : 'Fuera de jornada'}</div></td>
                    {products.filter((p) => p.active).map((p) => <td key={p.id} className="num mono">{c.stock[p.id] || 0}</td>)}
                    <td className="nowrap">
                      <button className="btn btn-sm btn-primary" onClick={() => setModal({ mode: 'assign', courier: c })}><Icon name="plus" /> Asignar</button>{' '}
                      <button className="btn btn-sm" onClick={() => setModal({ mode: 'return', courier: c })}>Devolver</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny muted" style={{ padding: '8px 14px' }}>{products.filter((p) => p.active).map((p) => `${p.sku}: ${p.name}`).join(' · ')}</div>
        </div>
      )}

      {tab === 'products' && (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{products.length} productos · recibes un aviso cuando el almacén llega al mínimo</span>
            <button className="btn btn-primary" onClick={() => setProductModal({})}><Icon name="plus" /> Nuevo producto</button>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>SKU</th><th>Producto</th><th className="num">Precio</th><th style={{ textAlign: 'center' }}>En almacén</th><th className="num">Con mensajeros</th><th className="num">Total</th><th className="num">Mínimo</th><th /></tr></thead>
                <tbody>
                  {products.map((p) => {
                    const withCouriers = couriers.reduce((sum, c) => sum + (c.stock[p.id] || 0), 0);
                    return (
                      <tr key={p.id} className={p.low_stock ? 'row-warn' : ''} style={{ opacity: p.active ? 1 : 0.55 }}>
                        <td className="mono small muted">{p.sku}</td>
                        <td className="bold">{p.name} {p.low_stock && <span className="badge" style={{ '--c': 'var(--warning)' }}>Bajo</span>}{!p.active && <span className="badge no-dot" style={{ '--c': 'var(--muted)' }}>Inactivo</span>}</td>
                        <td className="num">{money(p.price, currency)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <StockStepper value={p.warehouse_stock} low={p.low_stock} disabled={busy} onDelta={(d) => adjust(p, d)} />
                        </td>
                        <td className="num">{withCouriers}</td>
                        <td className="num bold">{p.warehouse_stock + withCouriers}</td>
                        <td className="num muted">{p.min_stock || '—'}</td>
                        <td className="nowrap">
                          <span className="icon-btn-group">
                            <button className="btn btn-sm btn-icon" onClick={() => setProductModal(p)} aria-label="Editar"><Icon name="edit" /></button>
                            <button className="btn btn-sm btn-icon" style={{ color: 'var(--danger)' }} aria-label="Eliminar" onClick={() => window.confirm(`¿Eliminar "${p.name}"?`) && run(async () => { await api.del(`/api/inventory/products/${p.id}`); refresh(); }, 'Producto eliminado.')}><Icon name="trash" /></button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {products.length === 0 && <Empty icon="box" title="Crea tu primer producto" />}
            </div>
          </div>
        </div>
      )}

      {tab === 'movements' && (
        <div className="card">
          {!movements.data ? <Spinner center /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Movimiento</th><th>Producto</th><th>Mensajero</th><th className="num">Mensajero ±</th><th className="num">Almacén ±</th><th>Pedido</th><th>Usuario</th></tr></thead>
                <tbody>
                  {movements.data.map((m) => (
                    <tr key={m.id}>
                      <td className="small nowrap">{fullDateTime(m.created_at)}</td>
                      <td className="small">{m.type_label}</td>
                      <td>{m.product_name}</td>
                      <td className="small">{m.courier_name || '—'}</td>
                      <td className="num mono" style={{ color: m.courier_delta < 0 ? 'var(--danger)' : m.courier_delta > 0 ? 'var(--success)' : undefined }}>{m.courier_delta > 0 ? `+${m.courier_delta}` : m.courier_delta || ''}</td>
                      <td className="num mono">{m.warehouse_delta > 0 ? `+${m.warehouse_delta}` : m.warehouse_delta || ''}</td>
                      <td className="small">{m.order_number ? `#${m.order_number}` : ''}</td>
                      <td className="small">{m.user_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movements.data.length === 0 && <Empty title="Sin movimientos" />}
            </div>
          )}
        </div>
      )}

      {modal && <StockModal {...modal} products={products} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {productModal && <ProductModal product={productModal.id ? productModal : null} onClose={() => setProductModal(null)} onDone={() => { setProductModal(null); refresh(); }} />}
    </div>
  );
}
