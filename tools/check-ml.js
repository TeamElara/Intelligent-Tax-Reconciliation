// Anomaly model checks on the demo month: repeatable, finds the planted unusual bills, flags only a small share, Benford says "not applicable" on narrow data.
const E = require('../engine.js'), M = require('../ml.js'), { loadSet } = require('./eval.js');
const d = loadSet(require('path').join(__dirname, '..', 'data', 'demo'));
E.runEngine(d.D);
const a = M.detect(d.D), b = M.detect(d.D);
let fail = 0; const bad = (m) => { fail++; console.error('FAIL', m); };
if (JSON.stringify(a.flags) !== JSON.stringify(b.flags)) bad('two runs gave different flags (not seeded)');
const spikes = d.labels.filter((l) => l.type === 'spike').flatMap((l) => l.ids), got = new Set(a.flags.map((f) => f.bill));
if (!spikes.length) bad('demo has no planted spike'); else if (!spikes.every((id) => got.has(id))) bad('a planted spike was not flagged');
const share = a.flags.length / a.n; if (share > 0.025) bad('flags ' + (share * 100).toFixed(1) + '% of bills, expected at most 2.5%');
if (a.flags.some((f) => !f.reasons.length)) console.log('note: a flag has no attributable reason (allowed, shown as "unlike the other bills")');
const bf = M.benford(d.D); if (!bf || bf.applicable) bad('Benford should be "not applicable" on the demo month, got ' + JSON.stringify(bf && { applicable:bf.applicable }));
if (M.detect({ books:d.D.books.slice(0, 10) }).flags.length) bad('tiny ledgers must not produce flags');
console.log(`demo: ${a.n} bills scored, ${a.flags.length} flagged (${(share * 100).toFixed(1)}%), planted spikes found ${spikes.filter((id) => got.has(id)).length}/${spikes.length}, Benford applicable: ${bf && bf.applicable}`);
console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed'); process.exit(fail ? 1 : 0);
