import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { Spinner } from './components/ui';
import AdminLayout from './components/AdminLayout';
import Login from './pages/Login';
import TrackingPage from './pages/tracking/TrackingPage';

const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Orders = lazy(() => import('./pages/admin/Orders'));
const OrderDetail = lazy(() => import('./pages/admin/OrderDetail'));
const LiveTracking = lazy(() => import('./pages/admin/LiveTracking'));
const Couriers = lazy(() => import('./pages/admin/Couriers'));
const Customers = lazy(() => import('./pages/admin/Customers'));
const CustomerDetail = lazy(() => import('./pages/admin/CustomerDetail'));
const Rates = lazy(() => import('./pages/admin/Rates'));
const ZonesMap = lazy(() => import('./pages/admin/ZonesMap'));
const Geography = lazy(() => import('./pages/admin/Geography'));
const Users = lazy(() => import('./pages/admin/Users'));
const Inventory = lazy(() => import('./pages/admin/Inventory'));
const Audit = lazy(() => import('./pages/admin/Audit'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const CourierApp = lazy(() => import('./pages/courier/CourierApp'));

export function homeFor(user) {
  if (!user) return '/login';
  if (user.role === 'courier') return '/mensajero';
  return '/admin';
}

function RequireRole({ roles, children }) {
  const { user } = useApp();
  const location = useLocation();
  if (user === undefined) return <div className="fullscreen-center"><Spinner /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return children;
}

function Home() {
  const { user } = useApp();
  if (user === undefined) return <div className="fullscreen-center"><Spinner /></div>;
  return <Navigate to={homeFor(user)} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="fullscreen-center"><Spinner /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/seguimiento/:token" element={<TrackingPage />} />

        <Route path="/admin" element={<RequireRole roles={['admin', 'dispatcher']}><AdminLayout /></RequireRole>}>
          <Route index element={<Dashboard />} />
          <Route path="pedidos" element={<Orders />} />
          <Route path="pedidos/:id" element={<OrderDetail />} />
          <Route path="seguimiento" element={<LiveTracking />} />
          <Route path="mensajeros" element={<Couriers />} />
          <Route path="clientes" element={<Customers />} />
          <Route path="clientes/:id" element={<CustomerDetail />} />
          <Route path="inventario" element={<Inventory />} />
          <Route path="tarifas" element={<Rates />} />
          <Route path="zonas" element={<ZonesMap />} />
          <Route path="geografia" element={<Geography />} />
          <Route path="usuarios" element={<Users />} />
          <Route path="auditoria" element={<Audit />} />
          <Route path="configuracion" element={<Settings />} />
        </Route>

        <Route path="/mensajero/*" element={<RequireRole roles={['courier']}><CourierApp /></RequireRole>} />
        <Route path="*" element={<div className="fullscreen-center"><div className="empty"><h1>Página no encontrada</h1><p><a href="/">Volver al inicio</a></p></div></div>} />
      </Routes>
    </Suspense>
  );
}
