// URL de tu implementación de Apps Script (termina en /exec).
// Se rellena al desplegar el backend — ver README.md.
const API_URL = 'https://script.google.com/macros/s/AKfycbwTEGtScG9jZQx3xP_jSEovPwyBIoRHepRKxrrt7OJ-G5BWTupiLe-k8u6ACZJyR4bbqw/exec';

async function apiGet(action, params) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(function ([k, v]) {
    url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error desconocido');
  return json.data;
}

async function apiPost(action, payload) {
  // Content-Type text/plain evita el preflight CORS que Apps Script no maneja bien.
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, payload))
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error desconocido');
  return json.data;
}
