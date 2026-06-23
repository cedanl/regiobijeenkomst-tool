import { test, expect } from '@playwright/test';
import { DEFAULT_REGIOS, validateRegios, canonicalizeRoom } from '../analyse-lib.mjs';

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

test('canonicalizeRoom unioniseert inzichten en neemt per stemmer de hoogste stem', () => {
  const state = { participants: {
    u1: { state: { insights: [{ id: 'i1', type: 'kans', text: 'A', role: 'praktijk', votes: { u1: 3 } }], cases: { i1: { doel: 'oud', _ts_doel: 100 } } } },
    u2: { state: { insights: [
      { id: 'i1', type: 'kans', text: 'A', role: 'praktijk', votes: { u1: 2, u2: 4 } },
      { id: 'i2', type: 'uitdaging', text: 'B', role: 'aansturing', votes: { u2: 1 } },
    ], cases: { i1: { doel: 'nieuw', _ts_doel: 200 } } } },
  } };
  const { insights, cases } = canonicalizeRoom(state);
  const i1 = insights.find(i => i.id === 'i1');
  expect(i1.votes).toEqual({ u1: 3, u2: 4 });        // max per stemmer
  expect(insights.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  expect(cases.get('i1').doel).toBe('nieuw');         // nieuwste _ts wint
});

test('canonicalizeRoom is bestand tegen ontbrekende velden', () => {
  expect(canonicalizeRoom({}).insights).toEqual([]);
  expect(canonicalizeRoom({ participants: { u: { state: {} } } }).cases.size).toBe(0);
});
