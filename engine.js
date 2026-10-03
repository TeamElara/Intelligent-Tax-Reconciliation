/* =====================================================================
   Rekora engine: deterministic checks. Every rupee shown comes from here.
   Shared by the dashboard (classic <script>, top-level names are globals)
   and the Node tools (module.exports at the bottom).
   ===================================================================== */
const BUYER = { name:'Mehta Electricals Pvt Ltd', gstin:'07AABCM4521K1ZK', state:'07' };
const AS_OF = '2026-09-30';
const STATES = { '03':'Punjab', '05':'Uttarakhand', '06':'Haryana', '07':'Delhi', '08':'Rajasthan', '09':'Uttar Pradesh', '19':'West Bengal', '23':'Madhya Pradesh', '24':'Gujarat', '27':'Maharashtra', '29':'Karnataka', '33':'Tamil Nadu' };
// Demo rate master. Date-effective: [from, rate] pairs, latest applicable wins.
const HSN = {
  '7214':{ d:'Steel bars and rods', h:[['2017-07-01',18]] },
  '8536':{ d:'Switches and sockets', h:[['2017-07-01',18]] },
  '8544':{ d:'Insulated wires and cables', h:[['2017-07-01',18]] },
  '7318':{ d:'Screws, bolts and nuts', h:[['2017-07-01',18]] },
  '7408':{ d:'Copper wire', h:[['2017-07-01',18]] },
  '3923':{ d:'Plastic packing articles', h:[['2017-07-01',18]] },
};
const GST2_DATE = '2025-09-22', SCRAPPED = [12, 28];
const INTEREST_PA = 0.18;

const SEED = {
  suppliers: {
    gupta:{ name:'Gupta Steel Traders', gstin:'06AADFG7781Q1ZO', base:35, bills:14, filing:'Last filed for July', late:true },
    balaji:{ name:'Shree Balaji Enterprises', gstin:'07AAHFS3318P1ZR', base:52, bills:6, filing:'On time', hist:[8200,9800,11000,9400,10500,9100,9800] },
    kapoor:{ name:'Kapoor Cables', gstin:'07AACFK2290L1Z7', base:20, bills:9, filing:'On time' },
    arora:{ name:'Arora Wires', gstin:'09AAKFA1234M1ZD', base:15, bills:11, filing:'On time' },
    sharma:{ name:'Sharma Switchgear', gstin:'07AAJFS6614D1Z9', base:10, bills:8, filing:'On time' },
    jain:{ name:'Jain Lighting', gstin:'07AAEFJ4471C1ZM', base:8, bills:5, filing:'On time' },
    bloom:{ name:'Bloom Traders', gstin:'08AAFFB9902K1Z8', base:22, bills:7, filing:'Filed late', late:true },
    orbit:{ name:'Orbit Office Solutions', gstin:'07AABCO7731E1ZL', base:18, bills:4, filing:'On time' },
    nova:{ name:'Nova Supplies', gstin:'06AACFN5518H1ZE', base:12, bills:3, filing:'On time' },
    mira:{ name:'Mira Packaging', gstin:'07AAGFM5521R1ZT', base:9, bills:10, filing:'On time' },
    dpt:{ name:'Delhi Power Tools', gstin:'07AACCD3381F1ZV', base:6, bills:12, filing:'On time' },
    bansal:{ name:'Bansal Electric Co', gstin:'06AAGFB2207N1ZL', base:7, bills:15, filing:'On time' },
    verma:{ name:'Verma Fasteners', gstin:'07AAKFV8812G1ZV', base:5, bills:20, filing:'On time' },
    singh:{ name:'Singh Copper Works', gstin:'03AAHFS6644B1ZH', base:8, bills:6, filing:'On time' },
    rathi:{ name:'Rathi Cables', gstin:'08AACFR1199M1ZQ', base:6, bills:9, filing:'On time' },
    agarwal:{ name:'Agarwal Switch House', gstin:'07AAEFA7720J1ZI', base:5, bills:7, filing:'On time' },
    goyal:{ name:'Goyal Lights', gstin:'07AAKFG4410H1ZM', base:6, bills:8, filing:'On time' },
    khanna:{ name:'Khanna Traders', gstin:'06AAEFK8823B1ZL', base:9, bills:5, filing:'On time' },
  },
  books: [
    { id:'B01', sup:'gupta', inv:'INV-311', date:'2026-09-04', hsn:'7214', taxable:240000, rate:18, cgst:0, sgst:0, igst:43200 },
    { id:'B02', sup:'gupta', inv:'INV-312', date:'2026-09-11', hsn:'7214', taxable:210000, rate:18, cgst:0, sgst:0, igst:37800 },
    { id:'B03', sup:'gupta', inv:'INV-318', date:'2026-09-22', hsn:'7214', taxable:240000, rate:18, cgst:0, sgst:0, igst:43200 },
    { id:'B04', sup:'balaji', inv:'SBE/2026/0918', date:'2026-09-13', hsn:'8536', taxable:304000, rate:18, cgst:27360, sgst:27360, igst:0 },
    { id:'B05', sup:'kapoor', inv:'KC-1187', date:'2026-04-01', hsn:'8544', taxable:270000, rate:18, cgst:24300, sgst:24300, igst:0 },
    { id:'B06', sup:'arora', inv:'AW-0442', date:'2026-09-12', hsn:'8544', taxable:212000, rate:18, cgst:19080, sgst:19080, igst:0 },
    { id:'B07', sup:'sharma', inv:'SS/442', date:'2026-09-09', hsn:'8536', taxable:149500, rate:18, cgst:13455, sgst:13455, igst:0 },
    { id:'B08', sup:'sharma', inv:'SS-442', date:'2026-09-09', hsn:'8536', taxable:149500, rate:18, cgst:13455, sgst:13455, igst:0 },
    { id:'B09', sup:'jain', inv:'JL-2201', date:'2026-09-05', hsn:'8536', taxable:55000, rate:18, cgst:4950, sgst:4950, igst:0 },
    { id:'B10', sup:'bloom', inv:'BT-1088', date:'2026-09-20', hsn:'8544', taxable:152000, rate:18, cgst:0, sgst:0, igst:27360 },
    { id:'B11', sup:'orbit', inv:'OOS-073', date:'2026-09-21', hsn:'8536', taxable:125000, rate:28, cgst:17500, sgst:17500, igst:0 },
    { id:'B12', sup:'mira', gstin:'07AAGFN5521R1ZT', inv:'MP-556', date:'2026-09-14', hsn:'3923', taxable:40000, rate:18, cgst:3600, sgst:3600, igst:0 },
    { id:'B13', sup:'dpt', inv:'DPT-2210', date:'2026-09-03', hsn:'8536', taxable:88000, rate:18, cgst:7920, sgst:7920, igst:0 },
    { id:'B14', sup:'bansal', inv:'BEC/0981', date:'2026-09-07', hsn:'8544', taxable:164000, rate:18, cgst:0, sgst:0, igst:29520 },
    { id:'B15', sup:'verma', inv:'VF-3307', date:'2026-09-11', hsn:'7318', taxable:36500, rate:18, cgst:3285, sgst:3285, igst:0 },
    { id:'B16', sup:'singh', inv:'SCW-118', date:'2026-09-16', hsn:'7408', taxable:248000, rate:18, cgst:0, sgst:0, igst:44640 },
    { id:'B17', sup:'rathi', inv:'RC-7740', date:'2026-09-19', hsn:'8544', taxable:92000, rate:18, cgst:0, sgst:0, igst:16560 },
    { id:'B18', sup:'agarwal', inv:'ASH-0563', date:'2026-09-23', hsn:'8536', taxable:58000, rate:18, cgst:5220, sgst:5220, igst:0 },
    { id:'B19', sup:'goyal', inv:'GL-201', date:'2026-09-08', hsn:'8536', taxable:30000, rate:18, cgst:2700, sgst:2700, igst:0 },
    { id:'B20', sup:'goyal', inv:'GL-209', date:'2026-09-15', hsn:'8536', taxable:45000, rate:18, cgst:4050, sgst:4050, igst:0 },
    { id:'B21', sup:'khanna', inv:'KT-0771', date:'2026-09-10', hsn:'7318', taxable:60000, rate:18, cgst:0, sgst:0, igst:10800 },
  ],
  g2b: [
    { id:'G04', sup:'balaji', inv:'SBE-2026-918', date:'2026-09-13', taxable:304000, cgst:27360, sgst:27360, igst:0 },
    { id:'G05', sup:'kapoor', inv:'KC-1187', date:'2026-04-01', taxable:270000, cgst:24300, sgst:24300, igst:0 },
    { id:'G06', sup:'arora', inv:'AW/442', date:'2026-09-12', taxable:212000, cgst:19080, sgst:19080, igst:0 },
    { id:'G07', sup:'sharma', inv:'SS-442', date:'2026-09-09', taxable:149500, cgst:13455, sgst:13455, igst:0 },
    { id:'G09', sup:'jain', inv:'JL2201', date:'2026-09-05', taxable:55000, cgst:4950, sgst:4950, igst:0 },
    { id:'G10', sup:'bloom', inv:'BT-1088', date:'2026-09-20', taxable:82800, cgst:0, sgst:0, igst:14904 },
    { id:'G11', sup:'orbit', inv:'OOS-73', date:'2026-09-21', taxable:125000, cgst:17500, sgst:17500, igst:0 },
    { id:'G12', sup:'mira', inv:'MP/556', date:'2026-09-14', taxable:40000, cgst:3600, sgst:3600, igst:0 },
    { id:'G13', sup:'dpt', inv:'DPT2210', date:'2026-09-03', taxable:88000, cgst:7920, sgst:7920, igst:0 },
    { id:'G14', sup:'bansal', inv:'BEC-981', date:'2026-09-07', taxable:164000, cgst:0, sgst:0, igst:29520 },
    { id:'G15', sup:'verma', inv:'VF3307', date:'2026-09-11', taxable:36500, cgst:3285, sgst:3285, igst:0 },
    { id:'G16', sup:'singh', inv:'SCW/118', date:'2026-09-16', taxable:248000, cgst:0, sgst:0, igst:44640 },
    { id:'G17', sup:'rathi', inv:'RC-7740', date:'2026-09-19', taxable:92000, cgst:0, sgst:0, igst:16560 },
    { id:'G18', sup:'agarwal', inv:'ASH-563', date:'2026-09-23', taxable:58000, cgst:5220, sgst:5220, igst:0 },
    { id:'G19', sup:'nova', inv:'NS-1042', date:'2026-09-18', taxable:100000, cgst:0, sgst:0, igst:18000 },
    { id:'G20', sup:'goyal', inv:'GL/201', date:'2026-09-08', taxable:30000, cgst:2700, sgst:2700, igst:0 },
    { id:'G21', sup:'goyal', inv:'GL/209', date:'2026-09-15', taxable:45000, cgst:4050, sgst:4050, igst:0 },
    { id:'G22', sup:'khanna', inv:'KT-771', date:'2026-09-10', taxable:60000, cgst:0, sgst:0, igst:10800 },
  ],
  // Bank rows carry only what a statement has: date, amount, narration. The payee is read from the narration.
  bank: [
    { id:'P06', date:'2026-09-15', amount:250160, ref:'NEFT ARORA WIRES AW442' },
    { id:'P07', date:'2026-09-16', amount:176410, ref:'NEFT SHARMA SWITCHGEAR SS442' },
    { id:'P09', date:'2026-09-10', amount:40000, ref:'IMPS JAIN LIGHTING JL2201 PART' },
    { id:'P10', date:'2026-09-24', amount:24900, ref:'IMPS JAIN LIGHTING JL2201 BAL' },
    { id:'P11', date:'2026-09-27', amount:179360, ref:'RTGS BLOOM TRADERS BT1088' },
    { id:'P12', date:'2026-09-29', amount:160000, ref:'NEFT ORBIT OFFICE SOLUTIONS OOS073' },
    { id:'P13', date:'2026-09-18', amount:47200, ref:'UPI MIRA PACKAGING MP556' },
    { id:'P14', date:'2026-09-08', amount:103840, ref:'NEFT DELHI POWER TOOLS DPT2210' },
    { id:'P15', date:'2026-09-17', amount:193520, ref:'RTGS BANSAL ELECTRIC BEC981' },
    { id:'P16', date:'2026-09-14', amount:43070, ref:'UPI VERMA FASTENERS VF3307' },
    { id:'P17', date:'2026-09-22', amount:292640, ref:'RTGS SINGH COPPER WORKS SCW118' },
    { id:'P18', date:'2026-09-26', amount:108560, ref:'NEFT RATHI CABLES RC7740' },
    { id:'P19', date:'2026-09-28', amount:68440, ref:'NEFT AGARWAL SWITCH HOUSE ASH563' },
    { id:'P20', date:'2026-09-25', amount:118000, ref:'NEFT NOVA SUPPLIES NS1042' },
    { id:'P21', date:'2026-09-25', amount:88500, ref:'NEFT GOYAL LIGHTS SEP BILLS' },
    { id:'P22', date:'2026-09-18', amount:70800, ref:'NEFT KHANNA TRADERS KT771' },
    { id:'P23', date:'2026-09-26', amount:70800, ref:'NEFT KHANNA TRADERS KT771' },
  ],
};

/* ---------- Helpers ---------- */
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const tax = (r) => r.cgst + r.sgst + r.igst;
const total = (r) => r.taxable + tax(r);
const CS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheck(g14) {
  let s = 0;
  for (let i = 0; i < 14; i++) { const p = CS.indexOf(g14[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); }
  return CS[(36 - (s % 36)) % 36];
}
function gstinValid(g) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) && gstinCheck(g) === g[14];
}
// INV/0042 and INV-42 are the same bill: drop separators and leading zeros in each part.
const canon = (inv) => inv.toUpperCase().split(/[^A-Z0-9]+/).map((x) => x.replace(/^([A-Z]*)0+(?=\d)/, '$1')).join('');
// Digits only, leading zeros dropped. Letters may differ between sources, digits may not (AW-0442 never matches AW-0443).
const digitsOf = (s) => (String(s).match(/\d+/g) || []).map((x) => String(+x)).join('-');
const hamming = (a, b) => a.length !== b.length ? 99 : [...a].filter((c, i) => c !== b[i]).length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function rateOn(hsn, date) { const m = HSN[hsn]; if (!m) return null; let r = null; for (const [from, rate] of m.h) if (date >= from) r = rate; return r; }
// Indian financial year (Apr-Mar). Suppliers restart invoice numbers every April, so it is part of the match key.
const fyStart = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 4 ? y : y - 1; };
const fy = (d) => { const s = fyStart(d); return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
// Section 16(4): credit for an FY can be claimed until 30 Nov after the FY ends.
const itcLapse = (d) => `${fyStart(d) + 1}-11-30`;
// Credit is treated as availed in GSTR-3B, due on the 20th of the following month.
const availedOn = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m === 12 ? `${y + 1}-01-20` : `${y}-${String(m + 1).padStart(2, '0')}-20`; };
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Narration digits end with the invoice's last number: "NEFT ARORA WIRES AW442" refers to AW-0442.
function refersTo(p, inv) {
  const last = (String(inv).match(/\d+/g) || []).pop();
  if (!last) return false;
  const want = String(+last);
  return (String(p.ref).match(/\d+/g) || []).some((run) => String(+run).endsWith(want));
}
// Who was paid, read from the narration. Ambiguous or unknown narrations stay unassigned for a person to allocate.
const LEGAL = new Set(['PVT', 'LTD', 'PRIVATE', 'LIMITED', 'CO', 'M/S', 'AND', 'THE']);
function payeeOf(p, suppliers) {
  if (p.sup) return p.sup;
  const words = new Set(String(p.ref).toUpperCase().split(/[^A-Z0-9]+/));
  let best = null, bestScore = 0, tie = false;
  for (const k in suppliers) {
    const toks = suppliers[k].name.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t && !LEGAL.has(t));
    const score = toks.filter((t) => words.has(t)).length / toks.length;
    if (score > bestScore) { best = k; bestScore = score; tie = false; } else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore >= 0.6 && !tie ? best : null;
}

/* ---------- Issue types ---------- */
// bucket: risk = claimed but not backed by GSTR-2B; recover = potential credit to review;
// reverse = must be reversed; review = a person should look; confirm = uncertain match, a person confirms;
// leak = cash lost, kept out of the credit buckets.
const TYPES = {
  missing2b:{ label:'Missing in GSTR-2B', bucket:'risk', conf:99, group:true },
  missingBooks:{ label:'Missing in books', bucket:'recover', conf:97 },
  amount:{ label:'Amount mismatch', bucket:'risk', conf:98 },
  taxValue:{ label:'Tax value mismatch', bucket:'risk', conf:99 },
  gstin:{ label:'GSTIN typo', bucket:'risk', conf:94, needsReview:true },
  rate:{ label:'Wrong GST rate', bucket:'reverse', conf:99 },
  taxType:{ label:'Wrong tax type', bucket:'reverse', conf:99 },
  duplicate:{ label:'Duplicate in books', bucket:'reverse', conf:97 },
  unpaid180:{ label:'Unpaid 180+ days', bucket:'reverse', conf:99 },
  spike:{ label:'Unusual spike', bucket:'review', conf:null, method:'median rule' },
  split:{ label:'Split payment', bucket:'confirm', conf:92, needsReview:true },
  combined:{ label:'Combined payment', bucket:'confirm', conf:90, needsReview:true },
  doublePay:{ label:'Paid twice', bucket:'leak', conf:95 },
};
const bucketOf = (i) => i.bucket || TYPES[i.type].bucket;

// Advice for the Invoice Management System: Accept, Pending or Reject, per issue.
function imsAdvice(i) {
  switch (i.type) {
    case 'missing2b': return { act:'Not in IMS', why:'The supplier has not reported it yet, so there is nothing to act on in IMS.' };
    case 'missingBooks': return { act:'Pending', why:'Keep it pending until you confirm the purchase is yours, then book it and accept.' };
    case 'amount': return i.bucket === 'recover' ? { act:'Pending', why:'GSTR-2B shows more than your bill. Check the bill before accepting.' } : { act:'Pending', why:'Keep it pending until the supplier amends GSTR-1.' };
    case 'taxValue': return { act:'Accept', why:'GSTR-2B is right; the error is in your books.' };
    case 'gstin': return { act:'Accept', why:'Accept once you confirm it is the same supplier, and fix the GSTIN in your books.' };
    case 'rate': return { act:'Reject', why:'Reject until the supplier issues a credit note at the correct rate.' };
    case 'taxType': return { act:'Reject', why:'Reject until a corrected invoice arrives under the right tax head.' };
    case 'duplicate': return { act:'Accept', why:'The supplier\'s entry is fine. Remove the extra copy from your books.' };
    case 'unpaid180': return { act:'Accept', why:'The bill is genuine. Reverse the credit in GSTR-3B and re-claim it when you pay.' };
    case 'spike': return { act:'Pending', why:'Keep it pending until delivery and the e-way bill are verified.' };
    case 'split': case 'combined': return { act:'Accept', why:'Accept once you confirm the payment allocation.' };
    case 'doublePay': return { act:'Accept', why:'The bill is fine. Recover the second payment from the supplier.' };
  }
  return { act:'Pending', why:'' };
}

/* ---------- Engine ---------- */
function runEngine(D) {
  const t0 = nowMs();
  const buyerState = (D.buyer || BUYER).state, asOf = D.asOf || AS_OF;
  const out = [];
  const supOf = (r) => D.suppliers[r.sup];
  const gOf = (r) => r.gstin || supOf(r).gstin;
  const key = (r) => gOf(r) + '|' + fy(r.date) + '|' + canon(r.inv);
  const dkey = (r) => gOf(r) + '|' + fy(r.date) + '|' + digitsOf(r.inv);
  const usedG = new Set(), usedP = new Set(), seen = new Map();
  const idx = (f) => { const m = new Map(); for (const g of D.g2b) { const k = f(g); if (!m.has(k)) m.set(k, []); m.get(k).push(g); } return m; };
  const byKey = idx(key), byDigits = idx(dkey);
  const free = (list) => (list || []).find((g) => !usedG.has(g.id));
  const push = (type, r, impact, extra = {}) => {
    const i = Object.assign({ type, sup:r.sup, bills:[r.id], impact:Math.round(impact) }, extra);
    i.ims = imsAdvice(i); out.push(i); return i;
  };

  // Pass 1: match each book entry to GSTR-2B and run the bill-level GST checks.
  const live = [];
  for (const b of D.books) {
    b._g = null; b._p = null; b._conf = null;
    const k = key(b);
    if (seen.has(k)) { push('duplicate', b, tax(b), { twin:seen.get(k) }); b._dup = true; continue; }
    b._dup = false; seen.set(k, b.id); live.push(b);
    let g = free(byKey.get(k)), conf = 1, typo = false;
    if (!g) { const c = free(byDigits.get(dkey(b))); if (c && Math.abs(c.taxable - b.taxable) <= 1) { g = c; conf = 0.9; } }
    if (!g && !gstinValid(gOf(b))) {
      // Never auto-accepted: a near-identical GSTIN with the same invoice and amount is raised for a person to confirm.
      g = D.g2b.find((x) => !usedG.has(x.id) && fy(x.date) === fy(b.date) && canon(x.inv) === canon(b.inv) && Math.abs(x.taxable - b.taxable) <= 1 && hamming(gOf(x), gOf(b)) <= 2);
      typo = !!g; conf = 0.8;
    }
    if (!g) push('missing2b', b, tax(b));
    else {
      usedG.add(g.id); b._g = g.id; b._conf = conf;
      if (typo) push('gstin', b, tax(b), { good:gOf(g) });
      const d = tax(b) - tax(g);
      // Only the difference is at stake. If GSTR-2B is higher, it is potential credit, not risk.
      if (Math.abs(b.taxable - g.taxable) > 1 && Math.abs(d) > 1) push('amount', b, Math.abs(d), { g:g.id, bucket:d < 0 ? 'recover' : 'risk' });
    }
    const expected = Math.round(b.taxable * b.rate / 100), dv = tax(b) - expected;
    if (Math.abs(dv) > 1) push('taxValue', b, Math.abs(dv), { expected, bucket:dv < 0 ? 'recover' : 'risk' });
    const mr = rateOn(b.hsn, b.date);
    // Only an overcharge is reversible; an undercharge leaves nothing to reverse.
    if (mr !== null && b.rate > mr) push('rate', b, tax(b) - Math.round(b.taxable * mr / 100), { mr, scrapped:b.date >= GST2_DATE && SCRAPPED.includes(b.rate) });
    const inter = gOf(b).slice(0, 2) !== buyerState;
    if ((inter && (b.cgst || b.sgst)) || (!inter && b.igst)) push('taxType', b, tax(b), { inter });
    const hist = supOf(b).hist;
    if (hist && hist.length && b.taxable > 8 * median(hist)) push('spike', b, tax(b), { ratio:Math.round(b.taxable / median(hist)), med:median(hist), sunday:new Date(b.date).getUTCDay() === 0 });
  }

  // Pass 2: payments. Payee comes from the narration; amounts and dates decide the rest.
  const paysBy = new Map();
  for (const p of D.bank) { p._sup = payeeOf(p, D.suppliers); if (!p._sup) continue; if (!paysBy.has(p._sup)) paysBy.set(p._sup, []); paysBy.get(p._sup).push(p); }
  for (const list of paysBy.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const avail = (sup, from) => (paysBy.get(sup) || []).filter((p) => !usedP.has(p.id) && p.date >= from);
  const byDate = live.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // 2a: one payment for one bill, preferring a payment whose narration names the invoice.
  for (const b of byDate) {
    const T = total(b), ps = avail(b.sup, b.date).filter((p) => Math.abs(p.amount - T) <= 1);
    // Otherwise take one that doesn't name a different bill of this supplier.
    const p = ps.find((x) => refersTo(x, b.inv)) || ps.find((x) => !live.some((o) => o !== b && o.sup === b.sup && refersTo(x, o.inv)));
    if (p) { usedP.add(p.id); b._p = [p.id]; }
  }
  // 2b: one bill paid in 2 or 3 parts. Raised for a person to confirm.
  for (const b of byDate) {
    if (b._p) continue;
    const T = total(b), pays = avail(b.sup, b.date);
    let parts = null;
    outer: for (let i = 0; i < pays.length; i++) for (let j = i + 1; j < pays.length; j++) {
      if (Math.abs(pays[i].amount + pays[j].amount - T) <= 1) { parts = [pays[i], pays[j]]; break outer; }
      for (let k = j + 1; k < pays.length; k++) if (Math.abs(pays[i].amount + pays[j].amount + pays[k].amount - T) <= 1) { parts = [pays[i], pays[j], pays[k]]; break outer; }
    }
    if (parts) { parts.forEach((p) => usedP.add(p.id)); b._p = parts.map((p) => p.id); push('split', b, tax(b), { parts:b._p }); }
  }
  // 2c: one payment covering 2 or 3 bills of the same supplier. Raised for a person to confirm.
  const unpaidBy = new Map();
  for (const b of byDate) if (!b._p) { if (!unpaidBy.has(b.sup)) unpaidBy.set(b.sup, []); unpaidBy.get(b.sup).push(b); }
  for (const [sup, bills] of unpaidBy) {
    for (const p of avail(sup, '0000')) {
      const U = bills.filter((b) => !b._p && b.date <= p.date);
      let set = null;
      outer: for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) {
        if (Math.abs(total(U[i]) + total(U[j]) - p.amount) <= 1) { set = [U[i], U[j]]; break outer; }
        for (let k = j + 1; k < U.length; k++) if (Math.abs(total(U[i]) + total(U[j]) + total(U[k]) - p.amount) <= 1) { set = [U[i], U[j], U[k]]; break outer; }
      }
      if (!set) continue;
      usedP.add(p.id);
      set.forEach((b) => { b._p = [p.id]; });
      out.push(Object.assign({ type:'combined', sup, bills:set.map((b) => b.id), impact:set.reduce((a, b) => a + tax(b), 0), pay:p.id }, { ims:imsAdvice({ type:'combined' }) }));
    }
  }
  // 2d: the same bill paid again. Only when the narration names that invoice, so a recurring same-amount bill is never mistaken for it.
  for (const b of byDate) {
    if (!b._p || b._p.length !== 1) continue;
    const again = avail(b.sup, b.date).find((p) => Math.abs(p.amount - total(b)) <= 1 && refersTo(p, b.inv));
    if (again) { usedP.add(again.id); push('doublePay', b, again.amount, { pay:again.id, first:b._p[0] }); }
  }
  // 2e: unpaid after 180 days. Reverse in proportion to the unpaid part; part-payments are those naming the invoice.
  for (const b of byDate) {
    if (b._p) continue;
    const age = days(b.date, asOf);
    const partial = avail(b.sup, b.date).filter((p) => refersTo(p, b.inv));
    b._p = partial.map((p) => p.id);
    if (age <= 180) continue;
    const T = total(b), paid = partial.reduce((a, p) => a + p.amount, 0), unpaid = Math.max(0, T - paid);
    if (unpaid <= 1) continue;
    partial.forEach((p) => usedP.add(p.id));
    const reversal = Math.round(tax(b) * unpaid / T);
    const since = Math.max(0, days(availedOn(b.date), asOf));
    push('unpaid180', b, reversal, { age, paid, unpaid, interest:Math.round(reversal * INTEREST_PA * since / 365), since });
  }

  // Pass 3: in GSTR-2B but not in the books.
  for (const g of D.g2b) if (!usedG.has(g.id)) {
    const paid = (paysBy.get(g.sup) || []).find((p) => !usedP.has(p.id) && Math.abs(p.amount - total(g)) <= 1);
    out.push({ type:'missingBooks', sup:g.sup, bills:[g.id], impact:tax(g), paid:paid && paid.id, lapse:itcLapse(g.date), ims:imsAdvice({ type:'missingBooks' }) });
  }
  return { issues:out, ms:nowMs() - t0, unassigned:D.bank.filter((p) => !p._sup).map((p) => p.id) };
}

function groupIssues(issues) {
  const map = new Map();
  for (const i of issues) {
    const key = TYPES[i.type].group ? `${i.type}|${i.sup}` : `${i.type}|${i.bills.join('+')}`;
    if (!map.has(key)) map.set(key, Object.assign({}, i, { key, bills:[], impact:0, items:[] }));
    const g = map.get(key); g.bills.push(...i.bills); g.impact += i.impact; g.items.push(i);
  }
  return [...map.values()];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BUYER, AS_OF, STATES, HSN, GST2_DATE, SCRAPPED, INTEREST_PA, SEED, CS, days, tax, total, gstinCheck, gstinValid, canon, digitsOf, hamming, median, rateOn, fy, itcLapse, availedOn, refersTo, payeeOf, TYPES, bucketOf, imsAdvice, runEngine, groupIssues };
}
