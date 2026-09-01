# joeljussila.com

A personal page and a globe of the places I have been. Plain HTML, CSS and
JavaScript — no framework, no build step, no dependencies. Open a file, edit
it, push it.

## Layout

```
index.html            the front page
favicon.svg           the tab icon
places/
  index.html          the globe page (markup, styles, and the globe itself)
  places.json         the list of places  <- edit this one
  world.json          country outlines, generated (see below)
```

## Editing

**Text and links** live in `index.html`, in plain sight near the bottom.

**Places** live in `places/places.json`, one per line:

```json
{"name":"Chamonix","lat":45.92,"lon":6.87,"photos":[]}
```

Add an entry and a mark appears on the globe. `photos` takes paths to image
files, one to three of them:

```json
{"name":"Chamonix","lat":45.92,"lon":6.87,"photos":["photos/chamonix-1.webp"]}
```

Coordinates are currently city centres, accurate enough to place a mark. They
will be replaced by the real GPS read out of the photographs.

**Colours** are CSS variables at the top of each page's `<style>` block:

| Variable | Value | Used for |
| --- | --- | --- |
| `--ground` | `#0A0908` | page background |
| `--ink` | `#E8CFA0` | headings, pins |
| `--ink-body` | `#DCC08E` | body text |
| `--ink-dim` | `#A78D63` | links at rest |
| `--ink-faint` | `#6B5A45` | labels, captions |
| `--land` | `#2A241C` | countries |
| `--land-edge` | `#453A2C` | borders |

## The globe

Roughly 400 lines of plain JavaScript drawing to a `<canvas>`. No mapping
library, no API key, no tile server, nothing that can start charging money.

It uses an orthographic projection: each country outline is stored as unit
vectors, rotated by the current orientation, and drawn if it faces the viewer.
Coastlines that cross the edge of the disc are cut exactly at the horizon and
closed along it — without that, shapes wrapping a pole (Antarctica, in
particular) fill the whole disc and the sea turns beige.

The trigonometry runs once at load rather than every frame, which is what
keeps it smooth with ninety-odd pins on screen.

North is deliberately locked upright: the tilt stops at 78°, so the globe can
never roll over a pole and come back upside down.

### Regenerating `world.json`

Only needed to change the level of detail. Source data is Natural Earth via
[world-atlas](https://github.com/topojson/world-atlas) (public domain).

```bash
curl -o world-110m.json https://unpkg.com/world-atlas@2.0.2/countries-110m.json
node convert.js
```

`convert.js` decodes the TopoJSON and rounds coordinates to two decimals
(~1 km), which is far finer than the globe can draw.

## Running it locally

Any static file server. The globe fetches its data, so opening `index.html`
straight off the disk will not work — it needs `http://`.

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Deploying

Cloudflare Pages, connected to this repository. No build command, no output
directory — the files are the site. Every push to `main` deploys.
