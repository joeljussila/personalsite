// TopoJSON -> compact ring arrays. No dependencies: the topology format is
// quantized delta encoding, which is about 30 lines to undo.

const fs = require("fs");

const topo = JSON.parse(fs.readFileSync("world-110m.json", "utf8"));
const { scale, translate } = topo.transform;

// Decode every arc once: quantized deltas -> absolute lon/lat.
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map((d) => {
    x += d[0];
    y += d[1];
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

// A ring is a list of arc indices; negative means "walk that arc backwards".
function ring(indices) {
  const points = [];
  for (const index of indices) {
    const forward = index >= 0;
    const arc = arcs[forward ? index : ~index];
    const walked = forward ? arc : arc.slice().reverse();
    // Adjacent arcs share their joint point.
    for (let i = points.length ? 1 : 0; i < walked.length; i++) {
      points.push(walked[i]);
    }
  }
  return points;
}

const round = (n) => Math.round(n * 100) / 100;

function flatten(points) {
  const out = [];
  let lastLon = null;
  let lastLat = null;
  for (const [lon, lat] of points) {
    const a = round(lon);
    const b = round(lat);
    if (a === lastLon && b === lastLat) continue; // rounding created a duplicate
    out.push(a, b);
    lastLon = a;
    lastLat = b;
  }
  return out;
}

const countries = [];

for (const geometry of topo.objects.countries.geometries) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.arcs]
      : geometry.type === "MultiPolygon"
        ? geometry.arcs
        : [];

  const rings = [];
  for (const polygon of polygons) {
    for (const part of polygon) {
      const flat = flatten(ring(part));
      if (flat.length >= 8) rings.push(flat); // drop specks below 4 points
    }
  }

  if (rings.length) {
    countries.push({ n: geometry.properties.name, g: rings });
  }
}

const json = JSON.stringify(countries);
fs.writeFileSync("site/places/world.json", json);

const points = countries.reduce(
  (sum, c) => sum + c.g.reduce((s, r) => s + r.length / 2, 0),
  0,
);

console.log(
  `${countries.length} countries, ${points} points, ${(json.length / 1024).toFixed(1)} KB`,
);
