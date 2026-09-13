/* Shared prototype engine for the five design directions.
 *
 * Everything visual is read from CSS custom properties on the canvas, so a
 * direction changes how the globe looks by changing its stylesheet and
 * nothing else. The projection, clipping and interaction are lifted from
 * places/index.html so the mock-ups behave like the real page rather than
 * approximating it.
 *
 * Markup contract, all by data attribute:
 *   [data-view="home|places|blog|post"]   the surfaces, one visible at a time
 *   [data-goto="places"]                  anything that switches surface
 *   [data-proto="globe"]                  the canvas
 *   [data-proto="index"]                  <ul> the place list is built into
 *   [data-proto="count"]                  place count
 *   [data-proto="panel"] + panel-title / panel-coords / panel-frames / panel-close
 *   [data-proto="posts"]                  <ul> the blog index is built into
 *   [data-proto="post-title|post-date|post-body"]
 *   [data-proto="lightbox"] + lightbox-img / lightbox-caption
 */
(function (global) {
  "use strict";

  var RAD = Math.PI / 180;
  var DEGREE = String.fromCharCode(176);
  var reduced = global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- writing ------------------------------------------------------------
  //
  // Placeholder copy. Real enough in shape and length to judge a typeface and
  // a measure by, and clearly not finished writing.

  var BODY = [
    "The useful thing about a first principle is not that it is true. It is that it is small enough to hold in one hand while you turn it over. Most of what we call understanding is really familiarity, and familiarity is a poor substitute: it tells you where the switches are without ever telling you what the wiring does.",
    "I keep coming back to the same test. Can I rebuild this from the parts I already trust, or am I repeating a shape I saw somewhere and liked? The second one feels identical from the inside, which is what makes it dangerous.",
    "Sport taught me this before engineering did. You can copy a technique that works for somebody with different levers than yours and get slower for a year without ever knowing why. The correction is never more effort. It is going back down to the thing underneath the technique and asking what it was actually for.",
    "There is a version of this that becomes paralysis, and I want to be honest that I have spent time there. Deriving everything from scratch is its own way of avoiding the work. The point is not to distrust every abstraction. It is to know which ones you are standing on, so that when the ground moves you know which way to step.",
    "Which is roughly why I build things. A system you have opened is a system that can surprise you in useful ways instead of expensive ones."
  ];

  var POSTS = [
    {
      n: "03",
      date: "2026-08-27",
      title: "Everything is a system you are allowed to open",
      standfirst: "On the difference between knowing where the switches are and knowing what the wiring does.",
      read: "6 min"
    },
    {
      n: "02",
      date: "2026-07-09",
      title: "What eleven years of training actually taught me",
      standfirst: "Almost none of it was about the sport, and the part that was is the part I use least.",
      read: "9 min"
    },
    {
      n: "01",
      date: "2026-06-02",
      title: "Notes from the road, badly organised",
      standfirst: "Eighty-three places, one recurring mistake, and the case for going somewhere you cannot pronounce.",
      read: "4 min"
    }
  ];

  // ---- small helpers ------------------------------------------------------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function css(node, name, fallback) {
    var v = getComputedStyle(node).getPropertyValue(name).trim();
    return v || fallback;
  }

  // ---- the globe ----------------------------------------------------------

  function Globe(canvas, WORLD, PLACES, onOpen) {
    var ctx = canvas.getContext("2d");
    var style = canvas.getAttribute("data-globe-style") || "fill";

    var theme = {};
    function readTheme() {
      theme.sea = css(canvas, "--g-sea", "transparent");
      theme.land = css(canvas, "--g-land", "#d8d3c6");
      theme.edge = css(canvas, "--g-edge", "#8d8879");
      theme.grat = css(canvas, "--g-grat", "rgba(0,0,0,.07)");
      theme.rim = css(canvas, "--g-rim", "#8d8879");
      theme.mark = css(canvas, "--g-mark", "#1b2a63");
      theme.markHi = css(canvas, "--g-mark-hi", "#0f1a3d");
      theme.label = css(canvas, "--g-label", "#0f1a3d");
      theme.glow = css(canvas, "--g-glow", "27,42,99");
      theme.glowAlpha = parseFloat(css(canvas, "--g-glow-alpha", "0.18"));
      if (isNaN(theme.glowAlpha)) theme.glowAlpha = 0.18;
      theme.labelFont = css(canvas, "--g-label-font", "400 11px monospace");
      theme.hatchGap = parseFloat(css(canvas, "--g-hatch-gap", "3")) || 3;
      theme.hatchAngle = parseFloat(css(canvas, "--g-hatch-angle", "0")) || 0;
      theme.markShape = css(canvas, "--g-mark-shape", "dot");
    }
    readTheme();

    var radius = 240, cx = 0, cy = 0, size = 0;
    var dragging = false, moved = 0, lastX = 0, lastY = 0;
    var vlon = 0, vlat = 0, hovered = -1, selected = -1;
    var clon = 15, clat = 20;
    var MAX_TILT = 78;
    var idleSpin = 0.045; // the globe breathes when nobody is touching it
    var touched = false;

    var r00, r01, r02, r10, r11, r12, r20, r21, r22;

    function setOrientation() {
      var l = clon * RAD, p = clat * RAD;
      var sinL = Math.sin(l), cosL = Math.cos(l);
      var sinP = Math.sin(p), cosP = Math.cos(p);
      r00 = -sinL;        r01 = cosL;         r02 = 0;
      r10 = -sinP * cosL; r11 = -sinP * sinL; r12 = cosP;
      r20 = cosP * cosL;  r21 = cosP * sinL;  r22 = sinP;
    }

    // Coastline points become unit vectors once; only the orientation changes.
    var GEO = [];
    (function () {
      for (var i = 0; i < WORLD.length; i++) {
        var rings = WORLD[i].g, converted = [];
        for (var j = 0; j < rings.length; j++) {
          var flat = rings[j], count = flat.length / 2;
          var v = new Float32Array(count * 3);
          for (var k = 0; k < count; k++) {
            var l = flat[k * 2] * RAD, p = flat[k * 2 + 1] * RAD, cosP = Math.cos(p);
            v[k * 3] = cosP * Math.cos(l);
            v[k * 3 + 1] = cosP * Math.sin(l);
            v[k * 3 + 2] = Math.sin(p);
          }
          converted.push(v);
        }
        GEO.push(converted);
      }
    })();

    var GRATICULE = [];
    (function () {
      function line(points) {
        var v = new Float32Array(points.length / 2 * 3);
        for (var i = 0; i < points.length / 2; i++) {
          var l = points[i * 2] * RAD, p = points[i * 2 + 1] * RAD, cosP = Math.cos(p);
          v[i * 3] = cosP * Math.cos(l);
          v[i * 3 + 1] = cosP * Math.sin(l);
          v[i * 3 + 2] = Math.sin(p);
        }
        GRATICULE.push(v);
      }
      var lon, lat, points;
      var step = style === "wire" ? 15 : 30;
      for (lon = -180; lon < 180; lon += step) {
        points = [];
        for (lat = -90; lat <= 90; lat += 3) points.push(lon, lat);
        line(points);
      }
      for (lat = -75; lat <= 75; lat += step) {
        points = [];
        for (lon = -180; lon <= 180; lon += 3) points.push(lon, lat);
        line(points);
      }
    })();

    for (var pi = 0; pi < PLACES.length; pi++) {
      var pl = PLACES[pi];
      var pLon = pl.lon * RAD, pLat = pl.lat * RAD, pCos = Math.cos(pLat);
      pl.vx = pCos * Math.cos(pLon);
      pl.vy = pCos * Math.sin(pLon);
      pl.vz = Math.sin(pLat);
    }

    // ---- clipping to the visible hemisphere -------------------------------

    var runs = [], current = null, scratch = [0, 0];

    function edge(ax, ay, az, ad, bx, by, bz, bd, out) {
      var t = ad / (ad - bd);
      var x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      var len = Math.sqrt(x * x + y * y + z * z) || 1;
      x /= len; y /= len; z /= len;
      out[0] = cx + radius * (x * r00 + y * r01 + z * r02);
      out[1] = cy - radius * (x * r10 + y * r11 + z * r12);
    }

    function clipRing(v) {
      runs.length = 0; current = null;
      var count = v.length / 3, last = (count - 1) * 3;
      var px = v[last], py = v[last + 1], pz = v[last + 2];
      var pd = px * r20 + py * r21 + pz * r22;
      for (var i = 0; i < count; i++) {
        var o = i * 3, x = v[o], y = v[o + 1], z = v[o + 2];
        var d = x * r20 + y * r21 + z * r22;
        if (d > 0) {
          if (pd <= 0) {
            edge(x, y, z, d, px, py, pz, pd, scratch);
            current = [scratch[0], scratch[1]];
            runs.push(current);
          }
          if (!current) { current = []; runs.push(current); }
          current.push(
            cx + radius * (x * r00 + y * r01 + z * r02),
            cy - radius * (x * r10 + y * r11 + z * r12)
          );
        } else if (pd > 0) {
          edge(px, py, pz, pd, x, y, z, d, scratch);
          if (current) current.push(scratch[0], scratch[1]);
          current = null;
        }
        px = x; py = y; pz = z; pd = d;
      }
      return runs;
    }

    function angleAt(x, y) { return Math.atan2(y - cy, x - cx); }

    function limbArc(fromAngle, toAngle) {
      var delta = ((toAngle - fromAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      ctx.arc(cx, cy, radius, fromAngle, toAngle, delta < 0);
    }

    // ---- hatch pattern, built once ----------------------------------------

    var hatch = null;
    function buildHatch() {
      var gap = theme.hatchGap;
      var tile = document.createElement("canvas");
      tile.width = tile.height = Math.max(2, Math.round(gap * 2));
      var t = tile.getContext("2d");
      t.strokeStyle = theme.edge;
      t.lineWidth = 0.8;
      t.beginPath();
      for (var y = 0.5; y < tile.height; y += gap) { t.moveTo(0, y); t.lineTo(tile.width, y); }
      t.stroke();
      hatch = ctx.createPattern(tile, "repeat");
    }

    // ---- the marks --------------------------------------------------------

    var glowSize = 26, glowSprite = document.createElement("canvas");
    function buildGlow() {
      glowSprite.width = glowSprite.height = glowSize;
      var g = glowSprite.getContext("2d");
      var half = glowSize / 2;
      var grad = g.createRadialGradient(half, half, 0, half, half, half);
      grad.addColorStop(0, "rgba(" + theme.glow + "," + theme.glowAlpha + ")");
      grad.addColorStop(1, "rgba(" + theme.glow + ",0)");
      g.clearRect(0, 0, glowSize, glowSize);
      g.fillStyle = grad;
      g.fillRect(0, 0, glowSize, glowSize);
    }

    function drawGraticule() {
      ctx.beginPath();
      for (var g = 0; g < GRATICULE.length; g++) {
        var v = GRATICULE[g], count = v.length / 3, started = false;
        for (var i = 0; i < count; i++) {
          var o = i * 3, x = v[o], y = v[o + 1], z = v[o + 2];
          if (x * r20 + y * r21 + z * r22 < 0) { started = false; continue; }
          var sx = cx + radius * (x * r00 + y * r01 + z * r02);
          var sy = cy - radius * (x * r10 + y * r11 + z * r12);
          if (started) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); started = true; }
        }
      }
      ctx.strokeStyle = theme.grat;
      ctx.lineWidth = style === "wire" ? 0.6 : 0.8;
      ctx.stroke();
    }

    function landPath() {
      for (var i = 0; i < GEO.length; i++) {
        var rings = GEO[i], clipped = [];
        for (var j = 0; j < rings.length; j++) {
          var parts = clipRing(rings[j]);
          if (parts.length) clipped.push(parts.slice());
        }
        if (!clipped.length) continue;

        if (style !== "wire") {
          ctx.beginPath();
          for (var c = 0; c < clipped.length; c++) {
            var ring = clipped[c];
            for (var k = 0; k < ring.length; k++) {
              var run = ring[k];
              if (k === 0) ctx.moveTo(run[0], run[1]);
              else {
                var prev = ring[k - 1];
                limbArc(angleAt(prev[prev.length - 2], prev[prev.length - 1]), angleAt(run[0], run[1]));
              }
              for (var m = 2; m < run.length; m += 2) ctx.lineTo(run[m], run[m + 1]);
            }
            if (ring.length > 1) {
              var tail = ring[ring.length - 1];
              limbArc(angleAt(tail[tail.length - 2], tail[tail.length - 1]), angleAt(ring[0][0], ring[0][1]));
            }
            ctx.closePath();
          }
          if (style === "hatch") {
            ctx.save();
            ctx.clip("evenodd");
            ctx.fillStyle = theme.land;
            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
            if (hatch) {
              ctx.save();
              ctx.translate(cx, cy);
              ctx.rotate(theme.hatchAngle * RAD);
              ctx.fillStyle = hatch;
              ctx.fillRect(-radius * 1.5, -radius * 1.5, radius * 3, radius * 3);
              ctx.restore();
            }
            ctx.restore();
          } else {
            ctx.fillStyle = theme.land;
            ctx.fill("evenodd");
          }
        }

        // Coastlines only; never the horizon arcs that closed the shape.
        ctx.beginPath();
        for (var d = 0; d < clipped.length; d++) {
          var lines = clipped[d];
          for (var s = 0; s < lines.length; s++) {
            var line = lines[s];
            ctx.moveTo(line[0], line[1]);
            for (var t2 = 2; t2 < line.length; t2 += 2) ctx.lineTo(line[t2], line[t2 + 1]);
          }
        }
        ctx.strokeStyle = theme.edge;
        ctx.lineWidth = style === "wire" ? 0.75 : 0.6;
        ctx.stroke();
      }
    }

    function draw() {
      ctx.clearRect(0, 0, size, size);

      if (theme.sea && theme.sea !== "transparent") {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = theme.sea;
        ctx.fill();
      }

      drawGraticule();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      landPath();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = theme.rim;
      ctx.lineWidth = 1;
      ctx.stroke();

      var label = -1, half = glowSize / 2;

      for (var q = 0; q < PLACES.length; q++) {
        var place = PLACES[q];
        var depth = place.vx * r20 + place.vy * r21 + place.vz * r22;
        place.visible = depth > 0.02;
        if (!place.visible) continue;

        place.sx = cx + radius * (place.vx * r00 + place.vy * r01 + place.vz * r02);
        place.sy = cy - radius * (place.vx * r10 + place.vy * r11 + place.vz * r12);

        var lit = q === hovered || q === selected;
        if (lit) label = q;

        if (theme.glowAlpha > 0) ctx.drawImage(glowSprite, place.sx - half, place.sy - half);
        ctx.fillStyle = lit ? theme.markHi : theme.mark;

        if (theme.markShape === "square") {
          var s2 = lit ? 5 : 2.8;
          ctx.fillRect(place.sx - s2 / 2, place.sy - s2 / 2, s2, s2);
        } else if (theme.markShape === "cross") {
          var arm = lit ? 4.5 : 2.6;
          ctx.strokeStyle = lit ? theme.markHi : theme.mark;
          ctx.lineWidth = lit ? 1.2 : 0.9;
          ctx.beginPath();
          ctx.moveTo(place.sx - arm, place.sy); ctx.lineTo(place.sx + arm, place.sy);
          ctx.moveTo(place.sx, place.sy - arm); ctx.lineTo(place.sx, place.sy + arm);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(place.sx, place.sy, lit ? 3.4 : 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (label >= 0) {
        var chosen = PLACES[label];
        ctx.font = theme.labelFont;
        ctx.textAlign = "center";
        ctx.fillStyle = theme.label;
        ctx.fillText(chosen.name.toUpperCase(), chosen.sx, chosen.sy - 15);
      }
    }

    // ---- loop -------------------------------------------------------------

    var running = true;
    function tick() {
      if (!running) return;
      if (size <= 0) { requestAnimationFrame(tick); return; }
      if (!dragging) {
        if (Math.abs(vlon) > 0.004 || Math.abs(vlat) > 0.004) {
          clon += vlon;
          clat = Math.max(-MAX_TILT, Math.min(MAX_TILT, clat + vlat));
          vlon *= 0.90; vlat *= 0.90;
        } else if (!touched && !reduced && selected < 0) {
          clon += idleSpin;
        }
      }
      setOrientation();
      draw();
      requestAnimationFrame(tick);
    }

    function resize() {
      var holder = canvas.parentElement;
      if (!holder.clientWidth) return;
      var rect = holder.getBoundingClientRect();
      var available = Math.min(holder.clientWidth, rect.height || holder.clientWidth);
      size = Math.max(240, Math.min(760, available));
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = size + "px";
      canvas.style.height = size + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = size / 2; cy = size / 2; radius = size / 2 - 14;
      readTheme();
      buildHatch();
      buildGlow();
    }

    // ---- interaction ------------------------------------------------------

    function pointAt(ev) {
      var rect = canvas.getBoundingClientRect();
      return [ev.clientX - rect.left, ev.clientY - rect.top];
    }

    function hitTest(x, y) {
      var best = -1, bestDistance = 225;
      for (var i = 0; i < PLACES.length; i++) {
        var place = PLACES[i];
        if (!place.visible) continue;
        var dx = place.sx - x, dy = place.sy - y, distance = dx * dx + dy * dy;
        if (distance < bestDistance) { bestDistance = distance; best = i; }
      }
      return best;
    }

    canvas.addEventListener("pointerdown", function (ev) {
      dragging = true; touched = true; moved = 0;
      lastX = ev.clientX; lastY = ev.clientY;
      vlon = 0; vlat = 0;
      canvas.classList.add("dragging");
      canvas.setPointerCapture(ev.pointerId);
    });

    canvas.addEventListener("pointermove", function (ev) {
      if (!dragging) {
        var point = pointAt(ev);
        var hit = hitTest(point[0], point[1]);
        if (hit !== hovered) {
          hovered = hit;
          canvas.style.cursor = hit >= 0 ? "pointer" : "grab";
        }
        return;
      }
      var dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = ev.clientX; lastY = ev.clientY;
      vlon = -dx * 0.28; vlat = dy * 0.28;
      clon += vlon;
      clat = Math.max(-MAX_TILT, Math.min(MAX_TILT, clat + vlat));
    });

    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove("dragging");
      if (moved < 6) {
        var point = pointAt(ev);
        var hit = hitTest(point[0], point[1]);
        if (hit >= 0) onOpen(hit);
      }
    }

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    setOrientation();
    buildHatch();
    buildGlow();
    resize();
    tick();

    return {
      resize: resize,
      hover: function (i) { hovered = i; },
      select: function (i) {
        selected = i;
        touched = true;
        if (i < 0) return;
        var place = PLACES[i];
        var startLon = clon, startLat = clat;
        var deltaLon = ((place.lon - startLon + 540) % 360) - 180;
        var deltaLat = Math.max(-MAX_TILT, Math.min(MAX_TILT, place.lat)) - startLat;
        vlon = 0; vlat = 0;
        if (reduced) { clon = startLon + deltaLon; clat = startLat + deltaLat; return; }
        var steps = 26, step = 0;
        (function glide() {
          step++;
          var eased = 1 - Math.pow(1 - step / steps, 3);
          clon = startLon + deltaLon * eased;
          clat = startLat + deltaLat * eased;
          if (step < steps && !dragging) requestAnimationFrame(glide);
        })();
      }
    };
  }

  // ---- surfaces -----------------------------------------------------------

  function router(onEnter) {
    var views = $$("[data-view]");
    function go(name) {
      views.forEach(function (v) {
        var on = v.getAttribute("data-view") === name;
        v.hidden = !on;
      });
      document.documentElement.setAttribute("data-current-view", name);
      global.scrollTo(0, 0);
      if (onEnter) onEnter(name);
    }
    document.addEventListener("click", function (ev) {
      var trigger = ev.target.closest("[data-goto]");
      if (!trigger) return;
      ev.preventDefault();
      go(trigger.getAttribute("data-goto"));
    });
    go("home");
    return go;
  }

  // ---- boot ---------------------------------------------------------------

  function start(options) {
    options = options || {};
    var PREFIX = "../places/";

    var panel = $("[data-proto='panel']");
    var titleEl = $("[data-proto='panel-title']");
    var coordsEl = $("[data-proto='panel-coords']");
    var framesEl = $("[data-proto='panel-frames']");
    var indexList = $("[data-proto='index']");
    var canvas = $("[data-proto='globe']");

    var lightbox = $("[data-proto='lightbox']");
    var lightboxImg = $("[data-proto='lightbox-img']");
    var lightboxCap = $("[data-proto='lightbox-caption']");

    function format(value, positive, negative) {
      return Math.abs(value).toFixed(2) + DEGREE + " " + (value >= 0 ? positive : negative);
    }

    // ---- blog -------------------------------------------------------------

    var postsList = $("[data-proto='posts']");
    var postTitle = $("[data-proto='post-title']");
    var postDate = $("[data-proto='post-date']");
    var postBody = $("[data-proto='post-body']");
    var postStand = $("[data-proto='post-standfirst']");

    function openPost(i) {
      var post = POSTS[i];
      if (postTitle) postTitle.textContent = post.title;
      if (postStand) postStand.textContent = post.standfirst;
      if (postDate) postDate.textContent = post.date + "  /  " + post.read;
      if (postBody) {
        postBody.textContent = "";
        BODY.forEach(function (para) {
          var p = el("p");
          p.textContent = para;
          postBody.appendChild(p);
        });
      }
      go("post");
    }

    if (postsList) {
      POSTS.forEach(function (post, i) {
        var li = el("li", "post-row");
        var button = el("button");
        button.type = "button";
        button.innerHTML =
          '<span class="post-n">' + post.n + '</span>' +
          '<span class="post-main">' +
            '<span class="post-title">' + post.title + '</span>' +
            '<span class="post-stand">' + post.standfirst + '</span>' +
          '</span>' +
          '<span class="post-meta"><span class="post-date">' + post.date + '</span><span class="post-read">' + post.read + '</span></span>';
        button.addEventListener("click", function () { openPost(i); });
        li.appendChild(button);
        postsList.appendChild(li);
      });
    }

    // ---- lightbox ---------------------------------------------------------

    function openLightbox(src, name) {
      if (!lightbox) return;
      lightboxImg.src = src;
      lightboxImg.alt = name;
      if (lightboxCap) lightboxCap.textContent = name;
      lightbox.setAttribute("data-open", "true");
      lightbox.setAttribute("aria-hidden", "false");
    }

    function closeLightbox() {
      if (!lightbox) return;
      lightbox.setAttribute("data-open", "false");
      lightbox.setAttribute("aria-hidden", "true");
    }

    if (lightbox) {
      lightbox.addEventListener("click", closeLightbox);
    }

    // ---- router -----------------------------------------------------------

    var globe = null;
    var go = router(function (name) {
      if (name === "places" && globe) {
        requestAnimationFrame(function () { globe.resize(); });
      }
    });

    // ---- data -------------------------------------------------------------

    Promise.all([
      fetch(PREFIX + "world.json").then(function (r) { return r.json(); }),
      fetch(PREFIX + "places.json").then(function (r) { return r.json(); })
    ]).then(function (data) {
      var WORLD = data[0];
      var PLACES = data[1];

      function open(i) {
        var place = PLACES[i];
        titleEl.textContent = place.name;
        coordsEl.textContent = format(place.lat, "N", "S") + "  /  " + format(place.lon, "E", "W");

        framesEl.textContent = "";
        var count = place.photos.length || 1;
        for (var f = 0; f < count; f++) {
          var frame = el("div", "frame");
          if (place.photos[f]) {
            var src = PREFIX + place.photos[f];
            var img = el("img");
            img.src = src;
            img.alt = place.name;
            img.loading = "lazy";
            frame.appendChild(img);
            frame.setAttribute("role", "button");
            frame.setAttribute("tabindex", "0");
            (function (s) {
              frame.addEventListener("click", function () { openLightbox(s, place.name); });
              frame.addEventListener("keydown", function (ev) {
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openLightbox(s, place.name); }
              });
            })(src);
          } else {
            frame.className = "frame is-empty";
            frame.textContent = "Photograph pending";
          }
          framesEl.appendChild(frame);
        }

        panel.setAttribute("data-open", "true");
        panel.setAttribute("aria-hidden", "false");

        $$("button", indexList).forEach(function (b, bi) {
          b.setAttribute("aria-current", bi === i ? "true" : "false");
        });

        globe.select(i);
      }

      function close() {
        panel.setAttribute("data-open", "false");
        panel.setAttribute("aria-hidden", "true");
        globe.select(-1);
        $$("button", indexList).forEach(function (b) { b.setAttribute("aria-current", "false"); });
      }

      globe = Globe(canvas, WORLD, PLACES, open);

      PLACES.forEach(function (place, i) {
        var li = el("li");
        var button = el("button");
        button.type = "button";
        button.setAttribute("aria-current", "false");
        var n = el("span", "n");
        n.textContent = String(i + 1).padStart(3, "0");
        button.appendChild(n);
        button.appendChild(document.createTextNode(place.name));
        button.addEventListener("click", function () { open(i); });
        button.addEventListener("mouseenter", function () { globe.hover(i); });
        button.addEventListener("mouseleave", function () { globe.hover(-1); });
        li.appendChild(button);
        indexList.appendChild(li);
      });

      var countEl = $("[data-proto='count']");
      if (countEl) countEl.textContent = PLACES.length;
      $$("[data-proto='count-inline']").forEach(function (n) { n.textContent = PLACES.length; });

      var closeBtn = $("[data-proto='panel-close']");
      if (closeBtn) closeBtn.addEventListener("click", close);

      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape") return;
        if (lightbox && lightbox.getAttribute("data-open") === "true") closeLightbox();
        else close();
      });

      global.addEventListener("resize", function () { if (globe) globe.resize(); });
      document.documentElement.classList.add("ready");
    }).catch(function (error) {
      var holder = canvas && canvas.parentElement;
      if (holder) holder.textContent = "The map data could not be loaded.";
      console.error(error);
    });
  }

  global.Proto = { start: start, POSTS: POSTS };
})(window);
