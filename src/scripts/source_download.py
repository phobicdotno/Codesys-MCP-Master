import sys, scriptengine as script_engine, os, traceback

COMPACT = {COMPACT}

try:
    print("DEBUG: source_download script: compact=%s, Project='%s'" % (COMPACT, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    # With unsaved changes CODESYS asks "Downloading the source requires the
    # project to be saved first" (Yes/No) and the call hangs on it. Our tools
    # never save a project on their own, so refuse and let the caller decide.
    if getattr(primary_project, 'dirty', False):
        raise RuntimeError(
            "The project has unsaved changes, and a source download needs it saved first "
            "(CODESYS would ask). Save it (save_project) and retry.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    # Clear a stale Archive.prj in the project dir -- a previously failed
    # attempt leaves one behind and the engine then fails with 'file is
    # being used by another process'.
    stale = os.path.join(os.path.dirname(PROJECT_FILE_PATH), 'Archive.prj')
    if os.path.exists(stale):
        try:
            os.remove(stale)
            print("DEBUG: removed stale %s" % stale)
        except Exception as e:
            print("DEBUG: could not remove stale Archive.prj: %s" % e)

    online_device = online_app.get_online_device()
    done = False
    if COMPACT and hasattr(online_device, 'download_source'):
        # Device-level call carries the compact option, but on SP21 it tries
        # to write its temp file into the CODESYS install dir (Program
        # Files) and dies with access-denied. Try it only when compact was
        # explicitly requested.
        try:
            online_device.download_source(COMPACT)
            print("DEBUG: online_device.download_source(bCompact=%s) OK" % COMPACT)
            done = True
        except Exception as e:
            print("DEBUG: online_device.download_source failed: %s -- falling back to app-level (full, not compact)." % e)
    if not done:
        # Application-level source_download (no compact option).
        online_app.source_download()
        print("DEBUG: online_app.source_download() OK%s" % (" (compact unavailable)" if COMPACT else ""))

    print("Compact: %s" % COMPACT)
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Source archive downloaded to device.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error downloading source to device for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
