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
DEFAULT = os.path.join(ROOT, "Shaders.kt")

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

# Kyant's notice travels with Kyant's code. This file holds their shader
# source verbatim - the extraction only lifts it out of Kotlin - so Apache-2.0
# section 4(c) binds it exactly as it binds Shaders.kt, and Shaders.kt carries
# this header.
HEADER = """/* AGSL shader source from Backdrop, extracted verbatim.
 *
 *   https://github.com/Kyant0/AndroidLiquidGlass
 *   backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt
 *
 *   Copyright 2025 Kyant
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 * A copy of the License is in licenses/Apache-2.0-Backdrop.txt. The shader
 * bodies below are unchanged; this file exists so the GLSL port can be checked
 * against them.
 *
 * Generated - do not edit by hand.
 * Regenerate: python tools/gen-agsl.py <path to Shaders.kt>
 */
"""

dst = os.path.join(ROOT, "lab", "agsl-source.js")
with open(dst, "w", encoding="utf-8") as f:
    f.write(HEADER)
    f.write("window.AGSL = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")

print("blocks:", ", ".join(sorted(out)))
print("->", dst)
