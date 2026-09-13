# Five design directions

Prototypes for a visual rebuild of the site. Nothing here ships — pick a
direction and it gets built properly into `index.html` and `places/index.html`.

Open [`/design/`](http://localhost:8781/design/) with the site served over
`http://` (the prototypes fetch the real place data, so `file://` will not
work).

```
index.html          the chooser
proto.js            shared engine: globe, places index, panel, blog, routing
d1-tide.html        indigo woodblock, hatched swell            cream / indigo
d2-cartograph.html  survey sheet, breathing contours           manila / Prussian
d3-grain.html       brutalist grid, crossfading grey blocks    black / white
d4-hachure.html     rare-book title page, engraved water       black / bone
d5-nocturne.html    the dark one, drifting indigo bloom        indigo / black
```

## What each prototype contains

All four surfaces of the real site, so a direction can be judged on how it
behaves rather than only on how it looks:

- **Home** — name, bio, the two doors, the elsewhere links
- **Places** — the globe with all 121 places and 83 photographs
- **Blog** — a dated index of placeholder posts
- **Post** — one piece opened, to show long-form typography

They are single files with an in-page router (`[data-view]` sections,
`[data-goto]` triggers). That is a prototyping convenience only; the real
site stays as separate static pages.

## proto.js

The shared engine. It carries the orthographic projection, hemisphere
clipping, limb-arc closing and drag behaviour lifted straight out of
`places/index.html`, so the mock-ups turn and clip exactly like the live page
instead of approximating it.

A direction restyles the globe entirely through CSS custom properties on the
canvas, plus one `data-globe-style` attribute:

| Property | What it colours |
| --- | --- |
| `--g-sea` | the disc behind the land |
| `--g-land` | land fill |
| `--g-edge` | coastlines, and the hatching in `hatch` style |
| `--g-grat` | graticule |
| `--g-rim` | the limb |
| `--g-mark` / `--g-mark-hi` | place marks, at rest and lit |
| `--g-label` / `--g-label-font` | the hovered place name |
| `--g-glow` / `--g-glow-alpha` | halo behind a mark, as `r,g,b` and a strength |
| `--g-hatch-gap` / `--g-hatch-angle` | hatching, in `hatch` style |
| `--g-mark-shape` | `dot`, `square` or `cross` |

`data-globe-style` is `fill` (solid land), `hatch` (land filled with ruled
lines) or `wire` (coastlines and a denser graticule, no fill).

`--g-glow-alpha` exists because a halo tuned for a dark ground reads as a
smear of dirt on paper. The light directions set it at or near zero.

## Backgrounds

Every texture is generated in code. None of the reference images are used or
redistributed — they were the brief, not the material.

They are built to be cheap enough to leave running. Three of the five paint
their texture once into an off-screen tile the width of the window and then
slide two copies of it past one another; the wave frequencies are snapped to
whole cycles across that width so the tile repeats without a seam. `d2` and
`d3` redraw on a timer instead, at twelve and ten frames a second, because
what they animate is geometry rather than position.

Two things learned the hard way and worth not relearning:

- Tiles are painted at 1x, not at device pixel ratio. Three retina-sized
  tiles exceed the page's canvas memory budget and the browser answers that
  by silently handing back canvases of zero size. Slight aliasing on a
  hairline reads as ink grain anyway.
- Every direction sets `visibility:hidden` on the closed detail panel rather
  than relying on `transform:translateX(101%)` alone. A transform by itself
  leaves the panel visible for any frame where the breakpoint has just
  changed and the transition has not caught up.

All of them honour `prefers-reduced-motion` by not starting the loop at all.

## Photographs

The brief was that the travel photographs looked pasted into the old
interface. Each direction duotones them into its own palette in the panel —
grey, multiplied onto the paper colour, then screened with the ink colour —
and releases them to full colour in the lightbox. The monochrome grid is what
makes opening one feel like something.

This is a CSS filter chain over the existing `.webp` files. No re-encoding,
no second set of assets.
