// Pure aggregatie- en validatielogica voor het regio-analyse-dashboard.
// Geen fs, geen express — alles in/uit als plain objects, zodat dit
// los unit-getest kan worden.

const CODE_RE = /^[A-Z0-9]{3,16}$/;

export const DEFAULT_REGIOS = [
  { code: 'HRQT', label: 'Arnhem' },
  { code: 'WTEL', label: 'Breda' },
  { code: 'PUXD', label: 'Utrecht' },
  { code: 'MDRH', label: 'Zwolle' },
];

// Valideert + normaliseert een regio-map. Retourneert {ok, value} of {ok:false, error}.
// Dubbele code = upsert (laatste label wint), oorspronkelijke positie blijft.
export function validateRegios(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'verwacht een array' };
  const map = new Map();
  for (const item of input) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'ongeldig item' };
    const code = String(item.code || '').trim().toUpperCase();
    const label = String(item.label || '').trim();
    if (!CODE_RE.test(code)) return { ok: false, error: `ongeldige code: ${code || '(leeg)'}` };
    if (!label) return { ok: false, error: `label ontbreekt voor ${code}` };
    if (label.length > 60) return { ok: false, error: `label te lang voor ${code}` };
    map.set(code, label); // Map.set behoudt invoegvolgorde, overschrijft waarde
  }
  return { ok: true, value: [...map.entries()].map(([code, label]) => ({ code, label })) };
}

// Recency van een case = hoogste _ts_<veld>-waarde.
function caseTimestamp(c) {
  let max = 0;
  for (const [k, v] of Object.entries(c)) {
    if (k.startsWith('_ts') && typeof v === 'number' && v > max) max = v;
  }
  return max;
}

// Voegt alle deelnemer-snapshots van één kamer samen tot één canonieke set.
// insights: union op id, votes per stemmer gemerged op max.
// cases: union op insightId, bij conflict de nieuwste (_ts).
export function canonicalizeRoom(state) {
  const participants = (state && state.participants) || {};
  const insightsById = new Map();
  const casesById = new Map();
  for (const p of Object.values(participants)) {
    const cs = (p && p.state) || {};
    for (const ins of (cs.insights || [])) {
      if (!ins || !ins.id) continue;
      const votes = (ins.votes && typeof ins.votes === 'object') ? ins.votes : {};
      const existing = insightsById.get(ins.id);
      if (!existing) {
        insightsById.set(ins.id, { ...ins, votes: { ...votes } });
      } else {
        for (const [uid, count] of Object.entries(votes)) {
          existing.votes[uid] = Math.max(existing.votes[uid] || 0, count || 0);
        }
      }
    }
    for (const [insightId, c] of Object.entries(cs.cases || {})) {
      if (!c || typeof c !== 'object') continue;
      const existing = casesById.get(insightId);
      if (!existing || caseTimestamp(c) > caseTimestamp(existing)) casesById.set(insightId, c);
    }
  }
  return { insights: [...insightsById.values()], cases: casesById };
}
