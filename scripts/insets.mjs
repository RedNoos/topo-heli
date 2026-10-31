// Insets: far-away islands moved closer to the mainland at build time, as in an atlas (drawn
// in a dashed frame). Everything inside `box` (source lon/lat) is shifted by `shift` [dLon, dLat],
// so the game sees them as ordinary nearby islands. Used by build-map, build-places and
// build-physical; apply the shift to raw source data, before clipping to the map.

export const INSETS = {
  'new-zealand': [
    // The Chatham Islands lie ~800 km east of Christchurch, across the 180° meridian: moved to
    // ~170 km east of Banks Peninsula (lon -176.5 -> 176.0).
    { name: 'Chatham Islands', box: [-177.1, -44.5, -175.9, -43.55], shift: [352.5, 0] },
  ],
};

const inBox = (box, lon, lat) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];

/** The point, moved if it lies in one of the insets' boxes. */
export function shiftPoint(insets, lon, lat) {
  const inset = insets?.find((i) => inBox(i.box, lon, lat));
  return inset ? [lon + inset.shift[0], lat + inset.shift[1]] : [lon, lat];
}

/** Shifts a GeoJSON FeatureCollection in place (all geometry types). */
export function shiftGeoJSON(fc, insets) {
  if (!insets?.length) return fc;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      const [lon, lat] = shiftPoint(insets, c[0], c[1]);
      c[0] = lon;
      c[1] = lat;
    } else c.forEach(walk);
  };
  for (const f of fc.features ?? []) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  return fc;
}

/** Shifts an Overpass answer in place: node positions, way/member geometries and centers. */
export function shiftOsm(data, insets) {
  if (!insets?.length) return data;
  const pt = (p) => {
    if (!p || typeof p.lat !== 'number') return;
    [p.lon, p.lat] = shiftPoint(insets, p.lon, p.lat);
  };
  for (const el of data.elements ?? []) {
    pt(el);
    pt(el.center);
    el.geometry?.forEach(pt);
    for (const m of el.members ?? []) {
      pt(m);
      m.geometry?.forEach(pt);
    }
  }
  return data;
}

/** The frames to draw on the map: each inset's box after the shift (lon/lat). */
export const insetFrames = (insets) =>
  (insets ?? []).map((i) => ({ name: i.name, box: [i.box[0] + i.shift[0], i.box[1] + i.shift[1], i.box[2] + i.shift[0], i.box[3] + i.shift[1]] }));
