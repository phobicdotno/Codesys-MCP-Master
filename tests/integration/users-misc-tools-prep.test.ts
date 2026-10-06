import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';

/**
 * Script-preparation tests for the SP21-coverage phase 5 project-user &
 * misc object tools. No CODESYS required.
 */
describe('E2E Script Preparation — users & misc tools (SP21 coverage phase 5)', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
  const mgr = new ScriptManager(scriptsDir);
  const P = { PROJECT_FILE_PATH: 'C:\\test.project' };

  it('list_project_users prepares with markers', () => {
    const script = mgr.prepareScriptWithHelpers('list_project_users', P, ['ensure_project_open']);
    expect(script).toContain('user_management');
    expect(script).toContain('### USERS_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('add_project_user prepares with optional fields', () => {
    const script = mgr.prepareScriptWithHelpers(
      'add_project_user',
      { ...P, USER_NAME: 'alice', FULL_NAME: '"Alice A"', PASSWORD: '"s3cret"', ADMIN_USER: '""', ADMIN_PASSWORD: '""' },
      ['ensure_project_open']
    );
    expect(script).toContain('USER_NAME = "alice"');
    expect(script).toContain('change_password');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('remove_project_user prepares', () => {
    const script = mgr.prepareScriptWithHelpers(
      'remove_project_user',
      { ...P, USER_NAME: 'alice', ADMIN_USER: '""', ADMIN_PASSWORD: '""' },
      ['ensure_project_open']
    );
    expect(script).toContain('.remove()');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('create_text_list prepares with parent path', () => {
    const script = mgr.prepareScriptWithHelpers(
      'create_text_list',
      { ...P, LIST_NAME: 'Alarms', PARENT_PATH: '' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('create_textlist');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('import_text_list_file prepares', () => {
    const script = mgr.prepareScriptWithHelpers(
      'import_text_list_file',
      { ...P, TEXTLIST_PATH: 'Alarms', IMPORT_FILE: 'C:\\texts.csv' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('importfile');
    expect(script).toContain('is_textlist');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('create_image_pool prepares', () => {
    const script = mgr.prepareScriptWithHelpers(
      'create_image_pool',
      { ...P, POOL_NAME: 'Icons', PARENT_PATH: '' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('create_imagepool');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('add_external_file prepares with enums', () => {
    const script = mgr.prepareScriptWithHelpers(
      'add_external_file',
      {
        ...P, FILE_PATH: 'C:\\doc.pdf', OBJECT_NAME: '', PARENT_PATH: '',
        REFERENCE_MODE: 'embed', AUTO_UPDATE_MODE: 'never',
      },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('create_external_file_object');
    expect(script).toContain('ReferenceMode');
    expect(script).toContain('AutoUpdateMode');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('all phase-5 scripts are ASCII-only (IronPython 2.7 constraint)', () => {
    const names = [
      'list_project_users', 'add_project_user', 'remove_project_user',
      'create_text_list', 'import_text_list_file', 'create_image_pool',
      'add_external_file',
    ];
    for (const name of names) {
      const content = mgr.loadTemplate(name);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content), `${name}.py must be ASCII-only`).toBe(true);
    }
  });
});
