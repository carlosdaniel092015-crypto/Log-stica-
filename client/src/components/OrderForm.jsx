import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../lib/api';
import { money, PAYMENT_METHODS, PAYMENT_STATUS, ZONE_KINDS } from '../lib/format';
import AddressPicker from './AddressPicker';
import Icon from './Icon';
import { Avatar, Field, Modal, useAsync } from './ui';
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

export function QuoteBox({ quote, loading, onManualFee }) {
  const { currency, user } = useApp();
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
      {!quote.covered && (
        <div className="stack-sm" style={{ marginTop: 8 }}>
          <div className="small">Ninguna zona cubre este punto. Si una zona tiene un círculo o polígono dibujado, solo cobra dentro de esa área.</div>
          <div className="row-wrap">
            {onManualFee && can(user, 'orders.override_fee') && <button type="button" className="btn btn-sm btn-primary" onClick={onManualFee}>Escribir costo de envío</button>}
            {can(user, 'zones.manage') && <a className="btn btn-sm" href="/admin/tarifas" target="_blank" rel="noreferrer"><Icon name="tag" /> Configurar zonas y tarifas</a>}
          </div>
        </div>
      )}
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
  const [step, setStep] = useState(1);
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

  // ¿El mensajero elegido tiene los productos del pedido? (solo con permiso de inventario)
  const canInventory = can(user, 'inventory.manage');
  const [courierStock, setCourierStock] = useState(null);
  const [assigningStock, setAssigningStock] = useState(false);
  useEffect(() => {
    setCourierStock(null);
    if (!canInventory || !form.courier_id) return;
    api.get(`/api/inventory/couriers/${form.courier_id}`).then((r) => setCourierStock(r.stock)).catch(() => {});
  }, [canInventory, form.courier_id]);
  const courierShortages = useMemo(() => {
    if (!courierStock) return [];
    const need = new Map();
    for (const i of validItems) need.set(i.product_id, (need.get(i.product_id) || 0) + Math.trunc(Number(i.quantity)));
    return [...need].map(([id, qty]) => {
      const have = courierStock.find((s) => s.product_id === id)?.quantity || 0;
      return { product_id: id, name: activeProducts.find((p) => p.id === id)?.name || 'Producto', missing: qty - have };
    }).filter((x) => x.missing > 0);
  }, [courierStock, validItems, activeProducts]);
  const assignMissing = async () => {
    setAssigningStock(true);
    try {
      const r = await api.post(`/api/inventory/couriers/${form.courier_id}/assign`, { items: courierShortages.map((x) => ({ product_id: x.product_id, quantity: x.missing })), note: 'Para un pedido nuevo' });
      setCourierStock(r.stock);
      toast('Inventario asignado al mensajero.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setAssigningStock(false);
    }
  };

  const total = useMemo(() => {
    const f = overrideFee ? Number(fee) || 0 : quote?.fee || 0;
    return (validItems.length ? itemsSubtotal : Number(form.subtotal) || 0) + f;
  }, [form.subtotal, overrideFee, fee, quote, validItems.length, itemsSubtotal]);

  const stepError = (n) => {
    if (n === 1) {
      if (mode === 'existing' && !customer) return 'Selecciona un cliente o registra uno nuevo.';
      if (mode === 'new' && !newCustomer.name.trim()) return 'Indica el nombre del cliente.';
      if (mode === 'new' && newCustomer.phone.trim() && newCustomer.phone.replace(/\D/g, '').length < 7) return 'El teléfono no es válido (o déjalo vacío).';
    }
    if (n === 2 && !address.formatted_address) return 'Indica la dirección de entrega.';
    return null;
  };
  const next = () => {
    const err = stepError(step);
    setError(err);
    if (!err) setStep(step + 1);
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (step < 3) return next(); // Enter en los pasos 1 y 2 avanza, no envía.
    setError(null);
    if (quote && !quote.covered && !(overrideFee && fee !== '')) {
      return setError(can(user, 'orders.override_fee')
        ? 'Esta dirección no está en ninguna zona de cobertura: escribe el costo de envío (marca "Modificar costo de envío manualmente") o configura una zona que la cubra.'
        : 'Esta dirección no está en ninguna zona de cobertura. Pide al administrador que configure una zona para ese sector.');
    }
    if (mode === 'existing' && !customer) return setError('Selecciona un cliente o registra uno nuevo.');
    if (!address.formatted_address) return setError('Indica la dirección de entrega.');
    setBusy(true);
    try {
      const body = {
        ...(mode === 'existing' ? { customer_id: customer.id } : { customer: { ...newCustomer, phone: newCustomer.phone.trim() || null, whatsapp: newCustomer.whatsapp.trim() || null, email: newCustomer.email || null } }),
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

  const STEPS = ['Cliente', 'Dirección', 'Productos y pago'];
  return (
    <Modal
      title="Nuevo pedido"
      size="lg"
      onClose={onClose}
      footer={
        <>
          {step === 3 && (quote && !quote.covered && !(overrideFee && fee !== '')
            ? <div className="spacer bold" style={{ color: 'var(--warning)' }}>Falta el costo de envío</div>
            : <div className="spacer bold">Total: {money(total, currency)}</div>)}
          {step === 1 ? <button key="cancel" type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button> : <button key="back" type="button" className="btn btn-ghost" onClick={() => { setError(null); setStep(step - 1); }}>Atrás</button>}
          {step < 3 ? <button key="next" type="button" className="btn btn-primary" onClick={next}>Siguiente</button> : <button key="submit" type="submit" className="btn btn-primary" form="order-form" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar pedido'}</button>}
        </>
      }
    >
      <div className="steps-head" style={{ margin: '-18px -20px 18px' }}>
        {STEPS.map((label, i) => (
          <div key={label} className={i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}>
            <span className="num">{i + 1 < step ? '✓' : i + 1}</span>{label}
          </div>
        ))}
      </div>
      <form id="order-form" className="stack" onSubmit={submit}>
        {error && <div className="alert alert-danger">{error}</div>}

        {step === 1 && (
          <section className="stack">
            <div className="segmented" style={{ alignSelf: 'flex-start' }}>
              <button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Cliente existente</button>
              <button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setCustomer(null); setAddressId(''); setAddress({}); }}>Cliente nuevo</button>
            </div>
            {mode === 'existing' ? (
              <>
                <div className="search-box">
                  <Icon name="search" size={18} />
                  <input className="input" placeholder="Buscar cliente por nombre o teléfono" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
                </div>
                <div className="pick-grid">
                  {results.map((c) => (
                    <button type="button" key={c.id} className={`pick-card ${customer?.id === c.id ? 'selected' : ''}`} onClick={() => pickCustomer(c)}>
                      <Avatar name={c.name} soft />
                      <span className="ellipsis">
                        <span className="bold" style={{ display: 'block' }}>{c.name}</span>
                        <span className="small muted">{c.phone}{c.sector_name ? ` · ${c.sector_name}` : ''}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {results.length === 0 && <div className="empty small">Sin resultados. Usa “Cliente nuevo”.</div>}
              </>
            ) : (
              <div className="form-grid">
                <Field label="Nombre *"><input className="input" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} autoFocus /></Field>
                <Field label="Teléfono (opcional)"><input className="input" type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="809-555-0000" /></Field>
                <Field label="WhatsApp"><input className="input" type="tel" value={newCustomer.whatsapp} onChange={(e) => setNewCustomer({ ...newCustomer, whatsapp: e.target.value })} placeholder="Igual al teléfono si se deja vacío" /></Field>
                <Field label="Correo"><input className="input" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></Field>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="stack-sm">
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
            <QuoteBox quote={quote} loading={quoting} onManualFee={() => { if (!stepError(2)) { setOverrideFee(true); setFee(''); setStep(3); } else next(); }} />
          </section>
        )}

        {step === 3 && (
          <section className="stack">
            <QuoteBox quote={quote} loading={quoting} onManualFee={() => { setOverrideFee(true); setFee(''); }} />
            {can(user, 'orders.override_fee') && (
              <div className="row-wrap">
                <label className="check small"><input type="checkbox" checked={overrideFee} onChange={(e) => { setOverrideFee(e.target.checked); setFee(quote?.fee ?? ''); }} /> Modificar costo de envío manualmente</label>
                {overrideFee && <input className="input" style={{ width: 140 }} type="number" min="0" step="1" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="Costo de envío" placeholder={`${currency} 0`} autoFocus required />}
              </div>
            )}
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
              {courierShortages.length > 0 && (
                <div className="alert alert-warning full">
                  <div className="bold">El mensajero no tiene todo este inventario</div>
                  <div className="small">Le falta: {courierShortages.map((x) => `${x.missing} ${x.name}`).join(', ')}. Si lo entrega así, lo que falte se descontará del almacén.</div>
                  <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} disabled={assigningStock} onClick={assignMissing}>Asignarle lo que falta desde el almacén</button>
                </div>
              )}
              <Field label="Notas" className="full"><textarea className="textarea" value={form.notes} onChange={set('notes')} maxLength={2000} placeholder="Instrucciones para el mensajero, horario, etc." /></Field>
            </div>
          </section>
        )}
      </form>
    </Modal>
  );
}
