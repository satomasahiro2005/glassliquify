"""ガラスの材質パラメータを振って、文字の読みやすさを実測で比べる。

「なんとなく薄い」を数値で詰めるための道具。各候補を実機へ流し込み、
画面を撮って、本文が乗っている区画の WCAG コントラスト比を出す。

    python tools/tune.py
"""
import json
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cdp  # noqa: E402

SHOTS = os.path.join(ROOT, "lab", "shots")

CANDIDATES = [
    {"name": "現状", "brightness": 0, "contrast": 1, "saturation": 1.5, "tint": 0.05},
    {"name": "ロック画面の処方", "brightness": -0.1, "contrast": 0.75, "saturation": 1.5, "tint": 0.25},
    {"name": "同・白薄め", "brightness": -0.1, "contrast": 0.75, "saturation": 1.5, "tint": 0.15},
    {"name": "暗め寄り", "brightness": -0.18, "contrast": 0.7, "saturation": 1.5, "tint": 0.10},
    {"name": "contrast のみ", "brightness": 0, "contrast": 0.7, "saturation": 1.5, "tint": 0.10},
]


def rl(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def score(path):
    im = Image.open(path).convert("RGB")
    L = rl(np.asarray(im, dtype=np.float64))
    H, W = L.shape
    x0, x1 = int(W * 0.07), int(W * 0.78)
    y0, y1 = int(H * 0.05), int(H * 0.92)
    tile = 220
    rs = []
    for y in range(y0, y1 - tile, tile):
        for x in range(x0, x1 - tile, tile):
            t = L[y:y + tile, x:x + tile]
            hi = np.quantile(t, 0.98)
            lo = np.quantile(t, 0.40)
            if hi - lo < 0.02:
                continue
            rs.append((hi + 0.05) / (lo + 0.05))
    if not rs:
        return None
    rs.sort()
    return {
        "worst": round(float(rs[0]), 2),
        "p10": round(float(np.quantile(rs, 0.10)), 2),
        "median": round(float(np.median(rs)), 2),
        "below45": int(sum(1 for r in rs if r < 4.5)),
        "tiles": len(rs),
    }


def main():
    s = cdp.Session()
    results = []
    for c in CANDIDATES:
        patch = {
            "brightness": c["brightness"],
            "contrast": c["contrast"],
            "saturation": c["saturation"],
            "surface": [1, 1, 1, c["tint"]],
        }
        s.evaluate("window.liquifyLG.set(%s)" % json.dumps(patch))
        time.sleep(0.8)
        path = os.path.join(SHOTS, "tune-%s.png" % c["name"].replace(" ", "_"))
        s.screenshot(path)
        r = score(path)
        r["name"] = c["name"]
        r.update({k: c[k] for k in ("brightness", "contrast", "tint")})
        results.append(r)
        print("%-16s worst %-5s p10 %-5s median %-5s 4.5未満 %d/%d" %
              (c["name"], r["worst"], r["p10"], r["median"], r["below45"], r["tiles"]))

    best = max(results, key=lambda r: (r["p10"], r["worst"]))
    print()
    print("best:", json.dumps(best, ensure_ascii=False))


if __name__ == "__main__":
    main()
