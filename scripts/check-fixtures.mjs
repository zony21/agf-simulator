import { readFileSync } from 'node:fs';
import { validateTrace } from '../src/core/validate-trace.mjs';
const data = JSON.parse(readFileSync(new URL('../fixtures/synthetic-trace.json', import.meta.url), 'utf8'));
const snapshot = validateTrace(data.scenario, data.events);
if(snapshot.stored!==1 || snapshot.magazines.M.qty!==7) throw new Error('Unexpected synthetic fixture output');
console.log('Synthetic trace validated:', JSON.stringify({stored:snapshot.stored, wrapper:snapshot.wrapper, magazine:snapshot.magazines.M.qty}));
