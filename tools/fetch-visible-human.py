#!/usr/bin/env python3
"""Downloads Visible Human Male cryosections (NLM, public domain) for the neck, shoulder and
upper chest, and writes small JPEG slices in all three planes to public/vh/.

    python3 tools/fetch-visible-human.py            # 1180..1640 at 2 mm, about 800 MB cached
    python3 tools/fetch-visible-human.py --step 4   # coarser, quicker

Axial slices come straight from the PNGs. Sagittal and coronal images are resampled from
the stack. The manifest records the registration used by the app (see src/app/section.ts).
"""
import argparse, io, json, os, sys, urllib.request
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
CACHE = HERE / '.vh-cache'
OUT = HERE.parent / 'public' / 'vh'
BASE = 'https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Male-Images/PNG_format/'
CREDIT = 'Visible Human Project, U.S. National Library of Medicine. Public domain; see https://www.nlm.nih.gov/databases/download/terms_and_conditions.html'
FIRST, LAST = 1180, 1640
# Image geometry: 2048x1216 px at 0.33 mm, patient's anterior at the top, patient's right on the image left.
MM_PER_PX = 0.33
# Crop to the body: these bounds hold for every slice in the range.
CROP = (120, 20, 1930, 940)  # left, top, right, bottom (px)

def folder(n): return 'head' if n <= 1279 else 'thorax'

def fetch(n):
    dst = CACHE / f'a_vm{n}.png'
    if dst.exists() and dst.stat().st_size > 100000: return dst
    url = f'{BASE}{folder(n)}/a_vm{n}.png'
    req = urllib.request.Request(url, headers={'User-Agent': 'virtual-cadaver/0.1 (educational)'})
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(req, timeout=120).read()
            if len(data) > 100000: dst.write_bytes(data); return dst
        except Exception as e:
            print('retry', n, e, file=sys.stderr)
    raise RuntimeError(f'could not fetch slice {n}')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--step', type=int, default=2); ap.add_argument('--first', type=int, default=FIRST); ap.add_argument('--last', type=int, default=LAST)
    a = ap.parse_args()
    CACHE.mkdir(exist_ok=True); (OUT / 'axial').mkdir(parents=True, exist_ok=True); (OUT / 'sagittal').mkdir(exist_ok=True); (OUT / 'coronal').mkdir(exist_ok=True)
    nums = list(range(a.first, a.last + 1, a.step))
    # 1 mm per pixel volume for resampling: crop then scale by 0.33.
    cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
    vw, vh = round(cw * MM_PER_PX), round(ch * MM_PER_PX)
    vol = []
    for i, n in enumerate(nums):
        p = fetch(n)
        im = Image.open(p).convert('RGB').crop(CROP)
        im.resize((768, round(768 * ch / cw)), Image.LANCZOS).save(OUT / 'axial' / f'{n}.jpg', quality=82, optimize=True)
        vol.append(im.resize((vw, vh), Image.LANCZOS))
        if i % 20 == 0: print(f'{i + 1}/{len(nums)} slices', flush=True)
    depth = len(nums)
    # Sagittal: for each x column (mm), gather column from every slice -> image width = vh (A-P), height = depth*step (S-I)
    sag_step = 3
    sag_x = list(range(0, vw, sag_step))
    for x in sag_x:
        img = Image.new('RGB', (vh, depth))
        for k, sl in enumerate(vol):
            col = sl.crop((x, 0, x + 1, vh)).transpose(Image.Transpose.ROTATE_90)  # 1xvh -> vh x1
            img.paste(col, (0, k))
        img = img.resize((vh, depth * a.step), Image.BICUBIC).transpose(Image.Transpose.FLIP_LEFT_RIGHT)  # anterior on the left
        img.save(OUT / 'sagittal' / f'{x}.jpg', quality=82, optimize=True)
    cor_step = 3
    cor_y = list(range(0, vh, cor_step))
    for y in cor_y:
        img = Image.new('RGB', (vw, depth))
        for k, sl in enumerate(vol):
            img.paste(sl.crop((0, y, vw, y + 1)), (0, k))
        img = img.resize((vw, depth * a.step), Image.BICUBIC)
        img.save(OUT / 'coronal' / f'{y}.jpg', quality=82, optimize=True)
    manifest = {
        'credit': CREDIT, 'mmPerPx': MM_PER_PX, 'crop': CROP, 'volume': {'w': vw, 'h': vh, 'first': a.first, 'step': a.step, 'count': depth},
        'axial': {'first': a.first, 'step': a.step, 'count': depth, 'width': 768},
        'sagittal': {'xs': sag_x}, 'coronal': {'ys': cor_y},
        # Registration to the app's world: slice at the humeral head centre, and mm per world unit.
        'register': {'headSlice': 1300, 'headY': 0.557, 'mmPerUnit': 10.45, 'midlinePx': round((1010 - CROP[0]) * MM_PER_PX), 'centrePy': round((560 - CROP[1]) * MM_PER_PX)},
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    (OUT / 'ATTRIBUTION.txt').write_text(CREDIT + '\n')
    print('wrote', OUT, f'{depth} axial, {len(sag_x)} sagittal, {len(cor_y)} coronal')

if __name__ == '__main__': main()
