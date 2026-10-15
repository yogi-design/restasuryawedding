const API_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') || '';
const hasApiConfig = Boolean(API_URL);

async function request(path, options = {}) {
  if (!hasApiConfig) {
    throw new Error('MySQL API belum dikonfigurasi.');
  }

  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('API tidak mengirim JSON. Periksa versi server dan URL API.');
  }

  if (!response.ok) {
    throw new Error(payload?.message || 'Request failed');
  }

  return payload;
}

export const isApiConfigured = hasApiConfig;

export function loadInvitation() {
  return request('/api/invitation');
}

export async function loadWishes() {
  const rows = await request('/api/wishes');
  return Array.isArray(rows)
    ? rows.map((item) => ({ id: item.id, name: item.name || item.guest_name, message: item.message }))
    : [];
}

export async function submitRsvpAndWish(payload) {
  return request('/api/rsvp-and-wish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitGiftReport(payload) {
  return request('/api/gift-reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function checkAdminSession() {
  return request('/api/admin/session', { credentials: 'include' });
}

export function adminLogin(payload) {
  return request('/api/admin/login', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export function adminLogout() {
  return request('/api/admin/logout', {
    method: 'POST',
    credentials: 'include',
  });
}

export function loadAdminDashboard() {
  return request('/api/admin/dashboard', { credentials: 'include' });
}

export function loadAdminUsers() {
  return request('/api/admin/users', { credentials: 'include' });
}

export function loadAdminInvitations() {
  return request('/api/admin/invitations', { credentials: 'include' });
}

export function createAdminInvitation(payload) {
  return request('/api/admin/invitations', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export function updateAdminInvitation(id, payload) {
  return request(`/api/admin/invitations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export function deleteAdminInvitation(id) {
  return request(`/api/admin/invitations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
}

export function importAdminInvitations(rows) {
  return request('/api/admin/invitations/import', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ rows }),
  });
}

export function addAdminUser(payload) {
  return request('/api/admin/users', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export function setAdminUserActive(id, isActive) {
  return request(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function resetAdminUserPassword(id, password) {
  return request(`/api/admin/users/${encodeURIComponent(id)}/password`, {
    method: 'PUT',
    credentials: 'include',
    body: JSON.stringify({ password }),
  });
}

export function saveAdminSettings(payload) {
  return request('/api/admin/settings', {
    method: 'PUT',
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}
