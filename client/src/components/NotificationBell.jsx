import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { useApp } from '../context/AppContext';
import { useSocketEvent } from './ui';
import { PushButton } from './pwa';

export default function NotificationBell() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    api.get('/api/notifications').then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useSocketEvent('notification', (n) => {
    setItems((list) => [n, ...list].slice(0, 30));
    toast(n.body, { title: n.title });
  });

  const unread = items.filter((n) => !n.read_at).length;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread) {
      await api.post('/api/notifications/read', {}).catch(() => {});
      setTimeout(() => setItems((list) => list.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))), 1500);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label={`Notificaciones${unread ? ` (${unread} sin leer)` : ''}`} style={{ position: 'relative' }}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="card notif-panel">
          <div className="card-header">
            <strong>Notificaciones</strong>
            <PushButton label="Push" />
          </div>
          {items.length === 0 && <div className="empty small">Sin notificaciones</div>}
          {items.map((n) => (
            <div
              key={n.id}
              className={`notif-item ${n.read_at ? '' : 'unread'}`}
              style={{ cursor: n.order_id ? 'pointer' : 'default' }}
              onClick={() => {
                if (n.order_id) {
                  setOpen(false);
                  navigate(`/admin/pedidos/${n.order_id}`);
                }
              }}
            >
              <div className="bold">{n.title}</div>
              <div className="muted">{n.body}</div>
              <div className="tiny muted">{relative(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
