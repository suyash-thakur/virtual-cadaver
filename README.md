# Virtual cadaver

A layer-by-layer virtual dissection trainer for MBBS students. The first region is the
brachial plexus (right upper limb). Five modes: **Dissect** (13 steps in dissection-manual
order), **Explore** (free layer switching), **Trace** (fibres by root value), **Lesion**
(what a cut nerve paralyses and numbs) and **Spotter** (pin-and-identify practice with
spaced repetition, the practical-exam format).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # content validation + logic tests
npm run build      # type-check and production build into dist/
```

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

* Add a specimen photo for a step: put the image in `public/photos/` and reference it in
  `src/content/data/photos.json` under the step key.
* Map a step to NMC CBME competency codes with the `competencies` field in `steps.json`.

## Coordinate frames

Content paths are in **world space** (x mirrored so the right limb reads on the viewer's
left). `plate`, `sheet.bdir` and `views` are in **authoring space** (lateral, superior,
anterior) and the engine mirrors x when it builds them. See `src/engine/coords.ts`.

## Status

The engine still draws the specimen procedurally from hand-placed control points. The
asset pipeline in `tools/` is the path to real meshes; see `ARCHITECTURE.md` for the roadmap.
