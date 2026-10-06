import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';

/**
 * Script-preparation tests for the SP21-coverage phase 3 application build
 * & object tools. No CODESYS required.
 */
describe('E2E Script Preparation — build & object tools (SP21 coverage phase 3)', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
  const mgr = new ScriptManager(scriptsDir);
  const P = { PROJECT_FILE_PATH: 'C:\\test.project' };

  it('application_build_action prepares all three actions', () => {
    for (const action of ['generate_code', 'rebuild', 'clean']) {
      const script = mgr.prepareScriptWithHelpers(
        'application_build_action', { ...P, ACTION: action }, ['ensure_project_open']
      );
      expect(script).toContain(`ACTION = "${action}"`);
      expect(script).toContain('active_application');
      expect(script).toContain('SCRIPT_SUCCESS');
    }
  });

  it('check_online_change prepares', () => {
    const script = mgr.prepareScriptWithHelpers('check_online_change', P, ['ensure_project_open']);
    expect(script).toContain('is_online_change_possible');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('move_object prepares with parent and index', () => {
    const script = mgr.prepareScriptWithHelpers(
      'move_object',
      { ...P, OBJECT_PATH: 'Application/MyPOU', NEW_PARENT_PATH: 'Application/Folder1', NEW_INDEX: '-1' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('def find_object_by_path_robust');
    expect(script).toContain('NEW_INDEX = -1');
    expect(script).toContain('.move(');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('get_signature_crc prepares', () => {
    const script = mgr.prepareScriptWithHelpers(
      'get_signature_crc',
      { ...P, OBJECT_PATH: 'Application/MyFB' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('get_signature_crc');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('set_exclude_from_build prepares with flag', () => {
    const script = mgr.prepareScriptWithHelpers(
      'set_exclude_from_build',
      { ...P, OBJECT_PATH: 'Application/TestPOU', EXCLUDE: 'True' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('EXCLUDE = True');
    expect(script).toContain('exclude_from_build');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('all phase-3 scripts are ASCII-only (IronPython 2.7 constraint)', () => {
    const names = [
      'application_build_action', 'check_online_change', 'move_object',
      'get_signature_crc', 'set_exclude_from_build',
    ];
    for (const name of names) {
      const content = mgr.loadTemplate(name);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content), `${name}.py must be ASCII-only`).toBe(true);
    }
  });
});
