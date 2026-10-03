# Rekora prototype build plan (v2)

Team Elara (Arihant Jain, Mahatva Goel). Fintechstico'26, PS2 Intelligent Tax Reconciliation.
v2 written Sat 3 Oct 2026, 20:15 IST, after reviews from Mahatva and a second Claude. Supersedes v1.

## The clock

| When (IST) | What |
|---|---|
| **Sun 4 Oct, 01:30** | **Video submission closes.** Hard stop. One member submits via the Google Form |
| Sun 4 Oct, ~03:00 | Shortlist results (eliminatory) |
| Sun 4 Oct, 10:30 | Final at NSUT Dwarka: working prototype, strategy, PPT, Q&A |

## Source of truth

**The submission code is this repo: TeamElara/Intelligent-Tax-Reconciliation.** (name ends with a period).
Mahatva's local `index.html` + `README.txt` (financial functions are placeholders) is an **older mockup. Don't use it.**
The `index.html` in this repo has a working engine: it was run in Node on 3 Oct and produced 10 correct issues from the sample. Pull this repo and work only here.

## What changed from v1

1. **One engine.** The JS engine in `engine.js` runs both the dashboard and the accuracy test, so the measured numbers are the demo's own numbers. No Python port tonight.
2. **One complete flow on screen:** upload 3 files → match → ranked mismatches → evidence → human decision.
3. **Small, hand-checked demo month first** (~120 bills). The large generated set (36,000 bills) only feeds the accuracy table, using the same engine.
4. **No ML, SHAP, LangGraph, Groq or FastAPI before the video.** Narration tonight: "Rules compute, a human decides." We don't say "ML flags" or "LLM explains" until those are actually running.
5. **No tuning the generator to hit the deck's ₹6.3L / ₹2.4L.** Report whatever comes out, worded as "on our synthetic test set".
6. **Uncertain = Needs review.** A GSTIN typo match, a split payment or a combined payment is never auto-accepted. A person confirms it.

## Engine rules (fixes to make in engine.js)

| Check | Rule |
|---|---|
| Match key | GSTIN + **financial year** + canonical invoice ID. Fuzziness only in letters and separators. **Digits must be equal**, so AW-0442 never pairs with AW-0443 |
| GSTIN typo | Checksum fails and one GSTIN in 2B is ≤ 2 characters off with the same invoice and amount → **Needs review** ("Confirm it's the same supplier"). Never auto-matched |
| Missing in GSTR-2B | Follow-up issue: chase the supplier, keep the claim pending. **Not** "fake ITC" |
| Missing in books | Bucket renamed **"Potential credit to review"**. Reason includes the time limit: FY 2025-26 credit lapses after 30 Nov 2026 |
| Amount / tax arithmetic | Impact = the **difference only**. 2B higher than books → potential credit, not at risk |
| Wrong rate | Flag only when **overcharged**. Impact = extra tax. Undercharged → no reversal. Limited to the demo rate-master products, labelled as a demo |
| Wrong tax type | IGST vs CGST + SGST from the state codes (unchanged) |
| Duplicate | Same key twice in books (unchanged) |
| Unpaid 180+ days | Only if credit was claimed. Reverse **in proportion to the unpaid amount**. Show interest at 18% a year |
| Split payment | 2 to 3 payments summing to one bill → **Needs review** |
| Combined payment (new) | One payment covering 2 to 3 bills of the same supplier → **Needs review**, so bulk-paid bills aren't falsely flagged as unpaid |
| Double payment (new) | Same bill paid twice → **cash leak**, kept out of the credit buckets and the "wrong credit" total |
| Spike | Called a **"median rule"**, never ML |
| IMS advice (new) | Every issue gets Accept / Pending / Reject advice. One derived field |
| Bank evidence | Matched on supplier name in the narration + amount + date window. The evidence panel shows the narration so a judge can see how we know who was paid |
| Liability | Output tax comes from a generated sales total, not a constant. Cash to pay = output tax − eligible credit, with Section 49 set-off (already built) |

## Tonight's build (20:15 to 23:00)

| # | Task | Owner | Time | Done by |
|---|---|---|---|---|
| 0 | Push this repo (private for tonight). Mahatva pulls it | Arihant | 5m | 20:25 |
| 1 | Rebrand TaxLens → Rekora. Wording: "Potential credit to review", DRC-01C threshold, no ML/LLM claims in UI copy | Mahatva | 30m | 20:55 |
| 2 | Move the engine out of index.html into `engine.js` (browser + Node). Apply the rule fixes above | Arihant + Claude | 75m | 21:30 |
| 3 | `tools/gen.js`: seeded generator with labels. Demo month (~120 bills, hand-checked) and full set (300 suppliers, 12 states, 18 months, ~36,000 bills). Planted types = only the ones the engine checks. Traps: separator variants, ₹1 rounding, legit split and combined payments, recurring same-amount bills, pre-22 Sep 2025 old-slab bills, invoice numbers restarting in April | Claude | 45m | 22:00 |
| 4 | `tools/eval.js`: precision, recall and ₹-weighted recall per type, plus trap false positives → `data/eval.json`. Accuracy card in the UI | Claude | 30m | 22:15 |
| 5 | **Upload flow**: the drop zone takes books / 2B / bank CSVs → parse → engine → dashboard. The demo month ships as these 3 CSVs | Claude + Arihant | 40m | 22:45 |
| 6 | Chaos Mode **trap break**: "Reformat the invoice number" → "Still matched, no false flag". Scoreboard gets a "correctly ignored" count | Claude | 15m | 22:45 |
| 7 | Video script with corrected wording, timed to 2:15 | Mahatva | parallel | 22:30 |

**22:45 feature freeze.** Anything unfinished gets cut, not rushed. 22:45 to 23:00 bug bash: every Chaos break × every clean bill, upload → reset → upload, both themes, no console errors.
The old sample (`SEED`) stays as a fallback via `?demo=seed`.

## The video (23:00 to 01:00)

| Time | Say | Show |
|---|---|---|
| 0:00-0:20 | One accountant, ~2,000 bills a month, books vs GSTR-2B vs bank. If the claim exceeds 2B beyond the threshold, a DRC-01C notice follows, and not responding can block the next GSTR-1 | Deck slide 2 |
| 0:20-0:35 | Existing tools match books with GSTR-2B. Rekora adds payment evidence and a ₹-ranked review workflow. Rules compute, a human decides | Deck slide 4 |
| 0:35-0:50 | Upload books, 2B and bank CSVs → reconciled | App |
| 0:50-1:20 | Buckets and net cash payable → biggest ₹ issue → evidence side by side (AW-0442 vs AW/442 still matched; wrong tax type in red) → IMS advice → decide, totals update → Hindi follow-up | App |
| 1:20-1:50 | Chaos Mode: break a clean bill → caught in X ms. Then the trap: reformat an invoice number → correctly ignored | App |
| 1:50-2:10 | Accuracy on our synthetic test set: N bills, per-type recall, ₹-weighted recall, trap false positives | App |
| 2:10-2:20 | For every questionable invoice: the evidence, the ₹ at stake and a documented decision | App |

- 23:00 dry run. 23:20 record (max 3 takes). 00:00 trim.
- **00:30 upload** (Drive "anyone with link" or YouTube unlisted). Test it in incognito.
- **01:00 submit.** If the build slipped, record what works. Partial work is judged as it stands; a late video gets nothing.

## If shortlisted (03:00 to 08:00)

Priority is **demo reliability over new AI**. Sleep in shifts.
1. Matching edge cases found during the bug bash, and the full test table on screen.
2. Slides updated to match the prototype exactly:
   - slide 7 split into "prototype" vs "production"
   - "every Confirm tunes the thresholds" deleted
   - slide 9 numbers replaced with measured results
   - "Recoverable" → "Potential credit to review"
   - the portal answer corrected (see Q&A)
3. Self-host the fonts (venue wifi).
4. Optional, only if 1 to 3 are done by 06:00: Benford on the whole ledger (not per supplier), then Isolation Forest as an offline Python step that writes flags the UI reads. Mention it only once it runs.
5. 08:00 code freeze. Rehearse the live demo 5 times without a failure.

**Roadmap only (say so if asked):** React, FastAPI service, Postgres, Docker, LLM copilot with verifier, ML risk model, PDF/WhatsApp ingest, credit notes, blocked credits, reverse charge, imports, TDS.

## Q&A answers (corrected)

- *Doesn't GSTN already do this?* GSTN offers a GSTR-2B vs purchase-register matching tool. Rekora adds the bank leg (payments, 180-day, split and combined payments), ranks by ₹ and records a decision on every item.
- *Is a bill in 2B but not in your books free credit?* No. It's potential credit to review. Presence in 2B doesn't prove eligibility.
- *Missing supplier filing = fraud?* No. It's a follow-up issue. A repeated pattern raises the supplier's review priority.
- *Rate check after 22 Sep 2025?* The rate change is real, but there are exceptions, so we check only a small demo rate master of identified products.
- *Is the accuracy real?* It's measured on our synthetic test set with ground truth and trap cases, using the same engine as the dashboard. Real data next, from a pilot.
- *How do you know who a bank payment went to?* The supplier name in the narration, plus amount and date. Ambiguous cases go to a person.
- *Where's the AI?* Tonight's prototype is deliberately rules-first: every rupee is deterministic. ML for anomaly scoring and an LLM for explanations are the next layer, and they never compute a rupee.

## Open items
- [ ] Repo private for tonight? (It's public: other PS2 teams can see pushes)
- [ ] Mahatva pulls this repo and confirms by 20:30
- [ ] Google Form link open in a tab
- [ ] Travel time to NSUT Dwarka (sets the morning code freeze)
