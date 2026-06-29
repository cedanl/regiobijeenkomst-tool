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

const CASE_FIELDS = ['doel', 'actoren', 'resultaat', 'ai_data'];

function voteTotal(votes) {
  if (!votes || typeof votes !== 'object') return 0;
  return Object.values(votes).reduce((s, n) => s + (n || 0), 0);
}
function voterCount(votes) {
  if (!votes || typeof votes !== 'object') return 0;
  return Object.keys(votes).filter(uid => (votes[uid] || 0) > 0).length;
}
function normType(t) { return t === 'uitdaging' ? 'uitdaging' : 'kans'; }

// rooms: [{ code, state }]. regios: [{ code, label }] (volgorde = weergavevolgorde).
// Alleen kamers met een code in regios doen mee (curatie).
export function aggregate(rooms, regios) {
  const order = new Map(regios.map((r, i) => [r.code, { label: r.label, i }]));
  const insights = [];
  const useCases = [];
  let deelnemers = 0;
  const regiosMetData = new Set();

  const mapped = rooms.filter(r => order.has(r.code))
    .sort((a, b) => order.get(a.code).i - order.get(b.code).i);

  for (const room of mapped) {
    const regioLabel = order.get(room.code).label;
    const { insights: roomInsights, cases } = canonicalizeRoom(room.state);
    deelnemers += Object.keys((room.state && room.state.participants) || {}).length;
    if (roomInsights.length || cases.size) regiosMetData.add(room.code);

    const byId = new Map(roomInsights.map(i => [i.id, i]));
    for (const ins of roomInsights) {
      insights.push({
        id: ins.id,
        type: normType(ins.type),
        rol: ins.role || null,
        tekst: ins.text || '',
        regio: regioLabel,
        regioCode: room.code,
        totaalStemmen: voteTotal(ins.votes),
        aantalStemmers: voterCount(ins.votes),
      });
    }
    for (const [insightId, c] of cases) {
      if (!CASE_FIELDS.some(f => String(c[f] || '').trim())) continue; // sla lege cases over
      const ins = byId.get(insightId) || null;
      useCases.push({
        insightId,
        tekst: ins ? (ins.text || '') : '(onbekend inzicht)',
        doel: c.doel || '',
        actoren: c.actoren || '',
        resultaat: c.resultaat || '',
        ai_data: c.ai_data || '',
        type: ins ? normType(ins.type) : null,
        rol: ins ? (ins.role || null) : null,
        regio: regioLabel,
        regioCode: room.code,
        totaalStemmen: ins ? voteTotal(ins.votes) : 0,
      });
    }
  }

  insights.sort((a, b) => b.totaalStemmen - a.totaalStemmen);
  useCases.sort((a, b) => b.totaalStemmen - a.totaalStemmen);

  const kpis = {
    regios: regiosMetData.size,
    inzichten: insights.length,
    stemmen: insights.reduce((s, i) => s + i.totaalStemmen, 0),
    deelnemers,
  };
  return { kpis, insights, useCases };
}

// Bouwt de Nederlandse instructie voor de Claude-API (één messages.create-call).
export function buildVerslagPrompt(data) {
  const { kpis, insights, useCases } = data;
  const lines = [];
  lines.push('Je bent beleidsadviseur. Schrijf een helder, goed onderbouwd managementverslag in het Nederlands, op basis van onderstaande data uit vier regiobijeenkomsten over datagedreven werken in het onderwijs. Neem de ruimte die de inhoud vraagt; een grondig verslag mag meerdere pagina\'s beslaan.');
  lines.push('');
  lines.push('Structuur: (1) inleiding/context, (2) de belangrijkste behoeften en patronen per rol en regio, (3) advies over welke 2 à 3 use cases zich het best lenen voor co-creatie en waarom, (4) een korte afsluiting met vervolgstappen. Lopende tekst onderbouwd met voorbeelden uit de data; geen kale opsomming van alle ruwe regels.');
  lines.push('');
  lines.push('Opmaak: gebruik Markdown — koppen met ## en ###, **vetgedrukte** kernpunten en opsommingen (- ) waar dat de leesbaarheid helpt.');
  lines.push('');
  lines.push(`Kerncijfers: ${kpis.regios} regio's, ${kpis.inzichten} inzichten, ${kpis.stemmen} stemmen, ${kpis.deelnemers} deelnemers.`);
  lines.push('');
  lines.push('Inzichten (tekst | type | rol | regio | stemmen):');
  for (const i of insights.slice(0, 30)) lines.push(`- ${i.tekst} | ${i.type} | ${i.rol || '—'} | ${i.regio} | ${i.totaalStemmen}`);
  lines.push('');
  lines.push('Use cases (titel | doel | rol | regio | stemmen):');
  for (const u of useCases.slice(0, 20)) lines.push(`- ${u.tekst} | ${u.doel} | ${u.rol || '—'} | ${u.regio} | ${u.totaalStemmen}`);
  return lines.join('\n');
}

// Getemplate feitelijke samenvatting — gebruikt als er geen API-sleutel is of
// de API-call faalt. Geen narratief, puur de cijfers + top-lijsten.
export function buildFallbackVerslag(data) {
  const { kpis, insights, useCases } = data;
  const topI = insights.slice(0, 8).map(i => `- ${i.tekst} (${i.regio}, ${i.type}, ${i.totaalStemmen} stemmen)`).join('\n');
  const topU = useCases.slice(0, 8).map(u => `- ${u.tekst} — ${u.doel} (${u.regio}, ${u.totaalStemmen} stemmen)`).join('\n');
  return [
    '## Samenvatting regio-analyse',
    '',
    `${kpis.regios} regio's · ${kpis.inzichten} inzichten · ${kpis.stemmen} stemmen · ${kpis.deelnemers} deelnemers.`,
    '',
    '### Belangrijkste behoeften',
    topI || '- (geen)',
    '',
    '### Use cases (op prioriteit)',
    topU || '- (geen)',
  ].join('\n');
}
