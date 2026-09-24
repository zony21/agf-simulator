import { readFileSync } from 'node:fs';
import { validateLogicalMap, findConceptualPath } from '../src/map/logical-map.mjs';

const map = JSON.parse(readFileSync(new URL('../data/reference-logical-map.json', import.meta.url), 'utf8'));
const result = validateLogicalMap(map);
const warehouse = findConceptualPath(map, 'WH-E-V', 'WH-W-V');
const palletizing = findConceptualPath(map, 'PZ-A2', 'PZ-DEV');
if (!warehouse || !palletizing) throw new Error('Expected conceptual link in each area');
if (findConceptualPath(map, 'PZ-A1', 'WH-E-V') !== null) {
  throw new Error('Unconfirmed inter-area route must not be returned as executable');
}
console.log('Abstract map validated:', JSON.stringify({
  ...result, warehouse: warehouse.corridors, palletizing: palletizing.corridors,
  interArea: 'unresolved'
}));
