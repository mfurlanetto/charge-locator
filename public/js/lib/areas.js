// Logica pura per: riconoscere le aree di servizio A4 nei testi Open Charge Map (OCM),
// raggrupparle, associare le colonnine alle aree e normalizzare i dati OCM.

import { haversineM, centroid } from './geo.js';

// Bounding box del corridoio A4 Torino–Trieste (lat min, lon min, lat max, lon max).
export const A4_BBOX = { south: 44.95, west: 7.6, north: 45.95, east: 13.85 };

// Raggio entro cui una colonnina è considerata "dentro" l'area di servizio.
export const AREA_RADIUS_M = 350;

const A4_RE = /\bA\s?-?4\b(?![\d/])|serenissima|torino\s?-?\s?(trieste|milano)|venezia\s?-?\s?trieste|brescia\s?-?\s?padova/i;
const ADS_RE = /\ba\.?d\.?s\.?\b|aree? (di )?servizio|autogrill|service area|stazione di servizio/i;
const NAME_RE =
  /(?:\ba\.?d\.?s\.?|area (?:di )?servizio|service area|autogrill)\s+(?:(?:ip|q8|eni|tamoil|esso|api|agip|enilive|sarni)\s+)?([a-zà-ú'][a-zà-ú' ]{1,30}?)\s+(nord|sud|est|ovest)\b/i;
const NAME_FALLBACK_RE = /\bA\s?4\s+([a-zà-ú'][a-zà-ú' ]{1,30}?)\s+(nord|sud|est|ovest)\b/i;
const VERSO_RE = /verso\s+(trieste|venezia|torino|milano)|direzione\s+(trieste|venezia|torino|milano)/i;
const KM_RE = /\bA\s?4\b[^|]*?\bkm\.?\s*(\d{1,3}(?:[.,]\d{1,3})?)/i;

export function poiText(p) {
  const a = p.AddressInfo || {};
  return [a.Title, a.AddressLine1, a.AddressLine2, p.GeneralComments].filter(Boolean).join(' | ');
}

export function isA4ServiceAreaText(text) {
  return A4_RE.test(text) && ADS_RE.test(text);
}

function titleCase(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s'])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
}

/** Estrae { name, suffix } (es. "Brianza", "Nord") dal testo, o null. */
export function parseAreaName(text) {
  const m = text.match(NAME_RE) || text.match(NAME_FALLBACK_RE);
  if (!m) return null;
  const name = titleCase(m[1]).replace(/\s+(Direzione|Verso)$/i, '');
  return { name, suffix: titleCase(m[2]) };
}

/** Chiave di confronto: "Monte Alto" e "Montealto" coincidono. */
export function nameKey(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

/**
 * Direzione di marcia servita dall'area.
 * 1) se il testo dice esplicitamente "verso Trieste/Torino" la usa (fonte: OCM);
 * 2) altrimenti deduce dal suffisso secondo la convenzione osservata sulla A4
 *    nei dati OCM: Nord/Ovest = verso Torino, Sud/Est = verso Trieste (dedotta).
 */
export function parseDirection(texts, suffix) {
  for (const t of texts) {
    const m = t.match(VERSO_RE);
    if (m) {
      const city = (m[1] || m[2]).toLowerCase();
      return { value: city === 'trieste' || city === 'venezia' ? 'trieste' : 'torino', inferred: false };
    }
  }
  if (suffix) {
    const s = suffix.toLowerCase();
    if (s === 'nord' || s === 'ovest') return { value: 'torino', inferred: true };
    if (s === 'sud' || s === 'est') return { value: 'trieste', inferred: true };
  }
  return { value: null, inferred: true };
}

export function parseKm(text) {
  const m = text.match(KM_RE);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * Costruisce l'elenco delle aree di servizio A4 a partire dai POI OCM.
 * Semi: POI che citano esplicitamente la A4 e un'area di servizio.
 * Estensione: POI con lo stesso nome di area (es. "Villarboit Sud") entro 3 km da un seme.
 */
export function buildAreasFromOcm(pois) {
  const named = [];
  for (const p of pois) {
    const a = p.AddressInfo;
    if (!a || !Number.isFinite(a.Latitude) || !Number.isFinite(a.Longitude)) continue;
    const text = poiText(p);
    const parsed = parseAreaName(text);
    named.push({ p, text, parsed, lat: a.Latitude, lon: a.Longitude, seed: isA4ServiceAreaText(text) });
  }
  const seeds = named.filter((n) => n.seed && n.parsed);
  const seedNameKeys = new Set(seeds.map((s) => nameKey(s.parsed.name)));
  const members = named.filter(
    (n) =>
      n.parsed &&
      seedNameKeys.has(nameKey(n.parsed.name)) &&
      (n.seed || seeds.some((s) => nameKey(s.parsed.name) === nameKey(n.parsed.name) && haversineM(s.lat, s.lon, n.lat, n.lon) < 3000)),
  );

  const groups = new Map();
  for (const m of members) {
    const key = `${nameKey(m.parsed.name)}-${m.parsed.suffix.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const areas = [];
  for (const [key, list] of groups) {
    const c = centroid(list);
    const { name, suffix } = list[0].parsed;
    const texts = list.map((l) => l.text);
    const dir = parseDirection(texts, suffix);
    const km = texts.map(parseKm).find((k) => k != null) ?? null;
    areas.push({
      id: key,
      name: `${name} ${suffix}`,
      direction: dir.value,
      directionInferred: dir.inferred,
      km,
      lat: Number(c.lat.toFixed(6)),
      lon: Number(c.lon.toFixed(6)),
      source: 'ocm-text',
      sourceIds: list.map((l) => l.p.ID).sort((x, y) => x - y),
    });
  }
  return mergeDuplicateAreas(areas).sort((x, y) => x.lon - y.lon);
}

/**
 * Unisce aree con stesso nome, stessa direzione ed entro 300 m: in OCM la stessa area
 * compare talvolta con suffissi diversi (es. "Limenella Nord" e "Limenella Ovest").
 * Prevale il nome dell'area con direzione esplicita (non dedotta).
 */
export function mergeDuplicateAreas(areas, maxM = 300) {
  const out = [];
  for (const a of [...areas].sort((x, y) => Number(x.directionInferred) - Number(y.directionInferred))) {
    const twin = out.find(
      (o) =>
        nameKey(o.name.replace(/\s+(Nord|Sud|Est|Ovest)$/, '')) === nameKey(a.name.replace(/\s+(Nord|Sud|Est|Ovest)$/, '')) &&
        o.direction && o.direction === a.direction &&
        haversineM(o.lat, o.lon, a.lat, a.lon) <= maxM,
    );
    if (!twin) {
      out.push({ ...a, aliases: [] });
      continue;
    }
    const n = twin.sourceIds.length;
    const m = a.sourceIds.length;
    twin.lat = Number(((twin.lat * n + a.lat * m) / (n + m)).toFixed(6));
    twin.lon = Number(((twin.lon * n + a.lon * m) / (n + m)).toFixed(6));
    twin.sourceIds = [...twin.sourceIds, ...a.sourceIds].sort((x, y) => x - y);
    twin.aliases.push(a.name);
    twin.aliasIds = [...(twin.aliasIds || []), a.id];
    twin.km ??= a.km;
  }
  return out;
}

/**
 * Associa ogni POI all'area più vicina entro AREA_RADIUS_M.
 * Se il POI cita per nome un'area esistente entro il raggio, quel nome ha la precedenza
 * (le due carreggiate distano spesso meno di 200 m).
 */
export function assignPoisToAreas(pois, areas, radiusM = AREA_RADIUS_M) {
  const byArea = new Map(areas.map((a) => [a.id, []]));
  for (const p of pois) {
    const a = p.AddressInfo;
    if (!a || !Number.isFinite(a.Latitude)) continue;
    const near = areas
      .map((ar) => ({ ar, d: haversineM(ar.lat, ar.lon, a.Latitude, a.Longitude) }))
      .filter((x) => x.d <= radiusM)
      .sort((x, y) => x.d - y.d);
    if (!near.length) continue;
    const parsed = parseAreaName(poiText(p));
    let chosen = near[0];
    if (parsed) {
      const want = `${nameKey(parsed.name)}-${parsed.suffix.toLowerCase()}`;
      chosen = near.find((x) => x.ar.id === want || x.ar.aliasIds?.includes(want)) || chosen;
    }
    byArea.get(chosen.ar.id).push({ poi: p, distanceM: Math.round(chosen.d) });
  }
  return byArea;
}

/** Normalizza un POI OCM (risposta compact=true) usando i dati di riferimento OCM. */
export function normalizePoi(p, ref) {
  const lookup = (list, id) => (id == null ? null : list.get(id) ?? null);
  const status = lookup(ref.statusTypes, p.StatusTypeID);
  const connections = (p.Connections || []).map((c) => {
    const cs = lookup(ref.statusTypes, c.StatusTypeID);
    return {
      type: lookup(ref.connectionTypes, c.ConnectionTypeID)?.title ?? 'Sconosciuto',
      current: lookup(ref.currentTypes, c.CurrentTypeID)?.title ?? null,
      powerKW: Number.isFinite(c.PowerKW) ? c.PowerKW : null,
      quantity: Number.isFinite(c.Quantity) ? c.Quantity : null,
      status: cs ? { id: c.StatusTypeID, title: cs.title, operational: cs.operational } : null,
    };
  });
  const maxPowerKW = connections.reduce((m, c) => (c.powerKW != null && c.powerKW > m ? c.powerKW : m), 0) || null;
  return {
    id: p.ID,
    title: p.AddressInfo?.Title ?? '',
    operator: lookup(ref.operators, p.OperatorID)?.title ?? null,
    operatorUrl: lookup(ref.operators, p.OperatorID)?.url ?? null,
    lat: p.AddressInfo?.Latitude,
    lon: p.AddressInfo?.Longitude,
    numberOfPoints: Number.isFinite(p.NumberOfPoints) ? p.NumberOfPoints : null,
    status: status ? { id: p.StatusTypeID, title: status.title, operational: status.operational } : null,
    // OCM: gli stati 10/20 sono "Automated Status"; tutti gli altri sono dichiarati da utenti/fornitori.
    statusIsLive: p.StatusTypeID === 10 || p.StatusTypeID === 20,
    dateLastStatusUpdate: p.DateLastStatusUpdate ?? null,
    dateLastVerified: p.DateLastVerified ?? null,
    usageCost: p.UsageCost ?? null,
    connections,
    maxPowerKW,
    // Attribuzione richiesta dai termini OCM: fornitore del dato e relativa licenza.
    dataProvider: ref.dataProviders ? lookup(ref.dataProviders, p.DataProviderID) : null,
    ocmUrl: `https://map.openchargemap.io/?id=${p.ID}`,
  };
}

/** Converte la risposta /v3/referencedata di OCM in mappe id -> {title,...}. */
export function buildRef(raw) {
  const m = (arr, f) => new Map((arr || []).map((x) => [x.ID, f(x)]));
  return {
    statusTypes: m(raw.StatusTypes, (x) => ({ title: x.Title, operational: x.IsOperational ?? null })),
    connectionTypes: m(raw.ConnectionTypes, (x) => ({ title: x.Title.trim() })),
    currentTypes: m(raw.CurrentTypes, (x) => ({ title: x.Title })),
    operators: m(raw.Operators, (x) => ({ title: x.Title, url: x.WebsiteURL || null })),
    dataProviders: m(raw.DataProviders, (x) => ({ title: x.Title, license: x.License || null, url: x.WebsiteURL || null })),
  };
}
