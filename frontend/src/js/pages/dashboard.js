/* ── SPINX DASHBOARD ── */

import { profileApi, healthApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

function skeletonCards() {
  return `
  <div class="stats-grid">
    ${Array(4).fill('<div class="stat-card skeleton-card skeleton"></div>').join('')}
  </div>
  <div class="bento-grid" style="margin-top:16px">
    <div class="bento-half card skeleton" style="height:240px"></div>
    <div class="bento-half card skeleton" style="height:240px"></div>
  </div>`;
}

function statCard({ label, value, change, color = 'var(--primary)' }) {
  const isUp = change && change.startsWith('+');
  return `
  <div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-value" style="background:linear-gradient(135deg,${color},var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${value}</div>
    ${change ? `<div class="stat-change ${isUp ? 'up' : 'down'}">${change} vs last month</div>` : ''}
  </div>`;
}

function activityRow({ icon, label, time, badge, badgeClass = 'badge-purple' }) {
  return `
  <tr>
    <td><span style="font-size:1.1rem">${icon}</span></td>
    <td>${label}</td>
    <td><span class="badge ${badgeClass}">${badge}</span></td>
    <td class="text-muted" style="font-size:0.75rem">${time}</td>
  </tr>`;
}

export async function renderDashboard() {
  const contentHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Good to see you, ${store.name} 👋</p>
        </div>
        <div class="page-actions">
          <span class="status-dot online" id="health-dot"></span>
          <span id="health-label" class="text-sm text-muted">Checking...</span>
        </div>
      </div>
    </div>
    <div id="dash-content">${skeletonCards()}</div>
  `;

  mountLayout(contentHTML);

  // Health check
  healthApi
    .check()
    .then(() => {
      document.getElementById('health-dot').className = 'status-dot online';
      document.getElementById('health-label').textContent = 'API Online';
    })
    .catch(() => {
      document.getElementById('health-dot').className = 'status-dot offline';
      document.getElementById('health-label').textContent = 'API Offline';
    });

  // Fetch real data
  try {
    const [dashRes] = await Promise.all([profileApi.getDashboard()]);
    const d = dashRes.data || {};
    renderDashContent(d);
  } catch (err) {
    // Render with mock data if API not yet live
    renderDashContent({});
  }
}

function renderDashContent(d) {
  const el = document.getElementById('dash-content');
  if (!el) return;

  const totalLogins = d.totalLogins ?? '—';
  const apiCalls = d.apiCalls ?? '—';
  const activeKeys = d.activeApiKeys ?? '—';
  const webhooks = d.webhooks ?? '—';
  const recentActivity = d.recentActivity || [];

  el.innerHTML = `
  <div class="stats-grid">
    ${statCard({ label: 'Total Logins', value: totalLogins, change: d.loginChange, color: 'var(--primary)' })}
    ${statCard({ label: 'API Calls', value: apiCalls, change: d.apiChange, color: 'var(--accent)' })}
    ${statCard({ label: 'Active API Keys', value: activeKeys, color: '#10b981' })}
    ${statCard({ label: 'Webhooks', value: webhooks, color: '#f59e0b' })}
  </div>

  <div class="bento-grid" style="margin-top:16px">
    <div class="card bento-half">
      <div class="card-header">
        <span class="card-title">Recent Activity</span>
        <a href="#profile" class="btn btn-ghost btn-sm">View all</a>
      </div>
      ${
        recentActivity.length
          ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Event</th><th>Type</th><th>Time</th></tr></thead>
          <tbody>
            ${recentActivity
              .slice(0, 8)
              .map((a) =>
                activityRow({
                  icon: a.icon || '⚡',
                  label: a.label || a.event || 'Activity',
                  badge: a.type || 'event',
                  badgeClass: a.badgeClass || 'badge-purple',
                  time: a.time || a.createdAt || '',
                })
              )
              .join('')}
          </tbody>
        </table>
      </div>
      `
          : `
      <div class="empty-state">
        <div class="empty-state-icon">⚡</div>
        <div class="empty-state-title">No activity yet</div>
        <div class="empty-state-desc">Your recent events will appear here</div>
      </div>
      `
      }
    </div>

    <div class="card bento-half">
      <div class="card-header">
        <span class="card-title">Quick Actions</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <a href="#apikeys" class="btn btn-secondary w-full">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          Generate API Key
        </a>
        <a href="#webhooks" class="btn btn-secondary w-full">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Add Webhook
        </a>
      </div>
    </div>
  </div>
  `;
}
