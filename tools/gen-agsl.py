"""Backdrop の Shaders.kt から AGSL の原文を機械的に取り出す。

手で写すと、写し間違いを写し間違いのまま検証することになる。検証に使う
原典は必ずここから出す。

    python tools/gen-agsl.py [path-to-Shaders.kt]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(
    os.environ.get("TEMP", "/tmp"),
    "claude", "C--Users-masahiro", "1ec8b939-a485-4d13-bf26-aded8da7f5f3",
    "scratchpad", "kyant", "x-HEAD", "AndroidLiquidGlass-HEAD",
    "backdrop", "src", "commonMain", "kotlin", "com", "kyant", "backdrop",
    "internal", "Shaders.kt",
)

src_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
src = open(src_path, encoding="utf-8").read()

# private const val NAME = """ ... """
pat = re.compile(r'(?:private\s+)?(?:internal\s+)?const\s+val\s+(\w+)\s*=\s*"""(.*?)"""', re.S)
# internal val NAME = """ ... """   (dispersion one is a val, not const)
pat2 = re.compile(r'(?:private\s+)?(?:internal\s+)?val\s+(\w+)\s*=\s*"""(.*?)"""', re.S)

blocks = {}
for p in (pat, pat2):
    for m in p.finditer(src):
        blocks.setdefault(m.group(1), m.group(2))

if not blocks:
    raise SystemExit("no shader blocks found in " + src_path)

# $RoundedRectSDF のような Kotlin の文字列補間を展開する
def expand(text, depth=0):
    if depth > 8:
        return text
    def sub(m):
        name = m.group(1)
        return expand(blocks.get(name, m.group(0)), depth + 1)
    return re.sub(r"\$(\w+)", sub, text)

out = {k: expand(v) for k, v in blocks.items()}

dst = os.path.join(ROOT, "lab", "agsl-source.js")
with open(dst, "w", encoding="utf-8") as f:
    f.write("/* generated from Backdrop's Shaders.kt - do not edit by hand.\n")
    f.write(" * regenerate: python tools/gen-agsl.py <path to Shaders.kt>\n")
    f.write(" * source: " + src_path.replace("\\", "/") + "\n */\n")
    f.write("window.AGSL = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")

print("blocks:", ", ".join(sorted(out)))
print("->", dst)
