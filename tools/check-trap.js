// The Chaos Mode trap: reformatting an invoice number must never create an issue. Checked on every clean bill of the sample and the demo month.
const fs = require('fs'), path = require('path'), vm = require('vm');
const E = require('../engine.js');
const sb = { window:{} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'demo.js'), 'utf8'), sb);
const sets = { sample:E.SEED, demo:sb.window.REKORA_DEMO.D };
let fail = 0;
for (const [name, src] of Object.entries(sets)) {
  const base = structuredClone(src), issues0 = E.runEngine(structuredClone(base)).issues, flagged = new Set(issues0.flatMap((i) => i.bills));
  const probe = structuredClone(base); E.runEngine(probe);
  const clean = probe.books.filter((b) => b._g && !flagged.has(b.id));
  let tried = 0, noRewrite = 0;
  for (const b of clean) {
    const D = structuredClone(base), g = D.g2b.find((x) => x.id === b._g), n = E.reformatInv(g.inv, b.inv);
    if (n && (n === g.inv || n === b.inv)) { fail++; console.error('reformat did not change the spelling', b.id, g.inv, n); }
    if (!n) { noRewrite++; continue; }
    g.inv = n; tried++;
    const now = E.runEngine(D).issues.filter((i) => i.bills.includes(b.id));
    if (now.length) { fail++; if (fail < 6) console.error('FALSE ALARM', name, b.id, b.inv, '->', n, now.map((i) => i.type)); }
  }
  console.log(`${name}: ${tried} clean bills reformatted, ${noRewrite} could not be rewritten, ${fail} false alarms`);
}
// Also the reverse: a one-digit change is a different bill and must NOT be matched as the same one.
const D = structuredClone(E.SEED), g = D.g2b.find((x) => x.id === 'G06'); g.inv = 'AW/443';
if (!E.runEngine(D).issues.some((i) => i.type === 'missing2b' && i.bills.includes('B06'))) { fail++; console.error('FAIL AW-0442 matched AW/443'); } else console.log('digit change (AW-0442 vs AW/443) is correctly NOT matched');
console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed'); process.exit(fail ? 1 : 0);
