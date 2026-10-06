import sys, scriptengine as script_engine, os, traceback

# Line-level access to an object's declaration or implementation text
# (IScriptTextDocument). MODE "get" prints numbered lines; MODE "edit" applies
# a list of line operations. Line numbers are 1-based (as shown in the
# CODESYS editor) and always refer to the text BEFORE this call. Every op
# with an "expect" value and the overlap rule are checked first; any failure
# aborts the whole call before anything is written. The result is written
# with ONE doc.replace over the region that actually differs (common prefix
# and suffix kept), so text outside the touched lines is never rewritten.

OBJECT_PATH = "{OBJECT_PATH}"
PART = "{PART}"            # declaration | implementation
MODE = "{MODE}"            # get | edit
START_LINE = {START_LINE}  # get: first line (1-based)
LINE_COUNT = {LINE_COUNT}  # get: number of lines, 0 = to the end
SAVE = {SAVE}
OPS = {OPS}                # edit: list of dicts, see server.ts edit_text_lines

def _lines(text):
    """Lines without line endings; '' -> []."""
    if text == '':
        return []
    out = text.replace('\r\n', '\n').split('\n')
    if text.endswith('\n'):
        out.pop()
    return out

def _body(t):
    return t.replace('\r\n', '\n').split('\n')

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    obj = find_object_by_path_robust(primary_project, OBJECT_PATH, "target object")
    if not obj:
        raise ValueError("Object not found at path: %s" % OBJECT_PATH)
    if PART not in ('declaration', 'implementation'):
        raise ValueError("part must be 'declaration' or 'implementation'.")
    if not getattr(obj, 'has_textual_' + PART, False):
        raise TypeError("Object '%s' has no textual %s." % (OBJECT_PATH, PART))
    doc = getattr(obj, 'textual_' + PART)
    text = doc.text
    lines = _lines(text)
    total = len(lines)

    if MODE == 'get':
        first = max(1, START_LINE)
        last = total if LINE_COUNT <= 0 else min(total, first + LINE_COUNT - 1)
        print("### LINES_START ###")
        print("Object: %s (%s), %d lines" % (OBJECT_PATH, PART, total))
        for no in range(first, last + 1):
            print("%5d| %s" % (no, lines[no - 1]))
        print("### LINES_END ###")
        print("SCRIPT_SUCCESS: Lines read.")
        sys.exit(0)

    if MODE != 'edit':
        raise ValueError("Unknown mode '%s'." % MODE)
    if not OPS:
        raise ValueError("No operations given.")

    # Validate every op and collect (first_line, last_line, sort_rank, op).
    plan = []
    for idx, op in enumerate(OPS):
        kind = op.get('op')
        line = int(op.get('line', 0))
        if kind == 'insert':
            if line < 1 or line > total + 1:
                raise ValueError("op %d: insert line %d out of range 1..%d." % (idx + 1, line, total + 1))
            if op.get('expect') is not None:
                raise ValueError("op %d: 'expect' applies to replace/delete only, not insert." % (idx + 1))
            plan.append((line, line - 1, idx, op))
            continue
        if kind not in ('replace', 'delete'):
            raise ValueError("op %d: unknown op '%s' (insert, replace, delete)." % (idx + 1, kind))
        count = int(op.get('count', 1))
        if line < 1 or count < 1 or line + count - 1 > total:
            raise ValueError("op %d: lines %d..%d out of range 1..%d." % (idx + 1, line, line + count - 1, total))
        exp = op.get('expect')
        if exp is not None:
            actual = lines[line - 1:line - 1 + count]
            if actual != _body(exp):
                raise ValueError("op %d: expect mismatch at line %d. Current text:\n%s" % (idx + 1, line, '\n'.join(actual)))
        plan.append((line, line + count - 1, idx, op))

    # Overlaps: two replace/delete ranges may not share a line, and an insert
    # may not land strictly inside a replace/delete range (before its first
    # line is fine: the insert then goes in front of the replaced lines).
    spans = sorted([(a, b, i) for a, b, i, o in plan if b >= a])
    for x, y in zip(spans, spans[1:]):
        if y[0] <= x[1]:
            raise ValueError("ops %d and %d touch overlapping lines." % (x[2] + 1, y[2] + 1))
    for a, b, i, o in plan:
        if b >= a:
            continue
        for sa, sb, si in spans:
            if sa < a <= sb:
                raise ValueError("ops %d and %d overlap: insert at line %d falls inside lines %d..%d." % (i + 1, si + 1, a, sa, sb))

    # Apply on the line list from the bottom up. At the same line a
    # replace/delete runs before the inserts, and inserts at one line are
    # applied last-given first, so they end up in the order given.
    new_lines = list(lines)
    plan.sort(key=lambda r: (r[0], 1 if r[3].get('op') != 'insert' else 0, r[2]), reverse=True)
    for a, b, idx, op in plan:
        kind = op.get('op')
        if kind == 'insert':
            new_lines[a - 1:a - 1] = _body(op.get('text', ''))
        elif kind == 'delete':
            del new_lines[a - 1:b]
        else:
            new_lines[a - 1:b] = _body(op.get('text', ''))

    eol = '\r\n' if '\r\n' in text else '\n'
    trailing = text.endswith('\n')
    new_text = eol.join(new_lines) + (eol if trailing and new_lines else '')

    # One replace over the differing region only.
    p = 0
    lim = min(len(text), len(new_text))
    while p < lim and text[p] == new_text[p]:
        p += 1
    s = 0
    while s < lim - p and text[len(text) - 1 - s] == new_text[len(new_text) - 1 - s]:
        s += 1
    if text != new_text:
        doc.replace(p, len(text) - p - s, new_text[p:len(new_text) - s])

    if SAVE:
        primary_project.save()
    print("Object: %s (%s)" % (OBJECT_PATH, PART))
    print("Operations applied: %d" % len(plan))
    print("Lines: %d -> %d" % (total, len(_lines(doc.text))))
    print("SCRIPT_SUCCESS: Lines edited.%s" % (" Project saved." if SAVE else ""))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in text_lines (%s) for '%s' in project %s: %s\n%s" % (MODE, OBJECT_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
