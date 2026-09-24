import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLogicalMap, findConceptualPath } from '../src/map/logical-map.mjs';

const map = JSON.parse(readFileSync(new URL('../data/reference-logical-map.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(map);

test('reference map is abstract, with explicit unresolved links', () => {
  const result = validateLogicalMap(map);
  assert.equal(result.corridors, 22);
  assert.ok(result.confirmedLinks > 0);
  assert.ok(result.unresolvedLinks > 0);
  assert.equal(map.geometry.measured, false);
  assert.equal(map.geometry.hasActualSiteCoordinates, false);
  assert.equal(map.geometry.hasMeasuredDistances, false);
  assert.ok(!('xMm' in map.corridors[0]));
});

test('parallel palletizing corridors each remain one lane', () => {
  const pair = map.corridorGroups.find(x => x.id === 'PZ-PAIR');
  assert.equal(pair.aggregateLaneCount, 2);
  for (const id of pair.members) {
    const section = map.corridors.find(x => x.id === id);
    assert.equal(section.laneCount, 1);
    assert.equal(section.direction, 'both');
  }
  const trip = findConceptualPath(map, 'PZ-A2', 'PZ-DEV');
  assert.equal(trip.kind, 'conceptual-only');
  assert.equal(trip.etaMs, null);
  assert.ok(trip.corridors.includes('PZ-CON-W') || trip.corridors.includes('PZ-CON-E'));
});

test('warehouse cross-aisle conceptual connection exists', () => {
  const result = findConceptualPath(map, 'WH-E-V', 'WH-W-V');
  assert.ok(result);
  assert.equal(result.measuredDistanceMm, null);
  assert.ok(result.corridors.some(x => x === 'WH-X-U' || x === 'WH-X-L'));
});

test('unreviewed full routes are withheld', () => {
  assert.equal(findConceptualPath(map, 'PZ-DEV', 'WH-W-B'), null);
  assert.equal(findConceptualPath(map, 'WH-E-GATE', 'WH-W-B'), null);
  assert.equal(findConceptualPath(map, 'WH-SERVICE', 'WH-W-B'), null);
  assert.equal(findConceptualPath(map, 'WH-W-GATE', 'WH-W-B'), null);
});

test('unknown corridor access cannot be promoted by an invented confirmed link', () => {
  const changed = copy();
  changed.links.find(x => x.id === 'L-PZ-IN-ATTACH').status = 'confirmed';
  assert.throws(() => validateLogicalMap(changed), /review evidence/);
});

test('cross-area connector cannot be marked confirmed without reviewed gate data', () => {
  const changed = copy();
  changed.corridors.find(x => x.id === 'PZ-EXT').access = 'allowed';
  changed.links.find(x => x.id === 'L-AREA-CONNECT').status = 'confirmed';
  changed.links.find(x => x.id === 'L-AREA-CONNECT').reviewState = 'user-confirmed-abstract';
  assert.throws(() => validateLogicalMap(changed), /inter-area link/);
});

test('west warehouse gate is forbidden even if a route is fabricated', () => {
  const changed = copy();
  changed.links.push({
    id: 'IMPROPER', from: 'WH-W-GATE', to: 'WH-W-V', direction: 'both', status: 'confirmed', reviewState: 'user-confirmed-abstract'
  });
  assert.throws(() => validateLogicalMap(changed), /unapproved corridor/);
});

test('task 02 holds for existing same-row placement and reserves on issue', () => {
  assert.equal(map.accessRules.task02.reserveDestination, 'at-task-issue');
  assert.equal(map.accessRules.task02.holdIfSameRowPutTask, true);
  const changed = copy();
  changed.accessRules.task02.holdIfSameRowPutTask = false;
  assert.throws(() => validateLogicalMap(changed), /Task 02 destination reservation/);
});

test('individual warehouse slot and service stop nodes are unresolved', () => {
  const wh = map.interfaces.find(x => x.id === 'WAREHOUSE_SLOTS');
  assert.equal(wh.count, null);
  assert.equal(wh.individualStopNodes, 'unresolved');
  assert.equal(map.corridors.find(x => x.id === 'WH-SERVICE').access, 'unresolved');
});
