// Filtri e ordinamento delle aree: logica pura.

import { haversineM } from './geo.js';

export function connectorMatches(type, wanted) {
  if (!wanted) return true;
  const t = (type || '').toLowerCase();
  if (wanted === 'ccs') return t.includes('ccs') && !t.includes('type 1');
  if (wanted === 'tesla') return t.includes('tesla') || t.includes('nacs');
  if (wanted === 'type 2') return t.startsWith('type 2');
  return t.includes(wanted);
}

/** Filtra le stazioni di un'area; restituisce null se l'area non ha stazioni che soddisfano i filtri. */
export function filterArea(area, { direction = 'all', minPowerKW = 0, connector = '', onlyOperational = false } = {}) {
  if (direction !== 'all' && area.direction && area.direction !== direction) return null;
  const stations = area.stations.filter((s) => {
    if (onlyOperational && s.status?.operational !== true) return false;
    return s.connections.some(
      (c) => (minPowerKW ? (c.powerKW ?? 0) >= minPowerKW : true) && connectorMatches(c.type, connector),
    );
  });
  if (!stations.length) return null;
  return { ...area, stations };
}

/**
 * Suggerisce la direzione di marcia dalla rotta GPS (gradi, 0 = nord).
 * La A4 corre complessivamente da ovest (Torino) a est (Trieste): una componente est
 * della rotta indica "verso Trieste". Restituisce null se la rotta è quasi nord/sud o assente.
 */
export function directionFromHeading(heading, speedMs) {
  if (!Number.isFinite(heading) || !Number.isFinite(speedMs) || speedMs < 8) return null;
  const east = Math.sin((heading * Math.PI) / 180);
  if (Math.abs(east) < 0.35) return null;
  return east > 0 ? 'trieste' : 'torino';
}

/** Ordina per distanza dall'utente; senza posizione ordina da Torino a Trieste. */
export function sortAreas(areas, position) {
  const withD = areas.map((a) => ({
    ...a,
    distanceM: position ? haversineM(position.lat, position.lon, a.lat, a.lon) : null,
  }));
  return withD.sort((x, y) => (position ? x.distanceM - y.distanceM : x.lon - y.lon));
}
