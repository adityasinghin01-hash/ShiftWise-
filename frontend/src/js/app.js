/* ── SPINX SPA ROUTER ── */

import { store } from './store.js';
import { auth, authApi } from './api.js';
import { toast } from './toast.js';
import { navigate } from './router.js';

import { renderAuth } from './pages/auth.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderAdmin } from './pages/admin.js';
import { renderProfile } from './pages/profile.js';
import { renderApiKeys } from './pages/apikeys.js';
import { renderWebhooks } from './pages/webhooks.js';

export { navigate };

/* ── ROUTES ── */
const ROUTES = {
  login: () => renderAuth('login'),
  signup: () => renderAuth('signup'),
  'forgot-password': () => renderAuth('forgot'),
  'verify-email': () => renderAuth('verify'),
  'reset-password': () => renderAuth('reset-password'),
  dashboard: () => renderDashboard(),
  profile: () => renderProfile(),
  admin: () => renderAdmin(),
  apikeys: () => renderApiKeys(),
  webhooks: () => renderWebhooks(),
};

const PUBLIC_ROUTES = new Set([
  'login',
  'signup',
  'forgot-password',
  'verify-email',
  'reset-password',
]);
const ADMIN_ROUTES = new Set(['admin']);

async function handleRoute() {
  // Hash may contain query params: #reset-password?token=abc → route='reset-password'
  const hashFull = location.hash.slice(1) || 'dashboard';
  const [rawRoute] = hashFull.split('?');
  const raw = rawRoute || 'dashboard';
  let route = Object.keys(ROUTES).includes(raw) ? raw : 'dashboard';

  // Auth guards — redirect but don't return; fall through to render the new route
  if (!PUBLIC_ROUTES.has(route) && !store.isLoggedIn()) {
    route = 'login';
    history.replaceState(null, '', '#login');
  } else if (PUBLIC_ROUTES.has(route) && store.isLoggedIn()) {
    route = 'dashboard';
    history.replaceState(null, '', '#dashboard');
  } else if (ADMIN_ROUTES.has(route) && !store.isAdmin()) {
    toast('Admin access required', 'error');
    route = 'dashboard';
    history.replaceState(null, '', '#dashboard');
  }

  await ROUTES[route]?.();
}

/* ── BOOTSTRAP ── */
async function init() {
  store.load();

  // Silent token refresh if session data exists but in-memory token is gone
  if (store.isLoggedIn() && !auth.getToken()) {
    try {
      const storedRefresh = sessionStorage.getItem('spinx_refresh');
      const res = await authApi.refreshToken(
        storedRefresh ? { refreshToken: storedRefresh } : undefined
      );
      if (res.accessToken) auth.setToken(res.accessToken);
      if (res.refreshToken) sessionStorage.setItem('spinx_refresh', res.refreshToken);
    } catch {
      store.clear();
    }
  }

  window.addEventListener('hashchange', handleRoute);
  await handleRoute();
}

init();
