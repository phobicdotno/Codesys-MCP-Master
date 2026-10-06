import sys, scriptengine as script_engine, os, traceback

# Extracts and opens a .projectarchive (projects.open_archive) as the primary
# project. Always VersionUpdateFlags.NoUpdates: libraries, devices and the
# compiler version stay exactly as archived (never an upgrade on open).

ARCHIVE_PATH = r"{ARCHIVE_PATH}"
TARGET_DIR = r"{TARGET_DIR}"
OVERWRITE = {OVERWRITE}

try:
    print("DEBUG: open_project_archive: archive='%s' target='%s' overwrite=%s" % (ARCHIVE_PATH, TARGET_DIR, OVERWRITE))
    if not os.path.isfile(ARCHIVE_PATH):
        raise ValueError("Archive not found: %s" % ARCHIVE_PATH)
    if not os.path.isdir(TARGET_DIR):
        os.makedirs(TARGET_DIR)
    base = os.path.splitext(os.path.basename(ARCHIVE_PATH))[0]
    target = os.path.join(TARGET_DIR, base + ".project")
    if os.path.exists(target) and not OVERWRITE:
        raise ValueError("Target project already exists: %s (pass overwrite=true to replace it)." % target)

    prim = script_engine.projects.primary
    if prim is not None:
        if getattr(prim, 'dirty', False):
            raise RuntimeError("The open project '%s' has unsaved changes; save or close it first." % prim.path)
        prev_path = prim.path
        prim.close()
        print("DEBUG: closed the previous primary project: %s" % prev_path)

    before_projects = set(f for f in os.listdir(TARGET_DIR) if f.lower().endswith('.project'))
    proj = script_engine.projects.open_archive(ARCHIVE_PATH, TARGET_DIR, OVERWRITE,
                                               update_flags=script_engine.VersionUpdateFlags.NoUpdates)
    if proj is None:
        # SP21 P5 / SP22 P1: open_archive extracts the files but neither opens
        # the project nor returns it (verified live 2026-10-05). Open the
        # extracted project ourselves, again with NoUpdates.
        prim = script_engine.projects.primary
        if prim is not None and os.path.normcase(os.path.abspath(prim.path)) == os.path.normcase(os.path.abspath(target)):
            proj = prim
        else:
            # The extracted file carries the ORIGINAL project name (can differ
            # from the archive name) and the archived timestamp, so take the
            # .project that is new in the folder; with overwrite, fall back
            # to the archive-named one.
            now_projects = set(f for f in os.listdir(TARGET_DIR) if f.lower().endswith('.project'))
            fresh = [os.path.join(TARGET_DIR, f) for f in sorted(now_projects - before_projects)]
            if not fresh and os.path.isfile(target):
                fresh = [target]
            if len(fresh) != 1:
                raise RuntimeError("open_archive returned no project; extracted .project files: %s" % (fresh or 'none'))
            print("DEBUG: open_archive returned None; opening the extracted project %s" % fresh[0])
            proj = script_engine.projects.open(fresh[0], update_flags=script_engine.VersionUpdateFlags.NoUpdates)
        if proj is None:
            raise RuntimeError("Could not open the extracted project.")
    print("Archive: %s" % ARCHIVE_PATH)
    print("Project: %s" % proj.path)
    print("Primary: %s" % (script_engine.projects.primary is not None and script_engine.projects.primary.path == proj.path))
    print("SCRIPT_SUCCESS: Archive extracted and opened.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error opening archive '%s': %s\n%s" % (ARCHIVE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
