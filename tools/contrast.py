"""ガラスの上に乗った文字の読みやすさを測る。

見た目の「なんとなく薄い」を数値にする。指定した矩形の中で、明るい側
(文字)と暗い側(地)の相対輝度を分位点で取り、WCAG のコントラスト比を出す。

    python tools/contrast.py <png> <x> <y> <w> <h>

本文なら 4.5:1、大きい文字なら 3:1 が下限。
"""
import sys

import numpy as np
from PIL import Image


def rel_luminance(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def main():
    path = sys.argv[1]
    x, y, w, h = (int(v) for v in sys.argv[2:6])
    im = Image.open(path).convert("RGB")
    arr = np.asarray(im.crop((x, y, x + w, y + h)), dtype=np.float64)
    lum = rel_luminance(arr)

    # 文字は面積が小さいので、上下の分位点で「文字」と「地」を分ける
    hi = float(np.quantile(lum, 0.98))
    lo = float(np.quantile(lum, 0.40))
    ratio = (hi + 0.05) / (lo + 0.05)

    print(f"region      : {x},{y} {w}x{h}")
    print(f"luminance   : p40 {lo:.4f}  p98 {hi:.4f}")
    print(f"contrast    : {ratio:.2f}:1")
    print(f"body text   : {'ok' if ratio >= 4.5 else 'FAIL (needs 4.5)'}")
    print(f"large text  : {'ok' if ratio >= 3.0 else 'FAIL (needs 3.0)'}")


if __name__ == "__main__":
    main()
