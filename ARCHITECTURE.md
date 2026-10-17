# Architecture

## Layers

```
content (JSON + zod)  →  logic (pure TS)  →  engine (Three.js)  →  app (DOM controller)
```

* **content** never imports anything else. `loadContent()` validates every file and links
  the nerve graph (`children`). Cross-reference errors name the offending id.
* **logic** depends only on content types. `trace`, `lesion`, `dissect` and `spotter` are
  pure functions and are what the tests cover. Anything a teacher might dispute about the
  anatomy (which muscles a lesion paralyses, which roots a nerve carries) lives here or in
  content, never in rendering code.
* **engine** turns content into meshes (`Specimen`), owns the camera (`CameraRig`), the
  label layout (`Labels`) and picking (`Picker`). The body surface (skin, superficial
  fascia, deep fascia) is an implicit surface built in a Web Worker
  (`geometry/body.worker.ts`) so the page stays responsive while it is meshed.
* **app** is one controller (`App`) plus HTML builders (`html.ts`). It holds the mode state
  and translates clicks into calls on logic and engine.

## Runtime structure records

`engine/registry.ts` defines `RT`, the per-structure runtime record: meshes, material,
coverage spheres for the body field, visibility (`cur` eases toward `target` every frame),
anchor point for the label, and fold state for reflected muscles.

## Dissection state

`logic/dissect.ts` computes the cumulative state after each step (peel fractions for the
three shells, incision progress, muscle fold angles, hidden ids). The app keeps a current
(`DP`) and target (`DT`) copy and eases between them; the hands-on mode blends between the
previous and next step's state as the student drags.

## Assets

`tools/fetch-bodyparts3d.mjs` downloads BodyParts3D (CC BY-SA 2.1 JP, DBCLS) and writes
`public/assets/<group>.glb` with one node per structure id. `engine/assets.ts` swaps the
procedural meshes for glTF meshes when the file is present, so the app runs with or
without assets. Nerves stay as splines from content: BodyParts3D has no plexus, and splines
give the trace and lesion modes their parameterised curves.

## Roadmap, in order

1. Real meshes for bones and vessels from BodyParts3D (pipeline in `tools/`).
2. Muscles from BodyParts3D where present; keep the fold animation by binding the
   reflected muscles to the procedural sheet while real geometry is static.
3. Photogrammetry of departmental prosections, one capture per dissection step, as the
   photo-real layer; the current shells become the fallback.
4. Real cutting: per-structure state (intact, incised, reflected, removed) with mesh
   splitting along the scalpel path, undo, and a sectional view.
5. Accounts, progress persistence and teacher dashboards; the Spotter Leitner box is
   already serialisable JSON and moves from localStorage to the backend unchanged.
6. More regions through the same content schema (`region` in `structures.json`).
