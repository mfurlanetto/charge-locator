#!/usr/bin/env node
// Genera data/a4-areas.json: elenco delle aree di servizio della A4 Torino–Trieste.
//
// Fonti:
//   --source=osm  OpenStreetMap via Overpass API: aree highway=services entro 400 m
//                 dalle carreggiate highway=motorway con ref A4. Dati ODbL.
//   --source=ocm  Open Charge Map: aree ricavate dai testi dei POI che citano A4 + area di servizio.
//                 Contiene solo le aree che in OCM hanno almeno una colonnina.
//   --source=auto (predefinito) prova OSM, se fallisce usa OCM.
//
// Variabili d'ambiente: OCM_API_KEY (obbligatoria per OCM), OVERPASS_URL (opzionale).

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A4_BBOX, buildAreasFromOcm, parseDirection, nameKey } from '../public/js/lib/areas.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../data/a4-areas.json');
const source = (process.argv.find((a) => a.startsWith('--source=')) || '--source=auto').split('=')[1];
const UA = 'charge-locator/0.1 (https://github.com/mfurlanetto/charge-locator)';

async function fromOcm() {
  const key = process.env.OCM_API_KEY;
  if (!key) throw new Error('OCM_API_KEY mancante');
  const b = A4_BBOX;
  const url =
    `https://api.openchargemap.io/v3/poi?countrycode=IT&boundingbox=(${b.south},${b.west}),(${b.north},${b.east})` +
    `&maxresults=10000&compact=true&verbose=false`;
  const r = await fetch(url, { headers: { 'X-API-Key': key, 'User-Agent': UA } });
  if (!r.ok) throw new Error(`OCM HTTP ${r.status}`);
  const pois = await r.json();
  return { areas: buildAreasFromOcm(pois), license: 'CC BY 4.0 – Open Charge Map contributors' };
}

async function fromOsm() {
  const endpoint = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  const b = A4_BBOX;
  const q = `[out:json][timeout:180];
way["highway"="motorway"]["ref"~"(^|;) ?A4( ?;|$)"](${b.south},${b.west},${b.north},${b.east})->.m;
nwr["highway"="services"](around.m:400);
out center tags;`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ data: q }),
  });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  const json = await r.json();
  const areas = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (!Number.isFinite(lat) || !name) continue;
    const sfx = name.match(/\b(nord|sud|est|ovest)\b/i)?.[1] ?? null;
    const dir = parseDirection([name, el.tags?.destination || '', el.tags?.description || ''], sfx);
    areas.push({
      id: `${nameKey(name)}-${el.type[0]}${el.id}`,
      name: name.replace(/^(area di servizio|a\.?d\.?s\.?)\s+/i, ''),
      direction: dir.value,
      directionInferred: dir.inferred,
      km: null,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      operatorFood: el.tags?.operator ?? null,
      source: 'osm',
      sourceIds: [`${el.type}/${el.id}`],
    });
  }
  if (areas.length < 10) throw new Error(`Overpass: solo ${areas.length} aree trovate, risultato sospetto`);
  return { areas: areas.sort((x, y) => x.lon - y.lon), license: 'ODbL – © OpenStreetMap contributors' };
}

let result;
let used = source;
if (source === 'osm') result = await fromOsm();
else if (source === 'ocm') result = await fromOcm();
else {
  try {
    result = await fromOsm();
    used = 'osm';
  } catch (e) {
    console.warn(`OSM non disponibile (${e.message}); uso OCM.`);
    result = await fromOcm();
    used = 'ocm';
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  source: used,
  license: result.license,
  bbox: A4_BBOX,
  count: result.areas.length,
  areas: result.areas,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Scritte ${out.count} aree (fonte: ${used}) in ${OUT}`);
