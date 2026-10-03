// Runs the shared engine on the SEED sample and checks every expected issue. Usage: node tools/check-seed.js
const E = require('../engine.js');
const D = structuredClone(E.SEED);
const { issues, unassigned } = E.runEngine(D);
const groups = E.groupIssues(issues).sort((a, b) => b.impact - a.impact);
for (const g of groups) console.log(String(g.impact).padStart(7), E.bucketOf(g).padEnd(8), E.TYPES[g.type].label.padEnd(20), D.suppliers[g.sup].name.padEnd(26), g.bills.join(','), g.ims.act);

const expect = [
  ['missing2b', 'B01,B02,B03', 124200, 'risk'],
  ['spike', 'B04', 54720, 'review'],
  ['unpaid180', 'B05', 48600, 'reverse'],
  ['taxType', 'B06', 38160, 'reverse'],
  ['duplicate', 'B08', 26910, 'reverse'],
  ['missingBooks', 'G19', 18000, 'recover'],
  ['rate', 'B11', 12500, 'reverse'],
  ['amount', 'B10', 12456, 'risk'],
  ['split', 'B09', 9900, 'confirm'],
  ['gstin', 'B12', 7200, 'risk'],
  ['combined', 'B19,B20', 13500, 'confirm'],
  ['doublePay', 'B21', 70800, 'leak'],
];
let fail = 0;
for (const [type, bills, impact, bucket] of expect) {
  const g = groups.find((x) => x.type === type && x.bills.join(',') === bills);
  const ok = g && g.impact === impact && E.bucketOf(g) === bucket;
  if (!ok) { fail++; console.error('FAIL', type, bills, 'expected', impact, bucket, 'got', g && g.impact, g && E.bucketOf(g)); }
}
if (groups.length !== expect.length) { fail++; console.error('FAIL expected', expect.length, 'issues, got', groups.length); }
if (unassigned.length) { fail++; console.error('FAIL bank rows with no payee:', unassigned.join(',')); }
const k = groups.find((x) => x.type === 'unpaid180');
console.log('unpaid180 interest estimate', k && k.items[0].interest, 'missingBooks lapse', groups.find((x) => x.type === 'missingBooks').lapse);
// Clean bills used by Chaos Mode must stay clean.
for (const id of ['B13', 'B14', 'B15', 'B16', 'B17', 'B18']) if (issues.some((i) => i.bills.includes(id))) { fail++; console.error('FAIL clean bill flagged', id); }
console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
