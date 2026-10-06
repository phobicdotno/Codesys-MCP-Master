import sys, scriptengine as script_engine, os, traceback, json, re

# rename_symbol: rename an identifier everywhere in the project's textual
# code, and the object of that name too (a POU, DUT, GVL, method...). A dry
# run (the default) only reports what would change. Uses the st_identifiers
# helper; CODESYS has no scripting call for refactoring. Matching is by name
# (case-insensitive, like IEC 61131-3): two different variables with the
# same name in different POUs are both renamed unless OBJECTS limits it.
OLD = {OLD_PY}
NEW = {NEW_PY}
DRY_RUN = {DRY_RUN}
OBJECTS = {OBJECTS_PY}   # [] = whole project, else object paths (prefix match)

IEC_KEYWORDS = set("""ABS ACOS ACTION ADD AND ANY ARRAY ASIN AT ATAN BOOL BY BYTE CASE CONSTANT COS DATE DINT DIV
DO DT DWORD ELSE ELSIF END_ACTION END_CASE END_FOR END_FUNCTION END_FUNCTION_BLOCK END_IF END_INTERFACE
END_METHOD END_PROGRAM END_PROPERTY END_REPEAT END_STRUCT END_TYPE END_VAR END_WHILE EQ EXIT EXP EXTENDS FALSE
FOR FUNCTION FUNCTION_BLOCK GE GT IF IMPLEMENTS INT INTERFACE INT LE LINT LN LOG LREAL LT LWORD MAX METHOD MIN
MOD MOVE MUL MUX NE NOT OF OR POINTER PROGRAM PROPERTY REAL REFERENCE REPEAT RETAIN PERSISTENT RETURN SEL SHL
SHR SIN SINT SQRT STRING STRUCT SUB SUPER TAN THEN THIS TIME TO TOD TRUE TYPE UDINT UINT ULINT UNION UNTIL
USINT VAR VAR_CONFIG VAR_EXTERNAL VAR_GLOBAL VAR_IN_OUT VAR_INPUT VAR_INST VAR_OUTPUT VAR_STAT VAR_TEMP WHILE
WORD WSTRING XOR""".split())

try:
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", NEW) or "__" in NEW:
        raise ValueError("'%s' is not a valid IEC 61131-3 identifier." % NEW)
    if NEW.upper() in IEC_KEYWORDS:
        raise ValueError("'%s' is a reserved word." % NEW)
    if OLD.lower() == NEW.lower():
        raise ValueError("Old and new name are the same (IEC identifiers are case-insensitive).")

    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    docs, graphical = st_textual_objects(primary_project)

    def in_scope(path):
        return not OBJECTS or any(path == o or path.startswith(o.rstrip("/") + "/") for o in OBJECTS)

    # a clash: the new name already used anywhere in scope
    clashes = []
    for (path, obj, part, doc) in docs:
        if in_scope(path) and st_find_identifier(doc.text or "", NEW):
            clashes.append("%s (%s)" % (path, part))
    if clashes:
        raise ValueError("'%s' is already used in: %s. Rename refused." % (NEW, ", ".join(sorted(set(clashes))[:20])))

    changes = []
    for (path, obj, part, doc) in docs:
        if not in_scope(path):
            continue
        text = doc.text or ""
        new_text, n = st_replace_identifier(text, OLD, NEW)
        if n:
            changes.append({"object": path, "part": part, "count": n})
            if not DRY_RUN:
                doc.replace(new_text)  # whole-document replace, as set_pou_code does

    # the object carrying the old name (POU, DUT, GVL, method, ...)
    renamed_objects = []
    seen = set()
    for (path, obj, part, doc) in docs:
        if path in seen or not in_scope(path):
            continue
        seen.add(path)
        if path.split("/")[-1].lower() == OLD.lower() and hasattr(obj, "rename"):
            renamed_objects.append(path)
            if not DRY_RUN:
                obj.rename(NEW)

    if not DRY_RUN and (changes or renamed_objects):
        primary_project.save()

    print("### RENAME_START ###")
    print(json.dumps({
        "old": OLD,
        "new": NEW,
        "dry_run": DRY_RUN,
        "occurrences": sum(c["count"] for c in changes),
        "changes": changes,
        "renamed_objects": renamed_objects,
        "not_searched_graphical": graphical,
    }, indent=1))
    print("### RENAME_END ###")
    print("SCRIPT_SUCCESS: %s %d occurrence(s) of %s." % (
        "Would rename" if DRY_RUN else "Renamed", sum(c["count"] for c in changes), OLD))
    sys.exit(0)
except Exception as e:
    msg = "Error renaming %s to %s in %s: %s\n%s" % (OLD, NEW, PROJECT_FILE_PATH, e, traceback.format_exc())
    print(msg)
    print("SCRIPT_ERROR: %s" % msg)
    sys.exit(1)
