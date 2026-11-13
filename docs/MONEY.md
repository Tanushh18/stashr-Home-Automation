# Money: UPI and bank spending, sorted by category

Stashr reads your Federal Bank messages (Android app), sorts every payment into a category (Meta Ads, Food, Groceries…), keeps it, and
shows it month by month on the website (Money) and in the Android app (Settings → Money).

## Where the entries are kept (you choose, on the Money page → Storage)
| | **Stashr storage** (default) | **My Google Sheet only** |
|---|---|---|
| Where | Stashr's database, **each entry encrypted** with your account's own key (the same envelope encryption as the vault). The database can read only the month, the date, the status and a keyed hash of the reference (to skip duplicates). Merchant, amount, reference, balance and category are inside the encrypted part | Only your own Google Sheet. Stashr's database keeps none of the entries |
| Google setup | **None needed.** A sheet is an optional copy | Needed (below) |
| 4-month rule | Each entry is **deleted by the database 120 days after its date** | Rows older than 120 days are **moved** (not deleted) to the sheet's `Archive` tab |
| Sheet | Optional **copy**: new entries, category changes and deletions are also written to your sheet in the background; if Google is down the entry is still saved and the page shows "last N writes to your sheet failed"; *Send the last 4 months to the sheet now* catches up | The sheet is the store |

Switching never moves entries by itself; each place keeps what it has (the page explains this when you switch). In both modes the settings
document holds no transaction data: it has the storage choice, the optional sheet link, your own category rules, the start date, your
account's last digits and when the last message was handled.

## Google Sheet (optional copy, or the only store) — one-time setup (about 10 minutes)
1. **Google Cloud** (console.cloud.google.com): make a project (or use one), *APIs & Services → Library → Google Sheets API → Enable*.
2. *IAM & Admin → Service Accounts → Create*. Name it e.g. `stashr-money`. Open it → *Keys → Add key → JSON* → a file downloads.
3. Put that JSON on **both Render servers** (g305 and xxdr) as the environment variable `GOOGLE_SHEETS_SA_JSON` (paste the JSON, or its
   base64: `base64 -w0 key.json`). Redeploy. Never put this file in git.
4. Make a new Google Sheet. **Share** it with the service account's e-mail (`…@….iam.gserviceaccount.com`) as **Editor**.
5. Stashr website → **Money → Storage**: paste the sheet link, Save (in Stashr-storage mode this is the optional copy; choose *My Google Sheet only* to make
   it the store). Stashr creates the tabs `Transactions`, `Archive` and `Summary` (a ready month × category table built with formulas).
   Without steps 1–5 everything else still works in Stashr storage.
6. Choose **how far back to read your SMS — once**. After that the option disappears; new messages are read from then on.
7. Android app: Money → allow SMS access. On a sideloaded app Android 13+ may first need *Settings → Apps → Stashr → ⋮ → Allow restricted
   settings*, then allow SMS. Tap *Sync now*. From then on the app syncs in the background (about every 15–30 minutes, and whenever you open it).

## What goes in the sheet
Date, Time, Amount, Type (Debit/Credit), Merchant, **Category**, Account (X9229), Method (UPI/ATM/…), **Reference**, Balance, Source (SMS or
Statement), **Status**, Note, Month, SMS received, Flags. The `Summary` tab shows spending per month and category.

## Categories
Built in: Meta Ads, Food, Groceries, Travel, Shopping, Bills & Recharge, Subscriptions, Health, Education, Rent & Home, Investments,
Transfers, Cash, Salary & Income, Other, Uncategorized. "Meta Verifie" (how Federal Bank shortens Meta's name) is Meta Ads. Change a category
once (website or app) with *Remember for this merchant* and every later payment to it is sorted the same way, and the old ones too.

## No fake entries: flagging
Each message is checked. A doubtful one is written as **Flagged**, kept out of the totals, and shown under *Needs checking* with the reasons:
it came from a phone number instead of the bank's sender name; no date or no 12-digit UPI reference; an account that is not yours; a future
date; the arrival time disagrees with the date in the text; an amount over the UPI limit; or the **balance does not follow the previous
transaction** (a message may be missing). You can mark it *genuine* or *delete* it, or let the next statement decide.

## Check with your bank statement (any time, e.g. month end)
Download the statement from Federal net banking as **Excel or CSV** (PDF is not read) and upload it on Money (a locked Excel file asks for its password). Every line is matched by
reference (else amount and day): **Verified**, **Mismatch** (amount differs), lines the sheet missed are **added** (Source: Statement), sheet rows inside
the statement's dates that the bank does not show are **Not in statement**, and the statement's own running balance is checked for breaks.
A flagged row that the statement confirms becomes Verified.

**Locked statements.** An Excel file protected with a password (File > Info > Protect Workbook, or one the bank sends locked) is opened by
asking for its password on the Money page: pick the file, type the password, *Unlock and check*. A wrong password says so and lets you try
again. The password is sent once (in a request header, never the address), used to open the file in memory and is **not stored or logged**.
Both Excel lock types are supported (Excel 2010 and newer "Agile", and the Excel 2007 / LibreOffice "Standard"). A locked **PDF** still
cannot be read: download the Excel or CSV version.

**Month to match.** Before uploading, choose *Month to match* (the last 7 months) to use only that month's lines of the statement: only that
month's entries are checked and corrected, and a statement with nothing in that month is explained instead of silently doing nothing.
*Whole statement* (the default) uses every line, as before.

## Search your saved statements
Every statement you check is kept so it can be searched later (Money → *Search your saved statements*): type a name (small spelling slips are
fine: "rmesh kumr" finds "Ramesh Kumar", "meta verify" finds "Meta Verifie"), an amount (`1200`, `₹1,200.50`), a range (`500-2000`, `>5000`,
`<300`), part of a reference number (9 digits or more), or a name with an amount (`ramesh 350`). Filter by month, and delete a saved statement
when you do not want it kept.
- **What is kept:** the lines of the statement (date, text, amount, balance, reference), not the file. Each line's text, amount, balance and
  reference are **encrypted with your account's own key**, like Money entries; only the date and month stay readable.
- **How long:** until you delete the statement. There is no 4-month expiry on saved statements (the Money entries still follow the 4-month rule).
- **Sheet-only mode:** the lines are still kept (encrypted) in Stashr's database, because searching needs them there. Delete a saved statement to remove them.
- Uploading an overlapping statement again does not double the lines: shared lines move to the newest upload.

## Keeping 4 months
Each entry stays for 4 months (120 days after its date). In **Stashr storage** the database then deletes it (a message older than 4 months
read during the first sync is not kept; the statement check also looks only at the last 4 months). In **sheet only** mode older rows are
**moved, not deleted,** to the `Archive` tab once a day, and old messages from the first sync go straight there.

## Limits
- Only Federal Bank message formats are known (debit and credit via UPI, plus common IMPS/NEFT/ATM wording). A message the parser can't read
  is counted as "not understood" with its first words shown — send an example and the parser gets extended.
- The bank shortens names ("Meta Verifie"); person-to-person payments stay *Uncategorized* until you give them a category.
- SMS reading works only on Android, and only while you allow it. Nothing is read before the start date.
- In sheet-only mode reading the sheet takes a moment; the list is cached for under a minute.
- The app (2.5.0 and later) works with both modes unchanged: it only talks to the Stashr API, and an entry's `index` is just an opaque id.
