// Options/popup logic — store the LifeOS URL + token and request host
// permission for that origin so the background worker can POST to it.

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function originPattern(rawUrl) {
  const u = new URL(rawUrl);
  return `${u.protocol}//${u.host}/*`;
}

async function load() {
  const { lifeosUrl, token } = await api.storage.local.get(['lifeosUrl', 'token']);
  if (lifeosUrl) $('url').value = lifeosUrl;
  if (token) $('token').value = token;
}

async function save() {
  const lifeosUrl = $('url').value.trim().replace(/\/+$/, '');
  const token = $('token').value.trim();
  if (!lifeosUrl || !token) { setStatus('Enter both the LifeOS URL and token.', 'err'); return; }

  let pattern;
  try { pattern = originPattern(lifeosUrl); }
  catch { setStatus('That LifeOS URL is not valid.', 'err'); return; }

  // Ask for permission to talk to the LifeOS origin (no-op if already granted).
  try {
    const granted = await api.permissions.request({ origins: [pattern] });
    if (!granted) { setStatus('Permission for ' + pattern + ' was denied.', 'err'); return; }
  } catch (e) {
    // Some browsers reject permission requests outside a user gesture / tab —
    // saving still works if the origin was granted at install or manually.
    console.warn('permissions.request failed', e);
  }

  await api.storage.local.set({ lifeosUrl, token });

  // Quick connectivity check against the ingest token endpoint.
  try {
    const res = await fetch(lifeosUrl + '/api/grocery/ingest-token', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) setStatus('Saved and connected ✓ — visit walmart.com/orders to sync.', 'ok');
    else setStatus(`Saved, but LifeOS returned HTTP ${res.status} — check the token.`, 'err');
  } catch {
    setStatus('Saved. Could not reach LifeOS now — it will sync when reachable.', 'ok');
  }
}

$('save').addEventListener('click', save);
load();
