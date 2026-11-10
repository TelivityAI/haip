import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './context/AuthContext';
import { PropertyProvider } from './context/PropertyContext';
import { ToastProvider } from './components/ui/Toast';
import App from './App';
import { loadAuthConfig } from './lib/keycloak';
import './i18n';
import './index.css';

// Login settings come from the API at runtime; render only once they are known
// (loadAuthConfig never rejects: on failure it keeps the build-time settings).
void loadAuthConfig().then(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <PropertyProvider>
              <App />
            </PropertyProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
));
