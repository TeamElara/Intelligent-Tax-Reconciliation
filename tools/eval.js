// Runs the SAME engine.js the dashboard uses over a generated set and scores it against the planted labels.
//   node tools/eval.js            evaluates data/test and writes data/eval.json + data/eval.js
// Recall = planted errors the engine flagged (right type, right bill). Precision = flags that were planted.
// A flag on a trap bill (correct data that merely looks different) is reported separately as a trap false positive.
const fs = require('fs'), path = require('path');
const E = require('../engine.js');
const G = require('./gen.js');
const ML = require('../ml.js');

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n'), head = lines.shift().split(',');
  return lines.map((l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); const r = {}; head.forEach((h, i) => { r[h] = out[i]; }); return r; });
}

function evaluate(data) {
  const { D, labels, traps } = data;
  const t0 = Date.now(), res = E.runEngine(D), ms = Date.now() - t0;
  const issues = res.issues;
  const trapBy = new Map(); for (const t of traps) { if (!trapBy.has(t.id)) trapBy.set(t.id, new Set()); trapBy.get(t.id).add(t.tag); }
  const types = [...new Set(labels.map((l) => l.type))].sort();
  const per = {}; for (const t of types) per[t] = { planted:0, detected:0, missed:0, falsePositives:0, rupeesPlanted:0, rupeesCaught:0, bucketRight:0, impactRight:0, missedIds:[] };
  const claimed = new Set();
  for (const L of labels) {
    const m = per[L.type]; m.planted++; m.rupeesPlanted += L.impact;
    const hit = issues.find((i) => i.type === L.type && !claimed.has(i) && i.bills.some((id) => L.ids.includes(id)));
    if (!hit) { m.missed++; if (m.missedIds.length < 5) m.missedIds.push(L.ids.join('|')); continue; }
    claimed.add(hit); m.detected++; m.rupeesCaught += L.impact;
    if ((hit.bucket || E.TYPES[hit.type].bucket) === L.bucket) m.bucketRight++;
    if (Math.abs(hit.impact - L.impact) <= 1) m.impactRight++;
  }
  const trapCats = {}; for (const t of traps) { trapCats[t.tag] = trapCats[t.tag] || { count:0, flagged:0 }; trapCats[t.tag].count++; }
  const trapFlagged = new Set(), unexplained = [];
  for (const i of issues) {
    if (claimed.has(i)) continue;
    const tg = i.bills.map((id) => trapBy.get(id)).find(Boolean);
    if (tg) { for (const tag of tg) { const k = i.bills.find((id) => trapBy.has(id)) + '|' + tag; if (!trapFlagged.has(k)) { trapFlagged.add(k); trapCats[tag].flagged++; } } }
    else unexplained.push(i);
    if (per[i.type]) per[i.type].falsePositives++;
    else (per[i.type] = { planted:0, detected:0, missed:0, falsePositives:1, rupeesPlanted:0, rupeesCaught:0, bucketRight:0, impactRight:0, missedIds:[] });
  }
  let P = 0, D_ = 0, FP = 0, rp = 0, rc = 0, br = 0, ir = 0;
  for (const t of Object.keys(per)) {
    const m = per[t];
    m.precision = m.detected + m.falsePositives ? +(m.detected / (m.detected + m.falsePositives)).toFixed(4) : null;
    m.recall = m.planted ? +(m.detected / m.planted).toFixed(4) : null;
    m.f1 = m.precision && m.recall ? +(2 * m.precision * m.recall / (m.precision + m.recall)).toFixed(4) : 0;
    P += m.planted; D_ += m.detected; FP += m.falsePositives; rp += m.rupeesPlanted; rc += m.rupeesCaught; br += m.bucketRight; ir += m.impactRight;
  }
  const trapTotal = Object.values(trapCats).reduce((a, c) => a + c.count, 0), trapFlag = Object.values(trapCats).reduce((a, c) => a + c.flagged, 0);
  // Anomaly model on the same books. Planted spikes are the ground truth it is measured against; every flag is a review item, not an error.
  const tm = Date.now(), mlr = ML.detect(D), mlMs = Date.now() - tm, bf = ML.benford(D);
  const spikeIds = new Set(labels.filter((l) => l.type === 'spike').flatMap((l) => l.ids)), flaggedIds = new Set(mlr.flags.map((f) => f.bill));
  const ruleIds = new Set(labels.filter((l) => l.type !== 'spike').flatMap((l) => l.ids));
  const ml = { model:'Isolation Forest', billsScored:mlr.n, flagged:mlr.flags.length, flaggedShare:+(mlr.flags.length / Math.max(1, mlr.n)).toFixed(4), threshold:mlr.threshold, plantedSpikes:spikeIds.size, spikesFound:[...spikeIds].filter((id) => flaggedIds.has(id)).length,
    flaggedOnRuleErrors:mlr.flags.filter((f) => ruleIds.has(f.bill)).length, ms:mlMs, benford:bf && bf.applicable ? { mad:bf.mad, chi2:bf.chi2, verdict:bf.verdict, n:bf.n } : null };
  return {
    ml,
    generated:{ seed:data.cfg.seed, suppliers:Object.keys(D.suppliers).length, books:D.books.length, g2b:D.g2b.length, bank:D.bank.length, from:data.cfg.from, to:data.cfg.to, plantedTypes:types.length, planted:P },
    perType:per,
    overall:{ recall:+(D_ / P).toFixed(4), precision:+(D_ / (D_ + FP)).toFixed(4), weightedRecall:+(rc / rp).toFixed(4), rupeesPlanted:rp, rupeesCaught:rc, bucketAccuracy:+(br / D_).toFixed(4), impactAccuracy:+(ir / D_).toFixed(4), falsePositives:FP, unexplained:unexplained.length, engineMs:ms, billsPerSecond:Math.round(D.books.length / (ms / 1000)) },
    traps:{ total:trapTotal, flagged:trapFlag, byKind:trapCats },
    unexplainedSample:unexplained.slice(0, 8).map((i) => [i.type, i.bills.join('|'), i.impact]),
  };
}

function loadSet(dir) {
  const suppliers = {}, byName = {};
  for (const r of readCsv(path.join(dir, 'suppliers.csv'))) { suppliers[r.key] = { name:r.name, gstin:r.gstin, base:+r.base, bills:0, filing:r.filing, late:r.filing === 'Filed late', hist:r.hist.split(';').map(Number) }; byName[r.name] = r.key; }
  const num = (r, ks) => { for (const k of ks) r[k] = +r[k]; return r; };
  const books = readCsv(path.join(dir, 'books.csv')).map((r) => { r.sup = byName[r.supplier]; delete r.supplier; return num(r, ['taxable', 'rate', 'cgst', 'sgst', 'igst']); });
  const g2b = readCsv(path.join(dir, 'g2b.csv')).map((r) => { r.sup = byName[r.supplier]; delete r.supplier; return num(r, ['taxable', 'cgst', 'sgst', 'igst']); });
  const bank = readCsv(path.join(dir, 'bank.csv')).map((r) => num(r, ['amount']));
  const labels = readCsv(path.join(dir, 'labels.csv')).map((r) => ({ type:r.type, ids:r.ids.split('|'), impact:+r.impact, bucket:r.bucket }));
  const traps = readCsv(path.join(dir, 'traps.csv'));
  return { D:{ suppliers, books, g2b, bank, asOf:'2026-09-30', buyer:E.BUYER }, labels, traps, cfg:{ seed:42, from:'2025-04', to:'2026-09' } };
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'data', process.argv[2] || 'test');
  const data = loadSet(dir), r = evaluate(data);
  const out = path.join(__dirname, '..', 'data');
  fs.writeFileSync(path.join(out, 'eval.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(out, 'eval.js'), 'window.REKORA_EVAL = ' + JSON.stringify(r) + ';\n');
  const pct = (x) => (x === null ? '  n/a' : (x * 100).toFixed(1).padStart(5) + '%');
  console.log(`${r.generated.books} books, ${r.generated.suppliers} suppliers, ${r.generated.planted} planted errors, engine ${r.overall.engineMs} ms\n`);
  console.log('type'.padEnd(14), 'planted detect missed  FP  recall  prec   bucket impact  ₹caught/₹planted');
  for (const [t, m] of Object.entries(r.perType)) console.log(t.padEnd(14), String(m.planted).padStart(7), String(m.detected).padStart(6), String(m.missed).padStart(6), String(m.falsePositives).padStart(3), pct(m.recall), pct(m.precision), pct(m.detected ? m.bucketRight / m.detected : null), pct(m.detected ? m.impactRight / m.detected : null), ' ', m.rupeesCaught.toLocaleString('en-IN') + '/' + m.rupeesPlanted.toLocaleString('en-IN'));
  const o = r.overall;
  console.log(`anomaly model (${r.ml.model}): found ${r.ml.spikesFound} of ${r.ml.plantedSpikes} planted spikes, flagged ${(r.ml.flaggedShare * 100).toFixed(1)}% of ${r.ml.billsScored} bills, ${r.ml.ms} ms; Benford MAD ${r.ml.benford && r.ml.benford.mad} (${r.ml.benford && r.ml.benford.verdict})`);
  console.log(`\noverall recall ${pct(o.recall)}  precision ${pct(o.precision)}  ₹-weighted recall ${pct(o.weightedRecall)}  bucket ${pct(o.bucketAccuracy)}  impact ${pct(o.impactAccuracy)}`);
  console.log(`traps: ${r.traps.flagged} flagged of ${r.traps.total}`, Object.entries(r.traps.byKind).map(([k, v]) => `${k} ${v.flagged}/${v.count}`).join(', '));
  if (r.unexplainedSample.length) console.log('unexplained flags (sample):', JSON.stringify(r.unexplainedSample));
}
module.exports = { evaluate, loadSet };
