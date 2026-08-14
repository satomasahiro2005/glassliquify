"""Which localStorage key each row of Liquify's settings panel writes.

The panel renders a row as a label and a control, and neither carries the key:
the control is bound to a piece of React state, and the state is what was read
out of localStorage when the panel mounted. So the link exists in the source
and nowhere in the DOM, which is why it is extracted here rather than looked
up at runtime.

    const [bgBlur, setBgBlur] = React.useState(readNum("liquify-bg-blur", 7));
    ...
    createElement("div", {className:"liquifyRow"},
      createElement("div", {className:"liquifyLabel"}, t.backgroundBlur),
      createElement(Stepper, {value: bgBlur, ...}))

state variable -> key comes from the first line, row -> state variable from the
second, and the label is a path into the translation tables, which are in the
same file once per language. What comes out is every string that row's label
can read as, against the key behind it.

    python tools/gen-settings-keys.py

Writes patches/js/settings-rows.generated.js. Re-run after merging upstream.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "theme.js")
OUT = os.path.join(ROOT, "patches", "js", "settings-rows.generated.js")


def read_source():
    with open(SRC, encoding="utf-8", errors="replace") as f:
        return f.read()


def balanced(s, start):
    """Extent of the call whose opening paren is at or after `start`."""
    i = s.index("(", start)
    depth = 0
    q = None
    j = i
    while j < len(s):
        c = s[j]
        if q:
            if c == "\\":
                j += 2
                continue
            if c == q:
                q = None
        elif c in "\"'`":
            q = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return s[i:j + 1]
        j += 1
    return s[i:]


def constants(s):
    """Module-scope constants, by the three shapes the theme writes them in.

        var FOO_KEY = "liquify-x";
        var FOO_DEFAULT = 12;
        var NSC_DEFAULTS = { show: "on", height: 64, ... };   -> NSC_DEFAULTS.show

    The grouped ones are how most of the defaults are kept, and a row asks for
    one of them by property, so they are flattened to the name a row uses.
    """
    out = {}
    for m in re.finditer(r'\bvar (\w+) = "([^"]*)";', s):
        out[m.group(1)] = m.group(2)
    for m in re.finditer(r"\bvar (\w+) = (-?\d+(?:\.\d+)?);", s):
        out.setdefault(m.group(1), m.group(2))
    for m in re.finditer(r"\bvar (\w+) = \{", s):
        obj = enclosing_object(s, m.end())
        for p in re.finditer(r'([A-Za-z_$][\w$]*)\s*:\s*("([^"]*)"|-?\d+(?:\.\d+)?|true|false)', obj):
            val = p.group(3) if p.group(3) is not None else p.group(2)
            out.setdefault(m.group(1) + "." + p.group(1), val)
    return out


def state_map(body, consts):
    """React state variable -> (storage key, default as written)."""
    out = {}
    # A toggle keeps a boolean, so its read has a comparison after it:
    #   useState(readLS(KEY, "off") === "on")
    # The key and the default are still the two arguments of the read.
    pat = re.compile(
        r'const \[(\w+), \w+\] = React\.useState\(\s*'
        r'read(?:LS|Num|Bool)\(\s*("([^"]*)"|\w+)\s*,\s*([^)]*?)\)\s*(?:===[^)]*)?\)')
    for m in pat.finditer(body):
        var, key_tok, key_lit, dflt = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        key = key_lit if key_lit is not None else consts.get(key_tok)
        if not key or not key.startswith("liquify-"):
            continue
        if dflt.startswith('"') and dflt.endswith('"'):
            dflt = dflt[1:-1]
        elif dflt in consts:
            dflt = consts[dflt]
        out[var] = (key, dflt)
    return out


def rows(body):
    """Every liquifyRow element, as source."""
    out = []
    for m in re.finditer(r'React\.createElement\(\s*"div",\s*\{\s*className:\s*"liquifyRow"', body):
        out.append(balanced(body, m.start() + len("React.createElement")))
    return out


# The label is a path into the translation table, written with optional
# chaining and an English string after it for a language that is missing the
# entry: t.ui?.glassBlur || "Glass Blur (px):". Both halves are wanted - the
# path for every language, the fallback for the one the theme falls back to.
LABEL_RE = re.compile(
    r'className:\s*"liquifyLabel"\s*\}\s*,\s*'
    r'([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*)'
    r'(?:\s*\|\|\s*"((?:[^"\\]|\\.)*)")?')


def label_path(row):
    """(path into the translation table, the English fallback or None)."""
    m = LABEL_RE.search(row)
    if not m:
        return None, None
    path = m.group(1).replace("?.", ".")
    fallback = m.group(2)
    if fallback:
        fallback = fallback.encode("utf-8").decode("unicode_escape")
    return (path[2:] if path.startswith("t.") else None), fallback


BOUND_RE = re.compile(r'\b(?:value|checked|color|selected):\s*([A-Za-z_$][\w$]*)')


def bound_state(row, states):
    """The state variable the row's control is showing.

    Read off the control's own prop rather than by scanning the row for any
    known name: a row can mention two, and which one it is showing is the one
    that says what the row is for.
    """
    for m in BOUND_RE.finditer(row):
        if m.group(1) in states:
            return m.group(1)
    for v in states:
        if re.search(r'[^\w$]' + re.escape(v) + r'[^\w$]', row):
            return v
    return None


def enclosing_object(s, pos):
    """The braced object literal that `pos` sits directly inside."""
    depth = 0
    i = pos
    while i > 0:
        c = s[i]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                break
            depth -= 1
        i -= 1
    depth = 0
    j = i
    while j < len(s):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[i:j + 1]
        j += 1
    return s[i:]


def language_tables(s):
    """Every one of the theme's language tables, whole.

    Each is an object with a `sections` group in it, and nothing else in the
    file is, so that is what they are found by. Taken one at a time rather than
    flattened together because the same leaf name means different things in
    different groups - accentLightBoost is a label under one and a paragraph of
    help text under tooltips - and a row asks for one of them by path.
    """
    seen, out = set(), []
    for m in re.finditer(r'\bsections:\s*\{', s):
        obj = enclosing_object(s, m.start())
        if obj not in seen:
            seen.add(obj)
            out.append(obj)
    return out


def parse_object(s, i):
    """The object literal starting at s[i] == '{', as nested dicts of strings.

    Scanned rather than read line by line. A line-counting version of this got
    the nesting wrong partway down the longer tables and quietly filed leaves
    under the wrong group, which showed up as rows that could not be matched in
    one language and could in another.
    """
    assert s[i] == "{"
    out = {}
    i += 1
    while i < len(s):
        c = s[i]
        if c in " \t\r\n,":
            i += 1
            continue
        if c == "}":
            return out, i + 1
        m = re.match(r'("((?:[^"\\]|\\.)*)"|[A-Za-z_$][\w$]*)\s*:\s*', s[i:])
        if not m:
            return out, i + 1        # something we do not read: give up on this object
        name = m.group(2) if m.group(2) is not None else m.group(1)
        i += m.end()
        if s[i] == "{":
            out[name], i = parse_object(s, i)
        elif s[i] == '"':
            v = re.match(r'"((?:[^"\\]|\\.)*)"', s[i:])
            if not v:
                return out, i + 1
            out[name] = v.group(1).encode("utf-8").decode("unicode_escape")
            i += v.end()
        else:
            v = re.match(r'[^,}]*', s[i:])       # a number, a boolean, an expression
            i += v.end()
    return out, i


def flat_labels(s):
    """path -> the strings it reads as, across every language.

    `t.x` is a name at the top of a language table, `t.g.x` one inside the
    group g. Both are recorded; the leaf on its own is not, because that is
    what put a tooltip's text on a row.
    """
    out = {}
    for table in language_tables(s):
        obj, _ = parse_object(table, 0)
        for name, val in obj.items():
            if isinstance(val, str):
                out.setdefault(name, set()).add(val)
            elif isinstance(val, dict):
                for sub, text in val.items():
                    if isinstance(text, str):
                        out.setdefault(name + "." + sub, set()).add(text)
    return out


def main():
    s = read_source()
    consts = constants(s)
    i = s.find("function SettingsContent(props)")
    j = s.find("function SettingsModalRoot")
    if i < 0 or j < 0:
        sys.exit("SettingsContent not found - has the theme been restructured?")
    body = s[i:j]

    states = state_map(body, consts)
    labels = flat_labels(s)

    found, missed = [], []
    for row in rows(body):
        path, fallback = label_path(row)
        var = bound_state(row, states)
        if not path or not var:
            missed.append((path, var, row[:110].replace("\n", " ")))
            continue
        key, dflt = states[var]
        texts = set(labels.get(path, set()))
        if fallback:
            texts.add(fallback)
        if not texts:
            missed.append((path, var, "no label text for " + path))
            continue
        found.append({"labels": sorted(texts), "key": key, "default": dflt})

    # one row per key: the same setting is offered in more than one place
    by_key = {}
    for r in found:
        e = by_key.setdefault(r["key"], {"labels": set(), "key": r["key"], "default": r["default"]})
        e["labels"].update(r["labels"])
    out = [{"labels": sorted(v["labels"]), "key": v["key"], "default": v["default"]}
           for v in sorted(by_key.values(), key=lambda x: x["key"])]

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* generated from theme.js by tools/gen-settings-keys.py - "
                "do not edit by hand.\n"
                " *\n"
                " * Which localStorage key each row of Liquify's settings panel writes, and\n"
                " * what it reads when that key is missing. Labels are every language the\n"
                " * theme ships, because the row is matched by the text it is showing.\n"
                " */\n")
        f.write("window.__liquifySettingRows = " +
                json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")

    print("%d rows -> %d keys, written to %s" % (len(found), len(out), OUT))
    if missed:
        print("%d rows not mapped:" % len(missed))
        for p, v, r in missed:
            print("   label=%-24s state=%-20s %s" % (p, v, r[:80]))


if __name__ == "__main__":
    main()
