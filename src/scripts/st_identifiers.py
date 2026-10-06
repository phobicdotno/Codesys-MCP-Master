# --- st_identifiers helper: find and rename identifiers in Structured Text ---
# CODESYS's scripting API has no cross-reference or refactoring call, so the
# reference tools read the text of every textual object themselves. This is
# a small lexer, not a parser: it skips comments ((* *), /* */ and //,
# block comments nested), strings ('...' with $ escapes, "..."), pragmas
# ({...}) and the part after '#' in typed literals (T#1s, 16#FF, E_Mode#Run),
# and matches whole identifiers case-insensitively, as IEC 61131-3 does.
# It cannot tell two different variables of the same name apart: every
# match is reported with the qualifier in front of it ("PLC_PRG." in
# PLC_PRG.bRun) so the caller can judge.

import re as _st_re

_ST_IDENT = _st_re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

# Elementary types that prefix typed literals (T#1s, DINT#5, BOOL#1).
_ST_LITERAL_TYPES = set("""T TIME LTIME D DATE LDATE TOD TIME_OF_DAY LTOD DT DATE_AND_TIME LDT BOOL BYTE WORD
DWORD LWORD SINT INT DINT LINT USINT UINT UDINT ULINT REAL LREAL STRING WSTRING CHAR WCHAR""".split())


def st_identifier_spans(text):
    """(start, end) of every identifier token outside comments, strings,
    pragmas and typed-literal values."""
    spans = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        two = text[i:i + 2]
        if two == "(*" or two == "/*":
            closer = "*)" if two == "(*" else "*/"
            depth = 1
            i += 2
            while i < n and depth:
                if text[i:i + 2] == two:
                    depth += 1
                    i += 2
                elif text[i:i + 2] == closer:
                    depth -= 1
                    i += 2
                else:
                    i += 1
            continue
        if two == "//":
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "'" or c == '"':
            i += 1
            while i < n:
                if text[i] == "$":
                    i += 2
                    continue
                if text[i] == c:
                    i += 1
                    break
                i += 1
            continue
        if c == "{":
            j = text.find("}", i)
            i = n if j < 0 else j + 1
            continue
        if c == "#":
            # the value of a typed literal: T#1s, 16#FF, E_Mode#Run
            i += 1
            while i < n and (text[i].isalnum() or text[i] in "_.:"):
                i += 1
            continue
        m = _ST_IDENT.match(text, i)
        if m:
            # The type prefix of a typed literal (T#1s, DINT#5, TOD#12:00) is
            # not a name; an enum type before '#' (E_Mode#Run) is.
            if m.end() < n and text[m.end()] == "#" and m.group(0).upper() in _ST_LITERAL_TYPES:
                i = m.end()
                continue
            spans.append((m.start(), m.end()))
            i = m.end()
            continue
        if c.isdigit():
            # A number: digits, '_', one '.' followed by a digit (not the '..'
            # of an array range: ARRAY[1..nMax]), an exponent. Letters end it.
            i += 1
            while i < n:
                ch = text[i]
                if ch.isdigit() or ch == "_":
                    i += 1
                elif ch == "." and i + 1 < n and text[i + 1].isdigit():
                    i += 1
                elif ch in "eE" and i + 1 < n and (text[i + 1].isdigit() or
                                                   (text[i + 1] in "+-" and i + 2 < n and text[i + 2].isdigit())):
                    i += 2
                else:
                    break
            continue
        i += 1
    return spans


def st_find_identifier(text, name):
    """Matches of identifier `name` (case-insensitive) in `text`:
    list of dicts with line (1-based), column (1-based), qualifier and the
    source line."""
    want = name.lower()
    lines = text.split("\n")
    starts = [0]
    for ln in lines[:-1]:
        starts.append(starts[-1] + len(ln) + 1)
    found = []
    li = 0
    for (a, b) in st_identifier_spans(text):
        if text[a:b].lower() != want:
            continue
        while li + 1 < len(starts) and starts[li + 1] <= a:
            li += 1
        found.append({
            "line": li + 1,
            "column": a - starts[li] + 1,
            "qualifier": _st_qualifier(text, a),
            "text": lines[li].rstrip("\r"),
        })
    return found


def _st_qualifier(text, a):
    """The access path in front of position a: 'fb.out.' in fb.out.x,
    'arr[i].' in arr[i].x, 'p^.' in p^.x; '' when there is none."""
    k = a - 1
    while k >= 0 and text[k] in " \t":
        k -= 1
    if k < 0 or text[k] != ".":
        return ""
    end = k + 1
    while k >= 0 and text[k] == ".":
        k -= 1
        while k >= 0 and text[k] in " \t":
            k -= 1
        # one path element: identifier, optionally followed by [..] and/or ^
        while k >= 0 and text[k] in "^]":
            if text[k] == "]":
                depth = 0
                while k >= 0:
                    if text[k] == "]":
                        depth += 1
                    elif text[k] == "[":
                        depth -= 1
                        if depth == 0:
                            break
                    k -= 1
            k -= 1
        while k >= 0 and (text[k].isalnum() or text[k] == "_"):
            k -= 1
    return text[k + 1:end].replace(" ", "").replace("\t", "")


def st_replace_identifier(text, name, new_name):
    """`text` with every identifier `name` (case-insensitive) replaced by
    `new_name`; returns (new_text, count)."""
    want = name.lower()
    out = []
    last = 0
    count = 0
    for (a, b) in st_identifier_spans(text):
        if text[a:b].lower() == want:
            out.append(text[last:a])
            out.append(new_name)
            last = b
            count += 1
    out.append(text[last:])
    return "".join(out), count


def st_textual_objects(project):
    """(path, object, part, document) for every textual declaration and
    implementation in the project, and the paths of objects whose body is
    graphical (FBD/LD/CFC/SFC), which these tools cannot read."""
    docs = []
    graphical = []

    def walk(obj, prefix):
        name = obj.get_name() if hasattr(obj, "get_name") else "?"
        path = "%s/%s" % (prefix, name) if prefix else name
        for part in ("textual_declaration", "textual_implementation"):
            if hasattr(obj, part):
                try:
                    doc = getattr(obj, part)
                except Exception:
                    doc = None
                if doc is not None and hasattr(doc, "text"):
                    docs.append((path, obj, part.split("_")[1], doc))
                elif part == "textual_implementation":
                    # a POU whose body is FBD/LD/CFC/SFC has no text document
                    graphical.append(path)
        try:
            for ch in obj.get_children(False):
                walk(ch, path)
        except Exception:
            pass

    for ch in project.get_children(False):
        walk(ch, "")
    return docs, graphical
# --- end st_identifiers helper ---
