import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { resetSocket } from '../lib/socket';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = cargando
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const toast = useCallback((message, { title, type = 'info', timeout = 4500 } = {}) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, title, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), timeout);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api.get('/api/public/config'));
    } catch {
      setConfig({ company: { company_name: 'Entregas RD', currency_symbol: 'RD$' }, google: {}, statuses: {}, courierStatuses: {} });
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await api.get('/api/auth/me');
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    loadConfig();
    refreshUser();
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [loadConfig, refreshUser]);

  const login = useCallback(
    async (email, password) => {
      await api.post('/api/auth/login', { email, password });
      resetSocket();
      return refreshUser();
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    resetSocket();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ config, reloadConfig: loadConfig, user, setUser, refreshUser, login, logout, toast, currency: config?.company?.currency_symbol || 'RD$' }),
    [config, loadConfig, user, refreshUser, login, logout, toast]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={{ '--c': { success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)' }[t.type] }}>
            {t.title && <strong>{t.title}</strong>}
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

export function can(user, permission) {
  return !!user?.permissions && (user.permissions.includes('*') || user.permissions.includes(permission));
}
