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
});
