/* ── SPINX API CLIENT ── */

import {
  isMockMode,
  mockAuthApi,
  mockProfileApi,
  mockApiKeyApi,
  mockWebhookApi,
  mockAdminApi,
  mockSubscriptionApi,
  mockHealthApi,
} from './mock.js';

const BASE = import.meta.env.VITE_API_URL || '/api/v1';
const HEALTH_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace('/api/v1', '/api')
  : '/api';

let _accessToken = null;

export const auth = {
  setToken: (t) => {
    _accessToken = t;
  },
  getToken: () => _accessToken,
  clear: () => {
    _accessToken = null;
  },
};

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function request(path, opts = {}) {
  const { body, method = 'GET', apiKey, base = BASE } = opts;

  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': uuidv4(),
  };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    credentials: 'include', // send httpOnly cookie for refresh token
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || 60;
    throw new ApiError(429, `Rate limited. Try again in ${retryAfter}s.`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(res.status, data.message || 'Request failed', data);
  }

  return data;
}

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/* ── AUTH ── */
export const authApi = isMockMode()
  ? mockAuthApi
  : {
      signup: (body) => request('/signup', { method: 'POST', body }),
      login: (body) => request('/login', { method: 'POST', body }),
      googleLogin: (body) => request('/google-login', { method: 'POST', body }),
      googleSignup: (body) => request('/google-signup', { method: 'POST', body }),
      logout: (body) => request('/logout', { method: 'POST', body }),
      refreshToken: (body) => request('/refresh-token', { method: 'POST', body }),
      verifyEmail: (token) => request(`/verify-email?token=${encodeURIComponent(token)}`),
      resendVerification: (body) => request('/resend-verification', { method: 'POST', body }),
      checkVerificationStatus: (email) =>
        request(`/check-verification-status?email=${encodeURIComponent(email)}`),
      // Password reset — OTP flow
      forgotPassword: (body) => request('/password/forgot', { method: 'POST', body }),
      sendOtp: (body) => request('/password/send-otp', { method: 'POST', body }),
      verifyOtp: (body) => request('/password/verify-otp', { method: 'POST', body }),
      resetPassword: (body) => request('/password/reset', { method: 'POST', body }),
    };

/* ── PROFILE / DASHBOARD ── */
export const profileApi = isMockMode()
  ? mockProfileApi
  : {
      getProfile: () => request('/profile', { method: 'GET' }),
      updateProfile: (body) => request('/profile', { method: 'PUT', body }),
      changePassword: (body) => request('/change-password', { method: 'POST', body }),
      getDashboard: () => request('/dashboard', { method: 'GET' }),
      listSessions: () => request('/sessions', { method: 'GET' }),
      revokeSession: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
      revokeAllOtherSessions: (body) => request('/sessions', { method: 'DELETE', body }),
    };

/* ── MFA ── */
export const mfaApi = {
  setup: () => request('/mfa/setup', { method: 'POST' }),
  verifySetup: (body) => request('/mfa/verify-setup', { method: 'POST', body }),
  disable: (body) => request('/mfa/disable', { method: 'POST', body }),
  regenerateBackupCodes: () => request('/mfa/backup-codes', { method: 'POST' }),
  mfaLogin: (body) => request('/mfa/login', { method: 'POST', body }),
};

/* ── ADMIN ── */
export const adminApi = isMockMode()
  ? mockAdminApi
  : {
      getStats: () => request('/admin/stats'),
      listUsers: (page = 1, query = '') => request(`/admin/users?page=${page}&search=${query}`),
      getUser: (id) => request(`/admin/users/${id}`),
      updateRole: (id, role) =>
        request(`/admin/users/${id}/role`, { method: 'PUT', body: { role } }),
      banUser: (id, isBanned) =>
        request(`/admin/users/${id}/ban`, { method: 'PUT', body: { isBanned } }),
      deleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
    };

/* ── SUBSCRIPTIONS ── */
export const subscriptionApi = isMockMode()
  ? mockSubscriptionApi
  : {
      getPlans: () => request('/subscriptions/plans'),
      getCurrent: () => request('/subscriptions/current'),
      changePlan: (planName) =>
        request('/subscriptions/change', { method: 'PUT', body: { planName } }),
      getUsage: () => request('/subscriptions/usage'),
    };

/* ── API KEYS ── */
export const apiKeyApi = isMockMode()
  ? mockApiKeyApi
  : {
      list: () => request('/apikeys'),
      create: (body) => request('/apikeys', { method: 'POST', body }),
      revoke: (id) => request(`/apikeys/${id}`, { method: 'DELETE' }),
      rotate: (id) => request(`/apikeys/${id}/rotate`, { method: 'POST' }),
    };

/* ── WEBHOOKS ── */
export const webhookApi = isMockMode()
  ? mockWebhookApi
  : {
      list: () => request('/webhooks'),
      create: (body) => request('/webhooks', { method: 'POST', body }),
      update: (id, body) => request(`/webhooks/${id}`, { method: 'PUT', body }),
      delete: (id) => request(`/webhooks/${id}`, { method: 'DELETE' }),
      test: (id) => request(`/webhooks/${id}/test`, { method: 'POST' }),
    };

/* ── HEALTH ── */
export const healthApi = isMockMode()
  ? mockHealthApi
  : {
      check: () => request('/health', { base: HEALTH_BASE }),
      deep: () => request('/health/deep', { base: HEALTH_BASE }),
    };
