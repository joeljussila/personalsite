/* The globe on /map.html.

   An orthographic projection drawn to a <canvas>: no mapping library, no API
   key, no tile server, nothing that can start charging money. Country
   outlines come from places/world.json, the marks from places/places.json.

   Drag it to turn it. Hover or click a mark to name it. map.js drives the
   list beside it through the small API at the bottom of this file.

   The look is the atlas plate from the design: paper sea under a 45 degree
   ink hatch, paper land, ink coastlines, oxide marks. */
(function () {
  "use strict";

  var STYLE = {
    sea: "#EFE9DA",
    seaHatch: ["#1C3468", 0.30, 4, 45],   // colour, alpha, gap, angle
    land: "#EFE9DA",
    coast: "#1C3468",
    coastW: 0.65,
    graticule: "rgba(28,52,104,0.18)",
    ring: "#1C3468",
    ringW: 1.1,
    mark: "#8A3B2A",
    markR: 2,
    markLitR: 3.4,
    label: "#1C3468",
    labelHalo: "#EFE9DA"
  };

  var RAD = Math.PI / 180;
  var MAX_TILT = 78;          // north stays up; the globe never rolls over a pole
  var HIT_RADIUS = 15;

  var canvas = document.getElementById("globe");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var GEO = [];
  var GRATICULE = [];
  var PLACES = [];
  var loaded = false;

  var size = 0, cx = 0, cy = 0, radius = 0;
  var hatch = null;

  var clon = parseFloat(canvas.getAttribute("data-lon") || "12");
  var clat = parseFloat(canvas.getAttribute("data-lat") || "24");
  var r00, r01, r02, r10, r11, r12, r20, r21, r22;

  var dragging = false, moved = 0, lastX = 0, lastY = 0;
  var vlon = 0, vlat = 0;
  var hovered = -1, selected = -1;
  var glideStep = 0, glideSteps = 0, glideFrom = [0, 0], glideDelta = [0, 0];
  var dirty = true, frameQueued = false;
  var listeners = [];

  function setOrientation() {
    var l = clon * RAD, p = clat * RAD;
    var sinL = Math.sin(l), cosL = Math.cos(l);
    var sinP = Math.sin(p), cosP = Math.cos(p);
    r00 = -sinL;        r01 = cosL;         r02 = 0;      // east
    r10 = -sinP * cosL; r11 = -sinP * sinL; r12 = cosP;   // north
    r20 = cosP * cosL;  r21 = cosP * sinL;  r22 = sinP;   // toward the viewer
  }

  /* ---- geometry, converted once --------------------------------------
     Every coastline point becomes a unit vector at load. Those vectors never
     change, only the orientation does, so the trigonometry is paid for once
     instead of on every frame. */

  function toVectors(flat) {
    var n = flat.length / 2, v = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var l = flat[i * 2] * RAD, p = flat[i * 2 + 1] * RAD, cp = Math.cos(p);
      v[i * 3] = cp * Math.cos(l);
      v[i * 3 + 1] = cp * Math.sin(l);
      v[i * 3 + 2] = Math.sin(p);
    }
    return v;
  }

  function buildWorld(world) {
    for (var i = 0; i < world.length; i++) {
      var rings = world[i].g, out = [];
      for (var j = 0; j < rings.length; j++) out.push(toVectors(rings[j]));
      GEO.push(out);
    }
  }

  function buildGraticule() {
    var lon, lat, points;
    for (lon = -180; lon < 180; lon += 30) {
      points = [];
      for (lat = -90; lat <= 90; lat += 3) points.push(lon, lat);
      GRATICULE.push(toVectors(points));
    }
    for (lat = -60; lat <= 60; lat += 30) {
      points = [];
      for (lon = -180; lon <= 180; lon += 3) points.push(lon, lat);
      GRATICULE.push(toVectors(points));
    }
  }

  function buildPlaces(list) {
    PLACES = list.map(function (p) {
      var a = p.lon * RAD, b = p.lat * RAD, cb = Math.cos(b);
      return {
        name: p.name, lat: p.lat, lon: p.lon, photos: p.photos || [],
        vx: cb * Math.cos(a), vy: cb * Math.sin(a), vz: Math.sin(b),
        sx: 0, sy: 0, visible: false
      };
    });
  }

  /* ---- clipping -------------------------------------------------------
     Depth is a dot product, so it varies linearly along the straight line
     between two points: the horizon crossing solves exactly, no searching.
     Without this, shapes wrapping a pole fill the whole disc. */

  var runs = [], current = null, scratch = [0, 0];

  function edge(ax, ay, az, ad, bx, by, bz, bd) {
    var t = ad / (ad - bd);
    var x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    var len = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= len; y /= len; z /= len;
    scratch[0] = cx + radius * (x * r00 + y * r01 + z * r02);
    scratch[1] = cy - radius * (x * r10 + y * r11 + z * r12);
  }

  function clipRing(v) {
    runs.length = 0;
    current = null;
    var n = v.length / 3, last = (n - 1) * 3;
    var qx = v[last], qy = v[last + 1], qz = v[last + 2];
    var qd = qx * r20 + qy * r21 + qz * r22;

    for (var i = 0; i < n; i++) {
      var o = i * 3, x = v[o], y = v[o + 1], z = v[o + 2];
      var d = x * r20 + y * r21 + z * r22;
      if (d > 0) {
        if (qd <= 0) {
          edge(x, y, z, d, qx, qy, qz, qd);
          current = [scratch[0], scratch[1]];
          runs.push(current);
        }
        if (!current) { current = []; runs.push(current); }
        current.push(
          cx + radius * (x * r00 + y * r01 + z * r02),
          cy - radius * (x * r10 + y * r11 + z * r12)
        );
      } else if (qd > 0) {
        edge(qx, qy, qz, qd, x, y, z, d);
        if (current) current.push(scratch[0], scratch[1]);
        current = null;
      }
      qx = x; qy = y; qz = z; qd = d;
    }
    return runs;
  }

  function angleAt(x, y) { return Math.atan2(y - cy, x - cx); }

  function limbArc(from, to) {
    var delta = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    ctx.arc(cx, cy, radius, from, to, delta < 0);
  }

  /* ---- drawing -------------------------------------------------------- */

  function hatchPattern() {
    var colour = STYLE.seaHatch[0], alpha = STYLE.seaHatch[1];
    var gap = STYLE.seaHatch[2], angle = STYLE.seaHatch[3];
    var s = gap * 4, tile = document.createElement("canvas");
    tile.width = s; tile.height = s;
    var g = tile.getContext("2d");
    g.translate(s / 2, s / 2);
    g.rotate(angle * RAD);
    g.strokeStyle = colour;
    g.globalAlpha = alpha;
    g.lineWidth = 0.7;
    for (var i = -s; i <= s; i += gap) {
      g.beginPath(); g.moveTo(-s, i); g.lineTo(s, i); g.stroke();
    }
    return ctx.createPattern(tile, "repeat");
  }

  function drawGraticule() {
    ctx.beginPath();
    for (var g = 0; g < GRATICULE.length; g++) {
      var v = GRATICULE[g], n = v.length / 3, started = false;
      for (var i = 0; i < n; i++) {
        var o = i * 3, x = v[o], y = v[o + 1], z = v[o + 2];
        if (x * r20 + y * r21 + z * r22 < 0) { started = false; continue; }
        var sx = cx + radius * (x * r00 + y * r01 + z * r02);
        var sy = cy - radius * (x * r10 + y * r11 + z * r12);
        if (started) ctx.lineTo(sx, sy);
        else { ctx.moveTo(sx, sy); started = true; }
      }
    }
    ctx.strokeStyle = STYLE.graticule;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  function drawLabel(place) {
    ctx.font = "300 11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.16em";
    var text = place.name.toUpperCase();
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = STYLE.labelHalo;
    ctx.strokeText(text, place.sx, place.sy - 12);
    ctx.fillStyle = STYLE.label;
    ctx.fillText(text, place.sx, place.sy - 12);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  function draw() {
    if (!loaded || !size) return;
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = STYLE.sea;
    ctx.fill();
    if (hatch) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = hatch;
      ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    drawGraticule();

    for (var i = 0; i < GEO.length; i++) {
      var rings = GEO[i], clipped = [];
      for (var j = 0; j < rings.length; j++) {
        var parts = clipRing(rings[j]);
        if (parts.length) clipped.push(parts.slice());
      }
      if (!clipped.length) continue;

      ctx.beginPath();
      for (var c = 0; c < clipped.length; c++) {
        var ring = clipped[c];
        for (var k = 0; k < ring.length; k++) {
          var run = ring[k];
          if (k === 0) {
            ctx.moveTo(run[0], run[1]);
          } else {
            var previous = ring[k - 1];
            limbArc(
              angleAt(previous[previous.length - 2], previous[previous.length - 1]),
              angleAt(run[0], run[1])
            );
          }
          for (var m = 2; m < run.length; m += 2) ctx.lineTo(run[m], run[m + 1]);
        }
        if (ring.length > 1) {
          var tail = ring[ring.length - 1];
          limbArc(
            angleAt(tail[tail.length - 2], tail[tail.length - 1]),
            angleAt(ring[0][0], ring[0][1])
          );
        }
        ctx.closePath();
      }
      ctx.fillStyle = STYLE.land;
      ctx.fill("evenodd");

      // Stroke the coastlines only, never the horizon arcs that closed them.
      ctx.beginPath();
      for (var d = 0; d < clipped.length; d++) {
        var lines = clipped[d];
        for (var s = 0; s < lines.length; s++) {
          var line = lines[s];
          ctx.moveTo(line[0], line[1]);
          for (var t = 2; t < line.length; t += 2) ctx.lineTo(line[t], line[t + 1]);
        }
      }
      ctx.strokeStyle = STYLE.coast;
      ctx.lineWidth = STYLE.coastW;
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = STYLE.ring;
    ctx.lineWidth = STYLE.ringW;
    ctx.stroke();

    var label = -1;
    for (var q = 0; q < PLACES.length; q++) {
      var place = PLACES[q];
      var depth = place.vx * r20 + place.vy * r21 + place.vz * r22;
      place.visible = depth > 0.02;
      if (!place.visible) continue;
      place.sx = cx + radius * (place.vx * r00 + place.vy * r01 + place.vz * r02);
      place.sy = cy - radius * (place.vx * r10 + place.vy * r11 + place.vz * r12);

      var lit = q === hovered || q === selected;
      if (lit) label = q;
      ctx.beginPath();
      ctx.arc(place.sx, place.sy, lit ? STYLE.markLitR : STYLE.markR, 0, Math.PI * 2);
      ctx.fillStyle = STYLE.mark;
      ctx.fill();
    }

    // One label at a time, drawn last so nothing covers it.
    if (label >= 0) drawLabel(PLACES[label]);
  }

  /* ---- the loop -------------------------------------------------------
     Nothing is drawn unless something moved. A globe sitting still costs
     nothing, which is the point of not running an animation forever. */

  function invalidate() {
    dirty = true;
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
  }

  function frame() {
    frameQueued = false;

    if (glideSteps) {
      glideStep++;
      var eased = 1 - Math.pow(1 - glideStep / glideSteps, 3);
      clon = glideFrom[0] + glideDelta[0] * eased;
      clat = glideFrom[1] + glideDelta[1] * eased;
      if (glideStep >= glideSteps) glideSteps = 0;
      dirty = true;
    } else if (!dragging && (Math.abs(vlon) > 0.004 || Math.abs(vlat) > 0.004)) {
      clon += vlon;
      clat = Math.max(-MAX_TILT, Math.min(MAX_TILT, clat + vlat));
      vlon *= 0.90;
      vlat *= 0.90;
      dirty = true;
    }

    if (dirty) {
      dirty = false;
      setOrientation();
      draw();
    }

    if (glideSteps || (!dragging && (Math.abs(vlon) > 0.004 || Math.abs(vlat) > 0.004))) {
      frameQueued = true;
      requestAnimationFrame(frame);
    }
  }

  /* ---- sizing ---------------------------------------------------------
     The element's size stays the stylesheet's business. Only the backing
     store is set here, and it is set again whenever the box changes, so the
     globe is never a stretched raster of an older layout. */

  function resize() {
    var width = canvas.clientWidth;
    if (!width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = width;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = size / 2;
    cy = size / 2;
    radius = size / 2 - STYLE.ringW - 2;
    hatch = hatchPattern();
    invalidate();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }

  /* ---- interaction ---------------------------------------------------- */

  function hitTest(x, y) {
    var best = -1, bestDistance = HIT_RADIUS * HIT_RADIUS;
    for (var i = 0; i < PLACES.length; i++) {
      var place = PLACES[i];
      if (!place.visible) continue;
      var dx = place.sx - x, dy = place.sy - y;
      var distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return best;
  }

  function pointAt(ev) {
    var rect = canvas.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }

  canvas.addEventListener("pointerdown", function (ev) {
    if (!loaded) return;
    dragging = true;
    moved = 0;
    lastX = ev.clientX;
    lastY = ev.clientY;
    vlon = 0; vlat = 0;
    glideSteps = 0;
    canvas.classList.add("dragging");
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (!loaded) return;
    if (!dragging) {
      var point = pointAt(ev);
      var hit = hitTest(point[0], point[1]);
      if (hit !== hovered) {
        hovered = hit;
        canvas.classList.toggle("over-mark", hit >= 0);
        invalidate();
      }
      return;
    }
    var dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = ev.clientX;
    lastY = ev.clientY;
    vlon = -dx * 0.28;
    vlat = dy * 0.28;
    clon += vlon;
    clat = Math.max(-MAX_TILT, Math.min(MAX_TILT, clat + vlat));
    invalidate();
  });

  function endDrag(ev) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("dragging");
    if (moved < 6) {
      var point = pointAt(ev);
      var hit = hitTest(point[0], point[1]);
      if (hit >= 0) {
        api.focus(hit);
        listeners.forEach(function (fn) { fn(hit, PLACES[hit]); });
      }
    } else {
      invalidate();
    }
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", function () {
    if (dragging || hovered === -1) return;
    hovered = -1;
    invalidate();
  });

  /* ---- the API map.js drives ------------------------------------------ */

  var api = {
    places: [],
    onSelect: function (fn) { listeners.push(fn); },
    hover: function (i) {
      if (hovered === i) return;
      hovered = i;
      invalidate();
    },
    clear: function () {
      selected = -1;
      invalidate();
    },
    // Turn to face a place, the short way round the world.
    focus: function (i) {
      var place = PLACES[i];
      if (!place) return;
      selected = i;
      vlon = 0; vlat = 0;
      var deltaLon = ((place.lon - clon + 540) % 360) - 180;
      var deltaLat = Math.max(-MAX_TILT, Math.min(MAX_TILT, place.lat)) - clat;
      if (reduced) {
        clon += deltaLon;
        clat += deltaLat;
        glideSteps = 0;
        invalidate();
        return;
      }
      glideFrom = [clon, clat];
      glideDelta = [deltaLon, deltaLat];
      glideStep = 0;
      glideSteps = 26;
      invalidate();
    }
  };
  window.Globe = api;

  /* The outlines and the place list are separate files so either can be
     edited, or regenerated by the photo importer, without touching this. */
  api.ready = Promise.all([
    fetch("/places/world.json").then(function (r) { return r.json(); }),
    fetch("/places/places.json").then(function (r) { return r.json(); })
  ]).then(function (data) {
    buildWorld(data[0]);
    buildGraticule();
    buildPlaces(data[1]);
    api.places = PLACES;
    loaded = true;
    resize();
    return PLACES;
  }).catch(function (error) {
    canvas.setAttribute("aria-label", "The map data could not be loaded.");
    console.error(error);
    return [];
  });
})();
