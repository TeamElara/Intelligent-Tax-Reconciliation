# Rekora website prototype

Open `index.html` in a browser. The site is a local, working demo with a landing page, demo sign-in, three-file CSV upload, invoice matching, an evidence queue, review decisions, a live test and CSV export. It does not need a server or an account. The sign-in stores only the entered name for the current browser session and is not authentication.

## Quick demo

1. Choose **Explore the working demo**.
2. Enter any name and email address, then continue.
3. Choose **Load demo records** to see the prepared sample.
4. Select a case, inspect the source rows and mark it reviewed.
5. Try the live test with a changed GST amount, then a harmless invoice-number reformat.

The three sample CSV files in `data/` can also be uploaded through the three file controls. Uploaded files stay in the browser and are not sent to a service.

## CSV format

Books and GSTR-2B: `supplier,gstin,invoice,date,taxable,cgst,sgst,igst`.

Books may additionally include `rate,hsn,claimed`. Bank: `supplier,date,amount,reference`. Dates use `YYYY-MM-DD`. The upload parser accepts common header variants such as `supplier name`, `invoice number`, `taxable value`, `payee`, and `narration`.

## Scope

The active website uses a small browser-side matching engine for the prototype. It matches GSTIN and normalised invoice numbers, checks differences and duplicates, and links clear single or two-part payments. Ambiguous and legal eligibility decisions stay with a human. The original dashboard remains in the repository's Git history. The website does not file returns, validate every GST rule, or provide production security.
