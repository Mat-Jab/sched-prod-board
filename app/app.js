import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const panel = document.querySelector('[data-testid="incident-panel"]');

// Ack state lives here, keyed by incident id, so a refresh never drops it.
const acked = new Map(); // id -> ackedAt
const pending = new Set(); // ids with an ack in flight
const byId = new Map(); // id -> latest incident from the API
let openId = null; // the incident the panel names
let panelHtml = '';

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

// R2 (product, after step 1): the row has no Ack. It opens the incident panel; Ack lives in the panel.
function rowHtml(i) {
  return `<span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    <span class="act"></span>`;
}

function renderRowState(li) {
  const id = li.dataset.id;
  const act = li.querySelector('.act');
  const isAcked = acked.has(id);
  if (isAcked && !act.querySelector('[data-testid="acked"]')) {
    act.innerHTML = `<span data-testid="acked" class="acked">acked</span>`;
  }
  li.classList.toggle('is-acked', isAcked);
  li.classList.toggle('is-open', id === openId);
  li.setAttribute('aria-selected', String(id === openId));
}

// R1: keyed update. Existing rows keep their DOM node (and ack state); new ones go in at the top,
// in the API's order (newest first). Rows are only removed when the API no longer lists them.
function render(incidents) {
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  const want = new Set(incidents.map((i) => i.id));
  for (const [id, li] of existing) if (!want.has(id)) li.remove();

  let prev = null;
  for (const i of incidents) {
    byId.set(i.id, i);
    let li = existing.get(i.id);
    if (!li) {
      li = document.createElement('li');
      li.setAttribute('data-testid', 'incident-row');
      li.dataset.id = i.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-controls', 'incident-panel');
      li.innerHTML = rowHtml(i);
    } else {
      // Keep the row's node (and its ack state); only refresh what the API may have changed.
      const t = li.querySelector('time');
      if (t.getAttribute('datetime') !== i.openedAt) {
        t.setAttribute('datetime', i.openedAt);
        t.title = i.openedAt;
        t.textContent = localTime(i.openedAt);
      }
    }
    li.className = `row ${i.severity}`;
    renderRowState(li);
    const anchor = prev ? prev.nextSibling : list.firstChild;
    if (anchor !== li) list.insertBefore(li, anchor);
    prev = li;
  }

  empty.hidden = incidents.length > 0;
  list.hidden = incidents.length === 0;
  if (openId) renderPanel();
}

// The panel names one incident by id. It does not follow row positions, so a list that moves
// under the pointer cannot change which incident Ack sends.
function renderPanel() {
  const i = openId && byId.get(openId);
  if (!i) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.dataset.id = i.id;
  const isAcked = acked.has(i.id);
  const busy = pending.has(i.id);
  const html = `
    <div class="panel-head">
      <h2 class="panel-id">${esc(i.id)}</h2>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </div>
    <p class="panel-sev ${esc(i.severity)}">${esc(i.severity)}</p>
    <dl>
      <dt>Service</dt><dd>${esc(i.service)}</dd>
      <dt>Region</dt><dd>${esc(i.region)}</dd>
      <dt>Summary</dt><dd>${esc(i.summary)}</dd>
      <dt>Opened</dt><dd><time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time></dd>
    </dl>
    ${
      isAcked
        ? `<p class="panel-acked">Acked ${esc(i.id)} at ${esc(localTime(acked.get(i.id)))}</p>`
        : `<button type="button" data-testid="panel-ack" class="ack panel-ack" ${busy ? 'disabled' : ''}>Ack ${esc(i.id)}</button>`
    }`;
  // Only touch the DOM when something changed, so a refresh never swaps the button under a click.
  if (panelHtml !== html) {
    panelHtml = html;
    panel.innerHTML = html;
  }
}

function openPanel(id) {
  openId = id;
  for (const li of list.children) renderRowState(li);
  renderPanel();
}

list.addEventListener('click', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li) openPanel(li.dataset.id);
});
list.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('[data-testid="incident-row"]');
  if (!li) return;
  e.preventDefault();
  openPanel(li.dataset.id);
});

panel.addEventListener('click', async (e) => {
  if (e.target.closest('.panel-close')) {
    openPanel(null);
    return;
  }
  if (!e.target.closest('[data-testid="panel-ack"]')) return;
  const id = panel.dataset.id; // the incident the panel names, not a row position
  if (pending.has(id) || acked.has(id)) return;
  pending.add(id);
  renderPanel();
  try {
    const reply = await ack(id);
    acked.set(reply.id, reply.ackedAt);
  } catch (err) {
    console.error(err);
  } finally {
    pending.delete(id);
    const li = list.querySelector(`[data-testid="incident-row"][data-id="${CSS.escape(id)}"]`);
    if (li) renderRowState(li);
    if (openId === id) renderPanel();
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
