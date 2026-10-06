import sys, scriptengine as script_engine, os, traceback

# Compares the primary project (left) with another project file (right) via
# IScriptProject10.compare_to. The right project is opened as a NON-primary
# project with VersionUpdateFlags.NoUpdates and closed again afterwards; it
# is never saved. Read-only for both projects.

OTHER_PROJECT_PATH = r"{OTHER_PROJECT_PATH}"
IGNORE_WHITESPACE = {IGNORE_WHITESPACE}
IGNORE_COMMENTS = {IGNORE_COMMENTS}
IGNORE_PROPERTIES = {IGNORE_PROPERTIES}
SPLIT_RENAMES = {SPLIT_RENAMES}
MAX_ENTRIES = {MAX_ENTRIES}

def _path_of(obj):
    parts = []
    node = obj
    guard = 0
    while node is not None and guard < 64:
        guard += 1
        if not hasattr(node, 'get_name'):
            break
        try:
            parts.append(node.get_name())
        except Exception:
            break
        try:
            node = node.parent
        except Exception:
            node = None
    parts.reverse()
    return "/".join(parts)

_DIFF_NAMES = ['ADDED', 'DELETED', 'CONTENT_CHANGED', 'FOLDER_CHANGED',
               'ACCESS_RIGHTS_CHANGED', 'PROPERTIES_CHANGED', 'RENAMED']

def _diff_text(diff):
    od = script_engine.ObjectDifferences
    try:
        v = int(diff)
    except Exception:
        return str(diff)
    names = [n for n in _DIFF_NAMES if v & int(getattr(od, n))]
    return "|".join(names) if names else "EQUAL"

other = None
opened_here = False
exit_code = 1
try:
    print("DEBUG: compare_projects: left='%s' right='%s'" % (PROJECT_FILE_PATH, OTHER_PROJECT_PATH))
    left = ensure_project_open(PROJECT_FILE_PATH)
    if not hasattr(left, 'compare_to'):
        raise TypeError("compare_to is not available on this CODESYS version (needs IScriptProject10).")
    if not os.path.isfile(OTHER_PROJECT_PATH):
        raise ValueError("Other project not found: %s" % OTHER_PROJECT_PATH)
    norm = lambda p: os.path.normcase(os.path.abspath(p))
    if norm(OTHER_PROJECT_PATH) == norm(left.path):
        raise ValueError("Other project is the same file as the primary project.")

    for p in script_engine.projects.all:
        try:
            if norm(p.path) == norm(OTHER_PROJECT_PATH):
                other = p
        except Exception:
            pass
    if other is None:
        other = script_engine.projects.open(OTHER_PROJECT_PATH, primary=False,
                                            update_flags=script_engine.VersionUpdateFlags.NoUpdates,
                                            allow_readonly=True)
        opened_here = True
    if other is None:
        raise RuntimeError("Could not open the other project.")

    cf = script_engine.ComparisonFlags
    flags = cf.NONE
    if IGNORE_WHITESPACE: flags = flags | cf.IGNORE_WHITESPACE
    if IGNORE_COMMENTS: flags = flags | cf.IGNORE_COMMENTS
    if IGNORE_PROPERTIES: flags = flags | cf.IGNORE_PROPERTIES
    if SPLIT_RENAMES: flags = flags | cf.SPLIT_RENAMES

    result = left.compare_to(other, flags)
    changed = list(result.get_changed_objects(script_engine.ObjectDifferences.ANY_CHANGES))

    counts = {}
    rows = []
    for c in changed:
        dtxt = _diff_text(c.differences)
        for n in dtxt.split("|"):
            counts[n] = counts.get(n, 0) + 1
        lo = c.left_object
        ro = c.right_object
        lp = _path_of(lo) if lo is not None else ""
        rp = _path_of(ro) if ro is not None else ""
        if lp and rp and lp != rp:
            shown = "%s -> %s" % (lp, rp)
        else:
            shown = lp or rp
        rows.append((dtxt, shown))
    rows.sort(key=lambda r: (r[0], r[1]))

    print("### COMPARE_START ###")
    print("Left (primary): %s" % left.path)
    print("Right: %s" % OTHER_PROJECT_PATH)
    print("Flags: %s" % flags)
    print("Changed objects: %d" % len(rows))
    if counts:
        print("Summary: %s" % ", ".join("%s=%d" % (k, counts[k]) for k in sorted(counts)))
    for i, (d, s) in enumerate(rows):
        if MAX_ENTRIES > 0 and i >= MAX_ENTRIES:
            print("... %d more not shown (raise maxEntries)" % (len(rows) - MAX_ENTRIES))
            break
        print("%-24s %s" % (d, s))
    print("### COMPARE_END ###")
    print("SCRIPT_SUCCESS: Projects compared.")
    exit_code = 0
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error comparing '%s' with '%s': %s\n%s" % (PROJECT_FILE_PATH, OTHER_PROJECT_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    exit_code = 1
finally:
    if other is not None and opened_here:
        try:
            other.close()
            print("DEBUG: compare_projects: closed the other project (not saved).")
        except Exception as ce:
            print("DEBUG: compare_projects: closing the other project failed: %s" % ce)
sys.exit(exit_code)
