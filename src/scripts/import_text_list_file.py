import sys, scriptengine as script_engine, os, traceback

TEXTLIST_PATH = "{TEXTLIST_PATH}"
IMPORT_FILE = r"{IMPORT_FILE}"


def _read_text(path):
    import codecs
    raw = open(path, 'rb').read()
    if raw[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE):
        return raw.decode('utf-16')
    if raw[:3] == codecs.BOM_UTF8:
        raw = raw[3:]
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1252')


def _import_rows(tl, path):
    """Same file layout as importfile: header 'ID<TAB>Default<TAB><lang>...',
    then one row per text. Existing IDs are updated, new ones added."""
    lines = [l for l in _read_text(path).splitlines() if l.strip()]
    if not lines:
        raise ValueError("Import file is empty: %s" % path)
    header = lines[0].split('\t')
    if len(header) < 2 or header[0].strip().lower() != 'id':
        raise ValueError("Expected a header line 'ID<TAB>Default<TAB><language>...' in %s" % path)
    langs = [h.strip() for h in header[2:] if h.strip()]
    for lang in langs:
        try:
            tl.addlanguage(lang)
        except Exception:
            pass  # already there
    existing = {}
    for r in tl.rows:
        existing[str(r.id)] = r
    added = updated = 0
    for line in lines[1:]:
        cols = line.split('\t')
        rid = cols[0].strip()
        if not rid:
            continue
        default = cols[1] if len(cols) > 1 else ''
        row = existing.get(rid)
        if row is None:
            row = tl.rows.add(rid, default)
            if row is None:
                row = [r for r in tl.rows if str(r.id) == rid][0]
            added += 1
        else:
            row.setdefaulttext(default)
            updated += 1
        for i, lang in enumerate(langs):
            if len(cols) > 2 + i:
                row.setlanguagetext(lang, cols[2 + i])
    print("Rows added: %d, updated: %d, languages: %s" % (added, updated, ', '.join(langs) or '-'))


try:
    print("DEBUG: import_text_list_file script: TextList='%s', File='%s', Project='%s'" % (
        TEXTLIST_PATH, IMPORT_FILE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not TEXTLIST_PATH:
        raise ValueError("Text list path empty.")
    if not IMPORT_FILE or not os.path.isfile(IMPORT_FILE):
        raise ValueError("Import file does not exist: %s" % IMPORT_FILE)

    tl = find_object_by_path_robust(primary_project, TEXTLIST_PATH, "text list")
    if not tl:
        raise ValueError("Text list not found at path: %s" % TEXTLIST_PATH)
    if not (hasattr(tl, 'is_textlist') and tl.is_textlist):
        raise TypeError("Object at '%s' is not a text list." % TEXTLIST_PATH)

    try:
        tl.importfile(IMPORT_FILE)
    except Exception as imp_err:
        # CODESYS only says "Index was out of range" for a file whose header
        # has no language column (seen on SP18 and SP21).
        if 'index' in str(imp_err).lower():
            raise ValueError(
                "CODESYS could not read '%s' (%s). Expected a tab-separated file with a header line "
                "'ID<TAB>Default<TAB><language>...' and at least one language column (e.g. 'en'), "
                "then one row per text: 'ID<TAB>default text<TAB>translation'." % (IMPORT_FILE, imp_err))
        if 'guid' not in str(imp_err).lower():
            raise
        # SP19's importfile fails on any file with "The object GUID
        # '00000000-...' is not valid" (seen 2026-10-05). Fill the list row by
        # row instead: rows.add / setdefaulttext / setlanguagetext.
        print("DEBUG: importfile failed (%s); importing row by row." % imp_err)
        _import_rows(tl, IMPORT_FILE)
    primary_project.save()

    print("Text List: %s" % TEXTLIST_PATH)
    print("Imported: %s" % IMPORT_FILE)
    print("SCRIPT_SUCCESS: Text list entries imported. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error importing text list file into '%s' in %s: %s\n%s" % (
        TEXTLIST_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
