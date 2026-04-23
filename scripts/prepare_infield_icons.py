"""
Prepare Infield master (square 1024, transparent BG) and tray PNGs from icons/source/infield-master.png.

Run from Handy-main: python scripts/prepare_infield_icons.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SRC_TAURI = ROOT / "src-tauri"
MASTER_IN = SRC_TAURI / "icons" / "source" / "infield-master.png"
APP_OUT = SRC_TAURI / "icons" / "source" / "infield-app-1024.png"
RES = SRC_TAURI / "resources"
TRAY_SIZE = 64

# Odd kernel >= 3. Larger = visibly thicker outlines at small tray sizes (try 7–11).
STROKE_THICKEN_MAX_FILTER = 9


def corner_bg_color(im: Image.Image) -> tuple[int, int, int]:
    im = im.convert("RGB")
    w, h = im.size
    samples = [
        im.getpixel((0, 0)),
        im.getpixel((w - 1, 0)),
        im.getpixel((0, h - 1)),
        im.getpixel((w - 1, h - 1)),
    ]
    r = sum(s[0] for s in samples) // 4
    g = sum(s[1] for s in samples) // 4
    b = sum(s[2] for s in samples) // 4
    return (r, g, b)


def remove_near_bg(im_rgb: Image.Image, bg: tuple[int, int, int], thresh: float = 42.0) -> Image.Image:
    im = im_rgb.convert("RGBA")
    px = im.load()
    w, h = im.size
    br, bg_, bb = bg
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            dist = math.sqrt((r - br) ** 2 + (g - bg_) ** 2 + (b - bb) ** 2)
            if dist < thresh:
                px[x, y] = (r, g, b, 0)
            elif dist < thresh + 28:
                alpha = int(max(0, min(255, (dist - thresh) / 28.0 * 255)))
                px[x, y] = (r, g, b, alpha)
    return im


def _avg_opaque_rgb(rgba: Image.Image, alpha_floor: int = 24) -> tuple[int, int, int]:
    px = rgba.load()
    w, h = rgba.size
    rs, gs, bs, n = 0, 0, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > alpha_floor:
                rs += r
                gs += g
                bs += b
                n += 1
    if n == 0:
        return (44, 44, 44)
    return (rs // n, gs // n, bs // n)


def thicken_strokes_rgba(rgba: Image.Image, max_filter_size: int = STROKE_THICKEN_MAX_FILTER) -> Image.Image:
    """
    Expand opaque foreground so lines read thicker when downscaled (tray / taskbar).
    Uses a max filter on a binary alpha mask, then fills new edge pixels with the
    average opaque color (keeps the same charcoal look).
    """
    if max_filter_size < 3:
        return rgba
    if max_filter_size % 2 == 0:
        max_filter_size += 1

    _r, _g, _b, a_ch = rgba.split()
    w, h = rgba.size
    mask = Image.new("L", (w, h), 0)
    pm = mask.load()
    pa = a_ch.load()
    for y in range(h):
        for x in range(w):
            pm[x, y] = 255 if pa[x, y] > 12 else 0

    dilated = mask.filter(ImageFilter.MaxFilter(max_filter_size))
    stroke_rgb = _avg_opaque_rgb(rgba)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    src = rgba.load()
    dpx = dilated.load()
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if dpx[x, y] < 128:
                continue
            r, g, b, a = src[x, y]
            if a > 12:
                opx[x, y] = (r, g, b, a)
            else:
                opx[x, y] = (*stroke_rgb, 255)
    return out


def pad_square(im: Image.Image, side: int) -> Image.Image:
    w, h = im.size
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - w) // 2
    oy = (side - h) // 2
    canvas.paste(im, (ox, oy), im)
    return canvas


def to_square_1024(im_rgba: Image.Image) -> Image.Image:
    w, h = im_rgba.size
    side = max(w, h)
    padded = pad_square(im_rgba, side)
    if side != 1024:
        padded = padded.resize((1024, 1024), Image.Resampling.LANCZOS)
    return padded


def glyph_light_for_dark_tray(dark_rgba: Image.Image) -> Image.Image:
    r, g, b, _a = dark_rgba.split()
    gray = Image.merge("RGB", (r, g, b)).convert("L")
    inv = ImageOps.invert(gray)
    out = Image.new("RGBA", dark_rgba.size, (0, 0, 0, 0))
    dp = dark_rgba.load()
    op = out.load()
    gw, gh = gray.size
    for y in range(gh):
        for x in range(gw):
            _, _, _, al = dp[x, y]
            if al < 8:
                continue
            v = inv.getpixel((x, y))
            v = min(255, int(v * 1.05 + 10))
            op[x, y] = (v, v, v, al)
    return out


def to_dark_glyph(light_rgba: Image.Image) -> Image.Image:
    r, g, b, _a = light_rgba.split()
    gray = Image.merge("RGB", (r, g, b)).convert("L")
    dark = ImageOps.invert(gray)
    out = Image.new("RGBA", light_rgba.size, (0, 0, 0, 0))
    dp = light_rgba.load()
    op = out.load()
    w, h = light_rgba.size
    for y in range(h):
        for x in range(w):
            _, _, _, al = dp[x, y]
            if al < 8:
                continue
            v = dark.getpixel((x, y))
            v = max(0, int(v * 0.85))
            op[x, y] = (v, v, v, al)
    return out


def tint_recording(light_rgba: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    r0, g0, b0 = rgb
    t = 0.55
    out = Image.new("RGBA", light_rgba.size, (0, 0, 0, 0))
    p_in = light_rgba.load()
    p_out = out.load()
    w, h = light_rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = p_in[x, y]
            if a < 8:
                continue
            nr = int(r * (1 - t) + r0 * t)
            ng = int(g * (1 - t) + g0 * t)
            nb = int(b * (1 - t) + b0 * t)
            p_out[x, y] = (nr, ng, nb, a)
    return out


def tint_transcribing(light_rgba: Image.Image) -> Image.Image:
    return tint_recording(light_rgba, (245, 158, 11))


def linux_colored_from_light(light_rgba: Image.Image, accent: tuple[int, int, int]) -> Image.Image:
    return tint_recording(light_rgba, accent)


def export_tray(src_rgba: Image.Image, size: int, out_path: Path) -> None:
    im = src_rgba.copy()
    im.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ox = (size - im.width) // 2
    oy = (size - im.height) // 2
    canvas.paste(im, (ox, oy), im)
    canvas.save(out_path, "PNG")


def main() -> int:
    if not MASTER_IN.exists():
        print(f"Missing {MASTER_IN}", file=sys.stderr)
        return 1

    raw = Image.open(MASTER_IN).convert("RGB")
    bg = corner_bg_color(raw)
    rgba = remove_near_bg(raw, bg, thresh=42.0)
    rgba = thicken_strokes_rgba(rgba)
    sq = to_square_1024(rgba)
    APP_OUT.parent.mkdir(parents=True, exist_ok=True)
    sq.save(APP_OUT, "PNG")
    print(f"Wrote {APP_OUT} ({sq.size})")

    light_tray = glyph_light_for_dark_tray(sq)
    dark_tray = to_dark_glyph(light_tray)
    pink = (250, 162, 202)

    RES.mkdir(parents=True, exist_ok=True)
    exports: list[tuple[str, Image.Image]] = [
        ("tray_idle.png", light_tray),
        ("tray_recording.png", tint_recording(light_tray, (239, 68, 68))),
        ("tray_transcribing.png", tint_transcribing(light_tray)),
        ("tray_idle_dark.png", dark_tray),
        ("tray_recording_dark.png", tint_recording(dark_tray, (185, 28, 28))),
        ("tray_transcribing_dark.png", tint_transcribing(dark_tray)),
        ("handy.png", linux_colored_from_light(light_tray, pink)),
        ("recording.png", linux_colored_from_light(light_tray, (239, 68, 68))),
        ("transcribing.png", linux_colored_from_light(light_tray, (245, 158, 11))),
    ]
    for name, img in exports:
        export_tray(img, TRAY_SIZE, RES / name)
        print(f"Wrote {RES / name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
