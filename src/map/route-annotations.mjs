/**
 * Public-safe code for annotating a PRIVATE, AGF-free CAD preview.
 * Coordinates and image hashes are only kept in local browser memory/export.
 * Draft paths are display annotations, never confirmed navigable routes or ETA.
 */
export const NODE_TYPES = Object.freeze([
  'pickup','dropoff','shutter_wait','shutter_passage','turn',
  'junction','home','charger','waypoint'
]);
export const TASK_TYPES = Object.freeze(['01','02','03','04','05','charge']);
export const PHASES = Object.freeze(['empty','loaded','charge']);
const ID = /^[A-Za-z0-9_-]{1,32}$/;
const SHA = /^[0-9a-f]{64}$/;
const verify = (test, message) => { if (!test) throw new Error(message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const rounded = x => Math.round(x * 1000) / 1000;

function sourceBox(value) {
  if (value === null) return null;
  verify(Array.isArray(value) && value.length === 4 &&
    value.every(finite) && value[2] > 0 && value[3] > 0,
    'CAD SVG viewBox must contain four finite numbers with positive size');
  return [...value];
}
function coordinates(u, v, box) {
  return box ? {
    xCadMm: rounded(box[0] + u * box[2]),
    yCadMm: rounded(-box[1] - v * box[3]),
  } : {};
}
export function createAnnotation(backgroundSha256, cadViewBox = null) {
  verify(typeof backgroundSha256 === 'string' && SHA.test(backgroundSha256),
    'valid SHA-256 image hash required');
  return {
    schemaVersion:'private-route-annotations-v1',
    backgroundSha256, coordinateSpace:'image-fraction-top-left',
    cadViewBox:sourceBox(cadViewBox),
    unitEvidence:'user-specified-mm', metricScaleVerified:false,
    approvalStatus:'draft-only', routable:false, physicalEtaAllowed:false,
    nodes:[], routes:[]
  };
}
export function addNode(annotation, {id, type, u, v}) {
  verify(annotation?.schemaVersion === 'private-route-annotations-v1',
    'annotation document required');
  verify(typeof id === 'string' && ID.test(id), 'point ID: 1–32 Latin letters, digits, _ or -');
  verify(NODE_TYPES.includes(type), 'unsupported point type');
  verify(finite(u) && finite(v) && u >= 0 && u <= 1 && v >= 0 && v <= 1,
    'point must be on the preview image');
  verify(annotation.nodes.length < 1000, 'point limit reached');
  verify(!annotation.nodes.some(node => node.id === id), 'duplicate point ID');
  return {
    ...annotation,
    nodes:[...annotation.nodes, {id,type,u:rounded(u),v:rounded(v),
      ...coordinates(u,v,annotation.cadViewBox)}]
  };
}
export function addRoute(annotation, {id, taskType, phase, nodeIds}) {
  verify(typeof id === 'string' && ID.test(id), 'route ID: 1–32 Latin letters, digits, _ or -');
  verify(TASK_TYPES.includes(taskType), 'unsupported transport type');
  verify(PHASES.includes(phase) &&
    ((taskType === 'charge') === (phase === 'charge')),
    'charge routes require charge phase; transport routes require empty or loaded phase');
  verify(Array.isArray(nodeIds) && nodeIds.length >= 2 && nodeIds.length <= 200,
    'route needs 2–200 explicitly selected points');
  verify(annotation.routes.length < 200, 'route limit reached');
  verify(!annotation.routes.some(route => route.id === id), 'duplicate route ID');
  const points = new Set(annotation.nodes.map(n => n.id));
  verify(nodeIds.every(point => typeof point === 'string' && points.has(point)),
    'route references an undefined point');
  verify(nodeIds.every((point, i) => i === 0 || point !== nodeIds[i-1]),
    'consecutive route points must differ');
  return {...annotation, routes:[...annotation.routes,
    {id, taskType,phase,nodeIds:[...nodeIds],status:'draft'}]};
}
/**
 * Import is tied to the exact same image bytes and viewBox. Ignore untrusted
 * computed millimetre fields, and never import a confirmed/routable status.
 */
export function validateAnnotation(input, expectedSha256, expectedViewBox = null) {
  verify(input && typeof input === 'object' && !Array.isArray(input),
    'annotation must be a JSON object');
  const fresh=createAnnotation(expectedSha256, expectedViewBox);
  verify(input.schemaVersion === fresh.schemaVersion &&
    input.backgroundSha256 === expectedSha256,
    'the annotation is not for this exact CAD preview');
  verify(JSON.stringify(input.cadViewBox) === JSON.stringify(fresh.cadViewBox),
    'CAD preview viewBox mismatch');
  verify(input.coordinateSpace === fresh.coordinateSpace &&
    input.unitEvidence === fresh.unitEvidence &&
    input.metricScaleVerified === false &&
    input.approvalStatus === 'draft-only' &&
    input.routable === false &&
    input.physicalEtaAllowed === false,
    'unsafe or incompatible annotation metadata');
  verify(Array.isArray(input.nodes) && input.nodes.length <= 1000 &&
    Array.isArray(input.routes) && input.routes.length <= 200,
    'invalid point/route lists');
  let result=fresh;
  for (const n of input.nodes) result=addNode(result,n);
  for (const r of input.routes) {
    verify(r?.status === 'draft','only draft routes can be imported');
    result=addRoute(result,r);
  }
  return result;
}
