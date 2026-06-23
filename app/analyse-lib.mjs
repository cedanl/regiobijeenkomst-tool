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
