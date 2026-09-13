/* The list beside the globe, and the panel a place opens into.

   globe.js owns the canvas and hands this file the places once they are
   loaded; this file owns the index, the detail panel and the address bar. */
(function () {
  "use strict";

  var indexEl = document.getElementById("index");
  var indexView = document.getElementById("index-view");
  var detail = document.getElementById("detail");
  var nameEl = document.getElementById("detail-name");
  var coordsEl = document.getElementById("detail-coords");
  var platesEl = document.getElementById("detail-plates");
  var closeEl = document.getElementById("detail-close");
  if (!indexEl || !window.Globe) return;

  var links = [];
  var places = [];
  var open = -1;

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function coordinates(lat, lon) {
    return Math.abs(lat).toFixed(2) + "° " + (lat >= 0 ? "N" : "S") + " / " +
           Math.abs(lon).toFixed(2) + "° " + (lon >= 0 ? "E" : "W");
  }

  function note(text) {
    var p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    return p;
  }

  function show(i, turnGlobe) {
    var place = places[i];
    if (!place) return;
    open = i;

    nameEl.textContent = place.name;
    coordsEl.textContent = coordinates(place.lat, place.lon);

    platesEl.textContent = "";
    var photos = place.photos || [];
    platesEl.setAttribute("data-count", photos.length);
    if (!photos.length) {
      platesEl.appendChild(note("Photographs for this place are not online yet."));
    }

    var missing = 0;
    photos.forEach(function (src) {
      var img = document.createElement("img");
      img.alt = place.name;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.remove();
        missing++;
        if (missing === photos.length && !platesEl.querySelector(".empty")) {
          platesEl.appendChild(note("Photographs for this place are not online yet."));
        }
      });
      img.src = "/places/" + src.replace(/^places\//, "");
      platesEl.appendChild(img);
    });

    detail.hidden = false;
    document.body.classList.add("detail-open");
    indexView.setAttribute("aria-hidden", "true");

    for (var k = 0; k < links.length; k++) {
      if (k === i) links[k].setAttribute("aria-current", "true");
      else links[k].removeAttribute("aria-current");
    }

    if (turnGlobe) window.Globe.focus(i);
    if (history.replaceState) history.replaceState(null, "", "#" + slug(place.name));
    closeEl.focus();
  }

  function close() {
    open = -1;
    detail.hidden = true;
    document.body.classList.remove("detail-open");
    indexView.removeAttribute("aria-hidden");
    for (var k = 0; k < links.length; k++) links[k].removeAttribute("aria-current");
    window.Globe.clear();
    if (history.replaceState) history.replaceState(null, "", location.pathname);
  }

  closeEl.addEventListener("click", function (ev) { ev.preventDefault(); close(); });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !detail.hidden) close();
  });

  // A mark clicked on the globe opens the same panel.
  window.Globe.onSelect(function (i) {
    show(i, false);
    if (links[i] && links[i].scrollIntoView) {
      links[i].scrollIntoView({ block: "nearest" });
    }
  });

  window.Globe.ready.then(function (list) {
    places = list;

    list.forEach(function (place, i) {
      var a = document.createElement("a");
      a.href = "#" + slug(place.name);
      a.textContent = place.name;
      a.addEventListener("click", function (ev) { ev.preventDefault(); show(i, true); });
      a.addEventListener("mouseenter", function () { window.Globe.hover(i); });
      a.addEventListener("mouseleave", function () { window.Globe.hover(-1); });
      links.push(a);
      indexEl.appendChild(a);
    });

    // A link straight to a place opens it.
    var wanted = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (wanted) {
      for (var i = 0; i < list.length; i++) {
        if (slug(list[i].name) === wanted) { show(i, true); break; }
      }
    }
  });
})();
