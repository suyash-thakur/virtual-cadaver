"""Runs inside Blender: exports selected Z-Anatomy objects as OBJ files in Blender's own frame.

    /Applications/Blender.app/Contents/MacOS/Blender -b tools/.zanatomy-cache/Z-Anatomy/Startup.blend \
        --python tools/zanatomy-export.py -- tools/.zanatomy-cache/obj

Objects are chosen by regular expression on their names (right side and unpaired objects only).
"""
import bpy, re, sys, os, json

out_dir = sys.argv[-1]
os.makedirs(out_dir, exist_ok=True)

PATTERNS = [
    r'^(Clavicular head|Sternocostal head|\(Abdominal part) of pectoralis major muscle\)?\.r$',
    r'^(Clavicular|Acromial|Scapular spinal) part of deltoid muscle\.r$',
    r'^Latissimus dorsi muscle\.r$', r'^Platysma\.r$', r'^Clavipectoral fascia\.r$',
    r'^(Pectoral|Deltoid|Brachial|Superficial investing cervical) fascia\.r$',
    r'^(Anterior|Posterior|Central|Lateral|Apical) axillary nodes\.r$',
    r'^Humerus\.r$', r'^Scapula\.r$', r'^Clavicle\.r$',
    r'^(Axillary|Subclavian|Brachial|Thoraco-?acromial|Lateral thoracic|Subscapular|Deep brachial|Anterior circumflex humeral|Posterior circumflex humeral) (artery|vein)\.r$',
    r'^(Cephalic|Basilic|External jugular) vein\.r$',
    r'^(Pectoralis minor|Serratus anterior|Subclavius|Coracobrachialis|Biceps brachii|Teres major|Teres minor|Supraspinatus|Infraspinatus|Subscapularis|Trapezius|Sternocleidomastoid|Omohyoid|Anterior scalene|Middle scalene|Brachialis|Triceps brachii)( muscle)?\.r$',
    r'^(Long|Lateral|Medial|Short) head of (triceps brachii|biceps brachii)( muscle)?\.r$',
    r'^(Descending|Transverse|Ascending) part of trapezius( muscle)?\.r$',
    r'^(Inferior|Superior) belly of omohyoid( muscle)?\.r$',
]
rx = [re.compile(p) for p in PATTERNS]
chosen = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices) > 2 and any(r.search(o.name) for r in rx)]
print('matched', len(chosen))
manifest = []
for o in chosen:
    for ob in bpy.data.objects: ob.select_set(False)  # operators need a 3D view context in background mode; the data API does not
    o.hide_set(False); o.hide_viewport = False; o.select_set(True); bpy.context.view_layer.objects.active = o
    assert sum(1 for ob in bpy.data.objects if ob.select_get()) == 1
    safe = re.sub(r'[^A-Za-z0-9]+', '_', o.name).strip('_')
    path = os.path.join(out_dir, safe + '.obj')
    bpy.ops.wm.obj_export(filepath=path, export_selected_objects=True, export_materials=False, export_triangulated_mesh=True,
                          apply_modifiers=True, export_normals=False, export_uv=False, forward_axis='Y', up_axis='Z', global_scale=1.0)
    manifest.append({'name': o.name, 'file': safe + '.obj', 'verts': len(o.data.vertices), 'collections': [c.name for c in o.users_collection]})
    print('exported', o.name)
json.dump(manifest, open(os.path.join(out_dir, 'manifest.json'), 'w'), indent=1)
print('done', len(manifest))
