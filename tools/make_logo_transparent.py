"""
Flood-fill near-black background to transparent (logo PNGs exported on black).
Requires: pip install pillow
Usage (from repo root):
  python tools/make_logo_transparent.py frontend_intermediate/public/logo.png asset/logo.png
"""
from __future__ import annotations

import sys
from collections import deque

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install pillow", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    paths = [p for p in sys.argv[1:] if p]
    if not paths:
        print("Usage: python tools/make_logo_transparent.py <png> [png ...]", file=sys.stderr)
        sys.exit(1)

    for path in paths:
        img = Image.open(path).convert("RGBA")
        w, h = img.size
        px = img.load()

        def is_bg(r: int, g: int, b: int, a: int) -> bool:
            if a == 0:
                return True
            # Opaque black / near-black typical of export background
            return r < 55 and g < 55 and b < 55 and (r + g + b) < 140

        seen = [[False] * w for _ in range(h)]
        q: deque[tuple[int, int]] = deque()
        seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        for sx, sy in seeds:
            if 0 <= sx < w and 0 <= sy < h:
                q.append((sx, sy))

        while q:
            x, y = q.popleft()
            if x < 0 or x >= w or y < 0 or y >= h or seen[y][x]:
                continue
            seen[y][x] = True
            r, g, b, a = px[x, y]
            if not is_bg(r, g, b, a):
                continue
            px[x, y] = (r, g, b, 0)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                    q.append((nx, ny))

        img.save(path, "PNG")
        print("Wrote", path)


if __name__ == "__main__":
    main()
