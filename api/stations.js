// Funzione serverless Vercel: GET /api/stations
// Restituisce le aree di servizio A4 con le colonnine associate (fonte: Open Charge Map).
// Richiede la variabile d'ambiente OCM_API_KEY (impostata nel progetto Vercel).

import { readFileSync } from 'node:fs';
import { fetchOcm, buildPayload } from '../server/stations.js';

const areasDoc = JSON.parse(readFileSync(new URL('../data/a4-areas.json', import.meta.url), 'utf8'));

// Cache in memoria dell'istanza (oltre alla cache CDN impostata con Cache-Control).
const TTL_MS = 30 * 60 * 1000;
let cache = { at: 0, body: null };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo non consentito' });
  }
  const apiKey = process.env.OCM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OCM_API_KEY non configurata sul server' });

  try {
    if (!cache.body || Date.now() - cache.at > TTL_MS) {
      const { pois, ref } = await fetchOcm({ apiKey });
      cache = { at: Date.now(), body: buildPayload({ areasDoc, pois, refRaw: ref }) };
    }
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(cache.body);
  } catch (err) {
    if (cache.body) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ ...cache.body, stale: true, staleReason: String(err.message || err) });
    }
    return res.status(502).json({ error: 'Fonte dati non raggiungibile', detail: String(err.message || err) });
  }
}
