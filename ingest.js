/* =====================================================================
   Rekora ingest: turns uploaded CSVs (purchase register, GSTR-2B, bank, sales) into the dataset engine.js expects.
   Browser (classic <script>) and Node (module.exports). Nothing leaves the machine.
   ===================================================================== */
(function (root) {
  const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Column names seen in Tally / portal / bank exports, after norm(). First match wins.
  const ALIASES = {
    id:['id','srno','sno','sl','vchno','voucherno','txnid'],
    inv:['inv','invoice','invoiceno','invoicenumber','invno','billno','billnumber','supplierinvoiceno','documentno'],
    date:['date','invoicedate','billdate','invdate','vchdate','txndate','transactiondate','valuedate','postingdate'],
    gstin:['gstin','gstinofsupplier','suppliergstin','partygstin','gstinuin','gstno'],
    supplier:['supplier','suppliername','party','partyname','tradename','tradelegalname','vendor','vendorname','ledger','ledgername'],
    hsn:['hsn','hsncode','hsnsac','hsnsaccode'],
    taxable:['taxable','taxablevalue','taxableamount','taxablevaluers','assessablevalue'],
    rate:['rate','gstrate','taxrate','rateofgst','rateoftax','gstpercent'],
    cgst:['cgst','cgstamount','centraltax','centraltaxamount','centraltaxrs'],
    sgst:['sgst','sgstamount','sgstutgst','statetax','stateuttax','stateuttaxamount','sgstutgstamount'],
    igst:['igst','igstamount','integratedtax','integratedtaxamount','integratedtaxrs'],
    amount:['amount','debit','debitamount','withdrawal','withdrawalamt','withdrawalamount','dr','paid','amountpaid'],
    ref:['ref','narration','description','particulars','remarks','details','transactiondetails','chqrefno'],
    month:['month','period','taxperiod','retperiod'],
  };

  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); if (row.some((c) => c.trim() !== '')) rows.push(row); }
    if (q) throw new Error('Unclosed quote in the file');
    return rows;
  }

  function columnMap(headers) {
    const norms = headers.map(norm), map = {};
    for (const f in ALIASES) { const i = norms.findIndex((h) => ALIASES[f].includes(h)); if (i >= 0) map[f] = i; }
    return map;
  }
  function classify(map) {
    if (map.month !== undefined && map.inv === undefined && (map.igst !== undefined || map.cgst !== undefined)) return 'sales';
    if (map.inv !== undefined && (map.hsn !== undefined || map.rate !== undefined)) return 'books';
    if (map.inv !== undefined && map.taxable !== undefined) return 'g2b';
    if (map.date !== undefined && map.amount !== undefined && map.ref !== undefined) return 'bank';
    return null;
  }

  const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  function parseDate(s) {
    s = String(s).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s.*)?$/))) return iso(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})[\/\s.-]([A-Za-z]{3})[a-z]*[\/\s.,-]+(\d{2,4})(?:\s.*)?$/)) && MONTHS[m[2].toLowerCase()]) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    return null;
  }
  function iso(y, mo, d) { if (mo < 1 || mo > 12 || d < 1 || y < 2000 || y > 2100 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  function parseNum(s) {
    s = String(s === undefined ? '' : s).trim(); if (s === '' || s === '-') return 0;
    const neg = /^\(.*\)$/.test(s); const n = Number(s.replace(/[₹,\s()]/g, '').replace(/^Rs\.?/i, ''));
    return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  }
  const upper = (s) => String(s || '').trim().toUpperCase();
  const nameKey = (s) => upper(s).replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|M\/S)\b/g, '').replace(/[^A-Z0-9]/g, '');

  /* GSTR-2B as downloaded from the GST portal (JSON). Reads b2b invoices; credit/debit notes and other sections are counted and left out. */
  function ingestPortalJson(name, text) {
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error(`${name}: not valid JSON (${e.message})`); }
    const doc = (j && j.data && j.data.docdata) || (j && j.docdata) || j || {};
    const b2b = Array.isArray(doc.b2b) ? doc.b2b : null;
    if (!b2b) throw new Error(`${name}: no b2b section found. Expected the GSTR-2B JSON from the GST portal (data → docdata → b2b).`);
    const rows = [], errors = [], notes = [];
    b2b.forEach((sup, si) => {
      const gstin = upper(sup.ctin), supplier = sup.trdnm || sup.tradeName || '';
      (sup.inv || []).forEach((inv, ii) => {
        const where = `${name} supplier ${si + 1} invoice ${ii + 1}`, bad = (m) => errors.push(`${where}: ${m}`);
        if (!gstin) return bad('supplier GSTIN (ctin) missing');
        if (!inv.inum) return bad('invoice number (inum) missing');
        const date = parseDate(inv.dt || inv.idt || ''); if (!date) return bad(`date "${inv.dt || inv.idt || ''}" not understood`);
        const items = (inv.items || (inv.itms || []).map((x) => x.itm_det || x)).filter(Boolean);
        if (!items.length) return bad('no items');
        const sum = (k) => items.reduce((a, it) => a + (Number(it[k]) || 0), 0);
        const rec = { id:null, supplier, gstin, inv:String(inv.inum), date, taxable:Math.round(sum('txval')), cgst:Math.round(sum('cgst')), sgst:Math.round(sum('sgst')), igst:Math.round(sum('igst')) };
        if ([rec.taxable, rec.cgst, rec.sgst, rec.igst].some((x) => !Number.isFinite(x))) return bad('a value is not a number');
        rows.push(rec);
      });
    });
    const skipped = ['cdnr', 'cdnra', 'b2ba', 'isd', 'impg'].filter((k) => Array.isArray(doc[k]) && doc[k].length);
    if (skipped.length) notes.push(`${name}: ${skipped.join(', ')} sections are not read yet.`);
    if (!rows.length) throw new Error(`${name}: the b2b section has no invoices`);
    return { kind:'g2b', rows, errors, notes, name };
  }

  /* One file → typed rows plus row-level problems. Never throws on bad rows; throws only if the file is unusable. */
  function ingestFile(name, text) {
    if (/\.json$/i.test(name) || /^\s*[{\[]/.test(text)) return ingestPortalJson(name, text);
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error(`${name}: no data rows`);
    const map = columnMap(rows[0]), kind = classify(map);
    if (!kind) throw new Error(`${name}: could not tell what this file is. Expected columns like invoice no, date, taxable value (books or GSTR-2B), or date, amount, narration (bank), or month, igst, cgst, sgst (sales)`);
    const need = { books:['inv', 'date', 'taxable'], g2b:['inv', 'date', 'taxable'], bank:['date', 'amount', 'ref'], sales:['month'] }[kind];
    const missingCols = need.filter((f) => map[f] === undefined);
    if (missingCols.length) throw new Error(`${name}: missing column ${missingCols.join(', ')}`);
    const get = (r, f) => (map[f] === undefined ? '' : (r[map[f]] === undefined ? '' : r[map[f]].trim()));
    const out = [], errors = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2, bad = (msg) => errors.push(`${name} row ${line}: ${msg}`);
      if (kind === 'sales') {
        const mm = get(r, 'month'); const d = /^\d{4}-\d{2}$/.test(mm) ? mm + '-01' : parseDate(mm.length <= 8 ? '01-' + mm : mm);
        const rec = { month:d ? d.slice(0, 7) : null, taxable:parseNum(get(r, 'taxable')), igst:parseNum(get(r, 'igst')), cgst:parseNum(get(r, 'cgst')), sgst:parseNum(get(r, 'sgst')) };
        if (!rec.month) return bad(`month "${mm}" not understood`);
        if ([rec.taxable, rec.igst, rec.cgst, rec.sgst].some(Number.isNaN)) return bad('a tax figure is not a number');
        return out.push(rec);
      }
      const date = parseDate(get(r, 'date')); if (!date) return bad(`date "${get(r, 'date')}" not understood`);
      if (kind === 'bank') {
        const amount = parseNum(get(r, 'amount')); if (Number.isNaN(amount)) return bad('amount is not a number');
        if (amount <= 0) return; // credits and zero rows are not payments out
        return out.push({ id:get(r, 'id') || null, date, amount:Math.round(amount), ref:get(r, 'ref') });
      }
      const inv = get(r, 'inv'); if (!inv) return bad('invoice number is empty');
      const gstin = upper(get(r, 'gstin')), supplier = get(r, 'supplier');
      if (!gstin && !supplier) return bad('neither GSTIN nor supplier name');
      const taxable = parseNum(get(r, 'taxable')); if (Number.isNaN(taxable) || taxable < 0) return bad('taxable value is not a valid number');
      const heads = ['cgst', 'sgst', 'igst'].map((f) => parseNum(get(r, f)));
      if (heads.some((x) => Number.isNaN(x))) return bad('a tax figure is not a number');
      const [cgst, sgst, igst] = heads.map(Math.round), t = cgst + sgst + igst;
      const rec = { id:get(r, 'id') || null, supplier, gstin, inv, date, taxable:Math.round(taxable), cgst, sgst, igst };
      if (kind === 'books') {
        rec.hsn = get(r, 'hsn').replace(/\D/g, '').slice(0, 8) || '';
        const rate = map.rate !== undefined ? parseNum(get(r, 'rate')) : NaN;
        rec.rate = Number.isFinite(rate) ? rate : (taxable ? Math.round(t / taxable * 100) : 0);
      }
      out.push(rec);
    });
    return { kind, rows:out, errors, name };
  }

  /* Four typed row sets → the dataset runEngine() reads. Supplier identity: GSTIN from GSTR-2B first, then name, so a GSTIN typo in the books still lands on the right supplier. */
  function buildDataset(files) {
    const notes = [], { books = [], g2b = [], bank = [], sales = [] } = files;
    if (!books.length) throw new Error('No purchase register rows. Add the books file.');
    if (!g2b.length) throw new Error('No GSTR-2B rows. Add the GSTR-2B file.');
    const suppliers = {}, byName = new Map(), byGstin = new Map();
    let n = 0;
    const mk = (name, gstin) => { const k = 's' + String(++n).padStart(4, '0'); suppliers[k] = { name:name || gstin, gstin:gstin || '', base:10, bills:0, filing:'Not in uploaded files', late:false, hist:null }; if (name) byName.set(nameKey(name), k); if (gstin) byGstin.set(gstin, k); return k; };
    const resolve = (r, nameFirst) => {
      const nk = r.supplier ? nameKey(r.supplier) : '';
      let k = nameFirst ? (byName.get(nk) || byGstin.get(r.gstin)) : (byGstin.get(r.gstin) || byName.get(nk));
      if (!k) k = mk(r.supplier, r.gstin);
      else { const s = suppliers[k]; if (!s.gstin && r.gstin) { s.gstin = r.gstin; byGstin.set(r.gstin, k); } if (r.supplier && !byName.has(nk)) byName.set(nk, k); }
      return k;
    };
    const G = g2b.map((r, i) => { const k = resolve(r, false); return { id:r.id || 'G' + String(i + 1).padStart(5, '0'), sup:k, gstin:r.gstin || suppliers[k].gstin, inv:r.inv, date:r.date, taxable:r.taxable, cgst:r.cgst, sgst:r.sgst, igst:r.igst }; });
    const B = books.map((r, i) => { const k = resolve(r, true); suppliers[k].bills++; return { id:r.id || 'B' + String(i + 1).padStart(5, '0'), sup:k, gstin:r.gstin || suppliers[k].gstin, inv:r.inv, date:r.date, hsn:r.hsn, taxable:r.taxable, rate:r.rate, cgst:r.cgst, sgst:r.sgst, igst:r.igst }; });
    const P = bank.map((r, i) => ({ id:r.id || 'P' + String(i + 1).padStart(5, '0'), date:r.date, amount:r.amount, ref:r.ref }));
    for (const k in suppliers) { const v = B.filter((b) => b.sup === k).map((b) => b.taxable).filter((x) => x > 0); if (v.length >= 6) suppliers[k].hist = v; }
    for (const k in suppliers) if (!suppliers[k].gstin) notes.push(`${suppliers[k].name} has no GSTIN in any file.`);
    // As-of date: end of the latest month in the data. Buyer state: where CGST+SGST bills come from (intra-state supplies).
    const all = [...B, ...G, ...P].map((r) => r.date).sort(), last = all[all.length - 1], [y, m] = last.split('-').map(Number);
    const asOf = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const tally = {}; for (const b of B) if ((b.cgst || b.sgst) && b.gstin) { const s = b.gstin.slice(0, 2); tally[s] = (tally[s] || 0) + 1; }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    const buyer = { name:'Uploaded books', gstin:'', state:top ? top[0] : '07' };
    if (!top) notes.push('Could not infer your state from the bills, assuming Delhi (07).');
    if (!P.length) notes.push('No bank rows, so every bill will look unpaid.');
    const D = { suppliers, books:B, g2b:G, bank:P, asOf, buyer };
    return { D, sales, notes };
  }

  /* Output tax for the return month, from the sales rows. */
  function withPeriod(D, sales) {
    D.period = D.asOf.slice(0, 7);
    const row = (sales || []).find((s) => s.month === D.period);
    D.sales = sales || [];
    D.output = row ? { igst:row.igst, cgst:row.cgst, sgst:row.sgst } : null;
    return D;
  }

  const api = { ingestPortalJson, parseCsv, columnMap, classify, parseDate, parseNum, ingestFile, buildDataset, withPeriod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Ingest = api;
})(typeof window !== 'undefined' ? window : globalThis);
