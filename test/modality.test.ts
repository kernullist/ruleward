import { describe, it, expect } from 'vitest';
import { detectDirective, isImperative } from '../src/extract/modality';

describe('detectDirective', () => {
  it('MUST_NOT — strong prohibition (en/ko)', () => {
    expect(detectDirective('never use eval').directive).toBe('MUST_NOT');
    expect(detectDirective('do not import from legacy').directive).toBe('MUST_NOT');
    expect(detectDirective('eval 사용 금지').directive).toBe('MUST_NOT');
  });

  it('SHOULD_NOT — soft prohibition (en/ko)', () => {
    expect(detectDirective('avoid using var').directive).toBe('SHOULD_NOT');
    expect(detectDirective('var 사용을 지양').directive).toBe('SHOULD_NOT');
  });

  it('MUST — strong requirement (en/ko)', () => {
    expect(detectDirective('always use single quotes').directive).toBe('MUST');
    expect(detectDirective('반드시 테스트를 작성하라').directive).toBe('MUST');
  });

  it('SHOULD — preference / imperative', () => {
    expect(detectDirective('prefer async/await').directive).toBe('SHOULD');
    expect(detectDirective('use tabs').directive).toBe('SHOULD');
    expect(detectDirective('prefer named exports').polarity).toBe('preference');
  });

  it('MAY — optional', () => {
    expect(detectDirective('you may add comments').directive).toBe('MAY');
  });

  it('INFO — declarative prose', () => {
    expect(detectDirective('this project is a service').directive).toBe('INFO');
  });
});

describe('isImperative', () => {
  it('detects English imperative verbs', () => {
    expect(isImperative('use tabs')).toBe(true);
    expect(isImperative('this is a service')).toBe(false);
  });
  it('detects Korean imperative endings', () => {
    expect(isImperative('테스트를 작성하라')).toBe(true);
  });
});
