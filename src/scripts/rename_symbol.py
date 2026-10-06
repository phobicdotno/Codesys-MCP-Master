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

# Keywords, operators, elementary types and the blocks of the Standard
# library: a new name must not collide with any of them. Names from other
# libraries are not known here; compile after a rename to catch those.
RESERVED = set("""ABS ABSTRACT ACOS ACTION ADD ADR AND ANY ANY_BIT ANY_DATE ANY_DERIVED ANY_ELEMENTARY ANY_INT
ANY_MAGNITUDE ANY_NUM ANY_REAL ANY_STRING ARRAY ASIN AT ATAN BIT BITADR BOOL BY BYTE CASE CHAR CONSTANT CONTINUE
COS DATE DATE_AND_TIME DINT DIV DO DT DWORD ELSE ELSIF END_ACTION END_CASE END_FOR END_FUNCTION
END_FUNCTION_BLOCK END_IF END_INTERFACE END_METHOD END_PROGRAM END_PROPERTY END_REPEAT END_STRUCT END_TYPE
END_UNION END_VAR END_WHILE EQ EXIT EXP EXPT EXTENDS FALSE FINAL FOR FUNCTION FUNCTION_BLOCK GE GT IF IMPLEMENTS
INDEXOF INT INTERFACE INTERNAL JMP LDATE LDT LE LIMIT LINT LN LOG LREAL LT LTIME LTOD LWORD MAX METHOD MIN MOD
MOVE MUL MUX NE NOT OF OR POINTER PRIVATE PROGRAM PROPERTY PROTECTED PUBLIC REAL REF REFERENCE REPEAT RETAIN
PERSISTENT RETURN ROL ROR SEL SHL SHR SIN SINT SIZEOF SQRT STRING STRUCT SUB SUPER TAN THEN THIS TIME
TIME_OF_DAY TO TOD TRUE TRUNC TYPE UDINT UINT ULINT UNION UNTIL USINT VAR VAR_CONFIG VAR_EXTERNAL VAR_GLOBAL
VAR_IN_OUT VAR_INPUT VAR_INST VAR_OUTPUT VAR_STAT VAR_TEMP WCHAR WHILE WORD WSTRING XOR XSIZEOF
TON TOF TP RTC R_TRIG F_TRIG CTU CTD CTUD SR RS SEMA""".split())

try:
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", NEW) or "__" in NEW:
        raise ValueError("'%s' is not a valid IEC 61131-3 identifier." % NEW)
    if NEW.upper() in RESERVED:
        raise ValueError("'%s' is a reserved word, an elementary type or a Standard library block." % NEW)
    # the same names set_pou_code refuses: time-literal suffixes and S/R
    if NEW in ("s", "t", "d", "m", "h", "ms", "us", "ns", "S", "R"):
        raise ValueError("'%s' collides with a time-literal suffix or the S/R flip-flop inputs; pick a longer name." % NEW)
    if OLD.lower() == NEW.lower():
        raise ValueError("Old and new name are the same (IEC identifiers are case-insensitive).")

    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    docs, graphical = st_textual_objects(primary_project)

    def in_scope(path):
        return not OBJECTS or any(path == o or path.startswith(o.rstrip("/") + "/") for o in OBJECTS)

    # The new name must not be used anywhere in the project, also outside
    # the scope: a local named like a global would shadow it.
    clashes = []
    for (path, obj, part, doc) in docs:
        if st_find_identifier(doc.text or "", NEW) or path.split("/")[-1].lower() == NEW.lower():
            clashes.append("%s (%s)" % (path, part))
    if clashes:
        raise ValueError("'%s' is already used in: %s. Rename refused." % (NEW, ", ".join(sorted(set(clashes))[:20])))

    # The object carrying the old name (POU, DUT, GVL, method...).
    named = []
    seen = set()
    for (path, obj, part, doc) in docs:
        if path not in seen and path.split("/")[-1].lower() == OLD.lower() and hasattr(obj, "rename"):
            seen.add(path)
            named.append((path, obj))
    if OBJECTS and any(in_scope(p) for (p, o) in named):
        outside = sorted(set(path for (path, obj, part, doc) in docs
                             if not in_scope(path) and st_find_identifier(doc.text or "", OLD)))
        if outside:
            raise ValueError("Renaming the object '%s' inside the scope would break its uses outside it: %s. "
                             "Rename without 'objects', or widen the scope." % (OLD, ", ".join(outside[:20])))

    changes = []
    planned = []
    for (path, obj, part, doc) in docs:
        if not in_scope(path):
            continue
        text = doc.text or ""
        new_text, n = st_replace_identifier(text, OLD, NEW)
        if n:
            changes.append({"object": path, "part": part, "count": n})
            planned.append((doc, text, new_text))
    renamed_objects = [p for (p, o) in named if in_scope(p)]

    if not DRY_RUN and (planned or renamed_objects):
        done = []
        try:
            for (doc, old_text, new_text) in planned:
                doc.replace(new_text)  # whole-document replace, as set_pou_code does
                done.append((doc, old_text))
            for (p, o) in named:
                if in_scope(p):
                    o.rename(NEW)
        except Exception:
            # put the text back so the project is not left half renamed
            for (doc, old_text) in reversed(done):
                try:
                    doc.replace(old_text)
                except Exception:
                    pass
            raise
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
