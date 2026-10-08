import { NavLink, Outlet, useLocation } from 'react-router-dom';
import Icon from './Icon';
import NotificationBell from './NotificationBell';
import { OnlineIndicator } from './ui';
import OutcomeToasts from './OutcomeToasts';
import { InstallBanner } from './pwa';
import { can, useApp } from '../context/AppContext';

const NAV = [
  { section: 'Operación' },
  { to: '/admin', label: 'Dashboard', icon: 'dashboard', end: true, perm: 'dashboard.view', mobile: true },
  { to: '/admin/pedidos', label: 'Pedidos', icon: 'box', perm: 'orders.view', mobile: true },
  { to: '/admin/seguimiento', label: 'Seguimiento en vivo', short: 'En vivo', icon: 'navigation', perm: 'tracking.view', mobile: true },
  { to: '/admin/mensajeros', label: 'Mensajeros', icon: 'truck', perm: 'tracking.view', mobile: true },
  { to: '/admin/clientes', label: 'Clientes', icon: 'users', perm: 'customers.manage' },
  { to: '/admin/inventario', label: 'Inventario', icon: 'archive', perm: 'inventory.manage' },
  { section: 'Cobertura' },
  { to: '/admin/tarifas', label: 'Tarifas de entrega', short: 'Tarifas', icon: 'tag', perm: 'orders.view' },
  { to: '/admin/zonas', label: 'Zonas en el mapa', icon: 'layers', perm: 'orders.view' },
  { to: '/admin/geografia', label: 'Provincias y sectores', icon: 'globe', perm: 'orders.view' },
  { section: 'Administración' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: 'user', perm: 'users.manage' },
  { to: '/admin/auditoria', label: 'Auditoría', icon: 'shield', perm: 'audit.view' },
  { to: '/admin/configuracion', label: 'Configuración', icon: 'settings', perm: 'settings.manage' },
];

export default function AdminLayout() {
  const { user, logout, config } = useApp();
  const location = useLocation();
  const items = NAV.filter((n) => n.section || can(user, n.perm));
  const sections = items.filter((n, i) => !n.section || (items[i + 1] && !items[i + 1].section));
  const current = NAV.find((n) => n.to && (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));
  const company = config?.company;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menú principal">
        <div className="brand">
          <img src={company?.company_logo_url || '/icons/icon-192.png'} alt="" />
          <div>
            {company?.company_name || 'Entregas RD'}
            <small>Panel de logística</small>
          </div>
        </div>
        <nav>
          {sections.map((n) =>
            n.section ? (
              <div key={n.section} className="nav-section">{n.section}</div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
                <Icon name={n.icon} /> {n.label}
              </NavLink>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="small" style={{ padding: '4px 10px 8px', color: '#fff' }}>
            {user.name}
            <div className="tiny" style={{ color: 'var(--nav-text)' }}>{user.role === 'admin' ? 'Administrador' : 'Despachador'}</div>
          </div>
          <button className="nav-link" style={{ width: '100%', background: 'none', border: 0, font: 'inherit', cursor: 'pointer' }} onClick={logout}>
            <Icon name="logout" /> Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title ellipsis">{current?.label || 'Panel'}</div>
          <OnlineIndicator />
          <NotificationBell />
        </header>
        <main className="content">
          <div style={{ marginBottom: 12 }}>
            <InstallBanner storageKey="lrd_install_admin" />
          </div>
          <Outlet />
        </main>
      </div>
      <OutcomeToasts />
      <nav className="bottom-nav" aria-label="Navegación">
        {items.filter((n) => n.mobile).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <Icon name={n.icon} />
            {n.short || n.label}
          </NavLink>
        ))}
        <NavLink to="/admin/mas" onClick={(e) => { e.preventDefault(); document.getElementById('more-menu')?.showModal?.(); }}>
          <Icon name="menu" />
          Más
        </NavLink>
      </nav>
      <dialog id="more-menu" className="card" style={{ padding: 0, border: '1px solid var(--border)', width: 'min(360px, 92vw)', background: 'var(--surface)', color: 'var(--text)' }} onClick={(e) => e.target.id === 'more-menu' && e.currentTarget.close()}>
        <div className="card-header"><strong>Menú</strong><button className="btn btn-ghost btn-icon" onClick={() => document.getElementById('more-menu').close()} aria-label="Cerrar"><Icon name="x" /></button></div>
        <div style={{ padding: 8 }}>
          {items.filter((n) => !n.section && !n.mobile).map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-link" style={{ color: 'var(--text)' }} onClick={() => document.getElementById('more-menu').close()}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
          <button className="nav-link" style={{ width: '100%', background: 'none', border: 0, font: 'inherit', color: 'var(--danger)', cursor: 'pointer' }} onClick={logout}>
            <Icon name="logout" /> Cerrar sesión
          </button>
        </div>
      </dialog>
    </div>
  );
}
