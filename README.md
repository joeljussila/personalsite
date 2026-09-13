# joeljussila.com

A personal page, a globe of the places I have been, and somewhere to write.
Plain HTML, CSS and JavaScript — no framework, no build step, no
dependencies. Open a file, edit it, push it.

## Layout

```
index.html            the front page
map.html              the globe, the place index and the detail panel
blog.html             the post index
posts/_template.html  copy this to start a post (not deployed)
site.css              the whole design system: type, palette, grounds
globe.js              the globe itself, drawn to a canvas
map.js                the index beside it and the panel a place opens into
ground.webp           the ink wash behind every page
favicon.svg           the tab icon
vercel.json           redirects and response headers Vercel applies at the edge
.vercelignore         files that live here but are not part of the deployment
_headers              the same headers for Cloudflare Pages (kept until cutover)
robots.txt            crawler rules, points at the sitemap
sitemap.xml           the three pages, for crawlers
places/
  places.json         the list of places  <- edit this one
  world.json          country outlines, generated (see below)
  photos/             one to three photographs per place
design/               the prototype directions the current look came from
```

`vercel.json` sets HSTS, a content security policy, and the rest of the usual
hardening. Nothing on the site is inline any more — the styles are in
`site.css` and the globe in `globe.js` — so the policy refuses inline script
and style outright. Two consequences: never put a `<style>` block or an
`onclick` in a page, and if you add a script or a stylesheet from a new
domain, add it to the policy too or the browser will refuse to load it.

## Editing

**Text and links** live in `index.html`, in plain sight in the middle.

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

**Posts.** Copy `posts/_template.html` to `posts/<slug>.html`, fill in the
head and the body, add a row to `blog.html` and a `<url>` to `sitemap.xml`.
The template is excluded in `.vercelignore`; your posts are not, so nothing
else needs doing. While `blog.html` has no rows it says so, which is better
than three placeholder titles that go nowhere.

**Colours** are the three CSS variables at the top of `site.css`:

| Variable | Value | Used for |
| --- | --- | --- |
| `--paper` | `#EFE9DA` | page background, land, the sea under the hatch |
| `--ink` | `#1C3468` | type, coastlines, the graticule |
| `--oxide` | `#8A3B2A` | the marks on the globe, and hover |

The ground is one image, `ground.webp`, placed differently on each page by
`.g-home` / `.g-map` / `.g-blog` / `.g-post`; the mobile breakpoint moves each
into a different corner. It is flattened onto the paper colour rather than
kept transparent, which is why it is 53 KB instead of 760 KB — the page
behind it is always paper, so the result is pixel for pixel the same.

**Type** is EB Garamond 400/500 with its italics for everything you read, and
IBM Plex Mono 300 for the folio, the small caps and the place labels only.

## The globe

Roughly 400 lines of plain JavaScript in `globe.js`, drawing to a `<canvas>`.
No mapping library, no API key, no tile server, nothing that can start
charging money.

It uses an orthographic projection: each country outline is stored as unit
vectors, rotated by the current orientation, and drawn if it faces the viewer.
Coastlines that cross the edge of the disc are cut exactly at the horizon and
closed along it — without that, shapes wrapping a pole (Antarctica, in
particular) fill the whole disc and the sea turns beige.

The trigonometry runs once at load rather than every frame, which is what
keeps it smooth with a hundred-odd marks on screen. Nothing is drawn at all
unless something moved: dragging, gliding to a place and hovering a mark each
ask for a frame, and the loop stops as soon as the globe comes to rest.

North is deliberately locked upright: the tilt stops at 78°, so the globe can
never roll over a pole and come back upside down.

`map.js` drives it from the list through a small API — `Globe.focus(i)`,
`Globe.hover(i)`, `Globe.clear()` and `Globe.onSelect(fn)`. Clicking a place
in the list turns the globe to face it; clicking a mark on the globe opens the
same panel and scrolls the list to it. Both write the place into the address
bar, so `/map.html#kyoto` opens Kyoto.

### Regenerating `world.json`

Only needed to change the level of detail. Source data is Natural Earth via
[world-atlas](https://github.com/topojson/world-atlas) (public domain).

```bash
curl -o world-110m.json https://unpkg.com/world-atlas@2.0.2/countries-110m.json
node convert.js
```

`convert.js` decodes the TopoJSON and rounds coordinates to two decimals
(~1 km), which is far finer than the globe can draw.

## Design directions

`design/` holds the five prototypes the current look was chosen from. They are
kept for reference and are not deployed. Serve the site and open
http://localhost:8000/design/.

## Running it locally

Any static file server. The globe fetches its data, so opening `index.html`
straight off the disk will not work — it needs `http://`.

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Deploying

Vercel, connected to this repository. Framework preset **Other**, no build
command, output directory `.` — the files are the site. Every push to `main`
deploys; every other branch gets a preview URL.

Headers live in `vercel.json`. Vercel does not read `_headers` (that is a
Cloudflare Pages file), so the two have to be kept in step for as long as both
platforms are live. Once the domain is served by Vercel, delete `_headers`.

### Moving the domain

Cloudflare keeps the domain — it stays the registrar and the DNS — and only
the hosting moves.

1. Vercel → Settings → Domains, add `joeljussila.com` and
   `www.joeljussila.com`. It prints the records it wants.
2. In Cloudflare DNS, point the apex and `www` at those values: `www` as a
   CNAME to `cname.vercel-dns.com`, the apex as the A record Vercel gives
   (Cloudflare flattens a CNAME there too, if you would rather).
3. Set both records to **DNS only** — the grey cloud, not the orange one.
   Proxied records break Vercel's certificate check, and double-proxying
   through both Cloudflare and Vercel buys nothing.
4. Delete the Cloudflare Pages project once the certificate is issued and the
   site answers from Vercel, so a stale deployment cannot be reached.

Turning off the Cloudflare proxy also turns off the Cloudflare analytics
beacon. Vercel's own Web Analytics is the replacement: enable it in the
project and add `<script defer src="/_vercel/insights/script.js"></script>` to
each page. It is same-origin, so the content security policy already allows
it — which is why `cloudflareinsights.com` is no longer in the policy.
