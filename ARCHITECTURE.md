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

## Body surface

With `assets/body.glb` present, `engine/body.ts` builds the three shells from the real
BodyParts3D skin: the skin itself, and inward offsets of 0.45 and 1.0 units for the
superficial and deep fascia. Each shell gets its own index buffer (BVH builds reorder the
index in place), peel order and trunk/arm weight from `peelAt`, a tone colour, the cut
mask and planar UVs for the procedural pore, lobule and fibre textures in
`engine/textures.ts`. Surface helpers (incisions, landmarks, superficial veins, platysma)
are placed by raycasting the real skin (`SkinProjector`) instead of marching the field.
The converter keeps only the outer wall of the integument (BodyParts3D models skin as a
closed double-walled solid), clips below the lower chest, caps the cut loops, and skins
the hanging right arm into the abducted pose. Without the asset, the implicit-surface
blob in the worker is still used.

## Visible Human section panel

`tools/fetch-visible-human.py` downloads cryosections 1180 to 1640 (chin to lower chest)
at 2 mm, writes axial JPEGs plus sagittal and coronal resamples, and a manifest with the
registration: the humeral head is slice 1300 and one world unit is 10.45 mm. In Explore,
`app/section.ts` maps the section plane position to a slice and the sheet shows it with a
caption. The match is approximate (different body, arms by the sides) and the caption
says so.

## Free dissection

Cutting is texture-space (`engine/cutmask.ts`). Each shell carries a mask atlas with three
world-space planar projections (X, Y, Z faces); a fragment picks the face by its dominant
normal and discards itself when the texel is marked removed. Texels also store the depth
along the projection axis so the front and back of the body never share a cut, and a
per-face depth map of the body (rendered once at startup) bounds flood fills to the
surface. The scalpel stamps incision lines (G channel, drawn as a dark groove); Lift
flood-fills the region of skin bounded by incision lines and marks it removed (R channel),
refusing when the region is unbounded; Lift also brushes fat and fascia away and removes
deeper structures with a click. Operations are logged per shell and undo replays the log.
The guided step 2 uses the same painting: the student draws the incisions freely and the
step completes when most guide points lie within 1.5 units of a stroke. Tool picks prefer
the skin shell when a muscle pokes just through it. Removal of a detached muscle in the
guided dissection fades it out and drifts it off its bed (`lift`), not a hinge. The section plane is a
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
   and a camera rig; the content schema already takes a photo per step). Until then the
   real BodyParts3D skin with procedural textures and the Visible Human sections stand in.
2. Accounts and a backend so progress syncs across devices and teachers do not collect
   files by hand.
3. More regions through the same content schema (`region` in `structures.json`): each
   needs an anatomist to author structures, steps, lesions and spotter metadata.
4. Mesh splitting for deep structures (today the scalpel cuts the skin layers freely but
   deep structures are reflected or removed whole).
