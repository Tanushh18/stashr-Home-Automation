# My bills

Bills (electricity, water, gas, broadband, DTH, credit card...) with a bill date, a due date, the consumer / customer number, an amount if known and a monthly-repeat flag.

## What it does

| Where | What |
| --- | --- |
| Website → **My bills** (sidebar) | Add, edit, delete; sorted by due date; overdue and due-soon rows are highlighted; "Mark paid" / "Undo". |
| Banner at the top of every page | Bills overdue or due within N days (default 3, changeable on the Bills page). "Hide until tomorrow" brings it back the next day (remembered in this browser only). |
| Money tab | A "Bills to pay" card. "Mark paid" there is the same action as on the Bills page, so the bill is updated too. |
| Paying a bill | Adds a **Debit** to Money (category "Bills & Recharge", method "Bill", confirmed) dated today or the date you give, and marks the bill paid. A monthly bill creates next month's bill. "Undo" removes the Money entry. The account number is **not** copied to Money. |
| Telegram | Once a day, from 09:00 India time, one note listing bills that are overdue or due within 3 days (sent by the 1-minute home sweep, `utils/homeSweep.js` → `utils/bills.js dailyNote`). It never contains the account number. A failed send is retried later the same day. |
| Android app | A banner on the vault home and a "Bills to pay" list with "Mark paid" on the Money screen. |

Server: `server/models/bill.js`, `server/utils/bills.js`, `server/router/bills.js` (`/bills`, `/bills/due`, `/bills/:id/pay`, `/bills/:id/unpay`, `/bills/read`). Tests: `server/tests/bills.test.js`.

## Privacy

The consumer / customer number and the notes are sealed with the account's own data key (the same envelope encryption as the vault and the Money list: `getDataKey()` + `sealJSONWithKey`). Name, dates, amount and status stay readable so the list can sort and remind. The account number is never logged, never in the banner list (`/bills/due`), never in Telegram and never in Money. Provider passwords are never asked for or stored.

## Getting a bill without typing it: what is feasible

What is built: **"Fill from a bill"** on the add form. Paste the bill email or SMS text, or choose the bill PDF; Stashr reads the amount, due date, bill date and consumer number and fills the form. You check it and press Save. Nothing is stored until you save, and the PDF is read in memory only (password-protected PDFs take their password once, in a header, not kept). It reads the usual labels ("Total Payable Amount", "Amount payable", "Due date", "Pay by", "Bill (issue) date", "K No. / Consumer No. / Customer ID / Account no."). Scanned bills (pictures) have no text and are refused with a clear message. If a layout is not understood, the form simply stays empty for that field.

What I did **not** build, and why (from general knowledge of these systems; I did not test any provider's site):

| Option | Verdict |
| --- | --- |
| **BBPS / Bharat Connect** (the national bill system run by NPCI Bharat BillPay) | The real "fetch my bill by consumer number" API. But it is open only to certified operating units (banks, payment apps, aggregators) who are onboarded and audited; an individual cannot call it. Practical routes: a licensed aggregator's paid bill-fetch API (per-call fee, KYC, a business entity), or just paying through a BBPS-enabled app. Not realistic for a personal tool. |
| **Provider website / app (DHBVN, other boards, DTH, broadband)** | Many let you look up a bill by consumer number, but behind a captcha or OTP and with no public API. Automating that is scraping, breaks often and usually violates the terms of use; with a login it means storing provider passwords. **Deliberately not done.** |
| **Provider's official API** | Almost no consumer-level APIs exist for Indian utilities. Some large providers (telecom, some credit cards) offer partner APIs for businesses only. |
| **Bill email from Gmail** | Most providers email the bill (often with a PDF). A Gmail connector with read-only access, filtering a label such as "Bills", could read the email and run the same parser. Feasible and the best next step. Cost: Google OAuth setup, and the Gmail read scope is a "restricted" scope that needs Google's app verification for public apps (a personal app in test mode works for one user, with 7-day token expiry unless published). Not built here. |
| **SMS on the phone** | The Android app already reads bank SMS for Money. Utilities and card issuers send "bill of Rs X due on D" SMS; the same permission could feed `parseBillText`. Feasible, but SMS formats vary widely, so each sender would need rules and a confirm step. Not built here. |
| **Forward the email to Stashr** | Would need an inbound mail address (a mail service with inbound webhooks) and anti-abuse checks. Possible later; the paste box is the zero-infrastructure version. |
| **Account Aggregator (RBI AA framework)** | Covers bank, deposit, mutual fund and similar financial data, not utility bills. |

## Notes and limits

- Dates are India time (IST) for the server, banner counts and Telegram. The "hide until tomorrow" day is the browser's local day.
- A bill's amount may be unknown; then "Mark paid" asks for the amount.
- Money keeps only the last 4 months, so a payment date older than that is refused for Money.
- Marking a Money entry as deleted elsewhere does not un-pay the bill; use "Undo" on the bill.
