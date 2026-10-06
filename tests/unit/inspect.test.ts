import { describe, it, expect } from 'vitest';
import { parseInspectionXml } from '../../src/inspect';

const buildXml = (opts: {
  profileName?: string;
  profileVersion?: string;
  mandatory?: Array<{
    typeGuid?: string;
    pluginName?: string;
    pluginVersion?: string;
    packageName?: string;
    packageVersion?: string;
  }>;
  optional?: Array<{ packageName?: string; packageVersion?: string }>;
}) => {
  const detail = (e: NonNullable<typeof opts.mandatory>[number]) => {
    const parts: string[] = ['    <ProjectInspectionDetail>'];
    if (e.typeGuid !== undefined) parts.push(`      <TypeGuid>${e.typeGuid}</TypeGuid>`);
    if (e.pluginName !== undefined) parts.push(`      <OwningPluginName>${e.pluginName}</OwningPluginName>`);
    if (e.pluginVersion !== undefined) parts.push(`      <OwningPluginVersion>${e.pluginVersion}</OwningPluginVersion>`);
    if (e.packageName !== undefined) parts.push(`      <OwningPackageName>${e.packageName}</OwningPackageName>`);
    if (e.packageVersion !== undefined) parts.push(`      <OwningPackageVersion>${e.packageVersion}</OwningPackageVersion>`);
    parts.push('    </ProjectInspectionDetail>');
    return parts.join('\n');
  };

  const mandatory = (opts.mandatory ?? []).map(detail).join('\n');
  const optional = (opts.optional ?? [])
    .map((e) =>
      detail({
        typeGuid: '00000000-0000-0000-0000-000000000000',
        packageName: e.packageName,
        packageVersion: e.packageVersion,
      })
    )
    .join('\n');

  return [
    '<?xml version="1.0"?>',
    '<ProjectInspectionData>',
    `  <ProfileName>${opts.profileName ?? ''}</ProfileName>`,
    `  <ProfileVersion>${opts.profileVersion ?? ''}</ProfileVersion>`,
    '  <MandatoryTypes>',
    mandatory,
    '  </MandatoryTypes>',
    '  <OptionalPackages>',
    optional,
    '  </OptionalPackages>',
    '</ProjectInspectionData>',
  ].join('\n');
};

describe('parseInspectionXml', () => {
  it('parses ProfileName and ProfileVersion', () => {
    const xml = buildXml({
      profileName: 'CODESYS V3.5 SP22 Patch 1',
      profileVersion: '3.5.22.10',
    });
    const r = parseInspectionXml(xml);
    expect(r.profileName).toBe('CODESYS V3.5 SP22 Patch 1');
    expect(r.profileVersion).toBe('3.5.22.10');
  });

  it('derives 3.5.22.10 -> SP22 Patch 1', () => {
    const r = parseInspectionXml(
      buildXml({ profileName: 'CODESYS V3.5 SP22 Patch 1', profileVersion: '3.5.22.10' })
    );
    expect(r.major).toBe(3);
    expect(r.minor).toBe(5);
    expect(r.sp).toBe(22);
    expect(r.patch).toBe(1);
  });

  it('derives 3.5.21.50 -> SP21 Patch 5', () => {
    const r = parseInspectionXml(
      buildXml({ profileName: 'CODESYS V3.5 SP21 Patch 5', profileVersion: '3.5.21.50' })
    );
    expect(r.sp).toBe(21);
    expect(r.patch).toBe(5);
  });

  it('derives 3.5.21.0 -> SP21 Patch 0 (no patch suffix)', () => {
    const r = parseInspectionXml(
      buildXml({ profileName: 'CODESYS V3.5 SP21', profileVersion: '3.5.21.0' })
    );
    expect(r.sp).toBe(21);
    expect(r.patch).toBe(0);
  });

  it('extracts mandatory library entries with package-level title/version preferred over plugin-level', () => {
    const xml = buildXml({
      profileName: 'CODESYS V3.5 SP22 Patch 1',
      profileVersion: '3.5.22.10',
      mandatory: [
        {
          typeGuid: '6f9dac99-8de1-4efc-8465-68ac443b7d08',
          pluginName: 'POU Object',
          pluginVersion: '3.5.22.10',
        },
        {
          typeGuid: '2b939252-744a-453a-a81d-2c518c4e6dff',
          pluginName: 'CODESYS Math Libraries',
          pluginVersion: '4.0.0.0',
          packageName: 'CODESYS Math Libraries',
          packageVersion: '4.0.0.0',
        },
      ],
    });
    const r = parseInspectionXml(xml);
    expect(r.mandatoryLibraries).toHaveLength(2);
    expect(r.mandatoryLibraries[0].title).toBe('POU Object');
    expect(r.mandatoryLibraries[0].version).toBe('3.5.22.10');
    expect(r.mandatoryLibraries[0].typeGuid).toBe('6f9dac99-8de1-4efc-8465-68ac443b7d08');
    expect(r.mandatoryLibraries[1].title).toBe('CODESYS Math Libraries');
    expect(r.mandatoryLibraries[1].version).toBe('4.0.0.0');
  });

  it('does NOT include optional-package entries', () => {
    const xml = buildXml({
      profileName: 'CODESYS V3.5 SP22 Patch 1',
      profileVersion: '3.5.22.10',
      mandatory: [{ typeGuid: 'aaa', pluginName: 'Mandatory Thing', pluginVersion: '1.0.0.0' }],
      optional: [
        { packageName: 'CODESYS Control for Raspberry PI', packageVersion: '4.20.0.0' },
        { packageName: 'CODESYS Peripherals for Linux SL', packageVersion: '4.20.0.0' },
      ],
    });
    const r = parseInspectionXml(xml);
    expect(r.mandatoryLibraries).toHaveLength(1);
    expect(r.mandatoryLibraries[0].title).toBe('Mandatory Thing');
  });

  it('throws clear error on missing ProfileName / ProfileVersion', () => {
    const xml = '<?xml version="1.0"?><ProjectInspectionData></ProjectInspectionData>';
    expect(() => parseInspectionXml(xml)).toThrow(/ProfileName|ProfileVersion/);
  });

  it('throws clear error on malformed ProfileVersion', () => {
    const xml = buildXml({ profileName: 'CODESYS V3.5 SP22', profileVersion: 'not-a-version' });
    expect(() => parseInspectionXml(xml)).toThrow(/ProfileVersion/);
  });
});
