import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';

/**
 * Script-preparation tests for the SP21-coverage phase 2 project
 * lifecycle/interop tools. No CODESYS required.
 */
describe('E2E Script Preparation — project lifecycle tools (SP21 coverage phase 2)', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
  const mgr = new ScriptManager(scriptsDir);
  const P = { PROJECT_FILE_PATH: 'C:\\test.project' };

  it('close_project prepares with saveFirst flag', () => {
    const script = mgr.prepareScriptWithHelpers(
      'close_project', { ...P, SAVE_FIRST: 'True' }, ['ensure_project_open']
    );
    expect(script).toContain('SAVE_FIRST = True');
    expect(script).toContain('.close()');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('save_project_as prepares with password modes', () => {
    const script = mgr.prepareScriptWithHelpers(
      'save_project_as',
      { ...P, NEW_PATH: 'C:\\new.project', PASSWORD: '"__DISABLE__"' },
      ['ensure_project_open']
    );
    expect(script).toContain('NEW_PATH = r"C:\\new.project"');
    expect(script).toContain('__DISABLE__');
    expect(script).toContain('save_as');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('save_project_archive prepares with comment', () => {
    const script = mgr.prepareScriptWithHelpers(
      'save_project_archive',
      { ...P, ARCHIVE_PATH: 'C:\\out.projectarchive', COMMENT: '"release v1"' },
      ['ensure_project_open']
    );
    expect(script).toContain('ARCHIVE_PATH = r"C:\\out.projectarchive"');
    expect(script).toContain('save_archive');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('save_as_compiled_library prepares with optional destination', () => {
    const script = mgr.prepareScriptWithHelpers(
      'save_as_compiled_library', { ...P, DESTINATION: '' }, ['ensure_project_open']
    );
    expect(script).toContain('save_as_compiled_library');
    expect(script).toContain('.compiled_library');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('export_plcopen_xml prepares with object path and recursion', () => {
    const script = mgr.prepareScriptWithHelpers(
      'export_plcopen_xml',
      { ...P, EXPORT_PATH: 'C:\\out.xml', OBJECT_PATH: 'Application/MyPOU', RECURSIVE: 'True' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('def find_object_by_path_robust');
    expect(script).toContain('EXPORT_PATH = r"C:\\out.xml"');
    expect(script).toContain('export_xml');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('import_plcopen_xml prepares with folder structure flag', () => {
    const script = mgr.prepareScriptWithHelpers(
      'import_plcopen_xml',
      { ...P, IMPORT_PATH: 'C:\\in.xml', IMPORT_FOLDER_STRUCTURE: 'False' },
      ['ensure_project_open']
    );
    expect(script).toContain('IMPORT_FOLDER_STRUCTURE = False');
    expect(script).toContain('import_xml');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('export_native prepares with destination', () => {
    const script = mgr.prepareScriptWithHelpers(
      'export_native',
      { ...P, DESTINATION: 'C:\\out.export', OBJECT_PATH: '', RECURSIVE: 'True' },
      ['ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('DESTINATION = r"C:\\out.export"');
    expect(script).toContain('export_native');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('import_native prepares with import path', () => {
    const script = mgr.prepareScriptWithHelpers(
      'import_native', { ...P, IMPORT_PATH: 'C:\\in.export' }, ['ensure_project_open']
    );
    expect(script).toContain('import_native');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('get_project_info prepares with markers', () => {
    const script = mgr.prepareScriptWithHelpers('get_project_info', P, ['ensure_project_open']);
    expect(script).toContain('get_project_info');
    expect(script).toContain('### PROJECT_INFO_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('set_project_info prepares with selective fields', () => {
    const script = mgr.prepareScriptWithHelpers(
      'set_project_info',
      { ...P, COMPANY: '"ACME"', TITLE: '""', VERSION: '"1.0.0.0"', AUTHOR: '""', DESCRIPTION: '""' },
      ['ensure_project_open']
    );
    expect(script).toContain('COMPANY = "ACME"');
    expect(script).toContain('VERSION = "1.0.0.0"');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('get_compiler_version and set_compiler_version_to_newest prepare', () => {
    const get = mgr.prepareScriptWithHelpers('get_compiler_version', P, ['ensure_project_open']);
    expect(get).toContain('get_compilerversion');
    expect(get).toContain('SCRIPT_SUCCESS');
    const set = mgr.prepareScriptWithHelpers('set_compiler_version_to_newest', P, ['ensure_project_open']);
    expect(set).toContain('set_compilerversion_to_newest');
    expect(set).toContain('SCRIPT_SUCCESS');
  });

  it('clean_all prepares', () => {
    const script = mgr.prepareScriptWithHelpers('clean_all', P, ['ensure_project_open']);
    expect(script).toContain('clean_all');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('all phase-2 scripts are ASCII-only (IronPython 2.7 constraint)', () => {
    const names = [
      'close_project', 'save_project_as', 'save_project_archive',
      'save_as_compiled_library', 'export_plcopen_xml', 'import_plcopen_xml',
      'export_native', 'import_native', 'get_project_info', 'set_project_info',
      'get_compiler_version', 'set_compiler_version_to_newest', 'clean_all',
    ];
    for (const name of names) {
      const content = mgr.loadTemplate(name);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content), `${name}.py must be ASCII-only`).toBe(true);
    }
  });
});
