import { formatDistance } from './lib/geo.js';
import { googleMapsUrl, wazeUrl, appleMapsUrl } from './lib/navigation.js';
import { filterArea, sortAreas, directionFromHeading } from './lib/filters.js';

const $ = (s) => document.querySelector(s);
const state = {
  data: null,
  position: null, // { lat, lon, accuracy, heading, speed }
  filters: { direction: 'all', minPowerKW: 0, connector: '', onlyOperational: false },
  markers: new Map(),
  selected: null,
};

// ---------- Mappa ----------
// Se Leaflet non è disponibile l'app funziona comunque in sola lista.
const hasMap = typeof window.L !== 'undefined';
const noop = () => noopMap;
const noopMap = { setView: noop, getZoom: () => 7, addTo: noop, remove: noop };
const map = hasMap ? L.map('map', { zoomControl: true }).setView([45.45, 10.6], 7) : noopMap;
if (!hasMap) document.getElementById('map').hidden = true;
if (hasMap) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
let userMarker = null;
let userCircle = null;

function powerColor(kw) {
  if (kw >= 150) return '#0b6e4f';
  if (kw >= 50) return '#2f7fb5';
  return '#8a6d1f';
}

function markerIcon(area) {
  const kw = area.summary.maxPowerKW ?? 0;
  return L.divIcon({
    className: '',
    html: `<div class="marker" style="background:${powerColor(kw)}">${kw ? Math.round(kw) : '?'}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// ---------- Utilità di rendering ----------
const DIR_LABEL = { trieste: '→ verso Trieste', torino: '← verso Torino' };

function fmtDate(iso) {
  if (!iso) return 'n.d.';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'n.d.' : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(s) {
  if (!s.status) return '<span class="st-unk">Stato sconosciuto</span>';
  const live = s.statusIsLive ? ' (automatico)' : ' (dichiarato)';
  const cls = s.status.operational === true ? 'st-ok' : s.status.operational === false ? 'st-bad' : 'st-unk';
  const label =
    { 10: 'Disponibile', 20: 'In uso', 30: 'Temporaneamente non disponibile', 50: 'In servizio', 75: 'Parzialmente in servizio', 100: 'Fuori servizio', 150: 'Pianificata', 0: 'Sconosciuto' }[s.status.id] ??
    s.status.title;
  return `<span class="${cls}">${label}${live}</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function connectorLine(c) {
  const parts = [c.quantity ? `${c.quantity}×` : '', c.type, c.powerKW ? `${c.powerKW} kW` : '', c.current ? `(${c.current})` : ''];
  return parts.filter(Boolean).join(' ');
}

function renderList() {
  const list = $('#list');
  list.replaceChildren();
  if (!state.data) return;

  const visible = sortAreas(
    state.data.areas.map((a) => filterArea(a, state.filters)).filter(Boolean),
    state.position,
  );

  // Marker: mostra solo le aree visibili
  const visibleIds = new Set(visible.map((a) => a.id));
  for (const [id, m] of state.markers) {
    if (visibleIds.has(id)) m.addTo(map);
    else m.remove();
  }

  const tpl = $('#tpl-area');
  for (const a of visible) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = a.id;
    if (state.selected === a.id) node.classList.add('active');
    node.querySelector('.area-name').textContent = `AdS ${a.name}`;
    const dir = a.direction ? DIR_LABEL[a.direction] + (a.directionInferred ? ' (dedotta dal nome)' : '') : 'direzione n.d.';
    node.querySelector('.meta').textContent = [dir, a.km != null ? `km ${String(a.km).replace('.', ',')}` : null].filter(Boolean).join(' · ');
    node.querySelector('.dist').textContent = a.distanceM != null ? formatDistance(a.distanceM) : '';

    const pts = a.stations.reduce((n, s) => n + (s.numberOfPoints ?? s.connections.reduce((k, c) => k + (c.quantity ?? 1), 0)), 0);
    const maxKW = Math.max(0, ...a.stations.map((s) => s.maxPowerKW ?? 0));
    const ops = [...new Set(a.stations.map((s) => s.operator).filter((o) => o && !o.startsWith('(')))];
    node.querySelector('.summary').textContent =
      `${a.stations.length} ${a.stations.length === 1 ? 'stazione' : 'stazioni'} · ${pts} punti di ricarica` +
      (maxKW ? ` · fino a ${maxKW} kW` : '') +
      (ops.length ? ` · ${ops.join(', ')}` : '');

    const chips = node.querySelector('.chips');
    const agg = new Map();
    for (const s of a.stations) for (const c of s.connections) {
      const k = `${c.type}|${c.powerKW ?? ''}`;
      agg.set(k, { ...c, quantity: (agg.get(k)?.quantity ?? 0) + (c.quantity ?? 1) });
    }
    for (const c of [...agg.values()].sort((x, y) => (y.powerKW ?? 0) - (x.powerKW ?? 0))) {
      const li = document.createElement('li');
      li.textContent = connectorLine(c);
      chips.append(li);
    }

    const ul = node.querySelector('.stations');
    for (const s of a.stations) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="st-title">${esc(s.operator && !s.operator.startsWith('(') ? s.operator : 'Operatore n.d.')} — ${esc(s.title)}</div>
        <div>${statusBadge(s)}</div>
        <div class="st-meta">${s.connections.map((c) => esc(connectorLine(c))).join('<br>')}</div>
        <div class="st-meta">Ultimo aggiornamento stato: ${fmtDate(s.dateLastStatusUpdate)}${s.usageCost ? ' · Costo: ' + esc(s.usageCost) : ''}</div>
        <div class="st-meta">Dati: ${esc(s.dataProvider?.title || 'Open Charge Map')}${s.dataProvider?.license ? ' (' + esc(s.dataProvider.license) + ')' : ''} · <a href="${esc(s.ocmUrl)}" target="_blank" rel="noopener">Scheda OCM</a>${s.operatorUrl ? ` · <a href="${esc(s.operatorUrl)}" target="_blank" rel="noopener">Sito operatore</a>` : ''}</div>`;
      ul.append(li);
    }

    const dest = { lat: a.lat, lon: a.lon };
    const origin = state.position ? { lat: state.position.lat, lon: state.position.lon } : null;
    node.querySelector('[data-nav="google"]').href = googleMapsUrl(dest, origin);
    node.querySelector('[data-nav="waze"]').href = wazeUrl(dest);
    node.querySelector('[data-nav="apple"]').href = appleMapsUrl(dest, origin);

    node.addEventListener('click', (e) => {
      if (e.target.closest('a, summary')) return;
      select(a.id, true);
    });
    list.append(node);
  }

  const total = state.data.areas.length;
  const st = $('#status');
  st.classList.remove('error');
  st.textContent =
    `${visible.length} aree su ${total}` +
    (state.position ? ' · ordinate per distanza in linea d\'aria' : ' · ordinate da Torino a Trieste') +
    ` · dati OCM del ${fmtDate(state.data.generatedAt)}` +
    (state.data.stale ? ' · ⚠ dati non aggiornati' : '') +
    (state.data.offline ? ' · ⚠ offline, copia locale' : '');
}

function select(id, pan) {
  state.selected = id;
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
  const m = state.markers.get(id);
  if (m && pan) {
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 13));
    m.openPopup();
  }
}

function buildMarkers() {
  if (!hasMap) return;
  for (const a of state.data.areas) {
    const m = L.marker([a.lat, a.lon], { icon: markerIcon(a), title: `AdS ${a.name}` }).bindPopup(
      `<strong>AdS ${esc(a.name)}</strong><br>${esc(a.direction ? DIR_LABEL[a.direction] : '')}<br>${a.summary.points} punti · max ${a.summary.maxPowerKW ?? '?'} kW`,
    );
    m.on('click', () => {
      select(a.id, false);
      document.querySelector(`.card[data-id="${CSS.escape(a.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    state.markers.set(a.id, m);
  }
}

function renderSources() {
  const el = $('#sources');
  const src = (state.data?.sources || [])
    .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.license)}, fonte non ufficiale)`)
    .join(' · ');
  el.innerHTML = `Dati: ${src}. Elenco aree generato il ${fmtDate(state.data?.areasGeneratedAt)} (fonte: ${esc(state.data?.areasSource)}). ` +
    `Fonte ufficiale nazionale per verifica: <a href="https://www.piattaformaunicanazionale.it/" target="_blank" rel="noopener">Piattaforma Unica Nazionale (MASE/GSE)</a>.`;
}

// ---------- Dati ----------
async function loadData() {
  try {
    const r = await fetch('/api/stations', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.data = await r.json();
    state.data.offline = r.headers.get('X-From-SW-Cache') === '1';
    buildMarkers();
    renderSources();
    renderList();
  } catch (err) {
    const st = $('#status');
    st.classList.add('error');
    st.textContent = `Impossibile caricare i dati (${err.message}). Riprova più tardi.`;
  }
}

// ---------- Geolocalizzazione ----------
let watchId = null;
function startLocation() {
  if (!('geolocation' in navigator)) {
    $('#locate-label').textContent = 'Posizione non supportata';
    return;
  }
  $('#locate-label').textContent = 'Ricerca…';
  let first = true;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lon, accuracy, heading, speed } = pos.coords;
      state.position = { lat, lon, accuracy, heading, speed };
      $('#locate-label').textContent = `±${Math.round(accuracy)} m`;
      if (!hasMap) {
        // nessuna mappa
      } else if (!userMarker) {
        userMarker = L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map).bindTooltip('Tu sei qui');
        userCircle = L.circle([lat, lon], { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.1 }).addTo(map);
      } else {
        userMarker.setLatLng([lat, lon]);
        userCircle.setLatLng([lat, lon]).setRadius(accuracy);
      }
      if (first) {
        map.setView([lat, lon], 10);
        first = false;
      }
      const sug = directionFromHeading(heading, speed);
      const hint = $('#heading-hint');
      if (sug && state.filters.direction === 'all') {
        hint.hidden = false;
        hint.innerHTML = `Sembri in marcia ${sug === 'trieste' ? 'verso est (Trieste)' : 'verso ovest (Torino)'}. <button type="button" class="btn btn-ghost" data-apply="${sug}">Mostra solo questa direzione</button>`;
      } else hint.hidden = true;
      renderList();
    },
    (err) => {
      const msg = { 1: 'Permesso negato', 2: 'Posizione non disponibile', 3: 'Timeout' }[err.code] || 'Errore';
      $('#locate-label').textContent = msg;
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
}

$('#locate').addEventListener('click', () => {
  if (watchId == null) startLocation();
  else if (state.position) map.setView([state.position.lat, state.position.lon], 11);
});

$('#heading-hint').addEventListener('click', (e) => {
  const b = e.target.closest('[data-apply]');
  if (b) setDirection(b.dataset.apply);
});

// ---------- Filtri ----------
function setDirection(dir) {
  state.filters.direction = dir;
  document.querySelectorAll('.seg [data-dir]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dir === dir)));
  $('#heading-hint').hidden = true;
  renderList();
}
document.querySelectorAll('.seg [data-dir]').forEach((b) => b.addEventListener('click', () => setDirection(b.dataset.dir)));
$('#f-power').addEventListener('change', (e) => { state.filters.minPowerKW = Number(e.target.value); renderList(); });
$('#f-conn').addEventListener('change', (e) => { state.filters.connector = e.target.value; renderList(); });
$('#f-op').addEventListener('change', (e) => { state.filters.onlyOperational = e.target.checked; renderList(); });

// ---------- Avvio ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
loadData();
// La posizione si richiede subito se il permesso è già stato concesso, altrimenti su tocco del pulsante.
navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') startLocation(); }).catch(() => {});
