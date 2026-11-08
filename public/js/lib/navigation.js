// Deep link di navigazione, costruiti secondo la documentazione ufficiale:
// - Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
//   (azione "dir", parametri api=1, destination, travelmode, dir_action=navigate)
// - Waze Deep Links: https://developers.google.com/waze/deeplinks
//   (https://waze.com/ul?ll=lat,lon&navigate=yes)
// - Apple Maps unified URLs: https://developer.apple.com/documentation/mapkit/unified-map-urls
//   (https://maps.apple.com/directions?destination=...&mode=driving)

function coord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Coordinate non valide');
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function googleMapsUrl({ lat, lon }, origin) {
  const p = new URLSearchParams({ api: '1', destination: coord(lat, lon), travelmode: 'driving', dir_action: 'navigate' });
  if (origin) p.set('origin', coord(origin.lat, origin.lon));
  return `https://www.google.com/maps/dir/?${p}`;
}

export function wazeUrl({ lat, lon }) {
  const p = new URLSearchParams({ ll: coord(lat, lon), navigate: 'yes' });
  return `https://waze.com/ul?${p}`;
}

export function appleMapsUrl({ lat, lon }, origin) {
  const p = new URLSearchParams({ destination: coord(lat, lon), mode: 'driving' });
  if (origin) p.set('source', coord(origin.lat, origin.lon));
  return `https://maps.apple.com/directions?${p}`;
}
