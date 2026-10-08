import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Empty, Field, Modal, Spinner, useAction, useAsync } from '../../components/ui';
import { money } from '../../lib/format';
import { getGeoTree } from '../../components/AddressPicker';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

const LABELS = { provinces: 'Provincia', municipalities: 'Municipio / Distrito municipal', sectors: 'Sector' };

function GeoModal({ table, item, parent, onClose, onSaved }) {
  const [form, setForm] = useState({ name: item?.name || '', lat: item?.lat ?? '', lng: item?.lng ?? '', code: item?.code || '', kind: item?.kind || 'municipio', active: item?.active ?? true });
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { name: form.name, lat: form.lat === '' ? null : Number(form.lat), lng: form.lng === '' ? null : Number(form.lng), active: form.active };
      if (table === 'provinces') body.code = form.code || null;
      if (table === 'municipalities') { body.kind = form.kind; if (!item) body.province_id = parent; }
      if (table === 'sectors' && !item) body.municipality_id = parent;
      await (item ? api.put(`/api/geo/${table}/${item.id}`, body) : api.post(`/api/geo/${table}`, body));
      onSaved();
    }, 'Guardado.');
  };
  return (
    <Modal title={`${item ? 'Editar' : 'Nuevo'}: ${LABELS[table]}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="geo-form" disabled={busy}>Guardar</button></>}>
      <form id="geo-form" className="form-grid" onSubmit={submit}>
        <Field label="Nombre" className="full"><input className="input" value={form.name} onChange={set('name')} required /></Field>
        {table === 'provinces' && <Field label="Código"><input className="input" value={form.code} onChange={set('code')} placeholder="DO-01" /></Field>}
        {table === 'municipalities' && (
          <Field label="Tipo"><select className="select" value={form.kind} onChange={set('kind')}><option value="municipio">Municipio</option><option value="distrito_municipal">Distrito municipal</option></select></Field>
        )}
        <Field label="Latitud (centro)" hint="Se usa para detección aproximada"><input className="input" type="number" step="any" value={form.lat} onChange={set('lat')} /></Field>
        <Field label="Longitud (centro)"><input className="input" type="number" step="any" value={form.lng} onChange={set('lng')} /></Field>
        <label className="check full"><input type="checkbox" checked={form.active} onChange={set('active')} /> Activo</label>
      </form>
    </Modal>
  );
}

function Column({ title, items, selected, onSelect, onAdd, onEdit, onDelete, editable, render, side, emptyText }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)', minHeight: 200 }}>
      <div className="col-head row" style={{ justifyContent: 'space-between' }}>
        <span className="ellipsis">{title}</span>
        {editable && onAdd && <button className="btn btn-sm btn-ghost" onClick={onAdd} style={{ textTransform: 'none', letterSpacing: 0 }}><Icon name="plus" /> Agregar</button>}
      </div>
      {items.length > 8 && <div style={{ padding: '8px 8px 0' }}><input className="input" placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      <div style={{ overflowY: 'auto', padding: 6 }}>
        {shown.map((i) => (
          <div key={i.id} className={`list-item geo-item ${onSelect ? 'clickable' : ''} ${selected === i.id ? 'selected' : ''}`} style={{ opacity: i.active ? 1 : 0.5, border: 0 }} onClick={() => onSelect?.(i.id)}>
            <span className="spacer ellipsis" style={{ color: selected === i.id ? 'var(--primary)' : undefined, fontWeight: selected === i.id ? 650 : 400 }}>{render ? render(i) : i.name}</span>
            {side?.(i)}
            {editable && (
              <span className="geo-actions">
                <button className="btn btn-sm btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); onEdit(i); }} aria-label={`Editar ${i.name}`}><Icon name="edit" /></button>
                <button className="btn btn-sm btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); onDelete(i); }} aria-label={`Eliminar ${i.name}`}><Icon name="trash" /></button>
              </span>
            )}
          </div>
        ))}
        {shown.length === 0 && <Empty icon="globe" title={emptyText} />}
      </div>
    </div>
  );
}

export default function Geography() {
  const { user, currency } = useApp();
  const editable = can(user, 'zones.manage');
  const tree = useAsync(() => getGeoTree(true), []);
  const [province, setProvince] = useState(null);
  const [municipality, setMunicipality] = useState(null);
  const [modal, setModal] = useState(null);
  const [, run] = useAction();
  const prices = useAsync(() => (municipality ? api.get(`/api/geo/sector-prices?municipality_id=${municipality}`) : Promise.resolve([])), [municipality]);
  const t = tree.data;
  const municipalities = useMemo(() => (t?.municipalities || []).filter((m) => m.province_id === province), [t, province]);
  const sectors = useMemo(() => (t?.sectors || []).filter((s) => s.municipality_id === municipality), [t, municipality]);
  if (!t) return <Spinner center />;
  const count = (list, key, id) => list.filter((x) => x[key] === id).length;
  const priceOf = (id) => (prices.data || []).find((p) => p.sector_id === id);
  const provName = t.provinces.find((p) => p.id === province)?.name;
  const muniName = t.municipalities.find((m) => m.id === municipality)?.name;
  const del = (table, item) => window.confirm(`¿Eliminar "${item.name}"?`) && run(async () => { await api.del(`/api/geo/${table}/${item.id}`); tree.reload(true); }, 'Eliminado.');

  return (
    <div>
      <div className="page-header">
        <div><h1>Provincias y sectores</h1><p>Selecciona una provincia y un municipio para ver sus sectores y la tarifa que aplica</p></div>
      </div>
      <div className="grid grid-3" style={{ alignItems: 'start' }}>
        <Column title="Provincias" items={t.provinces} selected={province} editable={editable} emptyText="Sin provincias"
          onSelect={(id) => { setProvince(id); setMunicipality(null); }} onAdd={() => setModal({ table: 'provinces' })} onEdit={(i) => setModal({ table: 'provinces', item: i })} onDelete={(i) => del('provinces', i)}
          side={(p) => <span className="tiny muted nowrap">{count(t.municipalities, 'province_id', p.id)} municipios</span>} />
        <Column title={`Municipios${provName ? ` · ${provName}` : ''}`} items={municipalities} selected={municipality} editable={editable} emptyText="Selecciona una provincia"
          onSelect={setMunicipality} onAdd={province ? () => setModal({ table: 'municipalities', parent: province }) : null} onEdit={(i) => setModal({ table: 'municipalities', item: i })} onDelete={(i) => del('municipalities', i)}
          render={(m) => <>{m.name}{m.kind === 'distrito_municipal' && <span className="tiny muted"> (DM)</span>}</>}
          side={(m) => <span className="tiny muted nowrap">{count(t.sectors, 'municipality_id', m.id)} sectores</span>} />
        <Column title={`Sectores${muniName ? ` · ${muniName}` : ''}`} items={sectors} editable={editable} emptyText="Selecciona un municipio"
          onAdd={municipality ? () => setModal({ table: 'sectors', parent: municipality }) : null} onEdit={(i) => setModal({ table: 'sectors', item: i })} onDelete={(i) => del('sectors', i)}
          render={(s) => <span className="row" style={{ gap: 8 }}><span className="color-dot" style={{ width: 8, height: 8, background: 'var(--st-rescheduled)' }} />{s.name}</span>}
          side={(s) => {
            const p = priceOf(s.id);
            return <span style={{ textAlign: 'right' }}><strong className="mono" style={{ display: 'block' }}>{p?.fee != null ? money(p.fee, currency) : '—'}</strong><span className="tiny muted">{p?.zone_name || 'Sin zona'}</span></span>;
          }} />
      </div>
      {modal && <GeoModal {...modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); tree.reload(true); prices.reload(true); }} />}
    </div>
  );
}
