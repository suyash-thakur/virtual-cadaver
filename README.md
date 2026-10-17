# Virtual cadaver

A layer-by-layer virtual dissection trainer for MBBS students. The first region is the
brachial plexus (right upper limb). Five modes: **Dissect** (13 steps in dissection-manual
order, each with a reference plate or prosection photo), **Explore** (free layer switching
plus free dissection: scalpel, forceps, remove, undo, and a section plane), **Trace** (fibres
by root value), **Lesion** (what a cut nerve paralyses and numbs) and **Spotter**
(pin-and-identify practice with spaced repetition, the practical-exam format).

Bones, deep muscles and vessels are real meshes from BodyParts3D; nerves are splines from
the content. Student progress is kept locally and can be exported; `teacher.html` builds a
class overview from exported files without any server.

## Run it

```sh
npm install
npm run assets     # once: downloads BodyParts3D (~200 MB cached) and writes public/assets/*.glb
npm run dev        # http://localhost:5173  (teacher view at /teacher.html)
npm test           # content validation + logic tests
npm run build      # type-check and production build into dist/
```

Without `npm run assets` the app still runs, drawing every structure procedurally.

Browsers without WebGL get a readable fallback lesson instead of a blank page.

## Layout

| Path | What lives there |
|---|---|
| `src/content/data/*.json` | All anatomy content: structures, dissection steps, views, lesions, muscles, skin map, photos. Versioned and validated. |
| `src/content/schema.ts` | Zod schema for every content file. `loadContent()` fails loudly on bad content. |
| `src/logic/` | Pure logic, no DOM or Three.js: fibre tracing, lesion propagation, dissection state, spotter sessions. Fully unit-tested. |
| `src/engine/` | Three.js: procedural geometry, body field (built in a Web Worker), materials, camera framing, label layout, picking. |
| `src/app/` | UI controller, panel HTML, 2D fallback. |
| `tools/extract-content.mjs` | One-off extractor that pulled the content out of the single-file prototype. |
| `tools/fetch-bodyparts3d.mjs` | Downloads BodyParts3D meshes for the region and converts them to glTF (`public/assets/`). |

## Editing content

Every structure, step and lesion is plain JSON. Run `npm test` after editing: the schema
and cross-reference checks catch unknown ids, missing views and malformed root values.

* Specimen images: `public/photos/` holds Gray's Anatomy plates (public domain) and
  prosection photographs by Anatomist90 (CC BY-SA 3.0, Wikimedia Commons); see
  `public/photos/ATTRIBUTION.txt`. Swap in your department's own prosection photos by
  editing `src/content/data/photos.json`.
* Map a step to NMC CBME competency codes with the `competencies` field in `steps.json`.

## Coordinate frames

Content paths are in **world space** (x mirrored so the right limb reads on the viewer's
left). `plate`, `sheet.bdir` and `views` are in **authoring space** (lateral, superior,
anterior) and the engine mirrors x when it builds them. See `src/engine/coords.ts`.

## Status

Real geometry covers all bones, 18 muscles and 13 vessels. Pectoralis major, deltoid and
latissimus dorsi stay procedural (they carry the reflection animation and BodyParts3D has
no usable latissimus), as do the skin layers and the nerves. See `ARCHITECTURE.md`.
