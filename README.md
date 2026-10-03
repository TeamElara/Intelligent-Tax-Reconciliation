# Rekora

**Every GST mismatch across your books, GSTR-2B and bank, priced in ₹ and explained, before the department finds it.**

Team Elara (Arihant Jain, Mahatva Goel) · Fintechstico'26 · Problem Statement 2: Intelligent Tax Reconciliation

Rules compute. ML flags. A human decides.

## What it does

An accountant gets three records that never agree: the purchase register, the GSTR-2B the portal generates from suppliers' filings, and the bank statement. Rekora reconciles all three and turns the differences into a list ranked by rupees:

| Bucket | Meaning |
|---|---|
| **ITC at risk** | In your books, not backed by GSTR-2B. Chase the supplier before you claim |
| **Potential credit to review** | In GSTR-2B, not in your books. Check it, then book it |
| **ITC to reverse** | Unpaid 180+ days, duplicated, wrong rate or wrong tax type |

Pick any issue to see books, GSTR-2B and bank side by side, the reason in plain English, IMS advice (accept / pending / reject) and the action. Every decision is logged with its evidence and its effect on the claim, and can be exported.

## Try it

No install, no build step.

```bash
node tools/serve.js 8765     # then open http://localhost:8765
```

or open `index.html` directly. It starts on a bundled demo month (a fictional distributor, September 2026).

- **Upload your own:** drop the purchase register, bank statement and sales register as CSV and GSTR-2B as CSV or the portal JSON. Column names are matched loosely. Everything is read in the browser and nothing is uploaded. `data/demo/` has a complete set to try.
- **Chaos Mode:** break a clean bill in six ways and watch the engine catch it, or reformat an invoice number and watch it correctly stay quiet.
- **Ask Rekora:** questions about the reconciled data. Every ₹ figure in an answer is checked against engine output.

## What is checked

13 error types: missing in GSTR-2B, missing in books, amount mismatch, tax arithmetic, GSTIN typo (checksum), wrong rate (date-aware, including the 22 Sep 2025 slab change), wrong tax type (IGST vs CGST + SGST from state codes), duplicates, unpaid 180+ days (reversed in proportion, with interest), split payments, combined payments, double payments, and unusual bills.

Invoice numbers are matched on letters, separators and zero-padding but never on digits, so INV/0042 = INV-42 and AW-0442 ≠ AW-0443. Uncertain matches (GSTIN typos, split and combined payments) always go to a person instead of being accepted automatically.

**Anomaly model:** an Isolation Forest over five bill features raises "unusual bill" review items with plain-language reasons. Benford's first-digit test runs on the whole ledger and says "not applicable" when the bills do not span enough orders of magnitude. The model flags for review only and never changes a rupee figure.

## How well does it work

Measured on a synthetic test set with ground truth: 300 suppliers, 12 states, Apr 2025 to Sep 2026, 38,526 books, 3,197 planted errors and 28,777 "trap" bills that look different but are correct (invoice-format variants, ₹1 rounding, recurring same-amount bills, pre-switch rates, financial-year restarts, generic bank narrations).

| | |
|---|---|
| Recall / precision on planted errors | 100% / 100% |
| ₹-weighted recall | 100% |
| Trap bills wrongly flagged | 0 of 28,777 |
| Anomaly model | 137 of 137 planted unusual bills found, 2.0% of bills flagged |
| Engine speed (Node) | ~38,500 books in a few seconds |

**Read this honestly.** The generator and the engine were written by the same team, and the errors follow the rules the engine implements. These numbers show the engine is consistent with its own specification and fast. They do not predict the score on real books, which will contain patterns we have not seen. Building the generator already exposed real bugs (payee matching between similar supplier names, late payments matched to the wrong same-amount bill), which is what it is for. The next step is a pilot on real exports.

Reproduce everything:

```bash
node tools/gen.js            # generate data/demo and data/test (seeded)
node tools/eval.js           # score engine.js and ml.js against the labels
node tools/check-seed.js     # engine on the built-in sample
node tools/check-upload.js   # demo CSVs and portal JSON give the same issues as the bundled data
node tools/check-trap.js     # reformatted invoice numbers never raise a flag
node tools/check-ml.js       # anomaly model on the demo month
```

## How it is built

A static browser app in vanilla JavaScript, so it runs on any laptop and sensitive financial data never has to leave it.

- `engine.js`: deterministic matching and GST rules. Used by the dashboard and the Node tools alike, so the accuracy numbers are the demo's own numbers.
- `ingest.js`: CSV and GSTR-2B JSON parsing, column mapping, row validation, supplier resolution.
- `ml.js`: Isolation Forest and Benford.
- `index.html`: dashboard, evidence panel, Chaos Mode, decision log, Ask Rekora.
- `tools/`: generator, evaluator, checks.

## Not built yet

React, a FastAPI service, a database, a hosted LLM copilot (Ask Rekora answers from templates over engine output), SHAP (the model's reasons come from leave-one-feature-out attribution), credit notes, blocked credits, reverse charge, imports and TDS. The rate check uses a small demo rate master of identified products, not the full tariff. Synthetic data only.
