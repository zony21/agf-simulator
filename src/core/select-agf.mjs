/** Deterministic selector. area_first is destination-area first (approved rule). */
export function selectAgf(agfs, task, { mode, reservePct, fallback = 'wait' }) {
  if (!['area_first', 'low_battery_first'].includes(mode)) throw new Error('Unknown mode');
  if (!Number.isFinite(reservePct)) throw new Error('reservePct must be specified');
  if (!task || typeof task.destinationArea !== 'string' || !task.destinationArea)
    throw new Error('destinationArea required');
  if (!['wait', 'any'].includes(fallback)) throw new Error('Unknown fallback');
  const eligible = agfs.filter(a =>
    a.status === 'idle' && !a.blocked &&
    Number.isFinite(a.batteryPct) && a.batteryPct > reservePct
  );
  let candidates = eligible;
  if (mode === 'area_first') {
    const local = eligible.filter(a => a.area === task.destinationArea);
    if (local.length) candidates = local;
    else if (fallback === 'wait') return null; // Cross-area fallback remains an explicit scenario choice.
  }
  candidates.sort((a, b) => a.batteryPct - b.batteryPct ||
    String(a.id).localeCompare(String(b.id), 'en'));
  return candidates[0] ?? null;
}
