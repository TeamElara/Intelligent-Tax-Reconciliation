# Rekora prototype build plan (v3, phase-wise)

Team Elara (Arihant Jain, Mahatva Goel). Fintechstico'26, PS2 Intelligent Tax Reconciliation.
Written Sat 3 Oct 2026. v3 splits the v2 plan into phases. Each phase ships on its own.

## Status (3 Oct, evening)

Built and on `main`: phases 0 to 5 (shared engine and rule fixes, generator and accuracy table, CSV and GSTR-2B JSON upload, Chaos Mode trap), plus additions beyond the plan: in-browser Isolation Forest and Benford check, decision log with CSV exports, answer verifier in Ask Rekora, README. Still to do: the video and submission (phase 6), deck edits, finals rehearsal, self-hosted fonts, and the history cleanup.

Not built, so not to be claimed: React, FastAPI, a database, a hosted LLM copilot, SHAP.

## The clock

| When (IST) | What |
|---|---|
| **Sun 4 Oct, 01:30** | **Video submission closes.** Hard stop. One member submits via the Google Form |
| Sun 4 Oct, ~03:00 | Shortlist results (eliminatory) |
| Sun 4 Oct, 10:30 | Final at NSUT Dwarka: working prototype, strategy, PPT, Q&A |

## How the phases work

- **Every phase ends with a working, recordable app.** If the clock runs out mid-phase, revert that phase and record the previous one.
- Each phase is one branch → one PR → merged to `main` only when its **Done when** checks pass.
- The cut-off times are hard. A phase that isn't done by its cut-off gets dropped, not rushed.
- The old sample stays as a fallback forever: `index.html?demo=seed`.
- Source of truth: **this repo**. Mahatva's local mockup (placeholder functions) is retired.

```
Phase 0  Setup                    20:15-20:30   done
Phase 1  Rebrand + honest wording 20:30-21:00   Mahatva
Phase 2  Shared engine + rule fixes 20:30-21:45 Arihant
Phase 3  Generator + accuracy     21:45-22:30   the team (Arihant reviews)
Phase 4  Upload flow              22:15-22:45   Arihant
Phase 5  Chaos trap               22:30-22:45   
--- 22:45 FREEZE, bug bash ---
Phase 6  Video + submit           23:00-01:00   Mahatva records, Arihant drives
--- 03:00 results ---
Phase 7  Finals hardening         03:00-08:00   both, sleep in shifts
Phase 8  Optional ML (only if 7 is done by 06:00)
```
Phases 1 and 2 run in parallel (different parts of the file; merge 1 first). Phases 4 and 5 depend on 2. Phase 3 depends on 2.

---

## Phase 0: Setup (done)
- Repo initialised and pushed to `TeamElara/Intelligent-Tax-Reconciliation.` (public).
- Python 3.9 venv in `.venv` (only needed in Phase 8).
- **Done when:** Mahatva has pulled `main` and opened `index.html` and sees the working Chaos Mode. ☐

---

## Phase 1: Rebrand and honest wording
**Owner:** Mahatva · **Branch:** `phase-1-rebrand` · **Cut-off:** 21:00 · **Files:** `index.html` (HTML/CSS/copy only, no engine code)

Tasks
1. Replace any leftover old-name text with Rekora: `<title>`, brand name, "Ask Rekora", footer, copilot greeting, localStorage key `rekora-theme`.
2. "Recoverable ITC" → **"Potential credit to review"** (bucket card, chip, waterfall label, legend, copilot text). Sub-line: "In GSTR-2B, not in your books. Check before you claim."
3. Missing-in-2B wording: "follow up with the supplier", never "fake".
4. DRC-01C line in the Liability steps: "a notice can follow when the claim exceeds GSTR-2B beyond the threshold".
5. Footer: "Synthetic data for a fictional company. Rate checks use a small demo rate master."
6. Remove any UI copy that says ML or LLM.

**Done when**
- [ ] `grep -i "taxlens" index.html` returns nothing
- [ ] Both themes and a 375px-wide window look right
- [ ] Chaos Mode still catches all 6 break types
- [ ] No console errors

---

## Phase 2: Shared engine and rule fixes
**Owner:** Arihant · **Branch:** `phase-2-engine` · **Cut-off:** 21:45 · **Files:** new `engine.js`, `index.html` (script section), new `tools/check-seed.js`

**2a. Extract (do first, merge alone if time is short)**
- Move the data constants, helpers, `TYPES`, `runEngine` and `groupIssues` into `engine.js`. It works in the browser (`<script src="engine.js">`) and in Node (`module.exports`).
- `tools/check-seed.js` runs the engine on SEED in Node and asserts the expected 10 issues.
- **Done when:** the UI looks identical and `node tools/check-seed.js` passes.

**2b. Rule fixes** (each one is a small commit and keeps check-seed green, with updated expectations)

| Check | Rule |
|---|---|
| Match key | GSTIN + **financial year** + canonical invoice ID. Letters and separators can differ, **digits must match** (AW-0442 ≠ AW-0443) |
| GSTIN typo | Checksum fails, and a 2B GSTIN is ≤ 2 characters off with the same invoice and amount → **Needs review** ("Confirm it's the same supplier"). Never auto-matched |
| Missing in 2B | Follow-up issue, claim kept pending |
| Missing in books | "Potential credit to review", with the time limit: FY 2025-26 credit lapses after 30 Nov 2026 |
| Amount / tax arithmetic | Impact = **difference only**. 2B higher than books → potential credit |
| Wrong rate | Only when **overcharged**. Impact = extra tax |
| Unpaid 180+ days | Reverse **in proportion to the unpaid amount**. Show interest at 18% a year |
| Split payment | 2-3 payments = one bill → **Needs review** |
| Combined payment (new) | One payment = 2-3 bills of the same supplier → **Needs review** |
| Double payment (new) | Same bill paid twice → **cash leak**, outside the credit buckets and the hero total |
| Spike | Label "median rule", never ML |
| IMS advice (new) | Every issue gets Accept / Pending / Reject in the evidence panel |
| Bank evidence | Evidence shows the bank narration (supplier name in it) so the match is explainable |

**Done when**
- [ ] `node tools/check-seed.js` passes
- [ ] SEED gets 2 new rows (one combined payment, one double payment) and both show in the queue with correct buckets
- [ ] Resolve and Undo still move the ₹ totals correctly
- [ ] Chaos Mode catches all 6 break types

**If late:** merge 2a only, plus whichever fixes are done. The old rules still work.

---

## Phase 3: Generator and accuracy table
**Owner:** Arihant · **Branch:** `phase-3-accuracy` · **Cut-off:** 22:30 · **Files:** `tools/gen.js`, `tools/eval.js`, `data/`, `index.html` (Accuracy card)
**Depends on:** Phase 2a

Tasks
1. `tools/gen.js --seed 42`, deterministic, uses `engine.js` helpers for GSTINs and the rate master.
   - **Demo month** (Sep 2026, ~120 bills, ~20 suppliers): written as `data/demo/books.csv`, `g2b.csv`, `bank.csv`, `sales.csv` and `data/demo.js` (SEED shape). Hand-check every planted issue once.
   - **Test set**: 300 suppliers, 12 states, Apr 2025 to Sep 2026 (18 months), ~36,000 bills → `data/test/*.csv` + `labels.csv`. Not committed if over 5 MB (regenerate with one command).
   - Plant **only the types the engine checks**. Error rates are fixed in code and **not tuned** to any pitch number.
   - Traps (must stay unflagged): separator variants, ₹1 rounding, legit split and combined payments, recurring same-amount bills, old-slab bills dated before 22 Sep 2025, invoice numbers restarting in April.
   - Period-mismatch bills are never planted in the last month.
   - `sales.csv` gives monthly output tax, so net GST payable stops being a constant.
2. `tools/eval.js` runs **the same `engine.js`** over the test set → `data/eval.json`: per-type precision / recall / F1, ₹-weighted recall, trap false positives, runtime.
3. Accuracy card in the UI reads `data/eval.json` (inlined as `data/eval.js` so `file://` works). Header: "Measured on our synthetic test set".

**Done when**
- [ ] `node tools/gen.js && node tools/eval.js` runs in under a minute
- [ ] Every planted type has recall reported. Any type under 90% is either fixed or shown honestly
- [ ] The Accuracy card renders in both themes

**If late:** ship the demo month without the accuracy card, and say "accuracy table in the final" in the video.

---

## Phase 4: Upload flow
**Owner:** Arihant · **Branch:** `phase-4-upload` · **Cut-off:** 22:45 · **Files:** `index.html`
**Depends on:** Phase 2 (Phase 3 provides the demo CSVs; until then, CSVs exported from SEED work)

Tasks
1. The drop zone accepts books, 2B, bank and sales CSVs (detected by header row). Parsing happens in the browser, with no server.
2. Parse → validate (GSTIN checksum, dates, numbers) → `runEngine` → render. Row-level errors go into a toast, never a crash.
3. A "Load demo month" button does the same with the bundled files, as a backup if drag-and-drop misbehaves while recording.
4. Sources cards show real row counts from the upload.

**Done when**
- [ ] Dropping the 4 demo CSVs reproduces the same issues as `data/demo.js`
- [ ] A malformed CSV shows an error and the previous data stays
- [ ] Upload → Chaos → Reset → Upload works

**If late:** skip it. The video starts from the already-loaded dashboard.

---

## Phase 5: Chaos Mode trap
**Owner:** Arihant · **Branch:** `phase-5-trap` · **Cut-off:** 22:45 · **Files:** `index.html`
**Depends on:** Phase 2

Tasks
1. New break "Reformat the invoice number (should NOT be flagged)", e.g. `ASH-0563` → `ASH/563` in 2B.
2. Scoreboard: Planted / Caught / Missed / **Correctly ignored**. A trap that gets flagged counts as a **false alarm**.
3. Toast: "Still matched. No false flag."

**Done when:** the trap stays quiet on all clean bills, and the real breaks are still caught.

---

## 22:45 Freeze and bug bash (15 min)
- Every Chaos break × every clean bill. Upload → Reset → Upload. Both themes. Recording window size. Zero console errors.
- Merge only green phases to `main`. Tag `video-cut`.

---

## Phase 6: Video and submission
**Owner:** Mahatva records and narrates, Arihant drives the screen · **Cut-off:** **01:00 submitted**

| Time | Say | Show |
|---|---|---|
| 0:00-0:20 | One accountant, ~2,000 bills a month, books vs GSTR-2B vs bank. If the claim exceeds 2B beyond a threshold, a DRC-01C notice follows, and not responding can block the next GSTR-1 | Deck slide 2 |
| 0:20-0:35 | Existing tools match books with 2B. Rekora adds payment evidence and a ₹-ranked review workflow. Rules compute, a human decides | Deck slide 4 |
| 0:35-0:50 | Upload books, 2B, bank → reconciled *(Phase 4)* | App |
| 0:50-1:20 | Buckets and net cash payable → top ₹ issue → evidence side by side → IMS advice → decide, totals move → Hindi follow-up | App |
| 1:20-1:50 | Chaos: break a bill → caught in X ms. Trap: reformat an invoice → correctly ignored *(Phase 5)* | App |
| 1:50-2:10 | Accuracy on our synthetic test set *(Phase 3)* | App |
| 2:10-2:20 | For every questionable invoice: the evidence, the ₹ at stake and a documented decision | App |

Skip any row whose phase didn't ship. Never narrate a feature that isn't on screen.
- 23:00 dry run with a timer. 23:20 record (max 3 takes). 00:00 trim.
- **00:30 upload** (Drive "anyone with link" or YouTube unlisted). Test it in incognito.
- **01:00 submit.** The 30-minute buffer is not build time.

---

## Phase 7: Finals hardening (if shortlisted)
**Owner:** both, sleeping in shifts (03:00-05:30 / 05:30-08:00) · **Cut-off:** 08:00 code freeze

| # | Task | Owner |
|---|---|---|
| 7.1 | Fix every bug noted during the bug bash and recording | Arihant |
| 7.2 | Finish any phase 3-5 that was cut | Arihant |
| 7.3 | Self-host the Eczar and Mukta woff2 fonts (venue wifi) | Arihant |
| 7.4 | Deck: slide 7 "prototype vs production"; delete "every Confirm tunes thresholds"; slide 9 measured numbers; "Potential credit to review"; corrected portal answer; one accuracy slide | Mahatva |
| 7.5 | Rehearse the live demo 5 times in a row without a failure. Prep the Q&A below | both |

**Done when:** 5 clean rehearsals, the deck matches the app exactly, and the app is saved offline on both laptops.

---

## Phase 8: Optional ML (only if Phase 7 is done by 06:00)
**Owner:** Arihant · **Files:** `ml/benford.py`, `ml/iforest.py` → `data/flags.js`
1. Benford's law on the **whole ledger** (not per supplier), shown as one chart.
2. Isolation Forest as an offline Python step over the test set. It writes per-bill flags with the top-2 features in plain words, and the UI shows them as "Review" items.
- Mention ML in the pitch **only** if this is on screen. Otherwise it's roadmap.

**Roadmap only (say so if asked):** React, FastAPI, Postgres, Docker, LLM copilot with verifier, PDF/WhatsApp ingest, credit notes, blocked credits, reverse charge, imports, TDS.

---

## Q&A answers
- *Doesn't GSTN already do this?* GSTN offers a 2B vs purchase-register matching tool. Rekora adds the bank leg (payments, 180-day, split and combined payments), ranks by ₹ and records a decision on every item.
- *Is a bill in 2B but not in your books free credit?* No. It's potential credit to review. Being in 2B doesn't prove eligibility.
- *Missing supplier filing = fraud?* No. It's a follow-up issue. A repeated pattern raises review priority.
- *Rate check after 22 Sep 2025?* The change is real but has exceptions, so we check only a small demo rate master.
- *Is the accuracy real?* It's measured on our synthetic test set with ground truth and traps, using the same engine as the dashboard.
- *How do you know who a bank payment went to?* The supplier name in the narration, plus amount and date. Ambiguous cases go to a person.
- *Where's the AI?* Rules-first on purpose: every rupee is deterministic. ML scoring and LLM explanations are the next layer, and they never compute a rupee.

## Open items
- [ ] Mahatva pulls `main` and confirms (Phase 0)
- [ ] Google Form link open in a tab
- [ ] Travel time to NSUT Dwarka (sets the Phase 7 freeze)
