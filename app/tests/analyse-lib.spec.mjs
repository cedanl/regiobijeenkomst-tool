import { test, expect } from '@playwright/test';
import { DEFAULT_REGIOS, validateRegios } from '../analyse-lib.mjs';

test('DEFAULT_REGIOS bevat de vier sessiecodes in vaste volgorde', () => {
  expect(DEFAULT_REGIOS).toEqual([
    { code: 'HRQT', label: 'Arnhem' },
    { code: 'WTEL', label: 'Breda' },
    { code: 'PUXD', label: 'Utrecht' },
    { code: 'MDRH', label: 'Zwolle' },
  ]);
});

test('validateRegios normaliseert en accepteert geldige invoer', () => {
  const r = validateRegios([{ code: 'hrqt', label: ' Arnhem ' }, { code: 'WTEL', label: 'Breda' }]);
  expect(r.ok).toBe(true);
  expect(r.value).toEqual([{ code: 'HRQT', label: 'Arnhem' }, { code: 'WTEL', label: 'Breda' }]);
});

test('validateRegios upsert: dubbele code overschrijft label maar behoudt positie', () => {
  const r = validateRegios([{ code: 'HRQT', label: 'Arnhem' }, { code: 'WTEL', label: 'Breda' }, { code: 'HRQT', label: 'Arnhem-Noord' }]);
  expect(r.ok).toBe(true);
  expect(r.value).toEqual([{ code: 'HRQT', label: 'Arnhem-Noord' }, { code: 'WTEL', label: 'Breda' }]);
});

test('validateRegios weigert ongeldige code en leeg label', () => {
  expect(validateRegios('nope').ok).toBe(false);
  expect(validateRegios([{ code: 'ab', label: 'x' }]).ok).toBe(false);
  expect(validateRegios([{ code: 'HRQT', label: '' }]).ok).toBe(false);
});
