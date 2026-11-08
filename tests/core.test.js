import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { haversineM, formatDistance } from '../public/js/lib/geo.js';
import { googleMapsUrl, wazeUrl, appleMapsUrl } from '../public/js/lib/navigation.js';
import {
  parseAreaName, parseDirection, parseKm, isA4ServiceAreaText, buildAreasFromOcm, assignPoisToAreas, nameKey,
} from '../public/js/lib/areas.js';
import { filterArea, directionFromHeading, sortAreas, connectorMatches } from '../public/js/lib/filters.js';
import { buildPayload, fetchOcm } from '../server/stations.js';

const pois = JSON.parse(readFileSync(new URL('./fixtures/ocm-pois.json', import.meta.url)));
const ref = JSON.parse(readFileSync(new URL('./fixtures/ocm-ref.json', import.meta.url)));

test('haversine: Milano Duomo – Torino Porta Nuova ≈ 126 km', () => {
  const d = haversineM(45.4642, 9.19, 45.0621, 7.6785);
  assert.ok(d > 124000 && d < 128000, String(d));
  assert.equal(haversineM(45, 9, 45, 9), 0);
});

test('formatDistance', () => {
  assert.equal(formatDistance(850), '850 m');
  assert.equal(formatDistance(2345), '2,3 km');
  assert.equal(formatDistance(45678), '46 km');
});

test('deep link conformi alla documentazione ufficiale', () => {
  const dest = { lat: 45.5327, lon: 10.1503 };
  const g = new URL(googleMapsUrl(dest));
  assert.equal(g.origin + g.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(g.searchParams.get('api'), '1');
  assert.equal(g.searchParams.get('destination'), '45.532700,10.150300');
  assert.equal(g.searchParams.get('travelmode'), 'driving');
  assert.equal(g.searchParams.get('dir_action'), 'navigate');

  const w = new URL(wazeUrl(dest));
  assert.equal(w.origin + w.pathname, 'https://waze.com/ul');
  assert.equal(w.searchParams.get('ll'), '45.532700,10.150300');
  assert.equal(w.searchParams.get('navigate'), 'yes');

  const a = new URL(appleMapsUrl(dest, { lat: 45.4, lon: 9.1 }));
  assert.equal(a.origin + a.pathname, 'https://maps.apple.com/directions');
  assert.equal(a.searchParams.get('destination'), '45.532700,10.150300');
  assert.equal(a.searchParams.get('source'), '45.400000,9.100000');
  assert.equal(a.searchParams.get('mode'), 'driving');

  assert.throws(() => wazeUrl({ lat: NaN, lon: 1 }));
});

test('riconoscimento testi area di servizio A4', () => {
  assert.ok(isA4ServiceAreaText('Free To X AdS Brianza Nord | A4 km 374 (verso Torino)'));
  assert.ok(isA4ServiceAreaText('IPlanet ads IP Limenella Sud | Autostrada Serenissima'));
  assert.ok(!isA4ServiceAreaText('Tesla AdS Adda Nord | A35 Km 39'));
  assert.ok(!isA4ServiceAreaText('Free To X AdS Lario Est | A9 km 17'));
  assert.ok(!isA4ServiceAreaText('Conad Chiari | Via Vecchia per Castelcovati'));

  assert.deepEqual(parseAreaName('Free To X AdS Brianza Nord | A4 km 374'), { name: 'Brianza', suffix: 'Nord' });
  assert.deepEqual(parseAreaName('IPlanet ads IP Monte Alto Nord | x'), { name: 'Monte Alto', suffix: 'Nord' });
  assert.deepEqual(parseAreaName('A4 Fratta Sud Verso Trieste | AdS Fratta Sud'), { name: 'Fratta', suffix: 'Sud' });
  assert.equal(nameKey('Monte Alto'), nameKey('Montealto'));

  assert.deepEqual(parseDirection(['AdS Brianza Nord | A4 km 374 (verso Torino)'], 'Nord'), { value: 'torino', inferred: false });
  assert.deepEqual(parseDirection(['ads Tesina Sud direzione Venezia'], 'Sud'), { value: 'trieste', inferred: false });
  assert.deepEqual(parseDirection(['AdS Rho Sud'], 'Sud'), { value: 'trieste', inferred: true });
  assert.equal(parseKm('AdS Scaligera Nord | A4 km 176,200'), 176.2);
  assert.equal(parseKm('AdS Valtrompia Sud | A4'), null);
});

test('buildAreasFromOcm: esclude altre autostrade e unisce i doppioni', () => {
  const areas = buildAreasFromOcm(pois);
  const names = areas.map((a) => a.name);
  assert.ok(!names.some((n) => n.startsWith('Adda')), 'Adda è sulla A35');
  assert.ok(names.includes('Valtrompia Nord') && names.includes('Valtrompia Sud'));
  // Limenella Nord e Limenella Ovest: stessa carreggiata (verso Torino) → una sola area
  const lim = areas.filter((a) => a.name.startsWith('Limenella'));
  assert.equal(lim.length, 2);
  assert.equal(lim.filter((a) => a.direction === 'torino').length, 1);
});

test('assignPoisToAreas: carreggiate a 120 m assegnate per nome', () => {
  const areas = buildAreasFromOcm(pois);
  const byArea = assignPoisToAreas(pois, areas);
  const vn = byArea.get('valtrompia-nord').map((x) => x.poi.ID);
  const vs = byArea.get('valtrompia-sud').map((x) => x.poi.ID);
  assert.ok(vn.includes(193790) && !vn.includes(193789));
  assert.ok(vs.includes(193789) && !vs.includes(193790));
  // POI lontani da qualsiasi area A4 non vengono assegnati
  const all = [...byArea.values()].flat().map((x) => x.poi.ID);
  assert.ok(!all.includes(148831) && !all.includes(172981));
});

test('buildPayload: struttura, avviso e riepilogo', () => {
  const areasDoc = { generatedAt: '2026-11-07T00:00:00Z', source: 'ocm', areas: buildAreasFromOcm(pois) };
  const p = buildPayload({ areasDoc, pois, refRaw: ref, now: new Date('2026-11-08T00:00:00Z') });
  assert.equal(p.generatedAt, '2026-11-08T00:00:00.000Z');
  assert.match(p.notice, /NON è in tempo reale/);
  const vn = p.areas.find((a) => a.id === 'valtrompia-nord');
  assert.equal(vn.summary.operators[0], 'Free To X');
  assert.ok(vn.summary.maxPowerKW >= 50);
  const st = vn.stations[0];
  assert.ok(st.connections.length > 0);
  assert.equal(typeof st.statusIsLive, 'boolean');
  assert.equal(st.dataProvider?.title, 'Open Charge Map Contributors');
  assert.match(st.ocmUrl, /^https:\/\/map\.openchargemap\.io\/\?id=\d+$/);
});

test('buildPayload esclude POI rimossi o duplicati', () => {
  const areasDoc = { generatedAt: 'x', source: 'ocm', areas: buildAreasFromOcm(pois) };
  const removed = pois.map((p) => (p.ID === 193790 ? { ...p, StatusTypeID: 200 } : p));
  const p = buildPayload({ areasDoc, pois: removed, refRaw: ref });
  assert.ok(!p.areas.find((a) => a.id === 'valtrompia-nord').stations.some((s) => s.id === 193790));
});

test('filtri e ordinamento', () => {
  const area = {
    id: 'x', direction: 'trieste', lat: 45.5, lon: 10,
    stations: [
      { status: { operational: true }, connections: [{ type: 'CCS (Type 2)', powerKW: 300 }] },
      { status: { operational: false }, connections: [{ type: 'Type 2 (Socket Only)', powerKW: 22 }] },
    ],
  };
  assert.equal(filterArea(area, { direction: 'torino' }), null);
  assert.equal(filterArea(area, { minPowerKW: 150 }).stations.length, 1);
  assert.equal(filterArea(area, { connector: 'type 2' }).stations.length, 1);
  assert.equal(filterArea(area, { onlyOperational: true }).stations.length, 1);
  assert.equal(filterArea(area, { connector: 'chademo' }), null);
  assert.ok(connectorMatches('CCS (Type 2)', 'ccs'));
  assert.ok(!connectorMatches('CCS (Type 1)', 'ccs'));

  assert.equal(directionFromHeading(80, 25), 'trieste');
  assert.equal(directionFromHeading(260, 25), 'torino');
  assert.equal(directionFromHeading(5, 25), null);
  assert.equal(directionFromHeading(80, 2), null);

  const sorted = sortAreas([{ lat: 45.5, lon: 12 }, { lat: 45.5, lon: 9 }], { lat: 45.5, lon: 11.9 });
  assert.equal(sorted[0].lon, 12);
  assert.equal(sortAreas([{ lat: 45.5, lon: 12 }, { lat: 45.5, lon: 9 }], null)[0].lon, 9);
});

test('fetchOcm: invia la chiave in X-API-Key e segnala errori HTTP', async () => {
  const calls = [];
  const ok = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => (url.includes('referencedata') ? ref : pois) };
  };
  const r = await fetchOcm({ apiKey: 'k', fetchImpl: ok });
  assert.equal(r.pois.length, pois.length);
  assert.equal(calls[0].opts.headers['X-API-Key'], 'k');
  assert.match(calls[0].url, /boundingbox=\(44\.95,7\.6\),\(45\.95,13\.85\)/);
  await assert.rejects(fetchOcm({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});
