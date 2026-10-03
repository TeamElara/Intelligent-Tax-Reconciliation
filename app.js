/* Rekora demo: all parsing and reconciliation happens in the visitor's browser. */
const SAMPLE = {
  books: `supplier,gstin,invoice,date,taxable,cgst,sgst,igst,rate,hsn,claimed
Gupta Steel Traders,06AADFG7781Q1ZO,INV-311,2026-09-04,100000,0,0,18000,18,7214,yes
Arora Wires,09AAKFA1234M1ZD,AW-0442,2026-09-12,200000,0,0,36000,18,8544,yes
Bloom Traders,08AAFFB9902K1Z8,BT-1088,2026-09-20,150000,0,0,27000,18,8544,yes
Jain Lighting,07AAEFJ4471C1ZM,JL-2201,2026-09-05,50000,4500,4500,0,18,8536,yes
Orbit Office Solutions,07AABCO7731E1ZL,OOS-073,2026-09-21,80000,7200,7200,0,18,8536,yes
Orbit Office Solutions,07AABCO7731E1ZL,OOS/073,2026-09-21,80000,7200,7200,0,18,8536,yes`,
  g2b: `supplier,gstin,invoice,date,taxable,cgst,sgst,igst
Arora Wires,09AAKFA1234M1ZD,AW/442,2026-09-12,200000,0,0,36000
Bloom Traders,08AAFFB9902K1Z8,BT-1088,2026-09-20,100000,0,0,18000
Jain Lighting,07AAEFJ4471C1ZM,JL2201,2026-09-05,50000,4500,4500,0
Orbit Office Solutions,07AABCO7731E1ZL,OOS-73,2026-09-21,80000,7200,7200,0
Nova Supplies,06AACFN5518H1ZE,NS-1042,2026-09-18,40000,0,0,7200`,
  bank: `supplier,date,amount,reference
Gupta Steel Traders,2026-09-10,118000,NEFT INV311
Arora Wires,2026-09-15,236000,NEFT AW442
Bloom Traders,2026-09-27,177000,RTGS BT1088
Jain Lighting,2026-09-10,30000,IMPS JL2201 PART
Jain Lighting,2026-09-24,29000,IMPS JL2201 BAL
Orbit Office Solutions,2026-09-29,94400,NEFT OOS073`
};

const $ = (selector) => document.querySelector(selector);
const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (v) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const invoiceKey = (v) => String(v ?? '').toUpperCase().split(/[^A-Z0-9]+/).map(p => p.replace(/^([A-Z]*)0+(?=\d)/, '$1')).join('');
const tax = (r) => r.cgst + r.sgst + r.igst;
const total = (r) => r.taxable + tax(r);
const kindLabel = {missing2b:'Missing in 2B',duplicate:'Duplicate',amount:'Amount mismatch',missingBooks:'Potential credit',split:'Payment review',taxType:'Tax type'};
const state = {data:null, baseData:null, issues:[], matches:0, selected:null, reviewed:new Set(), source:'sample'};
let demoName = '';
try { demoName = sessionStorage.getItem('rekora-demo-name') || ''; } catch (_) {}

function csvRows(input) {
  const rows = []; let row = [], field = '', quoted = false;
  const text = String(input).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(x => x.trim())) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('A CSV file contains an unclosed quotation mark.');
  row.push(field); if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('Each CSV needs a header and at least one record.');
  const headers = rows.shift().map(h => clean(h));
  return rows.map((r, index) => Object.fromEntries(headers.map((h, j) => [h, (r[j] || '').trim()]))).map((r, i) => ({...r, _row:i + 2}));
}
function pick(row, ...names) { for (const n of names) { const v = row[clean(n)]; if (v !== undefined) return v; } return ''; }
function amount(value) { const n = Number(String(value).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : NaN; }
function normaliseInvoice(row, index, source) {
  const supplier = pick(row, 'supplier', 'supplier name', 'vendor', 'party name');
  const gstin = pick(row, 'gstin', 'supplier gstin', 'vendor gstin').toUpperCase();
  const invoice = pick(row, 'invoice', 'invoice number', 'invoice no', 'bill number');
  const date = pick(row, 'date', 'invoice date');
  const taxable = amount(pick(row, 'taxable', 'taxable value', 'taxable amount'));
  const cgst = amount(pick(row, 'cgst', 'central tax') || 0);
  const sgst = amount(pick(row, 'sgst', 'state tax') || 0);
  const igst = amount(pick(row, 'igst', 'integrated tax') || 0);
  if (!supplier || !gstin || !invoice || !/^\d{4}-\d{2}-\d{2}$/.test(date) || [taxable,cgst,sgst,igst].some(x => !Number.isFinite(x)))
    throw new Error(`${source}: row ${row._row} needs supplier, GSTIN, invoice, YYYY-MM-DD date and numeric amounts.`);
  return {id:`${source}-${index}`,supplier,gstin,invoice,date,taxable,cgst,sgst,igst,claimed:pick(row,'claimed','itc claimed').toLowerCase() !== 'no'};
}
function normaliseBank(row, index) {
  const supplier = pick(row,'supplier','supplier name','vendor','payee');
  const date = pick(row,'date','payment date','transaction date');
  const paid = amount(pick(row,'amount','debit','payment amount'));
  if (!supplier || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(paid))
    throw new Error(`Bank: row ${row._row} needs supplier, YYYY-MM-DD date and a numeric amount.`);
  return {id:`payment-${index}`,supplier,date,amount:paid,reference:pick(row,'reference','narration','description','remarks')};
}
function prepare(raw) {
  return {
    books:csvRows(raw.books).map((r,i) => normaliseInvoice(r,i,'Books')),
    g2b:csvRows(raw.g2b).map((r,i) => normaliseInvoice(r,i,'GSTR-2B')),
    bank:csvRows(raw.bank).map(normaliseBank)
  };
}
function addIssue(issues, kind, title, book, g2b, payments, impact, reason, next) {
  const ref = book || g2b;
  issues.push({id:`${kind}-${ref.id}`,kind,title,supplier:ref.supplier,invoice:ref.invoice,amount:Math.max(0,Math.round(impact)),reason,next,book,g2b,payments:payments || []});
}
function matchPayment(book, bankBySupplier, used) {
  const candidates = (bankBySupplier.get(clean(book.supplier)) || []).filter(p => p.date >= book.date && !used.has(p.id));
  const due = total(book);
  const reference = invoiceKey(book.invoice);
  const explicit = candidates.filter(p => clean(p.reference).includes(reference));
  const exact = explicit.find(p => Math.abs(p.amount - due) <= 1) || candidates.find(p => Math.abs(p.amount - due) <= 1);
  if (exact) { used.add(exact.id); return {items:[exact],confidence:'High'}; }
  const pool = (explicit.length ? explicit : candidates).slice(0,20);
  for (let i=0;i<pool.length;i++) for (let j=i+1;j<pool.length;j++) {
    if (Math.abs(pool[i].amount + pool[j].amount - due) <= 1) {used.add(pool[i].id);used.add(pool[j].id);return {items:[pool[i],pool[j]],confidence:'Needs confirmation'};}
  }
  return {items:[],confidence:'No payment linked'};
}
function reconcile(data) {
  const issues=[], usedG=new Set(), usedP=new Set(), seen=new Set(); let matches=0;
  const bankBySupplier=new Map();
  data.bank.forEach(p=>{const key=clean(p.supplier);if(!bankBySupplier.has(key))bankBySupplier.set(key,[]);bankBySupplier.get(key).push(p);});
  const gIndex = new Map();
  data.g2b.forEach(g => { const key=`${g.gstin}|${invoiceKey(g.invoice)}`; if (!gIndex.has(key)) gIndex.set(key,[]); gIndex.get(key).push(g); });
  data.books.forEach(book => {
    const key=`${book.gstin}|${invoiceKey(book.invoice)}`;
    const payment=matchPayment(book,bankBySupplier,usedP);
    if (seen.has(key)) {addIssue(issues,'duplicate','Possible duplicate in books',book,null,payment.items,tax(book),'This invoice key appears more than once in the purchase register.','Check whether the second entry is a duplicate before claiming credit.');return;}
    seen.add(key);
    const candidates=(gIndex.get(key)||[]).filter(g=>!usedG.has(g.id));
    const g=candidates.length===1?candidates[0]:null;
    if (!g) {
      addIssue(issues,'missing2b','Not found in GSTR-2B',book,null,payment.items,tax(book),candidates.length>1?'More than one GSTR-2B entry has this invoice key.':'The purchase invoice has no matching supplier filing in this file.','Check the invoice and ask the supplier to verify their filing.');
    } else {
      usedG.add(g.id);matches++;
      const difference=Math.abs(tax(book)-tax(g));
      if (difference>1 || Math.abs(book.taxable-g.taxable)>1)
        addIssue(issues,'amount','Amount differs between records',book,g,payment.items,difference,'The taxable or GST amount in your books differs from GSTR-2B.','Compare the source invoice and correct the record that is wrong.');
    }
    const interstate=book.gstin.slice(0,2)!=='07';
    if ((interstate&&(book.cgst>0||book.sgst>0))||(!interstate&&book.igst>0))
      addIssue(issues,'taxType','Tax type needs review',book,g,payment.items,tax(book),'The tax split does not match the supplier state in this simplified demo check.','Verify place of supply and the invoice tax type with an accountant.');
    if (payment.confidence==='Needs confirmation')
      addIssue(issues,'split','Split payment needs confirmation',book,g,payment.items,0,'Two bank entries add up to this invoice total, but a person should confirm the allocation.','Inspect both payment references and confirm they settle this invoice.');
  });
  data.g2b.forEach(g => {if(!usedG.has(g.id))addIssue(issues,'missingBooks','Present in GSTR-2B, absent from books',null,g,[],tax(g),'The supplier reported this invoice, but it is not in the uploaded purchase register.','Check whether the purchase belongs to your business and whether credit is eligible.');});
  issues.sort((a,b)=>b.amount-a.amount || a.title.localeCompare(b.title));
  return {issues,matches};
}
function showPage(page, scrollTop = true) {
  ['landing','login','workspace'].forEach(id => $('#'+id).hidden=id!==page);
  if(page==='workspace') $('#user-name').textContent=(demoName||'friend').split(' ')[0];
  if(scrollTop) window.scrollTo({top:0,behavior:'instant'});
}
function route() {
  const hash=location.hash;
  if(hash==='#workspace') {
    if(!demoName) {location.hash='demo';return;}
    showPage('workspace');
  } else if(hash==='#demo') showPage('login');
  else {
    const section=hash.slice(1);
    const returning=$('#landing').hidden;
    if(returning) showPage('landing',!section||section==='top');
    if(returning&&section&&section!=='top') requestAnimationFrame(()=>document.getElementById(section)?.scrollIntoView());
  }
}
function status(message,error=false) { const el=$('#status-message'); el.textContent=message;el.classList.toggle('error',error); }
function render() {
  const d=state.data; const open=state.issues.filter(i=>!state.reviewed.has(i.id));
  $('#results').hidden=false;
  $('#live-test').hidden=state.source!=='sample';
  $('#source-caption').textContent=state.source==='sample'?'Prepared demo records':'Your uploaded records · processed in this browser';
  $('#metric-invoices').textContent=d.books.length.toLocaleString('en-IN');
  $('#metric-matched').textContent=state.matches.toLocaleString('en-IN');
  $('#metric-issues').textContent=open.length.toLocaleString('en-IN');
  const byInvoice=new Map();open.forEach(i=>{const key=`${i.book?.gstin||i.g2b?.gstin}|${invoiceKey(i.invoice)}`;byInvoice.set(key,Math.max(i.amount,byInvoice.get(key)||0));});
  $('#metric-value').textContent=money([...byInvoice.values()].reduce((a,b)=>a+b,0));
  $('#queue-count').textContent=`${state.issues.length} cases`;
  $('#issue-list').innerHTML=state.issues.length?state.issues.map(i=>`<button type="button" class="issue-item ${state.selected===i.id?'active':''} ${state.reviewed.has(i.id)?'reviewed':''}" data-issue="${safe(i.id)}"><span><span class="issue-kind">${state.reviewed.has(i.id)?'Reviewed':safe(kindLabel[i.kind]||i.kind)}</span><strong>${safe(i.title)}</strong><small>${safe(i.supplier)} · ${safe(i.invoice)}</small></span><span class="issue-amount">${money(i.amount)}</span></button>`).join(''):'<div class="empty-queue">No differences found in these files.</div>';
  renderEvidence();
}
function evidenceRow(label,r) {
  if(!r)return `<div class="evidence-row"><span>${label}</span><strong>No record found</strong></div>`;
  if(r.amount!==undefined)return `<div class="evidence-row"><span>${label}</span><strong>${money(r.amount)} · ${safe(r.date)}<br>${safe(r.reference||r.supplier)}</strong></div>`;
  return `<div class="evidence-row"><span>${label}</span><strong>${safe(r.invoice)} · ${money(r.taxable)} taxable<br>GST ${money(tax(r))} · ${safe(r.date)}</strong></div>`;
}
function renderEvidence() {
  const i=state.issues.find(x=>x.id===state.selected);
  if(!i){$('#evidence-content').innerHTML='<h3 id="evidence-heading">Select a case</h3><p>Choose an item from the queue to see the original records and suggested next step.</p>';return;}
  $('#evidence-content').innerHTML=`<h3 id="evidence-heading">${safe(i.title)}</h3><p class="evidence-meta">${safe(i.supplier)} · ${safe(i.invoice)} · ${money(i.amount)} to review</p><p>${safe(i.reason)}</p><div class="evidence-rows">${evidenceRow('PURCHASE REGISTER',i.book)}${evidenceRow('GSTR-2B',i.g2b)}${i.payments.length?i.payments.map((p,n)=>evidenceRow(`BANK PAYMENT ${n+1}`,p)).join(''):evidenceRow('BANK PAYMENT',null)}</div><p><b>Suggested next step:</b> ${safe(i.next)}</p><div class="evidence-actions"><button type="button" class="primary-button" id="decision-button">${state.reviewed.has(i.id)?'Reopen this case':'Mark as reviewed'} <span aria-hidden="true">↗</span></button></div>`;
}
function load(raw,source) {
  const data=prepare(raw);const result=reconcile(data);
  state.data=data;state.baseData=structuredClone(data);state.issues=result.issues;state.matches=result.matches;state.selected=result.issues[0]?.id||null;state.reviewed=new Set();state.source=source;render();
  status(`${data.books.length} purchase invoices, ${data.g2b.length} GSTR-2B entries and ${data.bank.length} payments processed. ${result.issues.length} cases need review.`);
  $('#results').scrollIntoView({behavior:'smooth',block:'start'});
}
function csvEscape(v){const s=String(v??'');return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function download() {
  if(!state.data){status('Load records before exporting.',true);return;}
  const header=['Status','Issue','Supplier','Invoice','GST amount to review','Reason','Next step'];
  const rows=state.issues.map(i=>[state.reviewed.has(i.id)?'Reviewed':'Open',i.title,i.supplier,i.invoice,i.amount,i.reason,i.next]);
  const csv=[header,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='rekora-review.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

document.querySelectorAll('[data-open-login]').forEach(b=>b.addEventListener('click',()=>location.hash='demo'));
document.querySelectorAll('[data-go-home]').forEach(b=>b.addEventListener('click',()=>location.hash='top'));
$('#login-form').addEventListener('submit',e=>{e.preventDefault();if(!e.currentTarget.reportValidity())return;demoName=$('#demo-name').value.trim();try{sessionStorage.setItem('rekora-demo-name',demoName);}catch(_){}location.hash='workspace';route();});
$('#sign-out').addEventListener('click',()=>{demoName='';try{sessionStorage.removeItem('rekora-demo-name');}catch(_){}location.hash='top';route();});
$('#sample-button').addEventListener('click',()=>{try{load(SAMPLE,'sample');['books','g2b','bank'].forEach(k=>$('#'+k+'-status').textContent='Demo records');}catch(e){status(e.message,true);}});
$('#reset-button').addEventListener('click',()=>{state.data=null;state.issues=[];state.reviewed.clear();state.selected=null;$('#results').hidden=true;['books','g2b','bank'].forEach(k=>{$('#'+k+'-file').value='';$('#'+k+'-status').textContent='Choose file';});status('Files cleared. Load the demo records or choose three CSV files.');});
$('#export-button').addEventListener('click',download);
$('#run-live-test').addEventListener('click',()=>{
  if(state.source!=='sample'||!state.baseData)return;
  state.data=structuredClone(state.baseData);
  const g=state.data.g2b.find(r=>r.supplier==='Arora Wires');
  const scenario=$('#live-scenario').value;
  if(scenario==='amount')g.igst+=3600;else g.invoice='AW-442';
  const result=reconcile(state.data);
  state.issues=result.issues;state.matches=result.matches;state.reviewed.clear();
  state.selected=scenario==='amount'?result.issues.find(i=>i.supplier==='Arora Wires')?.id:result.issues[0]?.id;
  render();
  status(scenario==='amount'?'GST amount changed: Rekora added an Arora Wires mismatch to the review queue.':'Invoice number reformatted: it still matched correctly, so no new issue was added.');
});
$('#issue-list').addEventListener('click',e=>{const b=e.target.closest('[data-issue]');if(!b)return;state.selected=b.dataset.issue;render();});
$('#evidence-content').addEventListener('click',e=>{if(!e.target.closest('#decision-button'))return;state.reviewed.has(state.selected)?state.reviewed.delete(state.selected):state.reviewed.add(state.selected);render();});
async function maybeUpload(){const keys=['books','g2b','bank'];if(!keys.every(k=>$('#'+k+'-file').files[0])){status('Choose all three CSV files to run a reconciliation.');return;}try{const texts=await Promise.all(keys.map(k=>$('#'+k+'-file').files[0].text()));load(Object.fromEntries(keys.map((k,i)=>[k,texts[i]])),'upload');}catch(e){status(e.message,true);}}
['books','g2b','bank'].forEach(k=>$('#'+k+'-file').addEventListener('change',e=>{$('#'+k+'-status').textContent=e.target.files[0]?.name||'Choose file';maybeUpload();}));
window.addEventListener('hashchange',route);route();
