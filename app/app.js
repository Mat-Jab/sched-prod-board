import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');

// Ack state lives here, keyed by incident id, so a refresh never drops it.
const acked = new Map(); // id -> ackedAt
const pending = new Set(); // ids with an ack in flight

// R5: the viewer's own zone and locale order (en-GB/de → dd/mm, en-US → mm/dd).
const fmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});
const localTime = (iso) => fmt.format(new Date(iso));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function rowHtml(i) {
  return `<span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    <span class="act"></span>`;
}

function renderAction(li) {
  const id = li.dataset.id;
  const act = li.querySelector('.act');
  if (acked.has(id)) {
    if (!act.querySelector('[data-testid="acked"]')) {
      act.innerHTML = `<span data-testid="acked" class="acked">acked</span>`;
    }
    li.classList.add('is-acked');
  } else if (!act.querySelector('[data-testid="ack"]')) {
    act.innerHTML = `<button type="button" data-testid="ack" class="ack">Ack</button>`;
  }
  const btn = act.querySelector('[data-testid="ack"]');
  if (btn) btn.disabled = pending.has(id);
}

// R1: keyed update. Existing rows keep their DOM node (and ack state); new ones go in at the top,
// in the API's order (newest first).
function render(incidents) {
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  const want = new Set(incidents.map((i) => i.id));
  for (const [id, li] of existing) if (!want.has(id)) li.remove();

  let prev = null;
  for (const i of incidents) {
    let li = existing.get(i.id);
    if (!li) {
      li = document.createElement('li');
      li.setAttribute('data-testid', 'incident-row');
      li.dataset.id = i.id;
      li.innerHTML = rowHtml(i);
    }
    li.className = `row ${i.severity}${acked.has(i.id) ? ' is-acked' : ''}`;
    renderAction(li);
    const anchor = prev ? prev.nextSibling : list.firstChild;
    if (anchor !== li) list.insertBefore(li, anchor);
    prev = li;
  }

  empty.hidden = incidents.length > 0;
  list.hidden = incidents.length === 0;
}

// R2: the id comes from the row the button sits in, at click time.
list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn) return;
  const li = btn.closest('[data-testid="incident-row"]');
  const id = li.dataset.id;
  if (pending.has(id) || acked.has(id)) return;
  pending.add(id);
  renderAction(li);
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
  } catch (err) {
    console.error(err);
    btn.title = String(err.message || err);
  } finally {
    pending.delete(id);
    renderAction(li);
  }
});

// R3 + R4: loader until the first answer, then poll every 2 s without overlapping requests.
let loaded = false;
async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    board.dataset.updatedAt = page.updatedAt;
    if (!loaded) {
      loaded = true;
      loader.remove();
    }
  } catch (err) {
    console.error(err);
  } finally {
    setTimeout(tick, REFRESH_MS);
  }
}
tick();

// R6: footer names the same build as the meta tag.
const sha = document.querySelector('meta[name="build"]')?.content ?? 'dev';
document.querySelector('[data-testid="build-sha"]').textContent = sha;
