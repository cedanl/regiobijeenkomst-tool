import { test, expect } from '@playwright/test';
import { DEFAULT_REGIOS, validateRegios, canonicalizeRoom, aggregate, buildVerslagPrompt, buildFallbackVerslag } from '../analyse-lib.mjs';

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

function fixtureRooms() {
  return [
    { code: 'HRQT', state: { participants: {
      u1: { state: { insights: [{ id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 3 } }], cases: { i1: { doel: 'Eerder ingrijpen', actoren: 'SLB', resultaat: 'minder uitval', ai_data: 'LMS', _ts_doel: 100 } } } },
      u2: { state: { insights: [
        { id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 2, u2: 4 } },
        { id: 'i2', type: 'uitdaging', text: 'AVG-drempels', role: 'aansturing', votes: { u2: 1 } },
      ], cases: {} } },
    } } },
    { code: 'WTEL', state: { participants: {
      u3: { state: { insights: [{ id: 'i3', type: 'kans', text: 'Datageletterdheid', role: 'praktijk', votes: { u3: 5 } }], cases: { i3: { doel: 'Docenten data laten duiden', ai_data: 'training', _ts_doel: 50 } } } },
    } } },
    { code: 'TEST1', state: { participants: { u9: { state: { insights: [{ id: 'x1', type: 'kans', text: 'NIET MEETELLEN', role: 'praktijk', votes: { u9: 9 } }], cases: {} } } } } },
  ];
}

test('aggregate poolt alleen gemapte kamers en sorteert op stemmen', () => {
  const { kpis, insights, useCases } = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  // TEST1 zit niet in DEFAULT_REGIOS → uitgesloten (curatie)
  expect(insights.find(i => i.tekst === 'NIET MEETELLEN')).toBeUndefined();
  expect(insights.map(i => i.id)).toEqual(['i1', 'i3', 'i2']); // 7, 5, 1
  const i1 = insights[0];
  expect(i1.totaalStemmen).toBe(7);
  expect(i1.aantalStemmers).toBe(2);
  expect(i1.regio).toBe('Arnhem');
  expect(i1.regioCode).toBe('HRQT');
  expect(kpis).toEqual({ regios: 2, inzichten: 3, stemmen: 13, deelnemers: 3 });
});

test('aggregate maakt use cases met inhoud en sorteert op stemmen van het inzicht', () => {
  const { useCases } = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  expect(useCases.map(u => u.insightId)).toEqual(['i1', 'i3']); // i2 heeft geen case
  expect(useCases[0].doel).toBe('Eerder ingrijpen');
  expect(useCases[0].totaalStemmen).toBe(7);
  expect(useCases[0].rol).toBe('praktijk');
  expect(useCases[0].regio).toBe('Arnhem');
});

test('buildVerslagPrompt bevat kerncijfers en top-inzicht', () => {
  const data = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  const p = buildVerslagPrompt(data);
  expect(p).toContain('Studievoortgang');
  expect(p).toContain('managementverslag');
  expect(p).toMatch(/3 regio's|2 regio's/);
});

test('buildFallbackVerslag is feitelijk en bevat herkenbare koppen', () => {
  const data = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  const v = buildFallbackVerslag(data);
  expect(v).toContain('behoeften');
  expect(v).toContain('stemmen');
  expect(v).toContain('Studievoortgang');
});

test('aggregate slaat cases zonder inhoud over (lege/whitespace velden)', () => {
  const rooms = [{ code: 'HRQT', state: { participants: {
    u1: { state: { insights: [{ id: 'i1', type: 'kans', text: 'X', role: 'praktijk', votes: { u1: 1 } }], cases: { i1: { doel: '   ', actoren: '', resultaat: '', ai_data: '', _ts_doel: 5 } } } },
  } } }];
  const { useCases } = aggregate(rooms, DEFAULT_REGIOS);
  expect(useCases).toEqual([]); // case heeft geen inhoud → niet meegenomen
});

test('aggregate toont een weescase (zonder bijbehorend inzicht) als onbekend inzicht', () => {
  const rooms = [{ code: 'HRQT', state: { participants: {
    u1: { state: { insights: [], cases: { ghost: { doel: 'Verweesd doel', _ts_doel: 5 } } } },
  } } }];
  const { useCases } = aggregate(rooms, DEFAULT_REGIOS);
  expect(useCases).toHaveLength(1);
  expect(useCases[0].tekst).toBe('(onbekend inzicht)');
  expect(useCases[0].type).toBeNull();
  expect(useCases[0].rol).toBeNull();
  expect(useCases[0].totaalStemmen).toBe(0);
});
