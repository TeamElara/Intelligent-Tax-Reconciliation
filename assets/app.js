/* =======================================================================
   Rekora app: a guided, seven-step journey over the real engine.
   Rules compute (engine.js), ML flags (ml.js), files are read in the
   browser (ingest.js). Every rupee on screen comes from the engine.
   ======================================================================= */
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const inr = (n) => (n < 0 ? '−' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
const lakh = (n) => '₹' + (n / 1e5).toFixed(1) + ' lakh';
const L = (n) => '₹' + (n / 1e5).toFixed(1) + 'L';
const int = (n) => Math.round(n).toLocaleString('en-IN');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fdate = (d) => { const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; };
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = matchMedia('(pointer: fine)').matches;
const plural = (n, w) => `${int(n)} ${w}${n === 1 ? '' : 's'}`;

/* =======================================================================
   DATA AND ENGINE (ported from the classic dashboard, logic unchanged)
   ======================================================================= */
const BASE = { booksITC:4860000, risk:412380, recover:236450, reverse:218600, output:{ igst:2200000, cgst:2000000, sgst:2000000 }, itcShare:{ igst:.3289, cgst:.33555, sgst:.33555 } };
const BASE_COUNTS = { total:2148, matched:1873, diff:96, confirm:41, unmatched:112, dup:26 };
const S = {
  D:null, baseSet:null, groups:[], all:[], initialOpen:null, resolved:new Map(), booksDelta:0, resolvedCount:0,
  decisions:[], seq:0, filter:'all', query:'', sel:null, billIdx:0, counts:null, lastMs:0, prevWf:null, clean:null, up:{}, srcNote:'',
  chaos:{ planted:0, caught:0, missed:0, traps:0, ignored:0, falseAlarms:0, log:[], broken:new Set() }, newKeys:new Set(),
};
function seedSet() { return { D:Object.assign(structuredClone(SEED), { base:BASE }), label:'Built-in sample' }; }
function demoSet() { const d = structuredClone(window.REKORA_DEMO.D); Ingest.withPeriod(d, window.REKORA_DEMO.sales); return { D:d, label:'Bundled demo month' }; }
function defaultSet() { return window.REKORA_DEMO && !/demo=seed/.test(location.search) ? demoSet() : seedSet(); }
function reset(set) {
  S.decisions = [];
  S.baseSet = set || S.baseSet || defaultSet();
  S.D = structuredClone(S.baseSet.D); S.resolved = new Map(); S.booksDelta = 0; S.resolvedCount = 0;
  S.counts = Object.assign({}, BASE_COUNTS); S.chaos = { planted:0, caught:0, missed:0, traps:0, ignored:0, falseAlarms:0, log:[], broken:new Set() }; S.newKeys = new Set();
  S.initialOpen = null; S.sel = null; S.clean = null; S.prevWf = null;
}
const buyer = () => S.D.buyer || BUYER;
const outputOf = () => (S.D.base ? BASE.output : (S.D.output || { igst:0, cgst:0, sgst:0 }));
const periodOf = () => S.D.period || '2026-09';
const monthName = () => MONTH_NAMES[+periodOf().split('-')[1] - 1];
const periodName = () => `${monthName()} ${periodOf().split('-')[0]}`;
const periodBooks = () => S.D.books.filter((b) => b.date.startsWith(periodOf()));
function deriveCounts(issues) {
  const by = new Map(); for (const i of issues) for (const id of i.bills) { if (!by.has(id)) by.set(id, new Set()); by.get(id).add(i.type); }
  const c = { total:S.D.books.length, matched:0, diff:0, confirm:0, unmatched:0, dup:0 };
  for (const b of S.D.books) {
    const t = by.get(b.id);
    if (!t) c.matched++;
    else if (t.has('duplicate')) c.dup++;
    else if (t.has('missing2b')) c.unmatched++;
    else if (['gstin', 'split', 'combined'].some((x) => t.has(x))) c.confirm++;
    else c.diff++;
  }
  return c;
}
function cleanBills(issues) {
  const flagged = new Set(issues.flatMap((i) => i.bills)), seen = new Set(), out = [];
  const pool = S.D.books.filter((b) => b._g && b._p && b._p.length === 1 && !flagged.has(b.id) && b.date.startsWith(periodOf()) && b.taxable > 0).sort((a, b) => b.taxable - a.taxable);
  for (const b of pool) { if (seen.has(b.sup) || out.length >= 6) continue; seen.add(b.sup); out.push(b.id); }
  return out;
}
function compute() {
  const { issues, ms } = runEngine(S.D);
  S.lastMs = ms;
  S.idx = new Map(); for (const g of S.D.g2b) S.idx.set(g.id, g); for (const b of S.D.books) S.idx.set(b.id, b);
  S.ml = Rekora.ml.detect(S.D);
  const spikeBy = new Map(issues.filter((i) => i.type === 'spike').map((i) => [i.bills[0], i]));
  const mlIssues = [];
  for (const f of S.ml.flags) {
    const sp = spikeBy.get(f.bill);
    if (sp) { sp.ml = f; continue; }
    const b = S.D.books.find((x) => x.id === f.bill);
    const it = { type:'anomaly', sup:f.sup, bills:[f.bill], impact:tax(b), ml:f };
    it.ims = imsAdvice(it); mlIssues.push(it);
  }
  S.all = groupIssues(issues.concat(mlIssues));
  S.groups = S.all.filter((g) => !S.resolved.has(g.key)).sort((a, b) => b.impact - a.impact);
  const inPeriod = (g) => S.D.base || g.type === 'unpaid180' || g.bills.some((id) => { const r = rec(id); return r && r.date.startsWith(periodOf()); });
  S.scoped = S.groups.filter(inPeriod);
  const open = sumBuckets(S.scoped);
  if (!S.initialOpen) S.initialOpen = open;
  const t = {}, legacy = !!S.D.base;
  if (legacy) {
    for (const k of ['risk', 'recover', 'reverse']) t[k] = Math.max(0, BASE[k] + open[k] - S.initialOpen[k]);
    t.books = BASE.booksITC + S.booksDelta;
  } else {
    for (const k of ['risk', 'recover', 'reverse']) t[k] = open[k];
    t.books = periodBooks().reduce((a, b) => a + tax(b), 0) + S.booksDelta;
    S.counts = deriveCounts(issues);
    if (!S.clean) S.clean = cleanBills(issues);
  }
  if (legacy && !S.clean) S.clean = ['B13', 'B14', 'B15', 'B16', 'B17', 'B18'];
  t.eligible = Math.max(0, t.books - t.risk - t.reverse + t.recover);
  const o = outputOf(); t.output = o.igst + o.cgst + o.sgst;
  t.net = Math.max(0, t.output - t.eligible);
  S.totals = t;
  if (!S.sel || !S.groups.find((g) => g.key === S.sel)) S.sel = S.groups[0] && S.groups[0].key;
}
function sumBuckets(groups) { const o = { risk:0, recover:0, reverse:0, review:0, confirm:0, leak:0 }; for (const g of groups) o[bucketOf(g)] += g.impact; return o; }
function sumCount(groups) { const o = { risk:0, recover:0, reverse:0, review:0, confirm:0, leak:0 }; groups.forEach((g) => o[bucketOf(g)]++); return o; }
const supName = (k) => S.D.suppliers[k].name;
const rec = (id) => (S.idx ? S.idx.get(id) : null) || S.D.books.find((b) => b.id === id) || S.D.g2b.find((g) => g.id === id);
const TYPE_ORDER = ['missing2b', 'missingBooks', 'amount', 'taxValue', 'gstin', 'rate', 'taxType', 'duplicate', 'unpaid180', 'split', 'combined', 'doublePay', 'spike'];
const BUCKET_LABEL = { risk:'ITC at risk', recover:'Potential credit', reverse:'ITC to reverse', review:'Review', confirm:'Needs confirmation', leak:'Cash to recover' };
const stakeWord = (b) => (b === 'recover' ? 'to review' : b === 'confirm' ? 'to confirm' : b === 'leak' ? 'cash to recover' : 'at stake');
const effectText = (d) => (d.claimDelta < 0 ? `Claim reduced by ${inr(-d.claimDelta)}` : d.claimDelta > 0 ? `Claim raised by ${inr(d.claimDelta)}` : d.eligibleDelta > 0 ? `Credit stays, eligible ITC +${inr(d.eligibleDelta)}` : d.eligibleDelta < 0 ? `Eligible ITC ${inr(d.eligibleDelta)}` : 'No change to the claim');
const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

function visibleGroups() {
  const q = S.query.trim().toLowerCase();
  return S.groups.filter((g) => {
    if (S.filter !== 'all' && bucketOf(g) !== S.filter && !(S.filter === 'review' && ['confirm', 'leak'].includes(bucketOf(g)))) return false;
    if (!q) return true;
    const hay = [supName(g.sup), TYPES[g.type].label, ...g.bills.map((id) => rec(id).inv)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
function shortWhy(g) {
  const i = g.items[0], s = S.D.suppliers[g.sup];
  switch (g.type) {
    case 'missing2b': return s.late ? 'Supplier hasn\'t filed GSTR-1' : 'Not reported by the supplier yet';
    case 'missingBooks': return i.paid ? 'You paid it but never booked it' : 'Reported to you, not booked';
    case 'amount': return i.bucket === 'recover' ? 'GSTR-2B shows more than your bill' : 'Books and GSTR-2B disagree on value';
    case 'taxValue': return i.bucket === 'recover' ? 'Booked tax is below rate × value' : 'Tax doesn\'t equal rate × value';
    case 'gstin': return 'Books GSTIN fails the checksum, confirm the supplier';
    case 'rate': return i.scrapped ? `${rec(g.bills[0]).rate}% slab was scrapped in 2025` : 'Rate differs from the rate master';
    case 'taxType': return i.inter ? 'CGST + SGST on an inter-state bill' : 'IGST on an intra-state bill';
    case 'duplicate': return 'Same bill entered twice';
    case 'unpaid180': return `${inr(i.unpaid)} unpaid for ${i.age} days`;
    case 'spike': return `${i.ratio}× this supplier's usual bill`;
    case 'anomaly': return `Unusual: ${i.ml.reasons[0] || 'differs from the rest of the ledger'}`;
    case 'split': return `Paid in ${i.parts.length} parts, needs your confirmation`;
    case 'combined': return `${g.bills.length} bills paid in one transfer, needs your confirmation`;
    case 'doublePay': return 'Same bill paid twice, cash to recover';
  }
  return '';
}
function explain(g) {
  const i = g.items[Math.min(S.billIdx, g.items.length - 1)];
  const s = S.D.suppliers[g.sup], r = rec(i.bills[0]);
  const st = STATES[s.gstin.slice(0, 2)] || 'another state';
  switch (g.type) {
    case 'missing2b': return `${g.bills.length > 1 ? g.bills.length + ' bills' : 'This bill'} (${g.bills.map((id) => rec(id).inv).join(', ')}) ${g.bills.length > 1 ? 'are' : 'is'} in your books, but ${s.name} hasn't reported ${g.bills.length > 1 ? 'them' : 'it'} in GSTR-1${s.late ? ' (their last filing was for July)' : ''}. Claiming ${inr(g.impact)} now would exceed GSTR-2B and can trigger a DRC-01C notice. Hold the claim and the next payment until they file.`;
    case 'missingBooks': { const p = i.paid && S.D.bank.find((x) => x.id === i.paid); return `${s.name} reported ${r.inv} (taxable ${inr(r.taxable)}, GST ${inr(tax(r))}) against your GSTIN, but it isn't in your purchase register.${p ? ` Your bank shows ${inr(p.amount)} paid to them on ${fdate(p.date)}, so this looks like a real purchase that was never booked.` : ' Check whether it is yours before accepting it in IMS.'} Being in GSTR-2B doesn't make it claimable by itself: confirm the purchase, book it, and claim by ${fdate(i.lapse)} (the Section 16(4) time limit).`; }
    case 'amount': { const g2 = S.D.g2b.find((x) => x.id === i.g); return i.bucket === 'recover' ? `Your books show a taxable value of ${inr(r.taxable)}; ${s.name} reported ${inr(g2.taxable)}, which is ${inr(g.impact)} more credit than your books claim. Check the bill. If GSTR-2B is right, correct your books and the extra credit is potential credit to review.` : `Your books show a taxable value of ${inr(r.taxable)}; ${s.name} reported ${inr(g2.taxable)}. Only the difference is at stake: ${inr(g.impact)} more credit in your books than GSTR-2B supports. Ask them to amend GSTR-1, or claim only the GSTR-2B value this month.`; }
    case 'taxValue': return `At ${r.rate}% on ${inr(r.taxable)}, the tax should be ${inr(i.expected)}, but ${inr(tax(r))} was recorded. Correct the entry before filing.`;
    case 'gstin': return `The GSTIN in your books (${r.gstin}) fails the checksum. GSTR-2B shows ${i.good} for the same invoice number and amount, so it is probably a typing error, but Rekora never merges two suppliers on its own. Confirm it is the same supplier, then fix the GSTIN in your books.`;
    case 'rate': return `${s.name} charged ${r.rate}% on HSN ${r.hsn} (${HSN[r.hsn].d}). The rate master says ${i.mr}% for ${fdate(r.date)}.${i.scrapped ? ` The ${r.rate}% slab was scrapped on 22 Sep 2025.` : ''} The extra ${inr(g.impact)} of GST isn't safe to claim. Ask for a credit note.`;
    case 'taxType': return i.inter ? `${s.name} is registered in ${st} (GSTIN starts ${s.gstin.slice(0, 2)}) and the goods came to you in ${STATES[(buyer().state || '07')] || 'your state'}. That's an inter-state supply, so it should carry IGST of ${inr(tax(r))}, not CGST + SGST. Credit under the wrong head can be disallowed.${r._p && r._p.length ? ' Amounts and payment match, so only the tax type is wrong.' : ''}` : `${s.name} is in the same state as you, so this bill should carry CGST + SGST, not IGST of ${inr(tax(r))}.`;
    case 'duplicate': { const t = S.D.books.find((x) => x.id === i.twin); return `${t.inv} and ${r.inv} are the same bill entered twice: same supplier, amount and date. Only one appears in GSTR-2B and the bank. Remove the second entry, or you over-claim ${inr(g.impact)}.`; }
    case 'unpaid180': return `This bill dated ${fdate(r.date)} is unpaid or part-paid after ${i.age} days, with ${inr(i.unpaid)} still outstanding${i.paid ? ` (${inr(i.paid)} was paid)` : ''}. Under the 180-day rule (Section 16(2), Rule 37) credit is reversed in proportion to the unpaid part, here ${inr(g.impact)}, and you can claim it back once you pay. Interest at 18% a year from the date the credit was availed is about ${inr(i.interest)} so far.`;
    case 'spike': return `This bill's taxable value of ${inr(r.taxable)} is ${i.ratio}× ${s.name}'s usual ${inr(i.med)}.${i.sunday ? ' It\'s dated on a Sunday.' : ''} One-off bills like this are how fake-ITC invoices often look. Hold the payment and check the e-way bill before claiming.${i.ml ? ` The Isolation Forest model agrees: anomaly score ${i.ml.score.toFixed(2)}.` : ''}`;
    case 'anomaly': return `The Isolation Forest model scored this bill ${i.ml.score.toFixed(2)} (1.0 is the most unusual) against the whole ledger, the main reasons: ${i.ml.reasons.join('; ') || 'it is unlike the other bills'}. That is not an error by itself, so check the bill with ${s.name} before you claim ${inr(tax(r))} of credit.`;
    case 'split': { const ps = i.parts.map((id) => S.D.bank.find((p) => p.id === id)); return `${s.name}'s bill ${r.inv} (${inr(total(r))}) looks to be paid in ${ps.length} parts: ${ps.map((p) => `${inr(p.amount)} on ${fdate(p.date)}`).join(' and ')}. The parts add up exactly, but bank narrations rarely name the invoice, so Rekora does not decide this alone. Confirm the allocation to close it.`; }
    case 'combined': { const p = S.D.bank.find((x) => x.id === i.pay); return `One payment of ${inr(p.amount)} on ${fdate(p.date)} ("${p.ref}") matches ${g.bills.map((id) => rec(id).inv).join(' + ')} from ${s.name} added together. It looks like a bulk payment. Confirm the allocation so these bills are not wrongly treated as unpaid under the 180-day rule.`; }
    case 'doublePay': { const a = S.D.bank.find((x) => x.id === i.first), b2 = S.D.bank.find((x) => x.id === i.pay); return `${r.inv} (${inr(total(r))}) was paid on ${fdate(a.date)} and again on ${fdate(b2.date)}, both naming the same invoice. The bill and its credit are fine; ${inr(b2.amount)} of cash went out twice. Ask ${s.name} for a refund or an adjustment against the next bill. This is a cash leak, so it is not counted in the credit buckets.`; }
  }
  return '';
}
const ACTIONS = {
  missing2b:[['Draft follow-up', 'draft'], ['Keep pending in IMS', 'fix', 'Kept pending. Moved out of this month\'s claim.'], ['Not an issue', 'none', 'Marked as fine. Credit stays in the claim.']],
  missingBooks:[['Add to books', 'add', 'Booked. Credit added to this month\'s claim.'], ['Reject in IMS', 'none', 'Rejected in IMS. It won\'t count as your credit.']],
  amount:[['Draft follow-up', 'draft'], ['Claim GSTR-2B value', 'fix', 'Claim reduced to the GSTR-2B value.']],
  taxValue:[['Correct the entry', 'fix', 'Entry corrected.']],
  gstin:[['Fix GSTIN in books', 'none', 'GSTIN fixed. Credit is safe to claim.']],
  rate:[['Request credit note', 'draft'], ['Mark IMS: Reject', 'fix', 'Rejected in IMS. Excess GST left out of the claim.']],
  taxType:[['Request credit note', 'draft'], ['Mark IMS: Reject', 'fix', 'Rejected in IMS until a corrected invoice arrives.']],
  duplicate:[['Remove duplicate', 'fix', 'Duplicate removed from the books.']],
  unpaid180:[['Reverse ITC', 'fix', 'Credit reversed. Re-claim it once you pay.'], ['Mark as paid', 'none', 'Marked as paid. Credit can stay.']],
  spike:[['Hold payment', 'none', 'Payment on hold until delivery is verified.'], ['Mark verified', 'none', 'Verified as genuine.']],
  anomaly:[['Mark verified', 'none', 'Verified as genuine.'], ['Hold payment', 'none', 'Payment on hold until the bill is verified.']],
  combined:[['Confirm allocation', 'none', 'Payment allocation confirmed.'], ['Not a match', 'none', 'Unlinked. The bills go back to unpaid.']],
  doublePay:[['Ask for refund', 'none', 'Refund request noted. No credit change.'], ['Mark as adjusted', 'none', 'Marked as adjusted against a later bill.']],
  split:[['Confirm match', 'none', 'Split payment confirmed.'], ['Not a match', 'none', 'Unlinked. The bill goes back to unmatched.']],
};
function riskScore(k) {
  const w = { spike:35, missing2b:15, taxType:20, rate:20, gstin:15, amount:15, duplicate:10, unpaid180:20, taxValue:10, missingBooks:0, split:0, combined:0, doublePay:10, anomaly:8 };
  const ms = S.ml && S.ml.supplierScore && S.ml.supplierScore[k];
  let s = ms !== undefined ? Math.max(0, Math.min(40, Math.round((ms - 0.4) * 100))) + (S.D.suppliers[k].late ? 10 : 0) : S.D.suppliers[k].base;
  S.groups.filter((g) => g.sup === k).forEach((g) => s += w[g.type] * (g.type === 'missing2b' ? Math.min(3, g.bills.length) : 1));
  return Math.min(99, Math.round(100 * (1 - Math.exp(-s / 55))));
}
function setoff(out, itc) {
  const o = Object.assign({}, out), c = Object.assign({}, itc), used = { igst:0, cgst:0, sgst:0 };
  const use = (from, to) => { const x = Math.min(c[from], o[to]); c[from] -= x; o[to] -= x; used[to] += x; };
  use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst');
  use('cgst', 'cgst'); use('cgst', 'igst'); use('sgst', 'sgst'); use('sgst', 'igst');
  return { cash:o, used };
}
function heads() {
  const E = S.totals.eligible;
  let sh = BASE.itcShare;
  if (!S.D.base) { const b = periodBooks(), tot = b.reduce((a, r) => a + tax(r), 0) || 1; sh = { igst:b.reduce((a, r) => a + r.igst, 0) / tot, cgst:b.reduce((a, r) => a + r.cgst, 0) / tot }; }
  const itc = { igst:Math.round(E * sh.igst), cgst:Math.round(E * sh.cgst) };
  itc.sgst = E - itc.igst - itc.cgst;
  return { itc, ...setoff(outputOf(), itc) };
}

/* ---------- evidence: books, GSTR-2B and bank for one issue ---------- */
function sourcesOf(g, idx = S.billIdx) {
  const i = g.items[Math.min(idx, g.items.length - 1)], b = i.bills[0];
  const book = S.D.books.find((x) => x.id === b) || null;
  const twin = g.type === 'duplicate' ? S.D.books.find((x) => x.id === i.twin) : null;
  const src = twin || book;
  const g2 = src ? (src._g ? S.D.g2b.find((x) => x.id === src._g) : null) : S.D.g2b.find((x) => x.id === b);
  const pays = (src && src._p ? src._p.map((id) => S.D.bank.find((p) => p.id === id)) : (i.paid ? [S.D.bank.find((p) => p.id === i.paid)] : [])).filter(Boolean);
  if (g.type === 'doublePay') { const p = S.D.bank.find((x) => x.id === i.pay); if (p) pays.push(p); }
  if (g.type === 'split' && !pays.length && i.parts) i.parts.forEach((id) => { const p = S.D.bank.find((x) => x.id === id); if (p) pays.push(p); });
  return { i, book, twin, g2, pays };
}
function evidenceCols(g) {
  const { i, book, twin, g2, pays } = sourcesOf(g);
  const gst = (r) => (r ? (r.gstin || S.D.suppliers[r.sup].gstin) : '');
  const t = g.type;
  const books = book ? {
    tag:twin ? ['reverse', 'Entered twice'] : ['pos', 'Found'],
    rows:[
      ['Invoice', twin ? `${twin.inv} and ${book.inv}` : book.inv, twin ? 'bad' : ''],
      ['Date', fdate(book.date), t === 'unpaid180' ? 'odd' : (t === 'spike' && i.sunday ? 'odd' : '')],
      ['GSTIN', gst(book), t === 'gstin' ? 'bad' : ''],
      ['Taxable', inr(book.taxable), t === 'amount' ? 'bad' : t === 'spike' ? 'odd' : ''],
      ['Rate', book.rate + '%', t === 'rate' ? 'bad' : ''],
      ['CGST + SGST', inr(book.cgst + book.sgst), t === 'taxType' && i.inter ? 'bad' : ''],
      ['IGST', inr(book.igst), t === 'taxType' && !i.inter ? 'bad' : ''],
      ['Total', inr(total(book)), t === 'amount' || t === 'taxValue' ? 'bad' : ''],
    ] } : { missing:'Not in your books', note:'GSTR-2B has it. Your purchase register does not.' };
  const twob = g2 ? {
    tag:['pos', 'Found'],
    rows:[
      ['Invoice', g2.inv, ''],
      ['Date', fdate(g2.date), ''],
      ['GSTIN', gst(g2), t === 'gstin' ? 'good' : ''],
      ['Taxable', inr(g2.taxable), t === 'amount' ? 'bad' : ''],
      ['Rate', (g2.taxable ? Math.round(tax(g2) / g2.taxable * 100) : 0) + '%', t === 'rate' ? 'bad' : ''],
      ['CGST + SGST', inr(g2.cgst + g2.sgst), t === 'taxType' && i.inter ? 'bad' : ''],
      ['IGST', inr(g2.igst), t === 'taxType' && !i.inter ? 'bad' : ''],
      ['Total', inr(total(g2)), t === 'amount' ? 'bad' : ''],
    ] } : { missing:'No matching entry', note:`Checked ${int(S.D.g2b.length)} GSTR-2B entries, including near-miss invoice numbers.` };
  const ctx = [];
  if (t === 'spike') ctx.push(['Usual bill', inr(i.med), 'odd']);
  if (t === 'rate') ctx.push(['Rate master', i.mr + '%', 'good']);
  if (t === 'unpaid180') ctx.push(['Unpaid', `${inr(i.unpaid)}, ${i.age} days`, 'bad']);
  if (t === 'anomaly' && i.ml) ctx.push(['Anomaly score', i.ml.score.toFixed(2), 'odd']);
  const paidSum = pays.reduce((a, p) => a + p.amount, 0);
  const bank = pays.length ? {
    tag:t === 'doublePay' ? ['risk', 'Paid twice'] : ['pos', pays.length > 1 ? `Paid in ${pays.length}` : 'Paid'],
    rows:[
      ['Reference', pays.map((p) => p.ref).join(' + '), ''],
      ['Date', pays.map((p) => fdate(p.date)).join(', '), ''],
      ['Amount', pays.length > 1 ? pays.map((p) => inr(p.amount)).join(' + ') : inr(paidSum), t === 'doublePay' ? 'bad' : 'good'],
      ...ctx,
    ] } : { tag:t === 'unpaid180' ? ['risk', 'Unpaid'] : ['info', 'No match'], rows:[['Payment', t === 'unpaid180' ? 'None found' : 'No payment matched', 'none'], ...ctx] };
  return [['Your books', books], ['GSTR-2B', twob], ['Bank', bank]];
}

/* ---------- decisions and exports ---------- */
function resolve(g, act, msg, label) {
  const before = S.totals.eligible;
  const delta = act === 'fix' ? -g.impact : act === 'add' ? g.impact : 0;
  const why = explain(g), item = g.items[0], ty = TYPES[g.type];
  S.resolved.set(g.key, delta); S.booksDelta += delta; S.resolvedCount++;
  const idx = visibleGroups().findIndex((x) => x.key === g.key);
  compute();
  const vis = visibleGroups(); S.sel = (vis[idx] || vis[idx - 1] || vis[0] || {}).key || null; S.billIdx = 0;
  const diff = S.totals.eligible - before;
  const entry = { id:++S.seq, at:new Date(), key:g.key, issue:ty.label, bucket:bucketOf(g), sup:supName(g.sup), gstin:S.D.suppliers[g.sup].gstin, invoices:g.bills.map((id) => rec(id).inv).join(' '), impact:g.impact, action:label || msg, outcome:msg, claimDelta:delta, eligibleDelta:diff, ims:item.ims ? item.ims.act : '', why };
  S.decisions.push(entry); S.lastEntry = entry.id;
  reach(3, true);
  renderAll();
  toast(`<b>${esc(msg)}</b>${diff ? ` Eligible ITC ${diff > 0 ? 'up' : 'down'} ${inr(Math.abs(diff))}.` : ''} Logged.`, { undo:() => undoDecision(entry.id) });
}
function undoDecision(id) {
  const d = S.decisions.find((x) => x.id === id); if (!d) return;
  S.resolved.delete(d.key); S.booksDelta -= d.claimDelta; S.resolvedCount--;
  S.decisions = S.decisions.filter((x) => x.id !== id);
  compute(); S.sel = d.key; S.billIdx = 0; renderAll();
  toast(`<b>Undone.</b> ${esc(d.issue)} at ${esc(d.sup)} is open again.`);
}
function downloadBlob(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadCsv(name, cols, rows) {
  const cell = (v) => { v = v === undefined || v === null ? '' : String(v); if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  downloadBlob(name, '﻿' + [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => cell(c[1](r))).join(','))].join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
}
function exportLog() {
  if (!S.decisions.length) return toast('<b>No decisions yet.</b> Resolve an issue and it appears here.');
  downloadCsv(`Rekora_decision_log_${periodOf()}.csv`, [['Logged at', (d) => stamp(d.at)], ['Return period', () => periodOf()], ['Issue', (d) => d.issue], ['Bucket', (d) => d.bucket], ['Supplier', (d) => d.sup], ['Supplier GSTIN', (d) => d.gstin], ['Invoices', (d) => d.invoices], ['At stake (INR)', (d) => d.impact], ['Decision', (d) => d.action], ['Result', (d) => d.outcome], ['Effect on claim', (d) => effectText(d)], ['Claim change (INR)', (d) => d.claimDelta], ['Change in eligible ITC (INR)', (d) => d.eligibleDelta], ['IMS advice', (d) => d.ims], ['Evidence and reason', (d) => d.why]], S.decisions);
  toast(`<b>Decision log downloaded.</b> ${plural(S.decisions.length, 'decision')}.`);
}
function exportQueue() {
  const rows = S.all.slice().sort((a, b) => b.impact - a.impact);
  downloadCsv(`Rekora_issue_queue_${periodOf()}.csv`, [['Rank', (g) => rows.indexOf(g) + 1], ['Issue', (g) => TYPES[g.type].label], ['Bucket', (g) => bucketOf(g)], ['Supplier', (g) => supName(g.sup)], ['Supplier GSTIN', (g) => S.D.suppliers[g.sup].gstin], ['Invoices', (g) => g.bills.map((id) => rec(id).inv).join(' ')], ['At stake (INR)', (g) => g.impact], ['Status', (g) => (S.resolved.has(g.key) ? 'Decided' : 'Open')], ['IMS advice', (g) => (g.items[0].ims ? g.items[0].ims.act : '')], ['Why flagged', (g) => explain(g)]], rows);
  toast(`<b>Issue queue downloaded.</b> ${plural(rows.length, 'issue')}.`);
}
function exportJSON() {
  const h = heads(), T = S.totals, o = outputOf(), [py, pm] = periodOf().split('-');
  const draft = { gstin:buyer().gstin, ret_period:pm + py, generated_by:'Rekora (draft, verify before filing)',
    sup_details:{ osup_det:{ iamt:o.igst, camt:o.cgst, samt:o.sgst } },
    itc_elg:{ itc_avl:[{ ty:'OTH', iamt:h.itc.igst, camt:h.itc.cgst, samt:h.itc.sgst }], itc_net:{ iamt:h.itc.igst, camt:h.itc.cgst, samt:h.itc.sgst } },
    tax_paid_cash:{ iamt:h.cash.igst, camt:h.cash.cgst, samt:h.cash.sgst, total:T.net },
    rekora:{ itc_at_risk:T.risk, itc_to_reverse:T.reverse, potential_credit_to_review:T.recover, open_issues:S.groups.length } };
  downloadBlob(`GSTR-3B_draft_${pm}${py}.json`, JSON.stringify(draft, null, 2), 'application/json');
  toast(`<b>GSTR-3B draft downloaded.</b> Net cash payable ${inr(T.net)}.`);
}

/* ---------- follow-up drafts (English and Hindi) ---------- */
function draftFor(g) {
  const s = S.D.suppliers[g.sup], r = rec(g.bills[0]);
  const invs = g.bills.map((id) => rec(id).inv).join(', ');
  const sign = `Accounts team, ${buyer().name}`, signHi = `अकाउंट्स टीम, ${buyer().name}`;
  const pn = periodName(), myState = STATES[buyer().state || '07'] || 'our state';
  if (g.type === 'missing2b') return { sub:`To ${s.name}: bills missing from GSTR-2B`, en:`Hi ${s.name} team,\n\nOur books show ${invs} for ${pn} (GST ${inr(g.impact)}), but ${g.bills.length > 1 ? 'they don\'t' : 'it doesn\'t'} appear in our GSTR-2B. Could you file or amend your GSTR-1 for ${monthName()} against our GSTIN ${buyer().gstin || ''}?\n\nWe'll release the pending payment as soon as ${g.bills.length > 1 ? 'they show' : 'it shows'} up.\n\nThanks,\n${sign}`, hi:`नमस्ते ${s.name} टीम,\n\nहमारे खातों में ${pn} के इनवॉइस ${invs} (GST ${inr(g.impact)}) दर्ज हैं, लेकिन ये हमारे GSTR-2B में नहीं दिख रहे। कृपया हमारे GSTIN ${buyer().gstin || ''} के साथ GSTR-1 फाइल या संशोधित करें।\n\nइनवॉइस दिखते ही हम बकाया भुगतान जारी कर देंगे।\n\nधन्यवाद,\n${signHi}` };
  if (g.type === 'taxType' && !g.items[0].inter) return { sub:`To ${s.name}: credit note request for ${r.inv}`, en:`Hi ${s.name} team,\n\nInvoice ${r.inv} dated ${fdate(r.date)} was billed with IGST of ${inr(tax(r))}. Since we're both registered in ${myState}, this is an intra-state supply and should carry CGST + SGST instead.\n\nPlease issue a credit note and a revised invoice, and update GSTR-1 accordingly.\n\nThanks,\n${sign}`, hi:`नमस्ते ${s.name} टीम,\n\nइनवॉइस ${r.inv} (${fdate(r.date)}) पर ${inr(tax(r))} का IGST लगाया गया है। हम दोनों एक ही राज्य में रजिस्टर्ड हैं, इसलिए यह राज्य के अंदर की सप्लाई है और इस पर CGST + SGST लगना चाहिए।\n\nकृपया क्रेडिट नोट और संशोधित इनवॉइस जारी करें, और GSTR-1 भी अपडेट करें।\n\nधन्यवाद,\n${signHi}` };
  if (g.type === 'taxType') return { sub:`To ${s.name}: credit note request for ${r.inv}`, en:`Hi ${s.name} team,\n\nInvoice ${r.inv} dated ${fdate(r.date)} was billed with CGST + SGST. Since you're registered in ${STATES[s.gstin.slice(0, 2)]} and the goods were delivered to ${myState}, this is an inter-state supply and should carry IGST of ${inr(tax(r))}.\n\nPlease issue a credit note and a revised invoice with IGST, and update GSTR-1 accordingly.\n\nThanks,\n${sign}`, hi:`नमस्ते ${s.name} टीम,\n\nइनवॉइस ${r.inv} (${fdate(r.date)}) पर CGST + SGST लगाया गया है। आप ${STATES[s.gstin.slice(0, 2)]} में रजिस्टर्ड हैं और माल दूसरे राज्य में आया है, इसलिए यह अंतर-राज्यीय सप्लाई है और इस पर ${inr(tax(r))} का IGST लगना चाहिए।\n\nकृपया क्रेडिट नोट और IGST के साथ संशोधित इनवॉइस जारी करें, और GSTR-1 भी अपडेट करें।\n\nधन्यवाद,\n${signHi}` };
  if (g.type === 'rate') { const i = g.items[0]; return { sub:`To ${s.name}: wrong GST rate on ${r.inv}`, en:`Hi ${s.name} team,\n\nInvoice ${r.inv} dated ${fdate(r.date)} charges ${r.rate}% GST on HSN ${r.hsn}. The applicable rate is ${i.mr}%${i.scrapped ? `, and the ${r.rate}% slab no longer exists after 22 Sep 2025` : ''}.\n\nPlease issue a credit note for the excess GST of ${inr(g.impact)} and correct your GSTR-1.\n\nThanks,\n${sign}`, hi:`नमस्ते ${s.name} टीम,\n\nइनवॉइस ${r.inv} (${fdate(r.date)}) पर HSN ${r.hsn} के लिए ${r.rate}% GST लगाया गया है, जबकि सही दर ${i.mr}% है।\n\nकृपया ${inr(g.impact)} के अतिरिक्त GST के लिए क्रेडिट नोट जारी करें और GSTR-1 में सुधार करें।\n\nधन्यवाद,\n${signHi}` }; }
  if (g.type === 'amount') { const g2 = S.D.g2b.find((x) => x.id === g.items[0].g); return { sub:`To ${s.name}: value mismatch on ${r.inv}`, en:`Hi ${s.name} team,\n\nFor invoice ${r.inv} dated ${fdate(r.date)}, your GSTR-1 shows a taxable value of ${inr(g2.taxable)}, but the invoice we received is for ${inr(r.taxable)}.\n\nPlease amend GSTR-1 so both match.\n\nThanks,\n${sign}`, hi:`नमस्ते ${s.name} टीम,\n\nइनवॉइस ${r.inv} (${fdate(r.date)}) के लिए आपके GSTR-1 में कर योग्य मूल्य ${inr(g2.taxable)} दिखाया गया है, जबकि हमें मिला इनवॉइस ${inr(r.taxable)} का है।\n\nकृपया GSTR-1 में सुधार करें ताकि दोनों मेल खाएं।\n\nधन्यवाद,\n${signHi}` }; }
  return { sub:`To ${s.name}`, en:`Hi ${s.name} team,\n\nWe found a difference on invoice ${r.inv}. Could you take a look?\n\nThanks,\n${sign}`, hi:`नमस्ते ${s.name} टीम,\n\nइनवॉइस ${r.inv} में अंतर मिला है। कृपया इसे देख लें।\n\nधन्यवाद,\n${signHi}` };
}
let DRAFT = null, LANG = 'en';
function openDraft(g) { DRAFT = draftFor(g); LANG = 'en'; $('#draftSub').textContent = DRAFT.sub; paintDraft(); openModal(); }
function paintDraft() {
  const t = $('#draftText'); t.textContent = DRAFT[LANG]; t.lang = LANG;
  $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === LANG)); moveSeg($('#langSeg'));
}

/* ---------- Ask Rekora: intent matching over the engine's output ---------- */
function suggestions() {
  const top = {}; S.groups.filter((g) => ['risk', 'reverse'].includes(bucketOf(g))).forEach((g) => { top[g.sup] = (top[g.sup] || 0) + g.impact; });
  const worst = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
  const draft = S.groups.find((g) => ['missing2b', 'taxType', 'rate', 'amount'].includes(g.type));
  return ['Which suppliers put the most ITC at risk?', worst ? `Why is ${supName(worst[0])} flagged?` : 'What is flagged this month?', 'How much GST do I pay this month?', 'What should I do before the IMS deadline?', draft ? `Draft a follow-up to ${supName(draft.sup)}` : 'Draft a follow-up'];
}
function engineFigureValues() {
  const values = new Set(), add = (n) => { if (Number.isFinite(n)) values.add(Math.round(n)); };
  Object.values(S.totals || {}).forEach(add); add((S.totals?.risk || 0) + (S.totals?.reverse || 0));
  const h = heads(); [h.itc, h.used, h.cash].forEach((part) => Object.values(part).forEach(add));
  (S.groups || []).forEach((g) => { add(g.impact); (g.items || []).forEach((item) => Object.values(item).forEach(add)); });
  const sums = new Map(), sum = (k, n) => sums.set(k, (sums.get(k) || 0) + n);
  (S.groups || []).forEach((g) => { const b = bucketOf(g); sum('all', g.impact); sum('b:' + b, g.impact); sum('s:' + g.sup, g.impact); if (b === 'risk' || b === 'reverse') sum('sr:' + g.sup, g.impact); });
  sums.forEach(add);
  [S.D.books, S.D.g2b, S.D.bank].forEach((rows) => (rows || []).forEach((row) => { add(row.taxable); add(row.cgst); add(row.sgst); add(row.igst); add(row.amount); if (row.taxable !== undefined) { add(tax(row)); add(total(row)); } }));
  return values;
}
function verifyAnswerFigures(html) {
  const text = html.replace(/<[^>]*>/g, ' ');
  const figures = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)\s*(lakh|L)?\b/gi)].map((m) => ({ amount:Number(m[1].replace(/,/g, '')), lakh:!!m[2] })).filter((f) => Number.isFinite(f.amount));
  const available = engineFigureValues();
  const ok = (f) => (f.lakh ? [...available].some((v) => (v / 100000).toFixed(1) === f.amount.toFixed(1)) : available.has(Math.round(f.amount)));
  return { count:figures.length, verified:figures.every(ok) };
}
const refBtn = (g) => `<button class="ref" type="button" data-goto="${esc(g.key)}">${esc(rec(g.bills[0]).inv)}${g.bills.length > 1 ? ' +' + (g.bills.length - 1) : ''}</button>`;
function answer(q) {
  const t = q.toLowerCase();
  const sup = Object.keys(S.D.suppliers).find((k) => t.includes(S.D.suppliers[k].name.toLowerCase().split(' ')[0]) || t.includes(S.D.suppliers[k].name.toLowerCase()));
  if (/draft|follow|message|email|whatsapp|write/.test(t)) {
    const g = S.groups.find((x) => (!sup || x.sup === sup) && ['missing2b', 'taxType', 'rate', 'amount'].includes(x.type));
    if (!g) return { html:'<p>There is no open issue that needs a supplier message right now.</p>' };
    setTimeout(() => openDraft(g), 600);
    return { html:`<p>Opening a draft to <b>${esc(supName(g.sup))}</b> about ${refBtn(g)}, in English and Hindi.</p>` };
  }
  if (/why|flag|explain|wrong|issue with/.test(t) && sup) {
    const gs = S.groups.filter((x) => x.sup === sup);
    if (!gs.length) return { html:`<p>${esc(supName(sup))} has no open issues this month. All their bills matched across books, GSTR-2B and bank.</p>` };
    return { html:gs.map((g) => `<p><b>${TYPES[g.type].label}</b> ${refBtn(g)}: ${esc(explain(g))}</p>`).join('') };
  }
  if (/risk|most|top|worst|exposed/.test(t)) {
    const by = {};
    S.groups.filter((g) => ['risk', 'reverse'].includes(bucketOf(g))).forEach((g) => { (by[g.sup] = by[g.sup] || { amt:0, gs:[] }).amt += g.impact; by[g.sup].gs.push(g); });
    const top = Object.entries(by).sort((a, b) => b[1].amt - a[1].amt).slice(0, 5);
    if (!top.length) return { html:'<p>Nothing is at risk or due for reversal right now.</p>' };
    return { html:`<p>Top suppliers by credit at risk or to reverse:</p><ul>${top.map(([k, v]) => `<li><b>${esc(supName(k))}</b>: ${inr(v.amt)} ${v.gs.map(refBtn).join('')}</li>`).join('')}</ul>` };
  }
  if (/pay|payable|owe|liabil|how much|cash/.test(t)) {
    const h = heads(), T = S.totals;
    return { html:`<p>Output tax is ${inr(T.output)} and credit you can defend is ${inr(T.eligible)}, so you pay <b>${inr(T.net)}</b> in cash: IGST ${inr(h.cash.igst)}, CGST ${inr(h.cash.cgst)}, SGST ${inr(h.cash.sgst)}.</p><p>That assumes you fix the ${inr(T.risk + T.reverse)} flagged as at risk or to reverse.</p>` };
  }
  if (/before|deadline|ims|to do|todo|first|plan/.test(t)) {
    const pick = (types) => S.groups.filter((g) => types.includes(g.type));
    const rows = [['Reject or keep pending in IMS', pick(['taxType', 'rate', 'amount'])], ['Accept in IMS after booking', pick(['missingBooks'])], ['Chase the supplier, keep the claim pending', pick(['missing2b'])], ['Fix in your books', pick(['duplicate', 'gstin', 'taxValue'])]].filter((r) => r[1].length);
    if (!rows.length) return { html:'<p>Nothing left to act on in IMS. You are ready to file.</p>' };
    return { html:`<p>Draft GSTR-2B for ${monthName()} is generated on the 14th of next month. Bills you don't act on in IMS are deemed accepted, so:</p><ul>${rows.map(([l, gs]) => `<li><b>${l}</b>: ${gs.map(refBtn).join('')}</li>`).join('')}</ul>` };
  }
  return { html:`<p>I can answer questions about this month's reconciliation. Try one of these:</p><ul>${suggestions().map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` };
}
function addMsg(who, html, verification) {
  const m = document.createElement('div'); m.className = 'msg ' + who;
  m.innerHTML = (who === 'ai' ? '<div class="who"><span class="mark">R</span>Rekora</div>' : '') + html;
  if (who === 'ai' && verification && verification.count) m.insertAdjacentHTML('beforeend', `<div class="verified ${verification.verified ? '' : 'failed'}">${verification.verified ? `${plural(verification.count, 'figure')} checked against engine output` : 'Figure verification failed'}</div>`);
  const box = $('#msgs'); box.appendChild(m); box.scrollTop = box.scrollHeight;
  return m;
}
function greet() {
  if (U.greeted) return; U.greeted = true;
  addMsg('ai', `<p>${periodName()} has <b>${plural(S.groups.length, 'open issue')}</b> worth ${inr(S.groups.reduce((a, g) => a + g.impact, 0))}. Ask me anything about them.</p>`);
  $('#suggest').innerHTML = suggestions().map((q) => `<button type="button">${esc(q)}</button>`).join('');
}
function ask(q) {
  if (!q.trim()) return;
  addMsg('me', esc(q));
  const wait = addMsg('ai', '<span class="typing"><i></i><i></i><i></i></span>');
  setTimeout(() => { const a = answer(q); wait.remove(); addMsg('ai', a.html, verifyAnswerFigures(a.html)); }, RM ? 50 : 750);
}

/* ---------- Chaos Mode ---------- */
const BREAKS = [
  ['amount', 'Change the amount in GSTR-2B', 'Supplier reports a different value'],
  ['gstin', 'Mistype the GSTIN in your books', 'One character off'],
  ['rate28', 'Charge the scrapped 28% rate', 'Both sides billed at 28%'],
  ['taxtype', 'Swap the tax type', 'IGST and CGST + SGST switched'],
  ['remove', 'Delete it from GSTR-2B', 'Supplier never reported it'],
  ['dup', 'Enter it twice in your books', 'Same bill, new separator'],
  ['reformat', 'Reformat the invoice number', 'Trap: same bill, written differently. Should NOT be flagged'],
];
const TRAP_BREAKS = new Set(['reformat']);
function breakIt() {
  const id = ($('input[name=bill]:checked') || {}).value, how = ($('input[name=brk]:checked') || {}).value;
  if (!id || !how) return toast('<b>Pick a bill and a way to break it.</b>');
  const D = S.D, b = D.books.find((x) => x.id === id), g = D.g2b.find((x) => x.sup === b.sup && canon(x.inv) === canon(b.inv) && fy(x.date) === fy(b.date));
  const before = new Set(runEngine(D).issues.map((i) => i.type + '|' + i.bills.join()));
  const label = BREAKS.find((x) => x[0] === how)[1];
  const split = (r, tx) => { if (r.igst) r.igst = tx; else { r.cgst = Math.round(tx / 2); r.sgst = tx - r.cgst; } };
  let targets = [id], bucketMove = 'diff';
  const trap = TRAP_BREAKS.has(how), openBefore = S.groups.length;
  if (how === 'reformat') { const n = g && reformatInv(g.inv, b.inv); if (!n) return toast('<b>Could not reformat that invoice number.</b> Pick another bill.'); g.inv = n; }
  if (how === 'amount') { const d = +$('#deltaIn').value || 0; g.taxable += d; split(g, Math.round(g.taxable * b.rate / 100)); }
  if (how === 'gstin') { const s = D.suppliers[b.sup].gstin; b.gstin = s.slice(0, 5) + CS[(CS.indexOf(s[5]) + 1) % 36] + s.slice(6); }
  if (how === 'rate28') { const old = tax(b); b.rate = 28; split(b, Math.round(b.taxable * .28)); if (g) split(g, Math.round(g.taxable * .28)); if (D.base) S.booksDelta += tax(b) - old; }
  if (how === 'taxtype') { for (const r of [b, g]) { if (!r) continue; const tx = tax(r); if (r.igst) { r.igst = 0; r.cgst = Math.round(tx / 2); r.sgst = tx - r.cgst; } else { r.igst = tx; r.cgst = 0; r.sgst = 0; } } }
  if (how === 'remove') { D.g2b = D.g2b.filter((x) => x !== g); bucketMove = 'unmatched'; }
  if (how === 'dup') { const c = Object.assign({}, b, { id:id + 'D', inv:b.inv.includes('-') ? b.inv.replace('-', '/') : b.inv.replace('/', '-') }); D.books.push(c); targets.push(c.id); if (D.base) S.booksDelta += tax(c); bucketMove = 'dup'; if (D.base) S.counts.total++; }
  if (D.base && !trap) { if (how !== 'dup') S.counts.matched--; S.counts[bucketMove]++; }
  if (trap) S.chaos.traps++; else { S.chaos.broken.add(id); S.chaos.planted++; }
  S.filter = 'all'; S.query = ''; $('#search').value = '';
  scanEl($('#pChaos .chaos-card'), `Re-checking ${int(S.counts.total)} bills`, () => {
    const res = runEngine(D);
    const fresh = res.issues.filter((i) => !before.has(i.type + '|' + i.bills.join()) && i.bills.some((x) => targets.includes(x)));
    compute();
    const sup = supName(b.sup);
    S.newKeys = new Set(S.groups.filter((gr) => gr.items.some((it) => fresh.some((f) => f.type === it.type && f.bills.join() === it.bills.join()))).map((gr) => gr.key));
    let view = null;
    if (trap) {
      if (fresh.length) {
        S.chaos.falseAlarms++;
        const names = [...new Set(fresh.map((f) => TYPES[f.type].label))].join(', ');
        S.chaos.log.push(`<b class="m">False alarm</b> ${esc(label.toLowerCase())} on ${esc(sup)}: flagged ${esc(names)}`);
        toast(`<b>False alarm.</b> ${esc(names)} on ${esc(sup)} after only a reformat.`);
      } else {
        S.chaos.ignored++;
        S.chaos.log.push(`<b class="c">Ignored</b> ${esc(label.toLowerCase())} on ${esc(sup)} (${esc(b.inv)} vs ${esc(g.inv)}): still matched, no flag`);
        toast(`<b>Still matched. No false flag.</b> ${esc(b.inv)} and ${esc(g.inv)} are the same bill; ${plural(S.groups.length, 'open issue')}, ${S.groups.length === openBefore ? 'unchanged' : 'was ' + openBefore}.`);
      }
    } else if (fresh.length) {
      S.chaos.caught++;
      const top = S.groups.find((gr) => S.newKeys.has(gr.key));
      if (top) { S.sel = top.key; S.billIdx = Math.max(0, top.items.findIndex((it) => it.bills.some((x) => targets.includes(x)))); view = top.key; }
      const names = [...new Set(fresh.map((f) => TYPES[f.type].label))].join(', ');
      S.chaos.log.push(`<b class="c">Caught</b> ${esc(label.toLowerCase())} on ${esc(sup)}: ${esc(names)} in ${res.ms.toFixed(1)} ms`);
      toast(`<b>Caught in ${res.ms.toFixed(1)} ms.</b> ${esc(names)} on ${esc(sup)}.`, view ? { action:['View issue', () => openIssue(view)] } : {});
    } else {
      S.chaos.missed++;
      S.chaos.log.push(`<b class="m">Missed</b> ${esc(label.toLowerCase())} on ${esc(sup)}`);
      toast(`<b>Not flagged.</b> The change stayed within tolerance on ${esc(sup)}.`);
    }
    renderAll();
    setTimeout(() => { S.newKeys = new Set(); }, 8000);
  });
}

/* ---------- upload ---------- */
function load(set) { reset(set); compute(); U.greeted = false; $('#msgs').innerHTML = ''; renderAll(); }
async function handleFiles(files) {
  const csvs = files.filter((f) => /\.(csv|json)$/i.test(f.name) || f.type === 'text/csv' || f.type === 'application/json');
  if (!csvs.length) return toast('<b>CSV or GSTR-2B JSON only.</b> Export the register and bank statement as CSV; GSTR-2B can be the portal JSON.');
  const errors = [], got = [], fileNotes = [], staged = Object.assign({}, S.up);
  for (const f of csvs) {
    try {
      const r = Ingest.ingestFile(f.name, await f.text());
      staged[r.kind] = r; got.push(`${r.kind === 'g2b' ? 'GSTR-2B' : r.kind === 'books' ? 'books' : r.kind} (${r.rows.length})`); errors.push(...r.errors); fileNotes.push(...(r.notes || []));
    } catch (e) { toast(`<b>Could not read ${esc(f.name)}.</b> ${esc(e.message.replace(f.name + ': ', ''))}`); }
  }
  if (!got.length) return;
  const need = ['books', 'g2b'].filter((k) => !staged[k]);
  S.up = staged;
  if (need.length) { S.srcNote = `Got ${got.join(', ')}. Add the ${need.map((k) => (k === 'g2b' ? 'GSTR-2B' : 'purchase register')).join(' and ')} file to run the reconciliation.`; renderSources(); return toast(`<b>Got ${esc(got.join(', '))}.</b> Add the ${need.map((k) => (k === 'g2b' ? 'GSTR-2B' : 'purchase register')).join(' and ')} too.`); }
  try {
    const built = Ingest.buildDataset({ books:staged.books.rows, g2b:staged.g2b.rows, bank:staged.bank ? staged.bank.rows : [], sales:staged.sales ? staged.sales.rows : [] });
    Ingest.withPeriod(built.D, built.sales);
    S.srcNote = [errors.length ? `${plural(errors.length, 'row')} skipped: ${errors[0]}` : '', ...fileNotes, ...built.notes].filter(Boolean).join(' ');
    load({ D:built.D, label:'Uploaded files' });
    toast(`<b>Reconciled ${int(built.D.books.length)} books against ${int(built.D.g2b.length)} GSTR-2B rows.</b> ${plural(S.groups.length, 'open issue')}.`);
    if (errors.length) console.warn('Skipped rows:\n' + errors.join('\n'));
  } catch (e) { toast(`<b>Could not run the reconciliation.</b> ${esc(e.message)} Your previous data is unchanged.`); }
}

/* =======================================================================
   JOURNEY: steps, mode, navigation
   ======================================================================= */
const STEPS = [
  { t:'Bring in your month', s:() => `${int(S.D.books.length)} bills loaded` },
  { t:'Reconcile', s:() => plural(S.groups.length, 'open issue') },
  { t:'Review an issue', s:() => 'Three records, side by side' },
  { t:'Decision log', s:() => (S.decisions.length ? plural(S.decisions.length, 'decision') : 'Every call, on record') },
  { t:'Look deeper', s:() => 'Risk and anomalies' },
  { t:'Ask Rekora', s:() => 'Checked answers' },
  { t:'File the return', s:() => `${inr(S.totals.net)} to pay` },
];
const U = { cur:0, reached:0, mode:'guided', busy:false, tab:'suppliers', showAll:false, allSup:false, greeted:false, started:false };
const unlocked = () => (U.mode === 'full' ? STEPS.length - 1 : U.reached);
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
let lenis = null;

function buildSteps() {
  $('#steps').innerHTML = '<li class="step-ind" aria-hidden="true"></li>' + STEPS.map((st, i) =>
    `<li><button class="step" type="button" data-go="${i}"><span class="dot"></span><span><span class="t">${st.t}</span><span class="s"></span></span></button></li>`).join('');
}
function updateSteps(fresh) {
  const ul = unlocked();
  $$('#steps .step').forEach((b, i) => {
    const locked = i > ul, done = i < U.reached && i !== U.cur;
    b.className = 'step' + (locked ? ' locked' : '') + (i === U.cur ? ' active' : '') + (done ? ' done' : '') + (i < U.reached ? ' passed' : '') + (U.mode === 'guided' && i === ul + 1 ? ' teaser' : '') + (i === fresh ? ' pop' : '');
    b.setAttribute('aria-disabled', locked); if (i === U.cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    b.querySelector('.dot').innerHTML = locked ? LOCK : (done ? '✓' : String(i + 1).padStart(2, '0'));
    b.querySelector('.s').textContent = STEPS[i].s();
  });
  moveStepInd();
}
function moveStepInd() {
  const ind = $('.step-ind'), b = $$('#steps .step')[U.cur]; if (!ind || !b) return;
  ind.style.width = b.offsetWidth + 'px'; ind.style.height = b.offsetHeight + 'px';
  ind.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
  const ul = $('#steps'); if (ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left:b.offsetLeft - 16, behavior:RM ? 'auto' : 'smooth' });
}
function reach(i, quiet) {
  if (i <= U.reached) return;
  U.reached = i; updateSteps(i);
  if (U.mode === 'guided' && quiet) toast(`<b>${STEPS[i].t} is ready.</b> It just opened in the sidebar.`);
}
function lockedHint(i) {
  toast(`<b>${STEPS[i].t} opens as you go.</b> Finish this step, or switch to Full access in the top bar.`);
  const m = $('#modeSeg'); m.classList.remove('nudge'); void m.offsetWidth; m.classList.add('nudge');
}
function show(i, fresh) {
  U.cur = i;
  $('#peek').classList.remove('on');
  $$('.screen').forEach((s) => s.classList.toggle('on', +s.dataset.step === i));
  const p = $('#progress'); p.textContent = `Step ${i + 1} of ${STEPS.length}`; p.classList.remove('flip'); void p.offsetWidth; p.classList.add('flip');
  if (lenis) lenis.scrollTo(0, { immediate:true }); else window.scrollTo(0, 0);
  updateSteps(fresh);
  renderStep(i);
  enter($(`.screen[data-step="${i}"]`));
  if (i === 5) { greet(); }
}
function go(i, fresh) {
  if (i > unlocked()) return lockedHint(i);
  if (U.busy || (i === U.cur && fresh === undefined && U.started)) { if (i === U.cur) renderStep(i); return; }
  if (RM) return show(i, fresh);
  U.busy = true;
  $('#wipeNum').textContent = String(i + 1).padStart(2, '0'); $('#wipeName').textContent = STEPS[i].t;
  const w = $('#wipe'); w.classList.remove('run'); void w.offsetWidth; w.classList.add('run');
  setTimeout(() => show(i, fresh), 520);
  setTimeout(() => { U.busy = false; w.classList.remove('run'); }, 1150);
}
function advance() {
  const next = U.cur + 1; if (next >= STEPS.length || U.busy) return;
  if (next === 2 && !S.groups.length) return toast('<b>Nothing to review.</b> Every issue has a decision.');
  if (next > U.reached) { U.reached = next; go(next, next); } else go(next);
}
function openIssue(key) {
  S.sel = key; S.billIdx = 0;
  if (2 > U.reached) U.reached = 2;
  if (U.cur === 2) { renderReview(true); return; }
  go(2, 2);
}
function setMode(m, silent) {
  U.mode = m;
  if (m === 'guided') U.reached = Math.max(U.reached, U.cur);
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  moveSeg($('#modeSeg'));
  try { localStorage.setItem('rekora-mode', m); } catch (e) {}
  updateSteps();
  if (!silent) toast(m === 'full' ? '<b>Full access.</b> Every step is open. Jump anywhere from the sidebar.' : '<b>Guided mode.</b> Steps open one at a time as you go.');
}

/* =======================================================================
   MOTION SYSTEM
   ======================================================================= */
function splitWords(el) {
  if (RM) return;
  const walk = (node) => [...node.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(document.createTextNode(part)); return; }
        const w = document.createElement('span'); w.className = 'w';
        const i = document.createElement('span'); i.textContent = part; w.append(i); frag.append(w);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1) {
      if (n.classList.contains('num')) { const w = document.createElement('span'); w.className = 'w'; const i = document.createElement('span'); n.replaceWith(w); i.append(n); w.append(i); }
      else walk(n);
    }
  });
  walk(el);
  $$('.w>span', el).forEach((s, k) => s.style.setProperty('--k', k));
}
function setH1(i, html) { const h = $('#h-' + i); h.innerHTML = html; splitWords(h); }
const MEM = {};
const FMT = { inr, int, lakh };
const numHTML = (key, v, fmt = 'inr') => `<span class="num" data-nk="${key}" data-val="${Math.round(v)}" data-fmt="${fmt}">${FMT[fmt](v)}</span>`;
function animateNums(root, fromZero) {
  $$('[data-nk]', root).forEach((el) => {
    const key = el.dataset.nk, to = +el.dataset.val, fmt = FMT[el.dataset.fmt] || inr;
    const from = fromZero ? 0 : (MEM[key] !== undefined ? MEM[key] : to);
    MEM[key] = to;
    if (RM || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = fromZero ? 1500 : 900;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function rollLabels(root = document) {
  $$('.btn', root).forEach((b) => { if (b.dataset.rolled) return; b.dataset.rolled = 1; [...b.childNodes].forEach((n) => {
    const txt = n.nodeType === 3 && n.textContent.trim(); if (!txt) return;
    const r = document.createElement('span'); r.className = 'roll'; r.innerHTML = `<b data-t="${esc(txt)}">${esc(txt)}</b>`; n.replaceWith(r);
  }); });
}
function moveSeg(group) {
  if (!group) return;
  const on = $(':scope > button.on', group), ind = $(':scope > .ind', group);
  if (!on || !ind || !on.offsetWidth) return;
  ind.style.width = on.offsetWidth + 'px'; ind.style.height = on.offsetHeight + 'px';
  ind.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
}
const io = new IntersectionObserver((entries) => {
  let k = 0;
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target; el.style.transitionDelay = (k++ * 90) + 'ms'; el.classList.add('seen');
    setTimeout(() => { animateNums(el, true); $$('[data-seg]', el).forEach(moveSeg); }, k * 90);
    setTimeout(() => (el.style.transitionDelay = ''), 1600);
    io.unobserve(el);
  });
}, { threshold:.08, rootMargin:'0px 0px -4% 0px' });
function enter(s) {
  s.classList.remove('in');
  $$('.rv', s).forEach((el) => { el.classList.remove('seen'); el.style.transitionDelay = ''; });
  $$('[data-stagger]', s).forEach((c) => [...c.children].forEach((ch, k) => ch.style.setProperty('--s', k)));
  void s.offsetWidth;
  requestAnimationFrame(() => {
    s.classList.add('in');
    $$('.rv', s).forEach((el) => io.observe(el));
    $$('[data-seg]', s).forEach(moveSeg);
    animateNums($('h1', s), true);
  });
}
function scanEl(el, label, then) {
  if (!el || RM) return then();
  el.dataset.scan = label; el.classList.remove('scanning'); void el.offsetWidth; el.classList.add('scanning');
  setTimeout(() => { el.classList.remove('scanning'); then(); }, 950);
}
let toastN = 0;
function toast(html, opt = {}) {
  const t = document.createElement('div'); t.className = 'toast'; t.style.setProperty('--life', '5.2s');
  t.innerHTML = `<i>✓</i><span>${html}</span>`;
  const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => { fn(); kill(); }; t.append(b); };
  if (opt.undo) add('Undo', opt.undo);
  if (opt.action) add(opt.action[0], opt.action[1]);
  const box = $('#toasts'); box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 500); };
  setTimeout(kill, 5200);
  return ++toastN;
}

/* =======================================================================
   RENDERING
   ======================================================================= */
function renderMeta() {
  const b = buyer();
  $('#buyerName').textContent = b.name; $('#buyerGstin').textContent = b.gstin ? 'GSTIN ' + b.gstin : 'From uploaded files';
  $('#avatar').textContent = b.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  $('#periodPill').textContent = `Return period · ${MON[+periodOf().split('-')[1] - 1]} ${periodOf().split('-')[0]}`;
  $('#journeyLabel').textContent = `${monthName()} close`;
  $('#monthWord').textContent = monthName();
  document.title = `Rekora | ${periodName()} reconciliation`;
  const c = S.chaos, chip = $('#chaosChip');
  chip.classList.toggle('on', c.planted + (c.traps || 0) > 0);
  $('#chaosChipText').textContent = `Chaos: ${c.caught} of ${c.planted} caught` + (c.traps ? `, ${c.ignored} of ${c.traps} ignored` : '');
}

/* 01 sources */
const ICONS = {
  books:'<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/></svg>',
  g2b:'<svg viewBox="0 0 24 24"><path d="M12 3 4 7v6c0 4.5 3.4 7.4 8 8 4.6-.6 8-3.5 8-8V7z"/></svg>',
  bank:'<svg viewBox="0 0 24 24"><path d="M3 10 12 4l9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18"/></svg>',
  sales:'<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/></svg>',
};
function renderSources() {
  setH1(0, `Let's bring in ${monthName()}. <em>Three records, one view.</em>`);
  $('#srcLede').innerHTML = `Rekora reads the three records that never agree for <b>${esc(buyer().name)}</b>: your books, the GSTR-2B and the bank. Start with the loaded month, or drop in your own files.`;
  const legacy = !!S.D.base;
  const src = legacy
    ? [['books', 'Purchase register', 'CSV from Tally or any ERP', S.counts.total, 'bills'], ['g2b', 'GSTR-2B', 'Portal JSON or CSV', 2072, 'entries'], ['bank', 'Bank statement', 'CSV, any bank', 1986, 'payments'], ['sales', 'Sales register', 'Feeds output tax', 1240, 'rows']]
    : [['books', 'Purchase register', S.baseSet.label, S.D.books.length, 'bills'], ['g2b', 'GSTR-2B', S.baseSet.label, S.D.g2b.length, 'entries'], ['bank', 'Bank statement', S.baseSet.label, S.D.bank.length, 'payments'], ['sales', 'Sales register', S.D.output ? 'Output tax for ' + periodName() : 'Optional, feeds output tax', (S.D.sales || []).length, 'rows']];
  $('#srcFiles').innerHTML = src.map(([ic, nm, sub, c, unit], k) => `<div class="file card ${c ? '' : 'opt'}" data-tilt style="--s:${k}"><div class="ic">${ICONS[ic]}</div><div><b>${nm}</b><br><span>${esc(sub)}</span></div><div class="prog"><i></i></div><div class="state">${c ? `<span class="num">${int(c)}</span> ${unit} ready` : 'Not loaded'}</div></div>`).join('');
  $('#srcNote').innerHTML = S.srcNote ? `<div class="src-note">${esc(S.srcNote)}</div>` : '';
}
/* 02 reconcile */
function renderReconcile() {
  const t = S.totals, fix = t.risk + t.reverse, c = S.counts;
  $('#recEyebrow').innerHTML = `<span>(02)</span>Reconciled in ${S.D.base ? '41 seconds' : S.lastMs.toFixed(0) + ' ms'}`;
  setH1(1, fix ? `${numHTML('h1fix', fix)} of credit <em>needs your attention.</em>` : `Nothing at risk. <em>You're ready to file.</em>`);
  $('#recLede').innerHTML = `Rekora checked <b>${plural(c.total, 'bill')}</b> across books, GSTR-2B and bank. Here is what's left, largest rupee impact first.${t.recover ? ` It also found <b>${inr(t.recover)}</b> of potential credit to review.` : ''}`;
  const parts = [['matched', 'Matched', 'var(--pos)'], ['diff', 'Matched with a difference', 'color-mix(in srgb,var(--pos) 45%,var(--surface))'], ['confirm', 'Needs confirmation', 'var(--warn)'], ['unmatched', 'Unmatched', 'var(--accent)'], ['dup', 'Duplicates', 'var(--plum)']];
  $('#matchbar').innerHTML = `<div class="bar">${parts.map(([k, , col]) => `<i style="--w:${(c[k] / Math.max(1, c.total) * 100).toFixed(2)}%;background:${col}"></i>`).join('')}</div><div class="legend">${parts.map(([k, l, col]) => `<span style="--c:${col}">${l}<b>${int(c[k])}</b></span>`).join('')}</div>`;
  const sc = S.scoped || S.groups, sb = sumBuckets(sc), cn = sumCount(S.groups);
  const btns = [['all', 'All', S.groups.reduce((a, g) => a + g.impact, 0), S.groups.length], ['risk', 'At risk', t.risk, cn.risk], ['recover', 'Potential credit', t.recover, cn.recover], ['reverse', 'To reverse', t.reverse, cn.reverse], ['review', 'Review', sb.review + sb.confirm + sb.leak, cn.review + cn.confirm + cn.leak]];
  const bk = $('#buckets'); if (!$('.ind', bk)) bk.insertAdjacentHTML('afterbegin', '<span class="ind"></span>');
  $$(':scope > button', bk).forEach((b) => b.remove());
  bk.insertAdjacentHTML('beforeend', btns.map(([k, l, amt, n]) => `<button type="button" class="${S.filter === k ? 'on' : ''}" data-filter="${k}" title="${n} open">${l} <span class="amt">${inr(amt)}</span></button>`).join(''));
  moveSeg(bk);
  renderQueue();
}
function renderQueue() {
  const list = visibleGroups(), el = $('#issueList');
  const carry = S.groups.length - (S.scoped || S.groups).length;
  $('#qmeta').innerHTML = `<span>${list.length} of ${plural(S.groups.length, 'open issue')}${carry ? `. ${carry} from earlier months, not in this month's totals` : ''}</span>${S.query ? `<span class="chip">Search: ${esc(S.query)}<button type="button" data-clear-search aria-label="Clear search">×</button></span>` : ''}<span class="qtools"><button class="btn btn-ghost btn-sm" type="button" id="rerunBtn">Re-run reconciliation</button><button class="btn btn-ghost btn-sm" type="button" data-export-queue>Export queue</button></span>`;
  rollLabels($('#qmeta'));
  if (!list.length) {
    el.innerHTML = `<div class="empty"><b>${S.groups.length ? 'Nothing matches that filter' : `All clear for ${monthName()}`}</b>${S.groups.length ? 'Try another bucket or clear the search.' : 'Every open issue has a decision. You\'re ready to file.'}</div>`;
    return;
  }
  const shown = U.showAll ? list : list.slice(0, 8);
  el.innerHTML = shown.map((g, k) => {
    const ty = TYPES[g.type], invs = g.bills.map((id) => rec(id).inv), st = S.D.suppliers[g.sup].gstin.slice(0, 2), b = bucketOf(g);
    return `<button class="issue ${k === 0 && !S.query && S.filter === 'all' ? 'first' : ''} ${g.key === S.sel && U.cur === 1 ? 'sel' : ''}" type="button" role="listitem" data-key="${esc(g.key)}" style="--r:${k}">
      <span class="rank">${String(k + 1).padStart(2, '0')}</span>
      <span class="sup"><b>${esc(supName(g.sup))}</b><span>${esc(invs.slice(0, 2).join(', '))}${invs.length > 2 ? ` +${invs.length - 2}` : ''} · ${g.bills.length > 1 ? plural(g.bills.length, 'bill') : fdate(rec(g.bills[0]).date)} · ${esc(STATES[st] || 'State ' + st)}</span></span>
      <span class="what"><span class="tags"><span class="tag ${b}">${ty.label}</span>${S.newKeys.has(g.key) ? '<span class="badge-new">New</span>' : ''}</span><small>${esc(shortWhy(g))}</small></span>
      <span class="amt num">${inr(g.impact)}</span>
      <span class="chev" aria-hidden="true">→</span>
    </button>`;
  }).join('') + (list.length > 8 ? `<div class="more"><button class="btn btn-ghost btn-sm" type="button" id="showAll">${U.showAll ? 'Show top 8 only' : `Show all ${list.length}`}</button></div>` : '');
  rollLabels(el);
}
/* 03 review */
function renderReview(fresh) {
  const g = S.groups.find((x) => x.key === S.sel) || S.groups[0];
  if (!g) {
    setH1(2, `Nothing left to review. <em>Every issue has a decision.</em>`);
    $('#crumb').innerHTML = `<button type="button" data-go="1">Reconcile</button>`; $('#evEyebrow').innerHTML = '<span>(03)</span>All clear';
    ['#evMeta', '#billTabs', '#compare', '#reason'].forEach((s) => ($(s).innerHTML = '')); $('#reason').style.display = 'none';
    $('#evActions').innerHTML = `<button class="btn btn-primary" type="button" data-go="3">See the decision log <span class="arr">→</span></button>`; rollLabels($('#evActions'));
    return;
  }
  $('#reason').style.display = '';
  S.sel = g.key; if (S.billIdx >= g.items.length) S.billIdx = 0;
  const vis = visibleGroups(), pos = vis.findIndex((x) => x.key === g.key), b = bucketOf(g), ty = TYPES[g.type];
  const gi = g.items[Math.min(S.billIdx, g.items.length - 1)];
  $('#crumb').innerHTML = `<button type="button" data-go="1">Reconcile</button><span>/</span><span>${BUCKET_LABEL[b]}</span><span>/</span><span>${esc(g.bills.map((id) => rec(id).inv).slice(0, 2).join(', '))}</span><span class="ev-nav"><span>${pos >= 0 ? `${pos + 1} of ${vis.length}` : ''}</span><button class="icon-btn" type="button" data-step-issue="-1" aria-label="Previous issue (K)"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button><button class="icon-btn" type="button" data-step-issue="1" aria-label="Next issue (J)"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button></span>`;
  $('#evEyebrow').innerHTML = `<span>(03)</span>${esc(ty.label)}`;
  setH1(2, `${esc(supName(g.sup))}. <em>${esc(shortWhy(g))}.</em>`);
  const score = g.type === 'anomaly' ? `Anomaly score ${gi.ml.score.toFixed(2)}` : g.type === 'spike' ? `Supplier risk ${riskScore(g.sup)} / 100` : `${ty.conf}% confident`;
  $('#evMeta').innerHTML = `<span class="tag ${b}">${BUCKET_LABEL[b]}</span><span><b class="num">${inr(g.impact)}</b> ${stakeWord(b)}</span><span class="conf">${score}</span>${ty.needsReview ? '<span class="conf">A person must confirm</span>' : ''}`;
  $('#billTabs').innerHTML = g.items.length > 1 ? `<div class="billtabs" data-seg><span class="ind"></span>${g.items.map((it, n) => `<button type="button" class="${n === S.billIdx ? 'on' : ''}" data-bill="${n}">${esc(rec(it.bills[0]).inv)}</button>`).join('')}</div>` : '';
  $('#compare').innerHTML = evidenceCols(g).map(([h, c], k) => c.missing
    ? `<div class="col card missing" data-tilt style="--s:${k}"><h4>${h} <span class="tag risk">Not found</span></h4><div class="missing-box"><b>${esc(c.missing)}</b><span>${esc(c.note)}</span></div></div>`
    : `<div class="col card" data-tilt style="--s:${k}"><h4>${h} <span class="tag ${c.tag[0]}">${esc(c.tag[1])}</span></h4>${c.rows.map(([l, v, cls]) => `<div class="kv"><span>${l}</span><b class="${cls}">${esc(v)}</b></div>`).join('')}</div>`).join('');
  const words = explain(g), figs = (words.match(/₹[\d,]+/g) || []).length;
  let whyHtml = esc(words); const m = whyHtml.match(/₹[\d,]+/); if (m) whyHtml = whyHtml.replace(m[0], `<mark>${m[0]}</mark>`);
  const ims = gi.ims || { act:'Pending', why:'' }, cls = /accept/i.test(ims.act) ? 'accept' : /reject/i.test(ims.act) ? 'reject' : 'pending';
  $('#reason').innerHTML = `<div><div class="eyebrow" style="margin-bottom:12px"><span>Why</span>it was flagged</div><p class="why">${whyHtml}</p><p class="src">${plural(figs, 'figure')} from the engine${ty.method ? ` · found by the ${ty.method}` : ''}</p></div><div class="ims"><small>IMS advice</small><div class="act ${cls}">${esc(ims.act)}</div><p>${esc(ims.why)}</p></div>`;
  $('#evActions').innerHTML = ACTIONS[g.type].map(([label, act], n) => `<button class="btn ${n === 0 ? (act === 'draft' ? 'btn-primary' : 'btn-accent') : 'btn-ghost'}" type="button" data-act="${act}" data-n="${n}">${label}</button>`).join('') + `<button class="link" type="button" data-go="1" style="margin-left:6px">Back to the queue</button>`;
  rollLabels($('#evActions'));
  if (fresh && U.cur === 2) {
    ['#evMeta', '#compare', '#reason', '#evActions'].forEach((s) => { const el = $(s); el.classList.remove('seen'); void el.offsetWidth; el.classList.add('seen'); });
    $$('#compare > *').forEach((ch, k) => ch.style.setProperty('--s', k));
    $$('#billTabs [data-seg]').forEach(moveSeg);
  } else $$('#billTabs [data-seg]').forEach((s) => requestAnimationFrame(() => moveSeg(s)));
}
/* 04 decisions */
function renderDecisions() {
  const n = S.decisions.length, t = S.totals;
  setH1(3, n ? `${plural(n, 'decision')}, <em>on the record.</em>` : `Every call you make, <em>on the record.</em>`);
  $('#timeline').innerHTML = n ? S.decisions.slice().reverse().map((d) => `<div class="entry ${d.id === S.lastEntry ? 'new' : ''}">
      <time>${stamp(d.at).slice(11, 16)}</time>
      <div><b>${esc(d.action)} · ${esc(d.sup)}</b><p>${esc(d.issue)} · ${esc(d.invoices)}${d.ims ? ` · IMS advice: ${esc(d.ims)}` : ''}</p><button class="undo link" type="button" data-undo="${d.id}">Undo</button></div>
      <div class="eff">${d.claimDelta ? inr(d.claimDelta).replace(/^₹/, '+₹') : '₹0'}<small>${esc(effectText(d))}</small></div>
    </div>`).join('')
    : `<div class="empty"><b>No decisions yet</b>Open an issue, pick an action, and it is logged here with its evidence.<div class="actions" style="justify-content:center;margin-top:18px"><button class="btn btn-primary btn-sm" type="button" data-open-top>Review the top issue</button></div></div>`;
  S.lastEntry = null;
  $('#claim').innerHTML = `<div class="eyebrow" style="margin-bottom:4px"><span>●</span>Credit you can defend</div>
    <div class="big">${numHTML('eligible', t.eligible)}</div>
    <p class="small-note" style="margin:0 0 14px">Updates with every decision</p>
    <div class="row"><span>Decided</span><b class="num">${n} of ${n + S.groups.length}</b></div>
    <div class="row"><span>Credit in your books</span><b class="num">${inr(t.books)}</b></div>
    <div class="row"><span>At risk</span><b class="num">${inr(t.risk)}</b></div>
    <div class="row"><span>To reverse</span><b class="num">${inr(t.reverse)}</b></div>
    <div class="row"><span>Potential credit to review</span><b class="num">${inr(t.recover)}</b></div>`;
  rollLabels($('#timeline'));
  drawWaterfall();
}
function drawWaterfall() {
  const t = S.totals;
  const target = { books:t.books, risk:t.risk, reverse:t.reverse, recover:t.recover, eligible:t.eligible };
  const lows = [t.books, t.books - t.risk, t.books - t.risk - t.reverse, t.books - t.risk - t.reverse + t.recover, t.eligible].map((x) => Math.max(0, x));
  const low = Math.min(...lows), mag = Math.pow(10, Math.max(4, Math.floor(Math.log10(Math.max(low, 1))) - 1));
  target.F = Math.max(0, Math.floor(low * 0.88 / mag) * mag); target.top = Math.max(t.books, 1) * 1.04;
  const from = S.prevWf || { books:t.books, risk:0, reverse:0, recover:0, eligible:t.books };
  S.prevWf = target;
  $('#wfFoot').innerHTML = `<span>Output tax <b class="num">${inr(t.output)}</b></span><span>Credit you can defend <b class="num">${inr(t.eligible)}</b></span><span>${target.F ? `Axis starts at ${lakh(target.F)} so small changes stay visible` : 'Axis starts at zero'}</span>`;
  const t0 = performance.now(), dur = RM ? 1 : 1100;
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    const v = {}; for (const k of ['books', 'risk', 'reverse', 'recover', 'eligible']) v[k] = from[k] + (target[k] - from[k]) * e;
    paintWaterfall(v, target);
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function paintWaterfall(v, labels) {
  const W = 760, top = 34, bottom = 230, F = labels.F, maxV = Math.max(labels.top, F + 1);
  const y = (x) => bottom - (Math.max(x, F) - F) / (maxV - F) * (bottom - top);
  const a1 = v.books, a2 = a1 - v.risk, a3 = a2 - v.reverse, a4 = a3 + v.recover;
  const bars = [
    { k:['Credit in', 'your books'], c:'b-total', y0:F, y1:a1, lab:L(labels.books) },
    { k:['At risk', ''], c:'b-risk', y0:a2, y1:a1, lab:'−' + L(labels.risk) },
    { k:['To reverse', ''], c:'b-reverse', y0:a3, y1:a2, lab:'−' + L(labels.reverse) },
    { k:['Potential credit', 'to review'], c:'b-recover', y0:a3, y1:a4, lab:'+' + L(labels.recover) },
    { k:['Credit you', 'can defend'], c:'b-final', y0:F, y1:v.eligible, lab:L(labels.eligible) },
  ];
  const bw = 92, gap = (W - 40 - bars.length * bw) / (bars.length - 1);
  let s = `<line class="axis" x1="20" x2="${W - 20}" y1="${bottom}" y2="${bottom}"/>` + (F ? `<path class="brk" d="M8 ${bottom - 8} l6 -5 l6 10 l6 -10"/>` : '');
  bars.forEach((b, i) => {
    const x = 20 + i * (bw + gap), yTop = y(Math.max(b.y0, b.y1)), yBot = y(Math.min(b.y0, b.y1)), h = Math.max(2, yBot - yTop);
    s += `<rect class="${b.c}" x="${x}" y="${yTop}" width="${bw}" height="${h}" rx="5"/><text class="val" x="${x + bw / 2}" y="${yTop - 9}" text-anchor="middle">${b.lab}</text><text x="${x + bw / 2}" y="${bottom + 24}" text-anchor="middle">${b.k[0]}</text>`;
    if (b.k[1]) s += `<text x="${x + bw / 2}" y="${bottom + 43}" text-anchor="middle">${b.k[1]}</text>`;
    if (i < bars.length - 1) s += `<line class="conn" x1="${x + bw}" x2="${x + bw + gap}" y1="${y([a1, a2, a3, a4][i])}" y2="${y([a1, a2, a3, a4][i])}"/>`;
  });
  $('#wf').innerHTML = s;
}
/* 05 deeper */
function renderDeeper() {
  const odd = S.groups.filter((g) => g.type === 'anomaly' || g.type === 'spike');
  setH1(4, odd.length ? `${plural(odd.length, 'bill')} ${odd.length === 1 ? 'looks' : 'look'} <em>out of character.</em>` : `Look past the rules. <em>Nothing looks unusual.</em>`);
  $('#deepLede').textContent = `An Isolation Forest reads every bill against its supplier's history, and supplier risk rolls mismatches, late filing and odd bills into one score. Models flag for review only and never change a rupee figure.`;
  $$('#deepTabs > button').forEach((b) => b.classList.toggle('on', b.dataset.tab === U.tab));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === U.tab));
  moveSeg($('#deepTabs'));
  renderSuppliers(); renderUnusual(odd); renderChaos(); renderAccuracy();
}
function renderSuppliers() {
  const rows = Object.keys(S.D.suppliers).map((k) => {
    const gs = S.groups.filter((g) => g.sup === k);
    const exposed = gs.filter((g) => ['risk', 'reverse', 'review'].includes(bucketOf(g))).reduce((a, g) => a + g.impact, 0);
    return { k, s:S.D.suppliers[k], open:gs.length, exposed, score:riskScore(k) };
  }).sort((a, b) => b.score - a.score);
  const shown = U.allSup ? rows : rows.slice(0, 8);
  $('#pSuppliers').innerHTML = `<div class="card" style="padding:6px 10px"><div class="table-wrap" data-lenis-prevent><table class="sup-table"><thead><tr><th>Supplier</th><th>State</th><th class="r">Bills</th><th class="r">Open</th><th class="r">ITC exposed</th><th>GSTR-1 filing</th><th>Risk score</th></tr></thead><tbody>${shown.map((r) => {
    const col = r.score >= 70 ? 'var(--accent)' : r.score >= 40 ? 'var(--warn)' : 'var(--pos)';
    return `<tr data-sup="${r.k}" tabindex="0"><td><b>${esc(r.s.name)}</b><small>${r.s.gstin}</small></td><td>${STATES[r.s.gstin.slice(0, 2)] || '—'}</td><td class="r">${r.s.bills || '—'}</td><td class="r">${r.open || '—'}</td><td class="r">${r.exposed ? inr(r.exposed) : '—'}</td><td class="filing ${r.s.late ? 'bad' : ''}">${r.s.filing || '—'}</td><td><div class="risk-cell"><div class="risk-bar"><span style="width:${r.score}%;background:${col}"></span></div><strong class="num" style="color:${col}">${r.score}</strong></div></td></tr>`;
  }).join('')}</tbody></table></div></div>
  <div class="actions" style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="supMore">${U.allSup ? 'Show top 8 only' : `Show all ${rows.length} suppliers`}</button><span class="small-note">Click a supplier to see their issues in the queue.</span></div>`;
  rollLabels($('#pSuppliers'));
}
function renderUnusual(odd) {
  const top = odd.slice().sort((a, b) => (b.items[0].ml ? b.items[0].ml.score : 0) - (a.items[0].ml ? a.items[0].ml.score : 0) || b.impact - a.impact)[0];
  let left = `<div class="card anomaly"><div class="empty"><b>No unusual bills</b>The model found nothing out of character this month.</div></div>`;
  if (top) {
    const i = top.items[0], r = rec(top.bills[0]);
    const reasons = top.type === 'anomaly' ? (i.ml.reasons || []).slice(0, 3).map((x) => ['·', x]) : [[`${i.ratio}×`, 'this supplier\'s usual bill size'], ...(i.sunday ? [['Sun', 'Dated on a Sunday']] : []), ...(i.ml ? [[i.ml.score.toFixed(2), 'Isolation Forest anomaly score']] : [])];
    left = `<div class="card anomaly" data-tilt><span class="tag review">${TYPES[top.type].label} · ${esc(supName(top.sup))} · ${esc(r.inv)}</span>
      <div class="amt">${numHTML('odd-' + top.key, r.taxable)}</div><p class="sub">Taxable value on ${fdate(r.date)}${i.ml ? ` · anomaly score ${i.ml.score.toFixed(2)}` : ''}</p>
      <ul class="reasons" data-stagger>${reasons.map(([k, v]) => `<li><i>${esc(k)}</i>${esc(v)}</li>`).join('') || '<li><i>·</i>Unlike the other bills in the ledger</li>'}</ul>
      <div class="actions" style="margin-top:20px"><button class="btn btn-accent" type="button" data-goto="${esc(top.key)}">Open the evidence</button></div>
      ${odd.length > 1 ? `<div class="mini-list">${odd.filter((g) => g !== top).slice(0, 6).map((g) => `<button type="button" data-goto="${esc(g.key)}"><b>${esc(supName(g.sup))} · ${esc(rec(g.bills[0]).inv)}</b><span>${inr(g.impact)}</span></button>`).join('')}</div>` : ''}</div>`;
  }
  $('#pUnusual').innerHTML = `<div class="deeper">${left}<div class="benford card" id="benford"></div></div>`;
  $$('#pUnusual [data-stagger]').forEach((c) => [...c.children].forEach((ch, k) => ch.style.setProperty('--s', k)));
  renderBenford(); rollLabels($('#pUnusual'));
  if ($('#pUnusual').classList.contains('seen')) animateNums($('#pUnusual'), false);
}
function renderBenford() {
  const el = $('#benford'), b = Rekora.ml.benford(S.D);
  if (!b) { el.innerHTML = '<h3>Benford check</h3><p class="small-note" style="margin-top:6px">Not enough bills to run it.</p>'; return; }
  if (!b.applicable) { el.innerHTML = `<h3>Benford check</h3><p class="small-note" style="margin-top:6px">Not applicable to this data. Benford's law needs bills spread over several orders of magnitude, and this ledger's bills span only about ${b.spread}× from small to large. Running it anyway would flag normal data, so Rekora skips it.</p>`; return; }
  const W = 540, H = 150, base = 120, top = 14, bw = 34, gap = (W - 20 - 9 * bw) / 8, mx = Math.max(...b.observed, ...b.expected) * 1.1;
  const y = (v) => base - v / mx * (base - top);
  const bars = b.observed.map((o, i) => { const x = 10 + i * (bw + gap); return `<rect class="bf-bar" style="animation-delay:${i * 60}ms" x="${x}" y="${y(o)}" width="${bw}" height="${base - y(o)}" rx="3"/><line class="bf-exp" x1="${x - 3}" x2="${x + bw + 3}" y1="${y(b.expected[i])}" y2="${y(b.expected[i])}"/><text x="${x + bw / 2}" y="${base + 18}" text-anchor="middle">${i + 1}</text>`; }).join('');
  el.innerHTML = `<div class="card-head" style="margin-bottom:4px"><h3>Benford check</h3><span>${int(b.n)} bills</span></div><p class="small-note">First digits across the whole ledger against Benford's law.</p>
    <svg class="bf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="First-digit distribution against Benford's law">${bars}</svg>
    <div class="bf-key"><span><i style="background:var(--surface-2)"></i>Your bills</span><span><i style="background:var(--accent)"></i>Expected</span><span><b>Deviation ${b.mad}</b>: ${b.verdict}</span></div>`;
}
function renderChaos() {
  const c = S.chaos;
  const chosen = ($('input[name=bill]:checked') || {}).value, how = ($('input[name=brk]:checked') || {}).value || 'amount';
  const pool = S.clean || [];
  const firstFree = pool.filter((x) => !c.broken.has(x))[0];
  $('#pChaos').innerHTML = `<div class="chaos-wrap">
    <div class="card chaos-card">
      <div class="step-title">1. Pick a clean bill</div>
      <div class="picks">${pool.map((id) => {
        const b = S.D.books.find((x) => x.id === id) || S.baseSet.D.books.find((x) => x.id === id), done = c.broken.has(id);
        const on = !done && (chosen && !c.broken.has(chosen) ? chosen === id : firstFree === id);
        return `<label class="pick ${done ? 'done' : ''}"><input type="radio" name="bill" value="${id}" ${done ? 'disabled' : ''} ${on ? 'checked' : ''}><span>${esc(supName(b.sup))}<small>${esc(b.inv)}, ${inr(b.taxable)} taxable</small></span><span class="num">${inr(tax(b))}</span></label>`;
      }).join('') || '<p class="small-note">No clean bills left to break. Reset to start again.</p>'}</div>
      <div class="step-title">2. Choose how to break it</div>
      <div class="picks">${BREAKS.map(([k, l, s]) => `<label class="pick"><input type="radio" name="brk" value="${k}" ${k === how ? 'checked' : ''}><span>${l}<small>${s}</small></span></label>`).join('')}</div>
      <div class="delta" style="display:${how === 'amount' ? 'flex' : 'none'}"><label for="deltaIn">Change GSTR-2B taxable value by ₹</label><input id="deltaIn" type="number" value="15000" step="100"></div>
      <div class="actions" style="margin-top:20px"><button class="btn btn-accent" type="button" id="breakBtn" ${!pool.length || pool.every((id) => c.broken.has(id)) ? 'disabled' : ''}>${TRAP_BREAKS.has(how) ? 'Reformat it' : 'Break it'}</button><button class="btn btn-ghost btn-sm" type="button" id="resetBtn">Reset all data</button></div>
    </div>
    <div>
      <div class="score"><div><span>Planted</span><strong>${c.planted}</strong></div><div class="c"><span>Caught</span><strong>${c.caught}</strong></div><div class="m"><span>Missed</span><strong>${c.missed}</strong></div><div class="c"><span>Ignored</span><strong>${c.ignored}/${c.traps}</strong></div></div>
      <div class="chaos-log" data-lenis-prevent>${c.log.slice().reverse().map((l) => `<div>${l}</div>`).join('') || '<div>Break a clean bill on purpose and Rekora re-checks every bill. Try the trap too: a reformatted invoice number must stay quiet.</div>'}</div>
    </div></div>`;
  rollLabels($('#pChaos'));
}
function renderAccuracy() {
  const ev = window.REKORA_EVAL, el = $('#pAccuracy');
  if (!ev) { el.innerHTML = '<div class="card empty"><b>No accuracy run yet</b>Run <kbd>node tools/eval.js</kbd> to measure the engine.</div>'; return; }
  const o = ev.overall, g = ev.generated, pct = (x) => (x * 100).toFixed(1) + '%';
  const m = ev.ml;
  el.innerHTML = `<div class="acc-tiles">${[
    ['Bills checked', int(g.books), `${int(g.suppliers)} suppliers, ${g.from} to ${g.to}`],
    ['Errors planted', int(g.planted), `${g.plantedTypes} types, labelled in advance`],
    ['Recall', pct(o.recall), `precision ${pct(o.precision)}, ₹-weighted ${pct(o.weightedRecall)}`],
    ['Traps wrongly flagged', `${ev.traps.flagged} of ${int(ev.traps.total)}`, 'correct bills that only look different'],
  ].map(([l, v, s]) => `<div class="acc-tile card"><span>${l}</span><strong class="num">${v}</strong><small>${s}</small></div>`).join('')}</div>
  <div class="card" style="margin-top:14px;padding:6px 10px"><div class="table-wrap" data-lenis-prevent><table><thead><tr><th>Error type</th><th class="r">Planted</th><th class="r">Caught</th><th class="r">Recall</th><th class="r">Wrongly flagged</th><th class="r">₹ caught of ₹ planted</th></tr></thead><tbody>${TYPE_ORDER.filter((t) => ev.perType[t]).map((t) => { const x = ev.perType[t]; return `<tr><td>${TYPES[t].label}</td><td class="r">${int(x.planted)}</td><td class="r">${int(x.detected)}</td><td class="r ${x.missed ? 'miss' : ''}">${pct(x.recall)}</td><td class="r ${x.falsePositives ? 'miss' : ''}">${x.falsePositives}</td><td class="r">${inr(x.rupeesCaught)} of ${inr(x.rupeesPlanted)}</td></tr>`; }).join('')}</tbody></table></div></div>
  ${m ? `<p class="acc-note">Anomaly model (${m.model}, no labels used to train): found ${m.spikesFound} of ${m.plantedSpikes} planted unusual bills while flagging ${(m.flaggedShare * 100).toFixed(1)}% of ${int(m.billsScored)} bills for review, in ${m.ms} ms.</p>` : ''}
  <p class="acc-note">The errors were planted by our own generator, following the rules this engine implements, so this shows the engine is consistent and fast (${int(o.billsPerSecond)} bills a second), not that it will score the same on real books. Real data comes next.</p>`;
}
/* 07 file */
function renderFile() {
  const t = S.totals, h = heads(), o = outputOf(), names = { igst:'IGST', cgst:'CGST', sgst:'SGST' };
  setH1(6, `You pay ${numHTML('net', t.net)} <em>in cash for ${monthName()}.</em>`);
  $('#fileLede').innerHTML = `Output tax of <b>${inr(t.output)}</b> minus credit you can defend of <b>${inr(t.eligible)}</b>, set off head by head the way Section 49 requires.${t.risk + t.reverse ? ` This assumes you act on the ${inr(t.risk + t.reverse)} flagged as at risk or to reverse.` : ''}`;
  $('#headsBody').innerHTML = Object.keys(names).map((k) => `<tr><td>${names[k]}</td><td class="r">${inr(o[k])}</td><td class="r">${inr(h.itc[k])}</td><td class="r">${inr(h.used[k])}</td><td class="r"><b>${inr(h.cash[k])}</b></td></tr>`).join('');
  const sum = (x) => x.igst + x.cgst + x.sgst;
  $('#headsFoot').innerHTML = `<tr><td>Total</td><td class="r">${inr(sum(o))}</td><td class="r">${inr(sum(h.itc))}</td><td class="r">${inr(sum(h.used))}</td><td class="r">${inr(sum(h.cash))}</td></tr>`;
  const [py, pm] = periodOf().split('-').map(Number), ny = pm === 12 ? py + 1 : py, nm = pm === 12 ? 1 : pm + 1, mm = String(nm).padStart(2, '0');
  const now = new Date(), todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dl = [[`${ny}-${mm}-14`, `Draft GSTR-2B for ${monthName()}`, 'Accept, reject or park supplier bills in IMS before this. Untouched bills are deemed accepted.'], [`${ny}-${mm}-20`, 'GSTR-3B due', 'File and pay the net tax in cash.']];
  $('#deadlines').innerHTML = dl.map(([d, ti, s]) => {
    const n = days(todayIso, d);
    const lbl = n > 0 ? `<strong class="num">${n}</strong><small>days left</small>` : n === 0 ? '<strong>Today</strong>' : `<strong class="num">${-n}</strong><small>days ago</small>`;
    return `<div class="dl card ${n >= 0 && n <= 14 ? 'urgent' : ''}"><div class="days">${lbl}</div><div><b>${ti}, ${fdate(d)}</b><span>${s}</span></div></div>`;
  }).join('');
}
function renderStep(i) {
  [renderSources, renderReconcile, () => renderReview(false), renderDecisions, renderDeeper, () => {}, renderFile][i]();
  rollLabels($(`.screen[data-step="${i}"]`));
}
function renderAll() {
  renderMeta(); updateSteps();
  renderStep(U.cur);
  animateNums($(`.screen[data-step="${U.cur}"]`), false);
}

/* =======================================================================
   POINTER: cursor, magnet, tilt, spotlight, peek
   ======================================================================= */
function pointer() {
  if (!FINE || RM) return;
  const cur = $('#cur'), ring = $('#ring'), peek = $('#peek');
  let mx = -100, my = -100, rx = -100, ry = -100, px = -100, py = -100, peekOn = false;
  addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    cur.classList.remove('hide'); ring.classList.remove('hide');
    ring.classList.toggle('hov', !!e.target.closest('button, a, input, label.pick, label.drop, [data-tilt], tr[data-sup]'));
    const card = e.target.closest('.card');
    if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', (mx - r.left) + 'px'); card.style.setProperty('--my', (my - r.top) + 'px'); }
    const issue = e.target.closest('.issue');
    if (issue) {
      const g = S.groups.find((x) => x.key === issue.dataset.key);
      if (g && peek.dataset.k !== g.key) {
        peek.dataset.k = g.key;
        const { book, g2, pays, i } = sourcesOf(g, 0);
        const line = (h, v, bad) => `<div class="pl"><span>${h}</span><b class="${bad ? 'bad' : ''}">${esc(v)}</b></div>`;
        peek.innerHTML = `<h5>${esc(supName(g.sup))} · ${esc(TYPES[g.type].label)}</h5>` +
          line('Books', book ? `${book.inv}, ${inr(book.taxable)}` : 'Not in books', !book || ['amount', 'gstin', 'rate', 'taxType', 'duplicate', 'taxValue'].includes(g.type)) +
          line('GSTR-2B', g2 ? `${g2.inv}, ${inr(g2.taxable)}` : 'Not found', !g2 || ['amount', 'rate', 'taxType'].includes(g.type)) +
          line('Bank', pays.length ? `Paid ${inr(pays.reduce((a, p) => a + p.amount, 0))}` : (g.type === 'unpaid180' ? `Unpaid, ${i.age} days` : 'No payment matched'), !pays.length || g.type === 'doublePay');
      }
      if (!peekOn) { px = mx; py = my; }
      peek.classList.add('on'); peekOn = true;
    } else if (peekOn) { peek.classList.remove('on'); peekOn = false; }
  });
  document.addEventListener('mouseleave', () => { cur.classList.add('hide'); ring.classList.add('hide'); });
  addEventListener('mousedown', () => ring.classList.add('down'));
  addEventListener('mouseup', () => ring.classList.remove('down'));
  (function loop() {
    rx += (mx - rx) * .18; ry += (my - ry) * .18; px += (mx - px) * .12; py += (my - py) * .12;
    cur.style.transform = `translate(${mx}px, ${my}px)`; ring.style.transform = `translate(${rx}px, ${ry}px)`;
    const w = 270, ox = px + w + 40 > innerWidth ? px - w - 24 : px + 24;
    peek.style.left = ox + 'px'; peek.style.top = Math.min(py - 20, innerHeight - 170) + 'px';
    requestAnimationFrame(loop);
  })();
  document.addEventListener('mousemove', (e) => {
    const b = e.target.closest('.btn');
    $$('.btn.mag').forEach((x) => { if (x !== b) { x.classList.remove('mag'); x.style.transform = ''; } });
    if (b && !b.disabled) {
      const r = b.getBoundingClientRect(); b.classList.add('mag'); b.style.transition = 'transform .35s var(--ease),background .3s,border-color .3s,color .3s';
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .22}px, ${(e.clientY - r.top - r.height / 2) * .3}px)`;
    }
    const t = e.target.closest('[data-tilt]');
    $$('[data-tilt].tilting').forEach((x) => { if (x !== t) { x.classList.remove('tilting'); x.style.transform = ''; } });
    if (t) {
      const r = t.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width - .5, dy = (e.clientY - r.top) / r.height - .5;
      t.classList.add('tilting'); t.style.transform = `perspective(900px) rotateX(${-dy * 5}deg) rotateY(${dx * 6}deg) translateY(-3px)`;
    }
  });
}
function onScroll() {
  const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
  $('#scrollbar').style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  const big = $('.screen.on .bignum'); if (big) big.style.transform = `translateY(${y * +big.dataset.speed}px)`;
  const bb = $('#bucketBar'); if (bb.offsetParent) bb.classList.toggle('stuck', bb.getBoundingClientRect().top <= 13);
}

/* =======================================================================
   OVERLAYS: modal, theme, start chooser
   ======================================================================= */
let lastFocus = null;
function openModal() { lastFocus = document.activeElement; $('#draftModal').classList.add('on'); $('#scrim').classList.add('on'); requestAnimationFrame(() => moveSeg($('#langSeg'))); setTimeout(() => $('#copyDraft').focus(), 80); }
function closeModal() { $('#draftModal').classList.remove('on'); $('#scrim').classList.remove('on'); if (lastFocus) lastFocus.focus(); }
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
function setTheme(t, save) {
  document.documentElement.dataset.theme = t;
  $('#themeIcon').innerHTML = t === 'dark' ? SUN : MOON;
  $('#themeBtn').setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  $('meta[name=theme-color]').content = t === 'dark' ? '#111110' : '#ECEBE7';
  if (save) try { localStorage.setItem('rekora-theme', t); } catch (e) {}
}
function openChooser() {
  const c = $('#chooser'); c.hidden = false;
  setTimeout(() => $('.ch-opt', c).focus(), 100);
}
function pickMode(m, card) {
  const ch = $('#chooser'); if (ch.classList.contains('picked')) return;
  const seg = $('#modeSeg'); seg.classList.add('ready'); setMode(m, true);
  const target = $(`#modeSeg button[data-mode="${m}"]`);
  const finish = () => { ch.hidden = true; ch.classList.remove('picked', 'out'); card.style.visibility = ''; U.started = true; enter($(`.screen[data-step="${U.cur}"]`)); seg.classList.remove('nudge'); void seg.offsetWidth; seg.classList.add('nudge'); };
  if (RM || !card.animate) { finish(); return; }
  const a = card.getBoundingClientRect(), b = target.getBoundingClientRect();
  const ghost = document.createElement('div'); ghost.className = 'ghost'; ghost.textContent = target.textContent;
  Object.assign(ghost.style, { left:a.left + 'px', top:a.top + 'px', width:a.width + 'px', height:a.height + 'px' });
  document.body.appendChild(ghost); card.style.visibility = 'hidden'; ch.classList.add('picked');
  ghost.animate([
    { left:a.left + 'px', top:a.top + 'px', width:a.width + 'px', height:a.height + 'px', borderRadius:'16px', fontSize:'24px' },
    { left:b.left + 'px', top:b.top + 'px', width:b.width + 'px', height:b.height + 'px', borderRadius:'99px', fontSize:'12.5px' },
  ], { duration:950, easing:'cubic-bezier(.77,0,.18,1)', fill:'forwards' });
  setTimeout(() => ch.classList.add('out'), 380);
  setTimeout(() => { ghost.remove(); finish(); }, 980);
}

/* =======================================================================
   EVENTS
   ======================================================================= */
function selectIssue(dir) {
  const v = visibleGroups(); if (!v.length) return;
  const i = v.findIndex((g) => g.key === S.sel), n = Math.max(0, Math.min(v.length - 1, (i < 0 ? 0 : i) + dir));
  S.sel = v[n].key; S.billIdx = 0;
  if (U.cur === 2) renderReview(true);
  else if (U.cur === 1) { if (n >= 8) U.showAll = true; renderQueue(); const row = $(`.issue[data-key="${CSS.escape(S.sel)}"]`); if (row) row.scrollIntoView({ block:'nearest', behavior:RM ? 'auto' : 'smooth' }); }
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (btn && !RM && !btn.disabled) {
    const r = btn.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2, s = document.createElement('span');
    s.className = 'ripple'; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    btn.append(s); setTimeout(() => s.remove(), 800);
  }
  const t = e.target.closest('button, [data-sup], label.drop');
  if (!t) { if (e.target.id === 'scrim') closeModal(); return; }
  if (t.dataset.pick) return pickMode(t.dataset.pick, t);
  if (t.closest('#modeSeg') && t.dataset.mode) { if (t.dataset.mode !== U.mode) setMode(t.dataset.mode); return; }
  if (t.classList.contains('issue')) return openIssue(t.dataset.key);
  if (t.dataset.goto) return openIssue(t.dataset.goto);
  if (t.hasAttribute('data-open-top')) { const v = visibleGroups()[0] || S.groups[0]; return v ? openIssue(v.key) : toast('<b>Nothing to review.</b> Every issue has a decision.'); }
  if (t.dataset.go !== undefined && t.classList.contains('step') && +t.dataset.go > unlocked()) return lockedHint(+t.dataset.go);
  if (t.dataset.go !== undefined) return go(+t.dataset.go);
  if (t.hasAttribute('data-advance')) return advance();
  if (t.dataset.filter) { S.filter = t.dataset.filter; U.showAll = false; $$('#buckets > button').forEach((b) => b.classList.toggle('on', b === t)); moveSeg($('#buckets')); renderQueue(); return; }
  if (t.hasAttribute('data-clear-search')) { S.query = ''; $('#search').value = ''; return renderQueue(); }
  if (t.dataset.stepIssue) return selectIssue(+t.dataset.stepIssue);
  if (t.dataset.bill !== undefined) { S.billIdx = +t.dataset.bill; return renderReview(true); }
  if (t.dataset.act) {
    const g = S.groups.find((x) => x.key === S.sel); if (!g) return;
    const a = ACTIONS[g.type][+t.dataset.n];
    if (t.dataset.act === 'draft') return openDraft(g);
    resolve(g, t.dataset.act, a[2], a[0]);
    if (U.cur === 2) renderReview(true);
    return;
  }
  if (t.dataset.undo) return undoDecision(+t.dataset.undo);
  if (t.dataset.tab) { U.tab = t.dataset.tab; $$('#deepTabs > button').forEach((b) => b.classList.toggle('on', b === t)); moveSeg($('#deepTabs')); $$('.panel').forEach((p) => { p.classList.toggle('on', p.dataset.panel === U.tab); if (p.dataset.panel === U.tab) { p.classList.add('seen'); animateNums(p, true); } }); return; }
  if (t.dataset.lang) { LANG = t.dataset.lang; return paintDraft(); }
  if (t.dataset.sup) { S.query = S.D.suppliers[t.dataset.sup].name; $('#search').value = S.query; S.filter = 'all'; U.showAll = true; return go(1); }
  if (t.hasAttribute('data-close')) return closeModal();
  if (t.hasAttribute('data-export-3b')) return exportJSON();
  if (t.hasAttribute('data-export-log')) return exportLog();
  if (t.hasAttribute('data-export-queue')) return exportQueue();
  if (t.closest('#suggest')) return ask(t.textContent);
  switch (t.id) {
    case 'themeBtn': return setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
    case 'chaosChip': U.tab = 'chaos'; return go(4);
    case 'rerunBtn': return scanEl($('#issueList'), `Re-checking ${plural(S.counts.total, 'bill')}`, () => { compute(); renderAll(); toast(`<b>Re-checked in ${S.lastMs.toFixed(1)} ms.</b> ${plural(S.groups.length, 'open issue')}.`); });
    case 'breakBtn': return breakIt();
    case 'resetBtn': reset(); compute(); U.greeted = false; $('#msgs').innerHTML = ''; renderAll(); return toast(`<b>Data reset.</b> Back to the ${esc(S.baseSet.label.toLowerCase())}.`);
    case 'supMore': U.allSup = !U.allSup; return renderSuppliers();
    case 'showAll': U.showAll = !U.showAll; return renderQueue();
    case 'loadDemo': if (!window.REKORA_DEMO) return toast('The bundled demo month is not available.'); S.up = {}; S.srcNote = ''; load(demoSet()); return toast(`<b>Demo month loaded.</b> ${int(S.D.books.length)} books, ${plural(S.groups.length, 'open issue')}.`);
    case 'copyDraft': { const txt = DRAFT[LANG]; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('<b>Copied.</b> Paste it into email or WhatsApp.')).catch(() => toast('Select the text and copy it manually.')); return; }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'brk') { const how = e.target.value; $('#pChaos .delta').style.display = how === 'amount' ? 'flex' : 'none'; const b = $('#breakBtn'); b.dataset.rolled = ''; b.textContent = TRAP_BREAKS.has(how) ? 'Reformat it' : 'Break it'; rollLabels($('#pChaos')); }
  if (e.target.id === 'fileIn' && e.target.files.length) { const f = [...e.target.files]; e.target.value = ''; handleFiles(f); }
});
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === 'Escape') { if ($('#draftModal').classList.contains('on')) return closeModal(); if (typing) document.activeElement.blur(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#search').focus(); }
  if (typing || !$('#chooser').hidden) return;
  if (e.key === '/') { e.preventDefault(); if (unlocked() < 5) return lockedHint(5); go(5); return setTimeout(() => $('#askInput').focus(), 700); }
  if ((e.key === 'j' || e.key === 'k') && (U.cur === 1 || U.cur === 2)) return selectIssue(e.key === 'j' ? 1 : -1);
  if (e.key === 'Enter' && U.cur === 1 && document.activeElement === document.body && S.sel) return openIssue(S.sel);
  if (e.key === 'Enter' && document.activeElement.matches('tr[data-sup]')) document.activeElement.click();
});
$('#search').addEventListener('input', (e) => {
  S.query = e.target.value; U.showAll = !!S.query;
  if (U.cur !== 1) { if (unlocked() < 1) return lockedHint(1); show(1); }
  renderQueue();
});
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = visibleGroups()[0]; if (v) openIssue(v.key); } });
$('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#askInput'); ask(i.value); i.value = ''; });
['dragover', 'dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  const d = e.target.closest && e.target.closest('#drop'); if (!d) return; e.preventDefault();
  d.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop') handleFiles([...e.dataTransfer.files]);
}));
addEventListener('resize', () => { moveStepInd(); $$('[data-seg], #modeSeg').forEach(moveSeg); });
addEventListener('scroll', onScroll, { passive:true });

/* =======================================================================
   BOOT
   ======================================================================= */
function boot() {
  setTheme(document.documentElement.dataset.theme || 'light');
  reset(); compute();
  const items = Object.values(TYPES).map((t) => t.label);
  $('#track').innerHTML = [...items, ...items].map((x) => `<span>${esc(x)}</span>`).join('');
  $('#msgs').setAttribute('data-lenis-prevent', '');
  buildSteps(); renderMeta(); pointer();
  $('#lLabel').textContent = `Reading ${monthName()}`;
  if (window.Lenis && !RM) { lenis = new Lenis({ lerp:.085, smoothWheel:true }); lenis.on('scroll', onScroll); const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
  const q = new URLSearchParams(location.search).get('mode');
  const start = () => {
    show(0);
    if (q === 'full' || q === 'guided') { $('#modeSeg').classList.add('ready'); setMode(q, true); U.started = true; return; }
    $$('.screen.on').forEach((s) => s.classList.remove('in'));
    openChooser();
  };
  document.fonts && document.fonts.ready.then(() => { moveStepInd(); $$('[data-seg], #modeSeg').forEach(moveSeg); });
  const loader = $('#loader');
  if (RM) { loader.remove(); start(); return; }
  const t0 = performance.now(), dur = 1500;
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    $('#lcount').textContent = String(Math.round(e * 100)).padStart(3, '0');
    $('#lbar').style.transform = `scaleX(${e})`;
    if (p < 1) return requestAnimationFrame(tick);
    setTimeout(() => { loader.classList.add('out'); start(); setTimeout(() => loader.remove(), 1200); }, 250);
  })(t0);
}
boot();
