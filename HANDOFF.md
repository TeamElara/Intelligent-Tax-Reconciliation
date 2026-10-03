# Rekora: project handoff

Read this first, then PLAN.md (the time-boxed build plan, supersedes "Next steps" below). Product name is **Rekora** (Team Elara: Arihant Jain, Mahatva Goel); the UI still says Rekora until the rebrand lands.

Repo: github.com/TeamElara/Intelligent-Tax-Reconciliation. (name ends with a period; PUBLIC). Python 3.9 venv in `.venv`.

## What this is
Rekora is our entry for **Fintechstico v7.0 (Consilium'26, NSUT)**, Problem Statement 2: Intelligent Tax Reconciliation. Team of two, building for the full 24 hours, goal is to win.

One-liner: every GST mismatch across purchase books, GSTR-2B and bank, found, priced in ₹ and explained, before the department finds it.
Design rule (say it in the pitch): **Rules compute. ML flags. The LLM explains. A human decides.**

## Working style
- Be blunt and direct. Short replies (3-4 lines) unless the task needs more.
- Business/GST knowledge on the team is low. Explain GST terms in plain words when they come up.
- Call it out directly if the build stalls around 80%. Chaos Mode is the demo moment and must work first.

## Files
- `index.html`: the full front-end prototype. One file, vanilla JS, no build step. Open it in a browser.
  - Fonts: Eczar (display and ₹ figures) + Mukta (UI, has Devanagari for Hindi drafts), loaded from Google Fonts.
  - Dark "ledger ink" theme by default, light "ledger paper" theme via the toggle.
- Also produced in chat (not in this folder): `Elara_Rekora_Fintechstico.pptx` (19-slide deck), architecture PNG, dashboard mockup PNG, pitch cheat sheet.

## What index.html already does
- **Hero**: ITC waterfall (books → at risk → to reverse → potential credit to review → credit you can defend), net GST payable, three ₹ bucket cards that filter the queue.
- **Engine in JS** (`runEngine`): canonical invoice IDs (INV/0042 = INV-42), GSTIN mod-36 checksum, fuzzy GSTIN-typo match, amount mismatch, tax value check, date-aware rate check (12%/28% scrapped from 22 Sep 2025), IGST vs CGST+SGST from state code, duplicates, missing in 2B / missing in books, 180-day unpaid rule, split payments (subset-sum up to 3 parts), spike detection (>8× supplier median).
- **Issue queue + evidence panel**: books / GSTR-2B / bank side by side, diff cells highlighted, plain-English reason, actions (resolve with undo, ₹ totals update correctly).
- **Chaos Mode** drawer: break a clean bill 6 ways, engine re-runs, new issue appears with "New" badge, scoreboard planted/caught/missed.
- **Ask Rekora** drawer: demo copilot with intent matching over engine output, record chips that jump to the queue, "N figures checked against engine output" badge.
- **Follow-up drafts** in English and Hindi (missing in 2B, tax type, rate, amount), copy button.
- Supplier risk table, Section 49 set-off table by tax head, GSTR-3B draft JSON download, deadlines (draft 2B on 14 Oct, GSTR-3B on 20 Oct), keyboard shortcuts (J/K, /, Ctrl K).

## Data model (top of the script)
- `SEED.suppliers`, `SEED.books`, `SEED.g2b`, `SEED.bank`: sample records for a fictional buyer, Mehta Electricals Pvt Ltd, GSTIN 07AABCM4521K1ZK (Delhi), return period September 2026.
- `BASE`: full-month aggregates (books ITC ₹48.6L, at risk ₹4,12,380, potential credit to review ₹2,36,450, to reverse ₹2,18,600, output tax ₹62L). Bucket totals = BASE + change in open sample issues.
- `HSN`: demo rate master. Label it as demo in the pitch.
- Every rupee on screen comes from the engine. Keep it that way.

## Planned architecture (from the deck)
**Roadmap only; not part of the current prototype:** React + Vite front end, FastAPI + Pydantic, DuckDB/Polars for joins (SQLite in demo), RapidFuzz + SciPy Hungarian for matching, scikit-learn Isolation Forest + SHAP + Benford for anomalies, and an LLM copilot. The current prototype is a static browser app with rule-based reconciliation and intent matching.

## Next steps, in order
1. Port `runEngine` to Python (FastAPI `/reconcile`), keep the same issue schema `{type, sup, bills, impact, ...}` so the UI needs no changes; swap `SEED` for a fetch.
2. Synthetic generator: 300 suppliers, 12 states, ~24,000 bills, Apr 2025 to Mar 2026, 13 planted error types with labels; precision/recall per type + ₹-weighted recall.
3. Isolation Forest + SHAP reasons for the spike/supplier-risk flags.
4. Real copilot on LangGraph + Groq; verifier rejects any ₹ figure not in engine output.
5. Rehearse the Chaos Mode demo until it never fails.

## Known nits
- Google Fonts need internet; at the venue, consider self-hosting the woff2 files.
- Supplier table scrolls horizontally on phones by design.

## Commands (Node 18+, no installs)
- `node tools/check-seed.js`: run the engine on the built-in sample and assert the expected issues.
- `node tools/gen.js`: regenerate `data/demo` (small, one example of every error type) and `data/test` (300 suppliers, 18 months, ~38,500 books; git-ignored, 8 MB). `--seed 42` by default.
- `node tools/eval.js`: score `engine.js` against the labels in `data/test` and write `data/eval.json` and `data/eval.js` (the dashboard's Accuracy section reads the latter).
- `node tools/serve.js 8765`: static server for local preview (`file://` also works).

## What the accuracy numbers mean
The generator plants 13 error types plus "trap" bills (invoice-format variants, ₹1 rounding, recurring same-amount bills, pre-switch rates, financial-year restarts, generic bank narrations) that must stay unflagged. The errors follow the rules the engine implements, so ~100% shows the engine is consistent with its own spec, not that it will score the same on real books. Say so if asked.

## Upload flow (phase 4)
- `ingest.js` parses CSVs in the browser (no server). Column names are matched loosely ("Invoice No.", "Taxable Value", "Narration"...); the file type is detected from its headers. Bad rows are skipped and reported; an unusable file leaves the current data untouched. `node tools/check-upload.js` proves the four demo CSVs give exactly the same issues as the bundled `data/demo.js`.
- The dashboard boots on the bundled demo month (`data/demo.js`). `?demo=seed` shows the older built-in sample, whose headline totals are scaled by `BASE`. "Load demo month" (Sources) restores the demo; Reset returns to whatever was last loaded.
- Totals are derived from the data: ITC in books = tax on bills dated in the return month; output tax = that month's row in the sales file; buckets count issues on that month's bills plus 180-day reversals of any age. Older-month issues stay in the queue with a note.
- Known limits: the return month is the latest month in the files; the buyer's state is inferred from CGST+SGST bills; GSTR-2B is read from CSV, not the portal JSON yet; no sales register means output tax is 0.

## Chaos Mode trap (phase 5)
"Reformat the invoice number" rewrites the GSTR-2B copy of a clean bill with a different separator or zero padding. The pass is silence: the scoreboard's Ignored counter goes up and the toast says "Still matched. No false flag." Any new issue counts as a false alarm instead. It does not use up the clean bill. `node tools/check-trap.js` runs the trap on every clean bill of the sample and demo month (335 bills, 0 false alarms) and confirms that a one-digit change (AW-0442 vs AW/443) is still treated as a different bill.
