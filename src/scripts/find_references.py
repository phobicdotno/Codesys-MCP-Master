import sys, scriptengine as script_engine, os, traceback, json

# find_references: every use of an identifier in the project's textual code
# (declarations and implementations of POUs, methods, properties, actions,
# DUTs, GVLs, interfaces). Uses the st_identifiers helper; CODESYS has no
# scripting call for cross-references.
NAME = {NAME_PY}
MAX_RESULTS = {MAX_RESULTS}

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    docs, graphical = st_textual_objects(primary_project)
    results = []
    total = 0
    for (path, obj, part, doc) in docs:
        try:
            text = doc.text or ""
        except Exception:
            continue
        for hit in st_find_identifier(text, NAME):
            total += 1
            if len(results) < MAX_RESULTS:
                hit["object"] = path
                hit["part"] = part
                results.append(hit)
    # objects named like the symbol (its definition, if it is a POU/DUT/GVL)
    defined = []
    for (path, obj, part, doc) in docs:
        if part == "declaration" and path.split("/")[-1].lower() == NAME.lower():
            defined.append(path)
    print("### REFERENCES_START ###")
    print(json.dumps({
        "name": NAME,
        "total": total,
        "shown": len(results),
        "objects_named_like_it": defined,
        "references": results,
        "not_searched_graphical": graphical,
    }, indent=1))
    print("### REFERENCES_END ###")
    print("SCRIPT_SUCCESS: %d reference(s) to %s." % (total, NAME))
    sys.exit(0)
except Exception as e:
    msg = "Error finding references to %s in %s: %s\n%s" % (NAME, PROJECT_FILE_PATH, e, traceback.format_exc())
    print(msg)
    print("SCRIPT_ERROR: %s" % msg)
    sys.exit(1)
