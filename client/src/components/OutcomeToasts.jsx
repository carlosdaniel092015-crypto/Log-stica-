import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { useSocketEvent } from './ui';

/**
 * Avisos automáticos en todo el panel administrativo, sin recargar:
 * verde cuando el mensajero marca Entregado, rojo cuando marca No entregado.
 */
export default function OutcomeToasts() {
  const [items, setItems] = useState([]);
  useSocketEvent('order:outcome', (o) => {
    const key = `${o.id}-${o.status}-${Date.now()}`;
    setItems((list) => [{ ...o, key }, ...list].slice(0, 4));
    setTimeout(() => setItems((list) => list.filter((x) => x.key !== key)), o.outcome === 'failure' ? 15000 : 8000);
  });
  if (!items.length) return null;
  return (
    <div className="outcome-toasts" role="status" aria-live="assertive">
      {items.map((o) => (
        <Link key={o.key} to={`/admin/pedidos/${o.id}`} className={`outcome-card ${o.outcome}`} onClick={() => setItems((l) => l.filter((x) => x.key !== o.key))}>
          <Icon name={o.outcome === 'success' ? 'check' : 'alert'} />
          <div className="spacer">
            <div className="bold">Pedido #{o.order_number} · {o.outcome === 'success' ? 'ENTREGADO' : o.status === 'customer_unavailable' ? 'CLIENTE NO DISPONIBLE' : 'NO ENTREGADO'}</div>
            <div className="small">{o.courier_name || 'Mensajero'} → {o.customer_name}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
