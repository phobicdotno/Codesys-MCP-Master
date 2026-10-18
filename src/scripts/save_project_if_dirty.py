import sys, scriptengine as script_engine, os, traceback

# Save only when the project has unsaved changes. release_project_version
# runs this before it fingerprints the .project: an unconditional save can
# rewrite an unchanged project and the changed SHA would count as a change.
try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    dirty = True
    try:
        dirty = bool(primary_project.dirty)
    except Exception as e:
        print("DEBUG: project.dirty not readable (%s); saving to be safe" % e)
    if dirty:
        primary_project.save()
        print("DEBUG: project had unsaved changes; saved.")
    else:
        print("DEBUG: project has no unsaved changes; not saved.")
    print("SCRIPT_SUCCESS: save check done.")
    sys.exit(0)
except Exception as e:
    error_message = "Error in save check for %s: %s" % (PROJECT_FILE_PATH, e)
    print(error_message)
    traceback.print_exc()
    print("SCRIPT_ERROR: %s" % error_message); sys.exit(1)
