import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './context/AppContext';
import { flushOutbox } from './lib/api';
import './styles.css';

// Service Worker: la app funciona sin él; se registra para caché básico, offline y push.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'flush-outbox') flushOutbox();
  });
}

// Reenvía acciones pendientes cuando vuelve la conexión.
window.addEventListener('online', () => flushOutbox());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProvider>
  </StrictMode>
);
