import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../lib/api';
import { money, PAYMENT_METHODS, PAYMENT_STATUS, ZONE_KINDS } from '../lib/format';
import AddressPicker from './AddressPicker';
import Icon from './Icon';
import { Field, Modal, useAsync } from './ui';
import { can, useApp } from '../context/AppContext';
import { ItemsEditor } from '../pages/admin/Inventory';

function useQuote(address) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify([address?.lat, address?.lng, address?.province_id, address?.municipality_id, address?.sector_id]);
  useEffect(() => {
    if (!address || (address.lat == null && !address.province_id && !address.municipality_id && !address.sector_id)) {
      setQuote(null);
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setQuote(
          await api.post('/api/zones/quote', {
            lat: address.lat ?? null,
            lng: address.lng ?? null,
            province_id: address.province_id || null,
            municipality_id: address.municipality_id || null,
            sector_id: address.sector_id || null,
          })
        );
      } catch {
        setQuote(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { quote, loading };
}

export function QuoteBox({ quote, loading }) {
  const { currency } = useApp();
  if (loading) return <div className="alert alert-info small">Calculando tarifa…</div>;
  if (!quote) return <div className="alert alert-info small">Selecciona la dirección para calcular automáticamente el precio del delivery.</div>;
  return (
    <div className={`alert ${quote.covered ? 'alert-success' : 'alert-warning'}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="small muted">Zona tarifaria detectada</div>
          <div className="bold">{quote.zone ? `${quote.zone.name} · ${ZONE_KINDS[quote.zone.kind]}` : 'Sin zona'}</div>
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{quote.fee != null ? money(quote.fee, currency) : '—'}</div>
      </div>
      {quote.warnings?.map((w) => <div key={w} className="small" style={{ marginTop: 4 }}>⚠ {w}</div>)}
      {quote.candidates?.length > 1 && (
        <div className="tiny muted" style={{ marginTop: 4 }}>
          También coincide con: {quote.candidates.slice(1).map((c) => `${c.name} (${money(c.price, currency)})`).join(', ')}
        </div>
      )}
    </div>
  );
}

/** Formulario para crear un pedido con detección automática de zona y precio. */
export default function OrderForm({ onClose, onCreated }) {
  const { user, currency, toast } = useApp();
  const [mode, setMode] = useState('existing');
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', whatsapp: '', email: '' });
  const [addressId, setAddressId] = useState('');
  const [address, setAddress] = useState({});
  const [saveAddress, setSaveAddress] = useState(true);
  const [form, setForm] = useState({ subtotal: '', payment_method: 'cash', payment_status: 'pending', status: 'new', priority: 0, notes: '', courier_id: '' });
  const [overrideFee, setOverrideFee] = useState(false);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const searchTimer = useRef(null);
  const [results, setResults] = useState([]);
  const couriers = useAsync(() => api.get('/api/couriers?active=true'), []);
  const products = useAsync(() => (can(user, 'inventory.manage') ? api.get('/api/inventory/products') : Promise.resolve([])), []);
  const [items, setItems] = useState([]);
  const activeProducts = (products.data || []).filter((p) => p.active);
  const validItems = items.filter((i) => i.product_id && Number(i.quantity) > 0);
  const itemsSubtotal = validItems.reduce((s, i) => s + (activeProducts.find((p) => p.id === i.product_id)?.price || 0) * Number(i.quantity), 0);
  const { quote, loading: quoting } = useQuote(address);

  useEffect(() => {
    if (mode !== 'existing') return undefined;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      api.get(`/api/customers${qs({ q: search, with_addresses: 'true', limit: 20 })}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [search, mode]);

  const pickCustomer = (c) => {
    setCustomer(c);
    const def = c.addresses?.find((a) => a.is_default) || c.addresses?.[0];
    if (def) {
      setAddressId(def.id);
      setAddress({ ...def });
    } else {
      setAddressId('');
      setAddress({});
    }
  };

  const total = useMemo(() => {
    const f = overrideFee ? Number(fee) || 0 : quote?.fee || 0;
    return (validItems.length ? itemsSubtotal : Number(form.subtotal) || 0) + f;
  }, [form.subtotal, overrideFee, fee, quote, validItems.length, itemsSubtotal]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (mode === 'existing' && !customer) return setError('Selecciona un cliente o registra uno nuevo.');
    if (!address.formatted_address) return setError('Indica la dirección de entrega.');
    setBusy(true);
    try {
      const body = {
        ...(mode === 'existing' ? { customer_id: customer.id } : { customer: { ...newCustomer, email: newCustomer.email || null } }),
        address_id: addressId || null,
        address: {
          formatted_address: address.formatted_address,
          lat: address.lat ?? null,
          lng: address.lng ?? null,
          place_id: address.place_id || null,
          reference: address.reference || null,
          province_id: address.province_id || null,
          municipality_id: address.municipality_id || null,
          sector_id: address.sector_id || null,
          components: address.components,
        },
        save_address: !addressId && saveAddress,
        ...(validItems.length ? { items: validItems.map((i) => ({ product_id: i.product_id, quantity: Math.trunc(Number(i.quantity)) })) } : { subtotal: Number(form.subtotal) || 0 }),
        payment_method: form.payment_method,
        payment_status: form.payment_status,
        status: form.status,
        priority: Number(form.priority) || 0,
        notes: form.notes || null,
        courier_id: form.courier_id || null,
        delivery_fee: overrideFee ? Number(fee) : null,
      };
      const res = await api.post('/api/orders', body);
      toast(`Pedido #${res.order.order_number} creado.`, { type: 'success' });
      onCreated(res.order);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal
      title="Nuevo pedido"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="spacer bold">Total: {money(total, currency)}</div>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" form="order-form" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar pedido'}</button>
        </>
      }
    >
      <form id="order-form" className="stack" onSubmit={submit}>
        {error && <div className="alert alert-danger">{error}</div>}
        <section className="stack-sm">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>1. Cliente</h3>
            <div className="chips">
              <button type="button" className={`chip ${mode === 'existing' ? 'active' : ''}`} onClick={() => setMode('existing')}>Existente</button>
              <button type="button" className={`chip ${mode === 'new' ? 'active' : ''}`} onClick={() => { setMode('new'); setCustomer(null); setAddressId(''); setAddress({}); }}>Nuevo</button>
            </div>
          </div>
          {mode === 'existing' ? (
            customer ? (
              <div className="card card-body row" style={{ padding: 12 }}>
                <Icon name="user" />
                <div className="spacer">
                  <div className="bold">{customer.name}</div>
                  <div className="small muted">{customer.phone}{customer.email ? ` · ${customer.email}` : ''}</div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => { setCustomer(null); setAddressId(''); setAddress({}); }}>Cambiar</button>
              </div>
            ) : (
              <>
                <input className="input" placeholder="Buscar por nombre, teléfono o correo…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
                <div className="card" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {results.map((c) => (
                    <button type="button" key={c.id} className="notif-item" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => pickCustomer(c)}>
                      <span className="bold">{c.name}</span> <span className="muted small">· {c.phone} · {c.addresses?.length || 0} dirección(es)</span>
                    </button>
                  ))}
                  {results.length === 0 && <div className="empty small">Sin resultados. Usa “Nuevo”.</div>}
                </div>
              </>
            )
          ) : (
            <div className="form-grid">
              <Field label="Nombre *"><input className="input" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} required /></Field>
              <Field label="Teléfono *"><input className="input" type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} required placeholder="809-555-0000" /></Field>
              <Field label="WhatsApp"><input className="input" type="tel" value={newCustomer.whatsapp} onChange={(e) => setNewCustomer({ ...newCustomer, whatsapp: e.target.value })} placeholder="Igual al teléfono si se deja vacío" /></Field>
              <Field label="Correo"><input className="input" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></Field>
            </div>
          )}
        </section>

        <section className="stack-sm">
          <h3>2. Dirección de entrega</h3>
          {customer?.addresses?.length > 0 && (
            <select className="select" value={addressId} onChange={(e) => {
              const a = customer.addresses.find((x) => x.id === e.target.value);
              setAddressId(e.target.value);
              setAddress(a ? { ...a } : {});
            }}>
              {customer.addresses.map((a) => <option key={a.id} value={a.id}>{a.label ? `${a.label}: ` : ''}{a.formatted_address}</option>)}
              <option value="">+ Otra dirección</option>
            </select>
          )}
          <AddressPicker value={address} onChange={(a) => { setAddress(a); if (addressId && (a.lat !== address.lat || a.formatted_address !== address.formatted_address)) setAddressId(''); }} />
          {!addressId && <label className="check small"><input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> Guardar esta dirección en el cliente</label>}
          <QuoteBox quote={quote} loading={quoting} />
          {can(user, 'orders.override_fee') && (
            <div className="row-wrap">
              <label className="check small"><input type="checkbox" checked={overrideFee} onChange={(e) => { setOverrideFee(e.target.checked); setFee(quote?.fee ?? ''); }} /> Modificar costo de envío manualmente</label>
              {overrideFee && <input className="input" style={{ width: 140 }} type="number" min="0" step="1" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="Costo de envío" required />}
            </div>
          )}
        </section>

        <section className="stack-sm">
          <h3>3. Productos, pedido y pago</h3>
          {activeProducts.length > 0 && (
            <div className="stack-sm">
              <div className="label">Productos del inventario (opcional)</div>
              <ItemsEditor products={activeProducts} items={items} onChange={setItems} />
              {validItems.length > 0 && <div className="small muted">Subtotal de productos: {money(itemsSubtotal, currency)}. Al marcar Entregado se descuentan del inventario del mensajero.</div>}
            </div>
          )}
          <div className="form-grid">
            <Field label={`Subtotal de productos (${currency})`}><input className="input" type="number" min="0" step="0.01" value={validItems.length ? itemsSubtotal : form.subtotal} onChange={set('subtotal')} placeholder="0" disabled={validItems.length > 0} /></Field>
            <Field label="Método de pago"><select className="select" value={form.payment_method} onChange={set('payment_method')}>{Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Estado del pago"><select className="select" value={form.payment_status} onChange={set('payment_status')}>{Object.entries(PAYMENT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Estado inicial"><select className="select" value={form.status} onChange={set('status')}><option value="new">Nuevo</option><option value="preparing">Preparando</option><option value="ready">Listo para despacho</option></select></Field>
            <Field label="Prioridad"><select className="select" value={form.priority} onChange={set('priority')}><option value={0}>Normal</option><option value={5}>Alta</option><option value={10}>Urgente</option></select></Field>
            <Field label="Asignar mensajero (opcional)">
              <select className="select" value={form.courier_id} onChange={set('courier_id')}>
                <option value="">Sin asignar</option>
                {(couriers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} — {c.status_label}{c.pending_count ? ` (${c.pending_count} pendientes)` : ''}</option>)}
              </select>
            </Field>
            <Field label="Notas" className="full"><textarea className="textarea" value={form.notes} onChange={set('notes')} maxLength={2000} placeholder="Instrucciones para el mensajero, horario, etc." /></Field>
          </div>
        </section>
      </form>
    </Modal>
  );
}
