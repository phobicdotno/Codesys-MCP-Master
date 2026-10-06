import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';

/**
 * Script-preparation tests for the SP21-coverage phase 1 online/runtime
 * tools. Like e2e.test.ts these don't require CODESYS — they verify the
 * template + helper + interpolation pipeline end-to-end.
 */
describe('E2E Script Preparation — online runtime tools (SP21 coverage phase 1)', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
  const mgr = new ScriptManager(scriptsDir);
  const ONLINE_HELPERS = ['ensure_project_open', 'ensure_online_connection'];

  it('reset_application prepares with level and online helpers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'reset_application',
      { PROJECT_FILE_PATH: 'C:\\test.project', RESET_LEVEL: 'warm' },
      ONLINE_HELPERS
    );
    expect(script).toContain('def ensure_project_open');
    expect(script).toContain('def ensure_online_connection');
    expect(script).toContain('RESET_LEVEL = "warm"');
    expect(script).toContain('ResetOption');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('read_variables prepares with a Python list literal', () => {
    const script = mgr.prepareScriptWithHelpers(
      'read_variables',
      { PROJECT_FILE_PATH: 'C:\\test.project', EXPRESSIONS_PY: '["PLC_PRG.bRun", "GVL.nCounter"]' },
      ONLINE_HELPERS
    );
    expect(script).toContain('EXPRESSIONS = ["PLC_PRG.bRun", "GVL.nCounter"]');
    expect(script).toContain('read_values');
    expect(script).toContain('### VALUES_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('write_variables prepares with assignment tuples', () => {
    const script = mgr.prepareScriptWithHelpers(
      'write_variables',
      { PROJECT_FILE_PATH: 'C:\\test.project', ASSIGNMENTS_PY: '[("PLC_PRG.bRun", "TRUE"), ("GVL.n", "42")]' },
      ONLINE_HELPERS
    );
    expect(script).toContain('ASSIGNMENTS = [("PLC_PRG.bRun", "TRUE"), ("GVL.n", "42")]');
    expect(script).toContain('write_prepared_values');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('force_variables prepares and commits via force_prepared_values', () => {
    const script = mgr.prepareScriptWithHelpers(
      'force_variables',
      { PROJECT_FILE_PATH: 'C:\\test.project', ASSIGNMENTS_PY: '[("PLC_PRG.bOverride", "TRUE")]' },
      ONLINE_HELPERS
    );
    expect(script).toContain('force_prepared_values');
    expect(script).toContain('get_forced_expressions');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('unforce_variables supports both all and selective unforce', () => {
    const script = mgr.prepareScriptWithHelpers(
      'unforce_variables',
      { PROJECT_FILE_PATH: 'C:\\test.project', EXPRESSIONS_PY: '[]', RESTORE: 'False' },
      ONLINE_HELPERS
    );
    expect(script).toContain('EXPRESSIONS = []');
    expect(script).toContain('RESTORE = False');
    expect(script).toContain('unforce_all_values');
    expect(script).toContain('set_unforce_value');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('list_forced_variables prepares with markers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'list_forced_variables',
      { PROJECT_FILE_PATH: 'C:\\test.project' },
      ONLINE_HELPERS
    );
    expect(script).toContain('get_forced_expressions');
    expect(script).toContain('### FORCED_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('create_boot_application prepares both online and offline modes', () => {
    const script = mgr.prepareScriptWithHelpers(
      'create_boot_application',
      { PROJECT_FILE_PATH: 'C:\\test.project', ONLINE_MODE: 'False', OUTPUT_PATH: 'C:\\out\\app.app' },
      ONLINE_HELPERS
    );
    expect(script).toContain('ONLINE_MODE = False');
    expect(script).toContain('OUTPUT_PATH = r"C:\\out\\app.app"');
    expect(script).toContain('active_application');
    expect(script).toContain('create_boot_application');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('source_download prepares with compact flag', () => {
    const script = mgr.prepareScriptWithHelpers(
      'source_download',
      { PROJECT_FILE_PATH: 'C:\\test.project', COMPACT: 'True' },
      ONLINE_HELPERS
    );
    expect(script).toContain('COMPACT = True');
    expect(script).toContain('download_source');
    expect(script).toContain('source_download');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('source_upload prepares with archive path', () => {
    const script = mgr.prepareScriptWithHelpers(
      'source_upload',
      { PROJECT_FILE_PATH: 'C:\\test.project', ARCHIVE_PATH: 'C:\\temp\\up.prj' },
      ONLINE_HELPERS
    );
    expect(script).toContain('ARCHIVE_PATH = r"C:\\temp\\up.prj"');
    expect(script).toContain('upload_source');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('plc_file_list prepares with directory and markers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'plc_file_list',
      { PROJECT_FILE_PATH: 'C:\\test.project', PLC_DIRECTORY: '"PlcLogic"' },
      ONLINE_HELPERS
    );
    expect(script).toContain('PLC_DIRECTORY = "PlcLogic"');
    expect(script).toContain('get_file_list_of_directory');
    expect(script).toContain('### FILES_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('plc_file_transfer prepares both directions', () => {
    const script = mgr.prepareScriptWithHelpers(
      'plc_file_transfer',
      {
        PROJECT_FILE_PATH: 'C:\\test.project',
        DIRECTION: 'to_plc',
        LOCAL_PATH: 'C:\\local\\f.txt',
        PLC_PATH: '"PlcLogic/f.txt"',
        FORCE_OVERWRITE: 'True',
      },
      ONLINE_HELPERS
    );
    expect(script).toContain('DIRECTION = "to_plc"');
    expect(script).toContain('FORCE_OVERWRITE = True');
    expect(script).toContain('download_file');
    expect(script).toContain('upload_file');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('plc_file_delete prepares file and directory variants', () => {
    const script = mgr.prepareScriptWithHelpers(
      'plc_file_delete',
      { PROJECT_FILE_PATH: 'C:\\test.project', PLC_PATH: '"PlcLogic/old.txt"', IS_DIRECTORY: 'False', RECURSIVE: 'False' },
      ONLINE_HELPERS
    );
    expect(script).toContain('PLC_PATH = "PlcLogic/old.txt"');
    expect(script).toContain('delete_file');
    expect(script).toContain('delete_directory');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('all phase-1 scripts are ASCII-only (IronPython 2.7 constraint)', () => {
    const names = [
      'reset_application', 'read_variables', 'write_variables', 'force_variables',
      'unforce_variables', 'list_forced_variables', 'create_boot_application',
      'source_download', 'source_upload', 'plc_file_list', 'plc_file_transfer',
      'plc_file_delete',
    ];
    for (const name of names) {
      const content = mgr.loadTemplate(name);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content), `${name}.py must be ASCII-only`).toBe(true);
    }
  });
});
