// Logica della funzione /api/stations, separata dall'handler per poterla testare.

import { A4_BBOX, assignPoisToAreas, buildRef, normalizePoi } from '../public/js/lib/areas.js';

const OCM_BASE = 'https://api.openchargemap.io/v3';

export async function fetchOcm({ apiKey, fetchImpl = fetch }) {
  const headers = { 'X-API-Key': apiKey, 'User-Agent': 'charge-locator/0.1 (+https://github.com/mfurlanetto/charge-locator)' };
  const b = A4_BBOX;
  const poiUrl =
    `${OCM_BASE}/poi?countrycode=IT&boundingbox=(${b.south},${b.west}),(${b.north},${b.east})` +
    `&maxresults=10000&compact=true&verbose=false`;
  const [poiRes, refRes] = await Promise.all([
    fetchImpl(poiUrl, { headers }),
    fetchImpl(`${OCM_BASE}/referencedata?countryid=112`, { headers }),
  ]);
  if (!poiRes.ok) throw new Error(`OCM poi HTTP ${poiRes.status}`);
  if (!refRes.ok) throw new Error(`OCM referencedata HTTP ${refRes.status}`);
  return { pois: await poiRes.json(), ref: await refRes.json() };
}

function summarize(stations) {
  const connectors = new Map();
  const operators = new Set();
  const status = { operational: 0, notOperational: 0, unknown: 0, live: 0 };
  let points = 0;
  let maxPowerKW = 0;
  for (const s of stations) {
    if (s.operator && !s.operator.startsWith('(')) operators.add(s.operator);
    points += s.numberOfPoints ?? s.connections.reduce((n, c) => n + (c.quantity ?? 1), 0);
    if (s.maxPowerKW > maxPowerKW) maxPowerKW = s.maxPowerKW;
    if (s.statusIsLive) status.live++;
    if (s.status?.operational === true) status.operational++;
    else if (s.status?.operational === false) status.notOperational++;
    else status.unknown++;
    for (const c of s.connections) {
      const key = `${c.type}|${c.powerKW ?? '?'}`;
      const cur = connectors.get(key) || { type: c.type, current: c.current, powerKW: c.powerKW, quantity: 0 };
      cur.quantity += c.quantity ?? 1;
      connectors.set(key, cur);
    }
  }
  return {
    stations: stations.length,
    points,
    maxPowerKW: maxPowerKW || null,
    operators: [...operators].sort(),
    connectors: [...connectors.values()].sort((a, b) => (b.powerKW ?? 0) - (a.powerKW ?? 0)),
    status,
  };
}

export function buildPayload({ areasDoc, pois, refRaw, now = new Date() }) {
  const ref = buildRef(refRaw);
  // Escludi le colonnine rimosse/duplicate (OCM StatusType 200 e 210).
  const active = pois.filter((p) => p.StatusTypeID !== 200 && p.StatusTypeID !== 210);
  const byArea = assignPoisToAreas(active, areasDoc.areas);
  const areas = areasDoc.areas.map((a) => {
    const stations = (byArea.get(a.id) || [])
      .map(({ poi, distanceM }) => ({ ...normalizePoi(poi, ref), distanceFromAreaM: distanceM }))
      .sort((x, y) => (y.maxPowerKW ?? 0) - (x.maxPowerKW ?? 0));
    return { ...a, summary: summarize(stations), stations };
  });
  return {
    generatedAt: now.toISOString(),
    areasGeneratedAt: areasDoc.generatedAt,
    areasSource: areasDoc.source,
    sources: [
      { name: 'Open Charge Map', url: 'https://openchargemap.org', license: 'CC BY 4.0', official: false },
      areasDoc.source === 'osm'
        ? { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL', official: false }
        : null,
    ].filter(Boolean),
    notice:
      'Stato delle colonnine come dichiarato in Open Charge Map: salvo indicazione "automatico", NON è in tempo reale. ' +
      'Verificare la disponibilità nell\'app dell\'operatore.',
    areas,
  };
}
