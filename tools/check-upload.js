// The demo CSVs, pushed through the browser's parser, must give the same issues as the bundled demo data. Usage: node tools/check-upload.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const E = require('../engine.js'), I = require('../ingest.js');
const dir = path.join(__dirname, '..', 'data', 'demo');

const sandbox = { window:{} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'demo.js'), 'utf8'), sandbox);
const ref = sandbox.window.REKORA_DEMO;
const sig = (D) => E.runEngine(D).issues.map((i) => `${i.type}|${i.bills.join('+')}|${i.impact}|${i.bucket || ''}`).sort();

const files = {};
for (const f of ['books', 'g2b', 'bank', 'sales']) {
  const r = I.ingestFile(f + '.csv', fs.readFileSync(path.join(dir, f + '.csv'), 'utf8'));
  if (r.kind !== f) throw new Error(`${f}.csv was detected as ${r.kind}`);
  if (r.errors.length) throw new Error(r.errors.slice(0, 3).join('; '));
  files[f] = r.rows;
}
const up = I.buildDataset(files); I.withPeriod(up.D, up.sales);
const a = sig(ref.D), b = sig(up.D);
let fail = 0;
const onlyA = a.filter((x) => !b.includes(x)), onlyB = b.filter((x) => !a.includes(x));
console.log(`bundled demo: ${a.length} issues, uploaded CSVs: ${b.length} issues`);
if (onlyA.length || onlyB.length) { fail++; console.error('only in bundled:', onlyA.slice(0, 6), '\nonly in uploaded:', onlyB.slice(0, 6)); }
console.log('as of', up.D.asOf, '| period', up.D.period, '| buyer state', up.D.buyer.state, '| output tax', JSON.stringify(up.D.output), '| notes', JSON.stringify(up.notes));
if (up.D.asOf !== ref.D.asOf) { fail++; console.error('asOf differs', up.D.asOf, ref.D.asOf); }

// The portal-style JSON must give exactly the same GSTR-2B rows, hence the same issues, as the CSV.
const json = I.ingestFile('gstr2b.json', fs.readFileSync(path.join(dir, 'gstr2b.json'), 'utf8'));
if (json.kind !== 'g2b' || json.errors.length) { fail++; console.error('FAIL json ingest', json.kind, json.errors.slice(0, 3)); }
const viaJson = I.buildDataset(Object.assign({}, files, { g2b:json.rows })); I.withPeriod(viaJson.D, viaJson.sales);
// Portal files have no row ids, so compare what each issue is and is worth, not which generated id it carries.
const content = (D) => E.runEngine(D).issues.map((i) => `${i.type}|${i.impact}|${i.bucket || ''}|${i.bills.length}`).sort();
const c = content(viaJson.D), cc = content(up.D), onlyJ = c.filter((x, k) => x !== cc[k]), onlyC = cc.filter((x, k) => x !== c[k]);
console.log(`portal JSON: ${json.rows.length} invoices, ${c.length} issues (CSV gave ${b.length})`);
if (onlyJ.length || onlyC.length) { fail++; console.error('JSON vs CSV differ:', onlyJ.slice(0, 4), onlyC.slice(0, 4)); }
for (const bad of ['{"data":{}}', '{nope', '{"data":{"docdata":{"b2b":[]}}}']) { try { I.ingestFile('x.json', bad); fail++; console.error('FAIL accepted bad JSON', bad); } catch (e) { /* expected */ } }
const part = I.ingestFile('p.json', JSON.stringify({ data:{ docdata:{ b2b:[{ ctin:'07AAAAA0000A1Z5', trdnm:'T', inv:[{ inum:'A-1', dt:'05-09-2026', items:[{ txval:1000, cgst:90, sgst:90 }] }, { dt:'05-09-2026', items:[{ txval:1 }] }, { inum:'A-3', dt:'31-02-2026', items:[{ txval:1 }] }] }], cdnr:[{ ctin:'x', nt:[] }, { x:1 }] } } }));
if (part.rows.length !== 1 || part.errors.length !== 2 || !part.notes.length) { fail++; console.error('FAIL partial JSON', part.rows.length, part.errors, part.notes); } else console.log('partial JSON: 1 invoice kept, 2 rejected, credit notes noted');

// Messy input must produce row errors, not exceptions.
const messy = 'Invoice No.,Invoice Date,Party Name,GSTIN of Supplier,HSN Code,Taxable Value,Rate,CGST Amount,SGST Amount,IGST Amount\n' +
  'A-1,05/09/2026,Gupta Steel,06AADFG7781Q1ZO,7214,"1,00,000",18,9000,9000,0\n' +
  'A-2,31/02/2026x,Gupta Steel,06AADFG7781Q1ZO,7214,5000,18,450,450,0\n' +
  'A-3,07-Sep-2026,,,7214,5000,18,450,450,0\n' +
  ',08/09/2026,Gupta Steel,,7214,5000,18,450,450,0\n' +
  'A-5,09/09/2026,Gupta Steel,,7214,abc,18,450,450,0\n';
const m = I.ingestFile('messy.csv', messy);
console.log('messy:', m.kind, m.rows.length, 'row(s) kept,', m.errors.length, 'rejected');
if (m.kind !== 'books' || m.rows.length !== 1 || m.errors.length !== 4 || m.rows[0].taxable !== 100000) { fail++; console.error('FAIL messy parse', JSON.stringify(m.rows), m.errors); }
for (const bad of ['', 'a,b\n1,2\n', 'Invoice No.,Taxable Value\n"x,1\n']) { try { I.ingestFile('bad.csv', bad); fail++; console.error('FAIL accepted unusable file', JSON.stringify(bad)); } catch (e) { /* expected */ } }
console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
