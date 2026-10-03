/* =====================================================================
   Rekora anomaly engine: Isolation Forest over bill-level features, Benford's law over the whole ledger.
   Runs in the browser (classic <script>) and in Node (module.exports). Seeded, so results are repeatable.
   ML only raises review flags. It never changes a rupee figure: the rule engine in engine.js does that.
   ===================================================================== */
(function (root) {
  const EULER = 0.5772156649;
  const cFactor = (n) => (n <= 1 ? 0 : 2 * (Math.log(n - 1) + EULER) - 2 * (n - 1) / n);
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- Isolation Forest (Liu, Ting, Zhou 2008) ---------- */
  function buildTree(rows, depth, limit, rand, nf) {
    if (depth >= limit || rows.length <= 1) return { size:rows.length };
    for (let attempt = 0; attempt < nf * 2; attempt++) {
      const f = Math.floor(rand() * nf);
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) { if (r[f] < lo) lo = r[f]; if (r[f] > hi) hi = r[f]; }
      if (hi === lo) continue;
      const cut = lo + rand() * (hi - lo), L = [], R = [];
      for (const r of rows) (r[f] < cut ? L : R).push(r);
      return { f, cut, l:buildTree(L, depth + 1, limit, rand, nf), r:buildTree(R, depth + 1, limit, rand, nf) };
    }
    return { size:rows.length };
  }
  function pathLen(node, x, depth) {
    while (node.f !== undefined) { node = x[node.f] < node.cut ? node.l : node.r; depth++; }
    return depth + cFactor(node.size);
  }
  function forest(X, opt = {}) {
    const trees = opt.trees || 100, psi = Math.min(opt.psi || 256, X.length), rand = rng(opt.seed || 7), nf = X[0].length, limit = Math.ceil(Math.log2(Math.max(psi, 2)));
    const T = [];
    for (let t = 0; t < trees; t++) {
      const idx = new Set(); while (idx.size < psi) idx.add(Math.floor(rand() * X.length));
      T.push(buildTree([...idx].map((i) => X[i]), 0, limit, rand, nf));
    }
    const denom = cFactor(psi) || 1;
    return { psi, score:(x) => { let s = 0; for (const tr of T) s += pathLen(tr, x, 0); return Math.pow(2, -(s / T.length) / denom); } };
  }

  /* ---------- features ---------- */
  const FEATURES = ['ratio', 'weekend', 'round', 'gap', 'burst'];
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const dayNum = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);
  function featurise(D) {
    const rows = D.books.filter((b) => !b._dup && b.taxable > 0), bySup = new Map();
    for (const b of rows) { if (!bySup.has(b.sup)) bySup.set(b.sup, []); bySup.get(b.sup).push(b); }
    const globalMed = median(rows.map((b) => b.taxable)) || 1, out = [];
    for (const list of bySup.values()) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const med = list.length >= 5 ? median(list.map((b) => b.taxable)) : globalMed, days = list.map((b) => dayNum(b.date));
      list.forEach((b, i) => {
        const dow = new Date(b.date + 'T00:00:00Z').getUTCDay();
        const gap = i ? days[i] - days[i - 1] : 30;
        let burst = 0; for (let k = 0; k < list.length; k++) if (Math.abs(days[k] - days[i]) <= 3) burst++;
        // Relative to how busy this supplier normally is, so a high-volume supplier is not penalised for being busy.
        const span = Math.max(30, days[days.length - 1] - days[0]), expected = Math.max(1, list.length * 7 / span);
        out.push({ b, med, gap, burst, expected, x:[Math.log(b.taxable / med), dow === 0 || dow === 6 ? 1 : 0, b.taxable >= 10000 && b.taxable % 10000 === 0 ? 1 : 0, Math.log1p(gap), burst / expected] });
      });
    }
    return out;
  }
  // Plain-language wording for each feature, given the bill's raw values.
  function say(f, r) {
    const ratio = r.b.taxable / r.med, dow = new Date(r.b.date + 'T00:00:00Z').getUTCDay();
    switch (FEATURES[f]) {
      case 'ratio': return ratio >= 1 ? `${ratio.toFixed(ratio >= 10 ? 0 : 1)}× this supplier's usual bill` : `only ${Math.round(ratio * 100)}% of this supplier's usual bill`;
      case 'weekend': return `dated on a ${dow === 0 ? 'Sunday' : 'Saturday'}`;
      case 'round': return 'a round-number amount';
      case 'gap': return r.gap > 60 ? `first bill from this supplier in ${r.gap} days` : 'an unusual gap since their last bill';
      case 'burst': return `${r.burst} bills from this supplier within a week, about ${(r.burst / r.expected).toFixed(1)}× their usual pace`;
    }
  }

  /* ---------- run ---------- */
  // Returns { flags, scores, supplierScore, threshold }. flags: bills worth a person's look, each with a score, the top reasons and the feature attribution.
  function detect(D, opt = {}) {
    const recs = featurise(D);
    if (recs.length < 30) return { flags:[], scores:new Map(), supplierScore:{}, threshold:null, n:recs.length };
    const X = recs.map((r) => r.x), F = forest(X, opt);
    const scores = new Map(); recs.forEach((r, i) => { r.score = F.score(X[i]); scores.set(r.b.id, r.score); });
    const sorted = recs.map((r) => r.score).sort((a, b) => b - a);
    const cap = opt.maxShare || 0.02, floor = opt.floor || 0.6;
    const threshold = Math.max(floor, sorted[Math.max(0, Math.floor(recs.length * cap) - 1)] || floor);
    const med = FEATURES.map((_, f) => median(X.map((x) => x[f])));
    const flags = [];
    for (const r of recs) {
      if (r.score < threshold) continue;
      // Leave-one-feature-out attribution: how much the anomaly score falls if this feature took a typical value.
      const att = FEATURES.map((_, f) => { const x = r.x.slice(); x[f] = med[f]; return { f, drop:r.score - F.score(x) }; }).filter((a) => a.drop > 0.01).sort((a, b) => b.drop - a.drop);
      const top = att.slice(0, 2);
      flags.push({ bill:r.b.id, sup:r.b.sup, score:+r.score.toFixed(3), reasons:top.map((a) => say(a.f, r)), attribution:top.map((a) => ({ feature:FEATURES[a.f], drop:+a.drop.toFixed(3) })) });
    }
    flags.sort((a, b) => b.score - a.score);
    const supplierScore = {}, tmp = {};
    for (const r of recs) (tmp[r.b.sup] = tmp[r.b.sup] || []).push(r.score);
    for (const k in tmp) { const top3 = tmp[k].sort((a, b) => b - a).slice(0, 3); supplierScore[k] = +(top3.reduce((a, b) => a + b, 0) / top3.length).toFixed(3); }
    return { flags, scores, supplierScore, threshold:+threshold.toFixed(3), n:recs.length };
  }

  /* ---------- Benford's law over the whole ledger ---------- */
  const BENFORD = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));
  function benford(D) {
    const counts = Array(9).fill(0); let n = 0;
    for (const b of D.books) { if (b._dup || !(b.taxable >= 10)) continue; counts[+String(Math.round(b.taxable))[0] - 1]++; n++; }
    if (n < 50) return null;
    // Benford only holds for data spread over several orders of magnitude (Nigrini). Report the spread and say when the test does not apply.
    const sizes = D.books.filter((b) => !b._dup && b.taxable >= 10).map((b) => b.taxable).sort((x, y) => x - y);
    const spread = sizes[Math.floor(sizes.length * 0.99)] / sizes[Math.floor(sizes.length * 0.01)];
    if (spread < 50) return { applicable:false, n, spread:Math.round(spread) };
    const obs = counts.map((c) => c / n);
    const mad = obs.reduce((a, o, i) => a + Math.abs(o - BENFORD[i]), 0) / 9;
    const chi2 = counts.reduce((a, c, i) => a + Math.pow(c - n * BENFORD[i], 2) / (n * BENFORD[i]), 0);
    // Nigrini's mean-absolute-deviation bands for first-digit tests.
    const verdict = mad < 0.006 ? 'close conformity' : mad < 0.012 ? 'acceptable conformity' : mad < 0.015 ? 'marginal conformity' : 'non-conformity';
    return { applicable:true, spread:Math.round(spread), n, observed:obs, expected:BENFORD, mad:+mad.toFixed(4), chi2:+chi2.toFixed(1), verdict };
  }

  const api = { detect, benford, forest, featurise, FEATURES, BENFORD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Rekora = Object.assign(root.Rekora || {}, { ml:api });
})(typeof window !== 'undefined' ? window : globalThis);
