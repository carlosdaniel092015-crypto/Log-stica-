import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { resetSocket } from '../lib/socket';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = cargando
  const [toasts, setToasts] = useState([]);
  // Tema: claro/oscuro elegido por el usuario o, por defecto, el del sistema.
  const [themePref, setThemePref] = useState(() => {
    try {
      return localStorage.getItem('lrd_theme') || 'system';
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches || false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const fn = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const isDark = themePref === 'dark' || (themePref === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0a1628' : '#0f2a4a');
  }, [isDark]);
  const toggleTheme = useCallback(() => {
    const next = isDark ? 'light' : 'dark';
    setThemePref(next);
    try {
      localStorage.setItem('lrd_theme', next);
    } catch {
      /* sin almacenamiento */
    }
  }, [isDark]);
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
    async (email, password, remember = true) => {
      await api.post('/api/auth/login', { email, password, remember });
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
    () => ({ config, reloadConfig: loadConfig, user, setUser, refreshUser, login, logout, toast, currency: config?.company?.currency_symbol || 'RD$', isDark, toggleTheme }),
    [config, loadConfig, user, refreshUser, login, logout, toast, isDark, toggleTheme]
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
