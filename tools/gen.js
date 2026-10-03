// Seeded synthetic GST data with ground-truth labels.
//   node tools/gen.js            writes data/demo (small, hand-checkable) and data/test (full set)
//   node tools/gen.js --only demo|test --seed 42
// Error rates are fixed below and are NOT tuned to any pitch number. Labels say exactly what was planted.
const fs = require('fs'), path = require('path');
const E = require('../engine.js');
const { tax, total, gstinCheck, fy, rateOn, median, STATES } = E;

/* ---------- seeded random ---------- */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const R = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    range: (lo, hi) => lo + next() * (hi - lo),
  };
  R.logn = (median, sigma) => median * Math.exp(sigma * R.normal());
  return R;
}

/* ---------- planted errors: probability per eligible bill ---------- */
const RATES = { missing2b:.015, missingBooks:.010, amount:.008, taxValue:.005, gstin:.005, rate:.04, taxType:.005, duplicate:.005, unpaid180:.008, split:.010, combined:.006, doublePay:.005, spike:.004 };
const TRAP_RATES = { variant:.25, round1:.02, recurring:.006, generic:.15 };

const SURNAMES = ['Gupta','Sharma','Verma','Singh','Kapoor','Arora','Jain','Mehta','Agarwal','Bansal','Goyal','Khanna','Malhotra','Chopra','Bhatia','Saxena','Mittal','Garg','Aggarwal','Rathi','Joshi','Pandey','Mishra','Tiwari','Yadav','Chauhan','Thakur','Bhardwaj','Sethi','Kohli','Anand','Ahuja','Dhawan','Grover','Khatri','Lamba','Mathur','Nagpal','Oberoi','Puri','Rastogi','Sood','Tandon','Uppal','Vohra','Walia','Zutshi','Bajaj','Chadha','Dua','Gill','Handa','Iyer','Nair','Reddy','Patel','Shah','Desai','Kulkarni','Menon'];
const TRADES = ['Steel Traders','Cables','Wires','Switchgear','Lighting','Electric Co','Copper Works','Fasteners','Packaging','Power Tools','Enterprises','Supplies','Industries','Hardware','Plastics','Metals','Electricals','Components','Distributors','Sales Corp','Engineering','Agencies','Tools','Paper Mills','Polymers'];
const STATE_POOL = ['03','05','06','07','07','07','07','08','09','09','19','23','24','27','29','33'];
const HSN_CODES = ['7214','8536','8544','7318','7408','3923'];
const SLAB_HSN = ['8516','4818'];
const SWITCH = '2025-09-22';

const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);
const pad = (n, w = 4) => String(n).padStart(w, '0');
const monthsBetween = (from, to) => { const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number); while (y < ty || (y === ty && m <= tm)) { out.push([y, m]); if (++m > 12) { m = 1; y++; } } return out; };

function genGstin(R, state) {
  const L = () => String.fromCharCode(65 + R.int(0, 25));
  const body = `${state}${L()}${L()}${L()}${L()}${L()}${pad(R.int(0, 9999))}${L()}${R.int(1, 9)}Z`;
  return body + gstinCheck(body);
}
function typoOf(R, g) {
  for (;;) {
    const n = R.int(1, 2); const a = g.split('');
    for (let k = 0; k < n; k++) { const i = R.int(2, 13); a[i] = E.CS[R.int(0, 35)]; }
    const t = a.join('');
    if (t !== g && !E.gstinValid(t)) return t;
  }
}
function setHeads(r, taxAmt, intra) {
  if (intra) { r.cgst = Math.round(taxAmt / 2); r.sgst = taxAmt - r.cgst; r.igst = 0; } else { r.igst = taxAmt; r.cgst = 0; r.sgst = 0; }
}
function variantOf(R, inv) {
  const m = inv.match(/^([A-Z]+)([-/])(\d+)$/); if (!m) return inv;
  const [, pfx, sep, n] = m, plain = String(+n);
  return R.pick([pfx + (sep === '-' ? '/' : '-') + n, pfx + n, pfx + sep + plain, pfx + (sep === '-' ? '/' : '-') + plain]);
}

/* ---------- the generator ---------- */
function generate(cfg) {
  const R = rng(cfg.seed);
  const scale = cfg.rateScale || 1, plantFrom = cfg.plantFrom || '0000';
  const asOf = cfg.asOf, buyerState = E.BUYER.state;
  const sup = {}, keys = [];
  const used = new Set();
  for (let i = 0; i < cfg.suppliers; i++) {
    let name; do { name = `${R.pick(SURNAMES)} ${R.pick(TRADES)}`; } while (used.has(name)); used.add(name);
    const key = 's' + pad(i, 3), state = R.pick(STATE_POOL), med = Math.max(8000, R.logn(cfg.medianBill, .9)), sig = .3;
    const sl = R.chance(.18);
    sup[key] = { name, gstin:genGstin(R, state), base:R.int(5, 30), bills:0, filing:R.chance(.08) ? 'Filed late' : 'On time', late:false,
      med, sig, terms:R.pick(cfg.terms || [30, 45, 60]), pfx:name.split(' ').map((w) => w[0]).join('').toUpperCase().padEnd(2, 'X').slice(0, 3) + String.fromCharCode(65 + (i % 26)),
      style:R.pick(['-', '/']), hsn:sl ? R.pick(SLAB_HSN) : R.pick(HSN_CODES), lam:cfg.billsPerMonth * Math.exp(.4 * R.normal()) };
    sup[key].late = sup[key].filing === 'Filed late';
    sup[key].hist = Array.from({ length:7 }, () => Math.max(5000, Math.round(R.logn(med, sig) / 10) * 10));
    keys.push(key);
  }
  const labels = [], traps = [];
  const books = [], g2b = [], bank = [], extraBooks = [];
  const bills = [];
  const counters = new Map(), seenInv = new Map();
  let nid = 0;
  const modes = ['NEFT', 'RTGS', 'UPI', 'IMPS'];

  /* 1. clean bills */
  const months = monthsBetween(cfg.from, cfg.to);
  for (const [y, m] of months) for (const k of keys) {
    const s = sup[k]; const isLast = y === months[months.length - 1][0] && m === months[months.length - 1][1];
    const n = Math.max(1, Math.round(s.lam * (.7 + .6 * R.next()) * (isLast && cfg.lastMonthMult ? cfg.lastMonthMult : 1)));
    for (let j = 0; j < n; j++) {
      const date = `${y}-${pad(m, 2)}-${pad(R.int(1, 27), 2)}`;
      mkBill(k, date, null);
      if (R.chance(TRAP_RATES.recurring)) { const t = bills[bills.length - 1]; mkBill(k, addDays(date, R.int(1, 4)), t.taxable, 'recurring', t); }
    }
  }
  function mkBill(k, date, fixedTaxable, trapTag, twin) {
    const s = sup[k], fyk = fy(date), ck = k + '|' + fyk;
    const num = (counters.get(ck) || 0) + 1; counters.set(ck, num);
    const id = pad(++nid, 6);
    const inv = `${s.pfx}${s.style}${pad(num)}`;
    let taxable = fixedTaxable || Math.max(2000, Math.round(R.logn(s.med, s.sig) / 10) * 10);
    if (date >= '2025-10-01' && date <= '2025-10-31' && !fixedTaxable) taxable = Math.round(taxable * 1.6 / 10) * 10; // festive-season bump, a trap
    const mr = rateOn(s.hsn, date), intra = s.gstin.slice(0, 2) === buyerState;
    const b = { id:'B' + id, sup:k, gstin:s.gstin, inv, date, hsn:s.hsn, taxable, rate:mr, cgst:0, sgst:0, igst:0 };
    setHeads(b, Math.round(taxable * mr / 100), intra);
    const g = { id:'G' + id, sup:k, gstin:s.gstin, inv, date, taxable, cgst:b.cgst, sgst:b.sgst, igst:b.igst };
    const tags = new Set(); if (trapTag) tags.add(trapTag);
    if (SLAB_HSN.includes(s.hsn) && date < SWITCH) tags.add('oldSlab');
    const ik = k + '|' + E.canon(inv);
    if (seenInv.has(ik) && seenInv.get(ik) !== fyk) tags.add('fyRestart'); seenInv.set(ik, fyk);
    s.bills++;
    const bill = { b, g, pays:[], tags, planted:null, num, twin };
    bill.pays.push(mkPay(bill, total(b), addDays(date, s.terms + R.int(-5, 5)), true));
    bills.push(bill);
    return bill;
  }
  function mkPay(bill, amount, date, nameInvoice) {
    const s = sup[bill.b.sup], mode = R.pick(modes);
    const generic = nameInvoice && R.chance(TRAP_RATES.generic);
    if (generic && nameInvoice === true) bill.tags.add('generic');
    const ref = `${mode} ${s.name.toUpperCase()}` + (nameInvoice && !generic ? ` ${s.pfx}${bill.num}` : '');
    return { id:'P' + bill.b.id.slice(1) + (bill.pays.length ? String.fromCharCode(97 + bill.pays.length) : ''), date, amount, ref };
  }

  /* 2. pair-wise combined payments first (they consume two neighbouring bills of one supplier) */
  const bySup = new Map(); for (const bl of bills) { if (!bySup.has(bl.b.sup)) bySup.set(bl.b.sup, []); bySup.get(bl.b.sup).push(bl); }
  for (const list of bySup.values()) list.sort((x, y) => (x.b.date < y.b.date ? -1 : x.b.date > y.b.date ? 1 : 0));
  function plantCombined(a, c) {
    if (a.planted || c.planted || a.twin || c.twin || a.b.date < plantFrom || days2(a.b.date, c.b.date) > 20) return false;
    const s = sup[a.b.sup], date = addDays(c.b.date > a.b.date ? c.b.date : a.b.date, R.int(Math.min(10, s.terms), 25));
    if (date > asOf) return false;
    a.planted = c.planted = 'combined';
    a.pays = []; c.pays = [];
    a.pays.push({ id:'P' + a.b.id.slice(1) + 'c', date, amount:total(a.b) + total(c.b), ref:`${R.pick(modes)} ${s.name.toUpperCase()} SETTLEMENT` });
    labels.push({ type:'combined', ids:[a.b.id, c.b.id], impact:tax(a.b) + tax(c.b), bucket:'confirm' });
    return true;
  }
  for (const list of bySup.values()) for (let i = 0; i + 1 < list.length; i++) if (R.chance(RATES.combined * scale) && plantCombined(list[i], list[i + 1])) i++;
  function days2(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

  /* 3. single-bill errors */
  const order = ['missing2b','missingBooks','amount','taxValue','gstin','rate','taxType','duplicate','unpaid180','split','doublePay','spike'];
  function plant(bl, type) {
    if (bl.planted || !bl.b || !bl.g) return false;
    const { b, g } = bl, s = sup[b.sup], intra = s.gstin.slice(0, 2) === buyerState;
    const oldEnough = b.date <= addDays(asOf, -190), paidBy = bl.pays[0] && bl.pays[0].date;
    const slab = SLAB_HSN.includes(b.hsn) && b.date >= SWITCH;
    if (type === 'rate' && !slab) return false;
    if (type === 'unpaid180' && !oldEnough) return false;
    if (type === 'doublePay' && (!paidBy || addDays(paidBy, 20) > asOf)) return false;
    if (type === 'split' && addDays(b.date, s.terms + 12) > asOf) return false;
    if (bl.tags.has('recurring') || bl.twin) return false;
    if (type !== 'unpaid180' && b.date < plantFrom) return false;
    bl.planted = type;
    const L = { type, ids:[b.id], impact:0, bucket:null };
    switch (type) {
      case 'missing2b': bl.g = null; L.impact = tax(b); L.bucket = 'risk'; break;
      case 'missingBooks': bl.b = null; L.ids = [g.id]; L.impact = tax(g); L.bucket = 'recover'; if (R.chance(.5)) bl.pays = []; break;
      case 'amount': { const f = 1 + (R.chance(.5) ? 1 : -1) * R.range(.04, .15); g.taxable = Math.max(1000, Math.round(b.taxable * f / 10) * 10); setHeads(g, Math.round(g.taxable * b.rate / 100), intra); const d = tax(b) - tax(g); L.impact = Math.abs(d); L.bucket = d < 0 ? 'recover' : 'risk'; break; }
      case 'taxValue': { const exp = Math.round(b.taxable * b.rate / 100), f = 1 + (R.chance(.5) ? 1 : -1) * R.range(.05, .12); setHeads(b, Math.round(exp * f), intra); const d = tax(b) - exp; L.impact = Math.abs(d); L.bucket = d < 0 ? 'recover' : 'risk'; bl.pays[0].amount = total(b); break; }
      case 'gstin': b.gstin = typoOf(R, b.gstin); L.impact = tax(b); L.bucket = 'risk'; break;
      case 'rate': { const old = rateOn(b.hsn, '2025-01-01'); b.rate = old; setHeads(b, Math.round(b.taxable * old / 100), intra); setHeads(g, tax(b), intra); L.impact = tax(b) - Math.round(b.taxable * rateOn(b.hsn, b.date) / 100); L.bucket = 'reverse'; bl.pays[0].amount = total(b); break; }
      case 'taxType': setHeads(b, tax(b), !intra); setHeads(g, tax(b), !intra); L.impact = tax(b); L.bucket = 'reverse'; break;
      case 'duplicate': { const d = Object.assign({}, b, { id:b.id + 'D', inv:b.inv.includes('-') ? b.inv.replace('-', '/') : b.inv.replace('/', '-') }); extraBooks.push(d); L.ids = [d.id]; L.impact = tax(b); L.bucket = 'reverse'; break; }
      case 'unpaid180': { const T = total(b); if (R.chance(.3)) { const pa = Math.round(T * R.range(.3, .7)); bl.pays = [{ id:'P' + b.id.slice(1), date:addDays(b.date, R.int(20, 60)), amount:pa, ref:`NEFT ${s.name.toUpperCase()} ${s.pfx}${bl.num}` }]; L.impact = Math.round(tax(b) * (T - pa) / T); } else { bl.pays = []; L.impact = tax(b); } L.bucket = 'reverse'; break; }
      case 'split': { const T = total(b), p1 = Math.round(T * R.range(.4, .6)), d1 = addDays(b.date, Math.max(3, s.terms - 10)), d2 = addDays(b.date, s.terms + 12); const ref = (x) => `${R.pick(modes)} ${s.name.toUpperCase()} ${s.pfx}${bl.num} ${x}`; bl.pays = [{ id:'P' + b.id.slice(1) + 'a', date:d1, amount:p1, ref:ref('PART') }, { id:'P' + b.id.slice(1) + 'b', date:d2, amount:T - p1, ref:ref('BAL') }]; L.impact = tax(b); L.bucket = 'confirm'; break; }
      case 'doublePay': { const p0 = bl.pays[0]; bl.pays.push({ id:p0.id + 'x', date:addDays(p0.date, R.int(3, 18)), amount:p0.amount, ref:`${R.pick(modes)} ${s.name.toUpperCase()} ${s.pfx}${bl.num}` }); bl.pays[0].ref = `NEFT ${s.name.toUpperCase()} ${s.pfx}${bl.num}`; L.impact = p0.amount; L.bucket = 'leak'; break; }
      case 'spike': { const t = Math.round(median(s.hist) * R.range(10, 16) / 10) * 10; b.taxable = g.taxable = t; setHeads(b, Math.round(t * b.rate / 100), intra); setHeads(g, tax(b), intra); bl.pays[0].amount = total(b); L.impact = tax(b); L.bucket = 'review'; break; }
    }
    labels.push(L);
    return true;
  }
  for (const bl of bills) {
    if (bl.planted) continue;
    const slab = SLAB_HSN.includes(bl.b.hsn) && bl.b.date >= SWITCH;
    let u = R.next(), type = null, acc = 0;
    for (const t of order) { acc += (t === 'rate' ? (slab ? RATES.rate : 0) : RATES[t]) * scale; if (u < acc) { type = t; break; } }
    if (type) plant(bl, type);
  }
  // Small demo sets: make sure every error type appears at least once, so the walkthrough has an example of each.
  if (cfg.ensureAll && !labels.some((l) => l.type === 'combined')) { outer: for (const list of bySup.values()) for (let i = 0; i + 1 < list.length; i++) if (plantCombined(list[i], list[i + 1])) break outer; }
  if (cfg.ensureAll) for (const t of order) {
    if (labels.some((l) => l.type === t)) continue;
    const pool = bills.filter((bl) => !bl.planted && bl.b && bl.g && (t === 'unpaid180' || bl.b.date >= plantFrom));
    const target = t === 'rate' ? pool.filter((bl) => SLAB_HSN.includes(bl.b.hsn) && bl.b.date >= SWITCH) : t === 'unpaid180' ? pool.filter((bl) => bl.b.date <= addDays(asOf, -190)) : pool;
    for (const bl of target) if (plant(bl, t)) break;
  }

  /* 4. traps: variations that are correct and must stay unflagged */
  for (const bl of bills) {
    if (bl.planted || !bl.b || !bl.g) continue;
    if (R.chance(TRAP_RATES.variant)) { bl.g.inv = variantOf(R, bl.g.inv); if (bl.g.inv !== bl.b.inv) bl.tags.add('variant'); }
    if (R.chance(TRAP_RATES.round1)) { const d = R.chance(.5) ? 1 : -1; bl.g.taxable += d; bl.tags.add('round1'); }
  }

  /* 5. flatten, dropping payments dated after the as-of date */
  for (const bl of bills) {
    if (bl.b) books.push(bl.b);
    if (bl.g) g2b.push(bl.g);
    for (const p of bl.pays) if (p.date <= asOf) bank.push(p);
    if (!bl.planted) for (const t of bl.tags) traps.push({ tag:t, id:(bl.b || bl.g).id });
  }
  books.push(...extraBooks);
  // Bank statements cut the narration to a fixed width: long names and invoice references get clipped.
  for (const p of bank) p.ref = p.ref.slice(0, cfg.narrationWidth || 36);
  bank.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  /* 6. sales: monthly output tax, a fixed multiple of that month's purchase tax with noise (no sales invoices needed for the engine) */
  const sales = [];
  for (const [y, m] of months) {
    const ym = `${y}-${pad(m, 2)}`, pt = books.filter((r) => r.date.startsWith(ym) && !r.id.endsWith('D')).reduce((a, r) => a + tax(r), 0);
    const out = Math.round(pt * R.range(1.2, 1.4) / 100) * 100, ig = Math.round(out * .33 / 100) * 100, cg = Math.round((out - ig) / 2 / 100) * 100;
    sales.push({ month:ym, taxable:Math.round(out / .18 / 100) * 100, igst:ig, cgst:cg, sgst:cg });
  }
  const suppliers = {}; for (const k of keys) { const s = sup[k]; suppliers[k] = { name:s.name, gstin:s.gstin, base:s.base, bills:s.bills, filing:s.filing, late:s.late, hist:s.hist }; }
  return { D:{ suppliers, books, g2b, bank, asOf, buyer:E.BUYER }, labels, traps, sales, cfg };
}

/* ---------- CSV ---------- */
const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => { const v = r[c] === undefined || r[c] === null ? '' : String(r[c]); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','))].join('\n') + '\n';
function writeSet(dir, data, jsName) {
  fs.mkdirSync(dir, { recursive:true });
  const { D, labels, traps, sales } = data, sn = (k) => D.suppliers[k].name;
  fs.writeFileSync(path.join(dir, 'books.csv'), csv(D.books.map((r) => Object.assign({}, r, { supplier:sn(r.sup) })), ['id','supplier','gstin','inv','date','hsn','taxable','rate','cgst','sgst','igst']));
  fs.writeFileSync(path.join(dir, 'g2b.csv'), csv(D.g2b.map((r) => Object.assign({}, r, { supplier:sn(r.sup) })), ['id','supplier','gstin','inv','date','taxable','cgst','sgst','igst']));
  // The same GSTR-2B rows in the shape of the GST portal's JSON download, so the demo can show a real portal file being dropped in.
  const bySupplier = new Map(); for (const r of D.g2b) { if (!bySupplier.has(r.gstin)) bySupplier.set(r.gstin, { ctin:r.gstin, trdnm:sn(r.sup), inv:[] }); const t = r.cgst + r.sgst + r.igst, [y, m, d] = r.date.split('-');
    bySupplier.get(r.gstin).inv.push({ inum:r.inv, typ:'R', dt:`${d}-${m}-${y}`, val:r.taxable + t, pos:E.BUYER.state, rev:'N', itcavl:'Y', diffprcnt:1, items:[{ num:1, rt:Math.round(t / Math.max(1, r.taxable) * 100), txval:r.taxable, igst:r.igst, cgst:r.cgst, sgst:r.sgst, cess:0 }] }); }
  if (jsName) fs.writeFileSync(path.join(dir, 'gstr2b.json'), JSON.stringify({ data:{ gstin:E.BUYER.gstin, rtnprd:D.asOf.slice(5, 7) + D.asOf.slice(0, 4), version:'1.0', gentime:D.asOf, docdata:{ b2b:[...bySupplier.values()] } } }, null, 1));
  fs.writeFileSync(path.join(dir, 'bank.csv'), csv(D.bank, ['id','date','amount','ref']));
  fs.writeFileSync(path.join(dir, 'sales.csv'), csv(sales, ['month','taxable','igst','cgst','sgst']));
  fs.writeFileSync(path.join(dir, 'suppliers.csv'), csv(Object.entries(D.suppliers).map(([k, s]) => Object.assign({ key:k }, s, { hist:s.hist.join(';') })), ['key','name','gstin','base','filing','hist']));
  fs.writeFileSync(path.join(dir, 'labels.csv'), csv(labels.map((l) => Object.assign({}, l, { ids:l.ids.join('|') })), ['type','ids','impact','bucket']));
  fs.writeFileSync(path.join(dir, 'traps.csv'), csv(traps, ['tag','id']));
  if (jsName) fs.writeFileSync(jsName, 'window.REKORA_DEMO = ' + JSON.stringify({ D, labels, sales }) + ';\n');
}

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
  const seed = +arg('seed', 42), only = arg('only', 'both'), root = path.join(__dirname, '..', 'data');
  if (only !== 'test') {
    const d = generate({ seed, suppliers:20, from:'2026-01', to:'2026-09', asOf:'2026-09-30', billsPerMonth:1, medianBill:90000, ensureAll:true, lastMonthMult:7, rateScale:3, plantFrom:'2026-09-01', terms:[5, 7, 10] });
    writeSet(path.join(root, 'demo'), d, path.join(root, 'demo.js'));
    console.log('demo: books', d.D.books.length, 'g2b', d.D.g2b.length, 'bank', d.D.bank.length, 'planted', d.labels.length);
  }
  if (only !== 'demo') {
    const t = generate({ seed, suppliers:300, from:'2025-04', to:'2026-09', asOf:'2026-09-30', billsPerMonth:6.67, medianBill:60000 });
    writeSet(path.join(root, 'test'), t, null);
    console.log('test: books', t.D.books.length, 'g2b', t.D.g2b.length, 'bank', t.D.bank.length, 'planted', t.labels.length, 'traps', t.traps.length);
  }
}
module.exports = { generate, rng, RATES, TRAP_RATES };
