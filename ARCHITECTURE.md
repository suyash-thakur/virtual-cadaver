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

## Free dissection

In Explore, the tool strip has two tools: turn and scalpel. Dragging the scalpel paints a
`mask` vertex attribute on the skin, fat and fascia shells (the shader discards masked
fragments, picking ignores them); clicking any other structure removes it. Removal in the
guided dissection uses the same `lift` value as the old fold: the muscle fades out and
drifts off its bed rather than hinging, which read as broken. Every action pushes a closure
onto an undo stack. The section plane is a
single global clipping plane that always removes the half nearest the camera.

## Progress

`logic/progress.ts` is the student record (steps completed, spotter sessions with missed
ids, lesions viewed). It lives in localStorage, exports as JSON from the Help panel, and
`teacher.html` aggregates exported files with `classSummary`. A backend would store the
same JSON per account.

## Done and still open

Done: real meshes (bones, deep muscles, vessels), free cutting with undo, section plane,
spotter assessment with spaced repetition, progress export and teacher view, reference
images for every step, content and engine split with tests.

Open:

1. Photogrammetry of departmental prosections as the photo-real layer (needs a specimen
   and a camera rig; the content schema already takes a photo per step).
2. Accounts and a backend so progress syncs across devices and teachers do not collect
   files by hand.
3. More regions through the same content schema (`region` in `structures.json`): each
   needs an anatomist to author structures, steps, lesions and spotter metadata.
4. Mesh splitting for deep structures (today the scalpel cuts the skin layers freely but
   deep structures are reflected or removed whole).
