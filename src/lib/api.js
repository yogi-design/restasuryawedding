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
