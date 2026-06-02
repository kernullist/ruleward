import { describe, it, expect } from 'vitest';
import { matchSettingKV } from '../src/extract/settingkv';

describe('matchSettingKV', () => {
  it('style.indent', () => {
    expect(matchSettingKV('use tabs for indentation')).toMatchObject({ key: 'style.indent', value: 'tab' });
    expect(matchSettingKV('indent with spaces')).toMatchObject({ key: 'style.indent', value: 'space' });
  });

  it('style.quotes', () => {
    expect(matchSettingKV('always use single quotes')).toMatchObject({ key: 'style.quotes', value: 'single' });
  });

  it('style.semicolons', () => {
    expect(matchSettingKV('no semicolons')).toMatchObject({ key: 'style.semicolons', value: 'forbidden' });
  });

  it('style.lineLength', () => {
    expect(matchSettingKV('maximum line length 100 characters')).toMatchObject({ key: 'style.lineLength', value: '100' });
  });

  it('naming.case with target', () => {
    expect(matchSettingKV('use camelCase for variables')).toMatchObject({ key: 'naming.case.variable', value: 'camel' });
  });

  it('testing.framework', () => {
    expect(matchSettingKV('use vitest for tests')).toMatchObject({ key: 'testing.framework', value: 'vitest' });
  });

  it('imports.restricted', () => {
    expect(matchSettingKV('never import from src/legacy')).toMatchObject({ key: 'imports.restricted' });
  });

  it('returns null for vague rules', () => {
    expect(matchSettingKV('write clean code')).toBeNull();
  });

  it('keys lang.version by language (no cross-language conflict)', () => {
    expect(matchSettingKV('target typescript 5.6')).toMatchObject({ key: 'lang.version.typescript' });
    expect(matchSettingKV('run on node 24')).toMatchObject({ key: 'lang.version.node' });
  });

  it('treats testing.framework as a set (coexisting frameworks)', () => {
    expect(matchSettingKV('use playwright for e2e tests')).toMatchObject({ key: 'testing.framework', confType: 'set' });
  });

  it('rejects a generic word as an import target', () => {
    expect(matchSettingKV('never import from module')).toBeNull();
  });
});
