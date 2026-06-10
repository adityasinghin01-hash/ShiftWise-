/* ── SPINX LAYOUT HELPER ── */
/* Provides mountLayout without circular imports from app.js */

import { store } from './store.js';
import { auth, authApi } from './api.js';
import { toast } from './toast.js';

const getApp = () => document.getElementById('app');

const logoSVG = `
  <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="12" fill="url(#lg)"/>
    <path d="M16 24L22 30L32 18" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <defs><linearGradient id="lg" x1="0" y1="0" x2="48" y2="48">
      <stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient></defs>
  </svg>`;

function sidebarHTML(activeRoute) {
  const isAdmin = store.isAdmin();
  const navItems = [
    {
      route: 'dashboard',
      label: 'Dashboard',
      icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    },
    {
      route: 'profile',
      label: 'Profile',
      icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
    },
    {
      route: 'apikeys',
      label: 'API Keys',
      icon: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    },
    {
      route: 'webhooks',
      label: 'Webhooks',
      icon: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    },
  ];

  function navLink({ route, label, icon }) {
    return `<a class="nav-link${activeRoute === route ? ' active' : ''}" href="#${route}" data-route="${route}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
      ${label}
    </a>`;
  }

  return `
  <aside class="sidebar">
    <div class="sidebar-logo">${logoSVG}<span>Spinx</span></div>
    <nav class="sidebar-nav">
      <span class="nav-section-title">Main</span>
      ${navItems.map(navLink).join('')}
      ${
        isAdmin
          ? `
        <span class="nav-section-title">Admin</span>
        ${navLink({ route: 'admin', label: 'Admin Panel', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' })}
      `
          : ''
      }
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill" id="logout-btn">
        <div class="user-avatar">${store.initials}</div>
        <div class="user-info">
          <div class="user-name truncate">${store.name}</div>
          <div class="user-role">${store.role}</div>
        </div>
      </div>
    </div>
  </aside>`;
}

export function mountLayout(contentHTML, activeRoute = null) {
  const route = activeRoute || location.hash.slice(1) || 'dashboard';
  getApp().innerHTML = `
    <div class="app-layout">
      ${sidebarHTML(route)}
      <main class="main-content" id="page-content">${contentHTML}</main>
    </div>`;

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    try {
      const storedRefresh = sessionStorage.getItem('spinx_refresh');
      await authApi.logout(storedRefresh ? { refreshToken: storedRefresh } : {});
    } catch {}
    auth.clear();
    store.clear();
    sessionStorage.removeItem('spinx_refresh');
    toast('Signed out', 'success');
    location.hash = 'login';
  });
}
