import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';
import { pyOptBool, pyOptString, pyTextLineOps } from '../../src/server';

/**
 * Script-preparation tests for the v0.20.0 scripting-API gap tools. No
 * CODESYS required; the live run is tests/live/api-gaps-live.mjs.
 */
describe('E2E Script Preparation - scripting API gap tools (v0.20.0)', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
  const mgr = new ScriptManager(scriptsDir);
  const P = { PROJECT_FILE_PATH: 'C:\\test.project' };
  const NAMES = ['compare_projects', 'plc_settings', 'text_lines', 'build_properties', 'open_project_archive',
    'device_description', 'plug_device', 'library_reference', 'create_iec_object'];

  it('pyOptBool / pyOptString map undefined to None', () => {
    expect(pyOptBool(undefined)).toBe('None');
    expect(pyOptBool(true)).toBe('True');
    expect(pyOptBool(false)).toBe('False');
    expect(pyOptString(undefined)).toBe('None');
    expect(pyOptString('')).toBe('""');
    expect(pyOptString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
  });

  it('pyTextLineOps builds a safe Python literal', () => {
    const lit = pyTextLineOps([
      { op: 'insert', line: 1, text: 'x := "{PROJECT_FILE_PATH}";\n// """ end' },
      { op: 'replace', line: 3.7, count: 2, text: 'y;', expect: "a\\b" },
      { op: 'delete', line: 5 },
    ]);
    expect(lit).toBe(
      "[{'op': \"insert\", 'line': 1, 'text': \"x := \\\"{PROJECT_FILE_PATH}\\\";\\n// \\\"\\\"\\\" end\"}, " +
      "{'op': \"replace\", 'line': 3, 'count': 2, 'text': \"y;\", 'expect': \"a\\\\b\"}, " +
      "{'op': \"delete\", 'line': 5}]"
    );
  });

  it('text_lines prepares get and edit, OPS last so caller text is not interpolated', () => {
    const get = mgr.prepareScriptWithHelpers('text_lines', {
      ...P, OBJECT_PATH: 'Application/Main', PART: 'implementation', MODE: 'get',
      START_LINE: '2', LINE_COUNT: '5', SAVE: 'False', OPS: '[]',
    }, ['ensure_project_open', 'find_object_by_path']);
    expect(get).toContain('MODE = "get"');
    expect(get).toContain('START_LINE = 2');
    expect(get).toContain('SCRIPT_SUCCESS');
    const ops = pyTextLineOps([{ op: 'insert', line: 1, text: '{MODE}' }]);
    const edit = mgr.prepareScriptWithHelpers('text_lines', {
      ...P, OBJECT_PATH: 'Application/Main', PART: 'declaration', MODE: 'edit',
      START_LINE: '1', LINE_COUNT: '0', SAVE: 'True', OPS: ops,
    }, ['ensure_project_open', 'find_object_by_path']);
    expect(edit).toContain('MODE = "edit"');
    expect(edit).toContain("'text': \"{MODE}\"");
    expect(edit).toContain('doc.replace(p, len(text) - p - s');
  });

  it('compare_projects prepares with flags and opens the other project NoUpdates', () => {
    const s = mgr.prepareScriptWithHelpers('compare_projects', {
      ...P, OTHER_PROJECT_PATH: 'C:\\other.project', IGNORE_WHITESPACE: 'True', IGNORE_COMMENTS: 'False',
      IGNORE_PROPERTIES: 'False', SPLIT_RENAMES: 'True', MAX_ENTRIES: '500',
    }, ['ensure_project_open']);
    expect(s).toContain('OTHER_PROJECT_PATH = r"C:\\other.project"');
    expect(s).toContain('SPLIT_RENAMES = True');
    expect(s).toContain('VersionUpdateFlags.NoUpdates');
    expect(s).toContain('primary=False');
    expect(s).toContain('compare_to(');
    expect(s).toContain('other.close()');
  });

  it('plc_settings prepares read and write', () => {
    const base = {
      ...P, DEVICE_PATH: '', BUS_CYCLE_TASK: 'None', UPDATE_IOS_WHILE_IN_STOP: 'None', OUTPUTS_ON_STOP: '',
      STOP_RESET_PROGRAM: 'None', ALWAYS_UPDATE_VARIABLES: '', GENERATE_FORCE_VARIABLES: 'None',
      ENABLE_DIAGNOSIS: 'None', IO_WARNINGS_AS_ERRORS: 'None',
    };
    const r = mgr.prepareScriptWithHelpers('plc_settings', { ...base, APPLY: 'False' },
      ['ensure_project_open', 'find_object_by_path', 'find_device_object']);
    expect(r).toContain('APPLY = False');
    expect(r).toContain('driver_info');
    const w = mgr.prepareScriptWithHelpers('plc_settings', { ...base, APPLY: 'True', OUTPUTS_ON_STOP: 'keep', UPDATE_IOS_WHILE_IN_STOP: 'True' },
      ['ensure_project_open', 'find_object_by_path', 'find_device_object']);
    expect(w).toContain('OUTPUTS_ON_STOP = "keep"');
    expect(w).toContain('UPDATE_IOS_WHILE_IN_STOP = True');
    expect(w).toContain('StopResetBehaviour');
  });

  it('build_properties, library_reference, create_iec_object, plug_device, device_description and open_project_archive prepare', () => {
    const bp = mgr.prepareScriptWithHelpers('build_properties', {
      ...P, OBJECT_PATH: 'Application/GVL', APPLY: 'True', EXCLUDE_FROM_BUILD: 'None', LINK_ALWAYS: 'True',
      EXTERNAL: 'None', ENABLE_SYSTEM_CALL: 'None', COMPILER_DEFINES: '"A,B"',
    }, ['ensure_project_open', 'find_object_by_path']);
    expect(bp).toContain('LINK_ALWAYS = True');
    expect(bp).toContain('COMPILER_DEFINES = "A,B"');
    expect(bp).toContain('_is_valid');
    expect(bp).not.toContain('project_defines =');

    const lr = mgr.prepareScriptWithHelpers('library_reference', {
      ...P, MODE: 'set', LIB_NAME: 'Util', PARAM_NAME: 'MAX', PARAM_VALUE: '"10"', QUALIFIED_ONLY: 'True',
      OPTIONAL: 'None', NAMESPACE: 'None', HIDE_WHEN_DEPENDENCY: 'None', PUBLISH_SYMBOLS: 'None',
    }, ['ensure_project_open']);
    expect(lr).toContain('MODE = "set"');
    expect(lr).toContain('download_missing_libraries');

    const io = mgr.prepareScriptWithHelpers('create_iec_object', {
      ...P, KIND: 'interface', PARENT_PATH: '', NAME: 'I_X', BASE_INTERFACES: 'I_Base',
      SET_DECLARATION: 'False', SET_IMPLEMENTATION: 'False', DECLARATION_CONTENT: '', IMPLEMENTATION_CONTENT: '',
    }, ['ensure_project_open', 'find_object_by_path']);
    expect(io).toContain('KIND = "interface"');
    expect(io).toContain('create_persistentvars');

    const pd = mgr.prepareScriptWithHelpers('plug_device', {
      ...P, ACTION: 'plug', PARENT_PATH: 'PLC/Rack', SLOT_INDEX: '2', DEVICE_PATH: '', NEW_NAME: 'M1',
      DEVICE_TYPE: '8000', DEVICE_ID: '0000 1', DEVICE_VERSION: '1.0.0.0', MODULE_ID: 'None',
    }, ['ensure_project_open', 'find_object_by_path']);
    expect(pd).toContain('SLOT_INDEX = 2');
    expect(pd).toContain('.plug(');

    const dd = mgr.prepareScript('device_description', {
      ACTION: 'remove_device', FILE_PATH: '', DEVICE_TYPE: '8000', DEVICE_ID: '0000 1', DEVICE_VERSION: '1.0.0.0', SOURCE_NAME: '',
    });
    expect(dd).toContain('ACTION = "remove_device"');
    expect(dd).toContain('remove_device(');

    const oa = mgr.prepareScript('open_project_archive', { ARCHIVE_PATH: 'C:\\a.projectarchive', TARGET_DIR: 'C:\\x', OVERWRITE: 'False' });
    expect(oa).toContain('VersionUpdateFlags.NoUpdates');
    expect(oa).toContain('open_archive(');
  });

  it('configure_task carries the watchdog and core binding fields', () => {
    const s = mgr.prepareScriptWithHelpers('configure_task', {
      ...P, APPLICATION_PATH: 'None', TASK_NAME: 'MainTask', KIND: '', PRIORITY: '', INTERVAL: '', INTERVAL_UNIT: '',
      EVENT: '""', WATCHDOG_ENABLED: 'True', WATCHDOG_TIME: '"100"', WATCHDOG_TIME_UNIT: '"ms"',
      WATCHDOG_SENSITIVITY: '"2"', CORE_BINDING: 'None',
    }, ['ensure_project_open', 'select_application']);
    expect(s).toContain('WATCHDOG_ENABLED = True');
    expect(s).toContain('WATCHDOG_TIME = "100"');
    expect(s).toContain('wd.enabled = WATCHDOG_ENABLED');
    expect(s).not.toMatch(/\{WATCHDOG_[A-Z_]+\}/);
  });

  it('every new script has no unreplaced placeholders when fully parameterised and is ASCII-only', () => {
    for (const name of NAMES) {
      const content = mgr.loadTemplate(name);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content), `${name}.py must be ASCII-only`).toBe(true);
      expect(content, `${name}.py reports success`).toContain('SCRIPT_SUCCESS');
      expect(content, `${name}.py reports errors`).toContain('SCRIPT_ERROR');
    }
  });
});
