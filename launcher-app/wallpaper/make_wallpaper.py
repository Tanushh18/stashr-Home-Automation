#!/usr/bin/env python3
"""Draws the Stashr "board" wallpaper: the website's forest-to-slate night, a faint grid and green circuit traces.

    python3 launcher-app/wallpaper/make_wallpaper.py [width height out.png]

Pure Python (no image library). Calm on purpose: icons and the Stashr Home widget stay readable on top of it.
"""
import math
import random
import struct
import sys
import zlib

W, H = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (1080, 2400)
OUT = sys.argv[3] if len(sys.argv) > 3 else "stashr-board.png"

TOP = (0x06, 0x15, 0x0F)      # --forest-900
BOTTOM = (0x0B, 0x11, 0x20)   # app dark background
GRID = (0x12, 0xA3, 0x7A)     # --emerald
TRACE = (0x12, 0xA3, 0x7A)
NODE = (0x3C, 0xCF, 0x9A)     # --emerald-soft
AMBER = (0xF5, 0xC8, 0x6A)    # --runway

px = bytearray(W * H * 3)


def blend(x, y, c, a):
    if 0 <= x < W and 0 <= y < H and a > 0:
        i = (y * W + x) * 3
        for k in range(3):
            px[i + k] = min(255, int(px[i + k] * (1 - a) + c[k] * a))


# 1. vertical gradient with a soft green glow behind the top third (where the widget sits)
gx, gy, gr = W * 0.5, H * 0.22, W * 0.75
for y in range(H):
    t = y / (H - 1)
    base = [TOP[k] + (BOTTOM[k] - TOP[k]) * t for k in range(3)]
    for x in range(W):
        d = math.hypot(x - gx, y - gy) / gr
        g = max(0.0, 1 - d) ** 2 * 0.10
        i = (y * W + x) * 3
        px[i] = int(base[0] + (NODE[0] - base[0]) * g)
        px[i + 1] = int(base[1] + (NODE[1] - base[1]) * g)
        px[i + 2] = int(base[2] + (NODE[2] - base[2]) * g)

# 2. faint grid, fading out towards the bottom (the dock area stays clean)
step = W // 18
for y in range(0, H, step):
    a = 0.06 * (1 - y / H)
    for x in range(W):
        blend(x, y, GRID, a)
for x in range(0, W, step):
    for y in range(H):
        blend(x, y, GRID, 0.06 * (1 - y / H))

# 3. circuit traces: orthogonal runs on the grid with a glowing node at each end
rnd = random.Random(7)


def line(x0, y0, x1, y1, c, a, width=2):
    n = max(abs(x1 - x0), abs(y1 - y0)) or 1
    for s in range(n + 1):
        x = x0 + (x1 - x0) * s // n
        y = y0 + (y1 - y0) * s // n
        for o in range(width):
            blend(x + (o if y0 == y1 else 0) * 0, y + (o if x0 == x1 else 0) * 0, c, a)
            blend(x + (o if x0 == x1 else 0), y + (o if y0 == y1 else 0), c, a)


def node(cx, cy, r, c, a):
    for y in range(cy - r * 3, cy + r * 3 + 1):
        for x in range(cx - r * 3, cx + r * 3 + 1):
            d = math.hypot(x - cx, y - cy)
            if d <= r:
                blend(x, y, c, a)
            elif d <= r * 3:
                blend(x, y, c, a * 0.25 * (1 - (d - r) / (2 * r)))


for _ in range(16):
    x = rnd.randrange(1, 18) * step
    y = rnd.randrange(2, int(H * 0.72) // step) * step
    pts = [(x, y)]
    for _ in range(rnd.randint(2, 4)):
        if rnd.random() < 0.5:
            x = max(step, min(W - step, x + rnd.choice([-1, 1]) * rnd.randint(1, 5) * step))
        else:
            y = max(step, min(int(H * 0.8), y + rnd.choice([-1, 1]) * rnd.randint(1, 6) * step))
        pts.append((x, y))
    fade = 0.22 * (1 - pts[0][1] / H)
    for (a0, b0), (a1, b1) in zip(pts, pts[1:]):
        line(a0, b0, a1, b1, TRACE, fade)
    node(*pts[0], 4, NODE, 0.55)
    node(*pts[-1], 4, AMBER if rnd.random() < 0.25 else NODE, 0.55)


def png(path):
    raw = b"".join(b"\x00" + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


png(OUT)
print(f"wrote {OUT} ({W}x{H})")
