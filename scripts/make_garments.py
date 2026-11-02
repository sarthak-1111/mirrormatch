"""Draws self-made garment reference images for the fictional "Hue & Hem" dresses.

Each colourway is the same procedurally drawn garment (front view, white background),
recoloured in CIELAB so fold shading is kept and only the colour changes.
Output: public/assets/garments/dress-<style>-<colour>.png (768x1024).
Licence: created for this project, MIT like the rest of the repo (see ASSETS.md).

Usage: python scripts/make_garments.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "garments"
W, H = 1536, 2048  # drawn at 2x, downsampled to 768x1024


def hex_to_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def wrap_dress_mask():
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    cx = W // 2
    # bodice + skirt silhouette
    body = [
        (cx - 150, 250), (cx - 235, 275), (cx - 345, 430), (cx - 300, 505), (cx - 222, 470),
        (cx - 195, 600), (cx - 168, 770), (cx - 210, 960), (cx - 300, 1300), (cx - 400, 1700),
        (cx - 440, 1860), (cx - 200, 1905), (cx, 1915), (cx + 200, 1905), (cx + 440, 1860),
        (cx + 400, 1700), (cx + 300, 1300), (cx + 210, 960), (cx + 168, 770), (cx + 195, 600),
        (cx + 222, 470), (cx + 300, 505), (cx + 345, 430), (cx + 235, 275), (cx + 150, 250),
        (cx + 40, 520), (cx, 600), (cx - 40, 520),
    ]
    d.polygon(body, fill=255)
    # tie ends hanging from the left waist
    d.polygon([(cx - 175, 780), (cx - 120, 790), (cx - 150, 1080), (cx - 205, 1070)], fill=255)
    d.polygon([(cx - 165, 785), (cx - 105, 800), (cx - 60, 1030), (cx - 115, 1045)], fill=255)
    return img


def slip_dress_mask():
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    cx = W // 2
    body = [
        (cx - 205, 470), (cx - 120, 420), (cx, 450), (cx + 120, 420), (cx + 205, 470),
        (cx + 190, 760), (cx + 230, 1100), (cx + 330, 1560), (cx + 380, 1880),
        (cx, 1910), (cx - 380, 1880), (cx - 330, 1560), (cx - 230, 1100), (cx - 190, 760),
    ]
    d.polygon(body, fill=255)
    # straps
    d.line([(cx - 175, 470), (cx - 140, 240)], fill=255, width=16)
    d.line([(cx + 175, 470), (cx + 140, 240)], fill=255, width=16)
    return img


def shading(mask, style):
    m = np.asarray(mask, dtype=np.float64) / 255.0
    inside = m > 0.5
    dist = distance_transform_edt(inside)
    edge = np.clip(dist / 70.0, 0, 1) ** 0.6  # darker towards silhouette edges
    yy, xx = np.mgrid[0:H, 0:W]
    cx = W / 2
    # vertical folds that widen towards the hem
    t = np.clip((yy - 800) / 1100.0, 0, 1)
    folds = 0.10 * t * np.sin((xx - cx) / (38 + 40 * t) + 0.6 * np.sin(yy / 160.0))
    folds += 0.05 * t * np.sin((xx - cx) / 17.0 + yy / 300.0)
    # soft key light from upper left
    light = 0.06 * (1 - (xx / W)) + 0.05 * (1 - yy / H)
    s = 0.78 + 0.22 * edge + folds + light
    if style == "wrap":
        # wrap overlap seam: diagonal from right waist to left hem, with a shadow under it
        seam = (xx - cx) - (-(yy - 790) * 0.36 + 170)
        s -= 0.12 * np.exp(-((seam - 6) ** 2) / 160.0) * (yy > 790)
        # V-neck lapel edges and waist band
        s -= 0.10 * np.exp(-((yy - 765) ** 2) / 120.0) * inside
        s += 0.05 * np.exp(-((yy - 745) ** 2) / 300.0) * inside
    else:
        s -= 0.08 * np.exp(-((yy - 470) ** 2) / 200.0) * inside
    return np.clip(s, 0.35, 1.15), m


def render(mask, shade, colour_hex):
    base = srgb_to_lin(hex_to_rgb(colour_hex))
    lin = base[None, None, :] * shade[..., None] ** 1.6
    # tiny specular lift so dark colours still show folds
    lin = lin + 0.025 * np.clip(shade - 0.95, 0, 1)[..., None]
    rgb = lin_to_srgb(lin)
    a = np.asarray(mask.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float64)[..., None] / 255.0
    out = rgb * a + 255.0 * (1 - a)
    img = Image.fromarray(out.astype(np.uint8), "RGB")
    return img.resize((W // 2, H // 2), Image.LANCZOS)


def main():
    catalog = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    cache = {}
    for p in catalog["products"]:
        if p["category"] != "dress":
            continue
        style = p["style"]
        if style not in cache:
            mask = wrap_dress_mask() if style == "wrap" else slip_dress_mask()
            cache[style] = (mask, shading(mask, style)[0])
        mask, shade = cache[style]
        out = ROOT / "public" / p["garmentImage"].lstrip("/")
        render(mask, shade, p["hex"]).save(out, optimize=True)
        print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
