/** Deterministic selector. Scenario supplies reserve threshold; no facility defaults. */
export function selectAgf(agfs, task, { mode, reservePct }) {
  if (!['area_first', 'low_battery_first'].includes(mode)) throw new Error('Unknown mode');
  if (!Number.isFinite(reservePct)) throw new Error('reservePct must be specified');
  if (!task || typeof task.originArea !== 'string') throw new Error('originArea required');
  const eligible = agfs.filter(a =>
    a.status === 'idle' &&
    !a.blocked &&
    Number.isFinite(a.batteryPct) &&
    a.batteryPct > reservePct
  );
  eligible.sort((a,b) => {
    if (mode === 'area_first') {
      const areaDelta = Number(a.area !== task.originArea) - Number(b.area !== task.originArea);
      if (areaDelta) return areaDelta;
    }
    return a.batteryPct - b.batteryPct || String(a.id).localeCompare(String(b.id));
  });
  return eligible[0] ?? null;
}
