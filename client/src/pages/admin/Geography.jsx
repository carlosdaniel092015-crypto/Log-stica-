import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Empty, Field, Modal, Spinner, useAction, useAsync } from '../../components/ui';
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

function Column({ title, items, selected, onSelect, onAdd, onEdit, onDelete, editable, render }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)', minHeight: 300 }}>
      <div className="card-header"><strong>{title} ({items.length})</strong>{editable && onAdd && <button className="btn btn-sm" onClick={onAdd}><Icon name="plus" /> Agregar</button>}</div>
      <div style={{ padding: 8 }}><input className="input" placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div style={{ overflowY: 'auto' }}>
        {shown.map((i) => (
          <div key={i.id} className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: selected === i.id ? 'var(--primary-50)' : undefined, cursor: onSelect ? 'pointer' : 'default', opacity: i.active ? 1 : 0.5 }} onClick={() => onSelect?.(i.id)}>
            <span className="spacer">{render ? render(i) : i.name}</span>
            {editable && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onEdit(i); }} aria-label="Editar"><Icon name="edit" /></button>}
            {editable && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onDelete(i); }} aria-label="Eliminar"><Icon name="trash" /></button>}
          </div>
        ))}
        {shown.length === 0 && <Empty icon="globe" title={onAdd ? 'Sin registros' : 'Selecciona un elemento'} />}
      </div>
    </div>
  );
}

export default function Geography() {
  const { user } = useApp();
  const editable = can(user, 'zones.manage');
  const tree = useAsync(() => getGeoTree(true), []);
  const [province, setProvince] = useState(null);
  const [municipality, setMunicipality] = useState(null);
  const [modal, setModal] = useState(null);
  const [, run] = useAction();
  const t = tree.data;
  const municipalities = useMemo(() => (t?.municipalities || []).filter((m) => m.province_id === province), [t, province]);
  const sectors = useMemo(() => (t?.sectors || []).filter((s) => s.municipality_id === municipality), [t, municipality]);
  if (!t) return <Spinner center />;
  const del = (table, item) => window.confirm(`¿Eliminar "${item.name}"?`) && run(async () => { await api.del(`/api/geo/${table}/${item.id}`); tree.reload(true); }, 'Eliminado.');

  return (
    <div>
      <div className="page-header">
        <div><h1>Provincias, municipios y sectores</h1><p>División territorial usada para direcciones y tarifas. Todo es editable; nada está fijo en el código.</p></div>
      </div>
      <div className="grid grid-3">
        <Column title="Provincias" items={t.provinces} selected={province} editable={editable} onSelect={(id) => { setProvince(id); setMunicipality(null); }} onAdd={() => setModal({ table: 'provinces' })} onEdit={(i) => setModal({ table: 'provinces', item: i })} onDelete={(i) => del('provinces', i)} />
        <Column title="Municipios / DM" items={municipalities} selected={municipality} editable={editable} onSelect={setMunicipality} onAdd={province ? () => setModal({ table: 'municipalities', parent: province }) : null} onEdit={(i) => setModal({ table: 'municipalities', item: i })} onDelete={(i) => del('municipalities', i)} render={(m) => <>{m.name} {m.kind === 'distrito_municipal' && <span className="tiny muted">(DM)</span>}</>} />
        <Column title="Sectores" items={sectors} editable={editable} onAdd={municipality ? () => setModal({ table: 'sectors', parent: municipality }) : null} onEdit={(i) => setModal({ table: 'sectors', item: i })} onDelete={(i) => del('sectors', i)} />
      </div>
      {modal && <GeoModal {...modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); tree.reload(true); }} />}
    </div>
  );
}
