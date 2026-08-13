"""theme.js の GLASS_TARGETS から、拡張が使うセレクタ一覧を生成する。

upstream を取り込んだあとに実行して patches/js/targets.generated.js を作り直す。
手で書くと upstream がセレクタを足したときに黙って取りこぼす。

    python tools/gen-targets.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

src = open(os.path.join(ROOT, "theme.js"), encoding="utf-8").read()
start = src.index("var GLASS_TARGETS = [")
open_at = src.index("[", start)

depth = 0
end = None
for k in range(open_at, len(src)):
    if src[k] == "[":
        depth += 1
    elif src[k] == "]":
        depth -= 1
        if depth == 0:
            end = k + 1
            break
block = src[open_at:end]

# { selector: "...", options: { ... } } と、options 無しの両方を拾う
entry = re.compile(
    r'selector:\s*"([^"]*)"\s*(?:,\s*options:\s*\{([^}]*)\})?',
    re.S,
)

items = []
seen = set()
for m in entry.finditer(block):
    sel = m.group(1)
    if sel in seen:
        continue
    seen.add(sel)
    opts = m.group(2) or ""
    r = re.search(r"borderRadius:\s*(\d+)", opts)
    items.append({
        "s": sel,
        "r": int(r.group(1)) if r else 20,
        "before": 'applyTo: "before"' in opts,
        "ca": "chromaticAberration: false" not in opts,
    })

out = os.path.join(ROOT, "patches", "js", "targets.generated.js")
with open(out, "w", encoding="utf-8") as f:
    f.write("/* generated from theme.js GLASS_TARGETS - do not edit by hand.\n")
    f.write(" * regenerate: python tools/gen-targets.py\n */\n")
    f.write("window.__liquifyGlassTargets = ")
    f.write(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
    f.write(";\n")

print("targets:", len(items), "->", out)
