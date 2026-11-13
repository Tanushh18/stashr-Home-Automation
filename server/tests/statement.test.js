// The bank statement is the source of truth: reading it (CSV and Excel, any common layout) and making the stored entries agree with it.
// Pure functions only (no database), so this file runs on its own: node --test tests/statement.test.js
const { describe, test } = require("node:test");
const expect = require("./expect");
const zlib = require("zlib");
const ex = require("../utils/expenses");
const kit = require("../utils/statementKit");

/* a small .xlsx writer: numbers stay numbers, text is inline */
function makeXlsx(table) {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const cell = (c, i, j) => { const ref = `${String.fromCharCode(65 + j)}${i + 1}`; return typeof c === "number" ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`; };
    const sheet = `<worksheet><sheetData>${table.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cell(c, i, j)).join("")}</row>`).join("")}</sheetData></worksheet>`;
    const data = Buffer.from(sheet), comp = zlib.deflateRawSync(data), name = Buffer.from("xl/worksheets/sheet1.xml");
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(0, 42);
    const cd = Buffer.concat([c, name]), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
    return Buffer.concat([local, name, comp, cd, end]);
}

/* stored entries as the stores hold them */
const entry = (index, o) => ({ index, date: o.date, time: o.time || "", amount: o.amount, type: o.type || "Debit", merchant: o.merchant ?? "", category: o.category || "Uncategorized", account: "X9229", method: o.method || "UPI",
    ref: o.ref || "", balance: o.balance ?? null, source: o.source || "SMS", status: o.status || "Unverified", note: o.note || "", month: o.date.slice(0, 7), received: "", flags: o.flags || [] });

/* what the stores do with a reconcile result, so a second upload can be tried on the outcome of the first */
function apply(rows, res) {
    const out = rows.map((r) => { const u = res.updates.find((x) => x.index === r.index); return u ? { ...r, ...u.fields, month: (u.fields.date || r.date).slice(0, 7) } : r; });
    res.additions.forEach((a, i) => out.push(ex.makeTx(a, a.category, "Statement", "Verified", "Added from your statement (no message was found)", 0, []) && { ...ex.makeTx(a, a.category, "Statement", "Verified", "", 0, []), index: 1000 + i }));
    return out;
}

describe("reading the file", () => {
    test("the delimiter is found from the file: comma, semicolon, tab and pipe", () => {
        expect(kit.sniffDelimiter("a,b,c\n1,2,3\n4,5,6")).toBe(",");
        expect(kit.sniffDelimiter("a;b;c\n1;2;3\n4;5;6")).toBe(";");
        expect(kit.sniffDelimiter("a\tb\tc\n1\t2\t3\n4\t5\t6")).toBe("\t");
        expect(kit.sniffDelimiter("a|b|c\n1|2|3\n4|5|6")).toBe("|");
        // a comma inside the narration of a semicolon file does not split a column
        expect(kit.parseDelimited("Date;Particulars;Amt\n01-08-2026;UPI/DR/1, SWIGGY;50\n02-08-2026;ATM;100")[1]).toEqual(["01-08-2026", "UPI/DR/1, SWIGGY", "50"]);
        // quoted cells keep their commas, quotes and line breaks
        expect(kit.parseDelimited('a,b\n"x, ""y""","line1\nline2"')[1]).toEqual(['x, "y"', "line1\nline2"]);
    });

    test("numbers: Indian grouping, Rs/₹, Dr/Cr, brackets, empty cells", () => {
        expect(kit.money("1,23,456.78")).toBe(123456.78);
        expect(kit.money("₹ 1,000.00 Cr")).toBe(1000);
        expect(kit.money("2,507.75 Dr")).toBe(-2507.75);
        expect(kit.money("(300.00)")).toBe(-300);
        expect(kit.money("")).toBeNull();
        expect(kit.money("-")).toBeNull();
        expect(kit.money("n/a")).toBeNull();
        expect(kit.money(42.5)).toBe(42.5);
    });

    test("a statement with notes above the table, a value-date column and a transaction id", () => {
        const csv = ["Federal Bank,,,,,,", "Account Number,X9229,,,,,", "Date,Value Date,Particulars,Tran ID,Withdrawals,Deposits,Balance",
            "03-08-2026,03-08-2026,UPI/DR/111111111111/SWIGGY/s@ybl,S1,\"1,250.00\",,\"8,750.00\"",
            "04-08-2026,04-08-2026,UPI/CR/222222222222/RAHUL K/x@ybl,S2,,\"2,000.00\",\"10,750.00\""].join("\n");
        const rows = ex.statementRows(ex.parseCsv(csv));
        expect(rows).toEqual([
            { date: "2026-08-03", desc: "UPI/DR/111111111111/SWIGGY/s@ybl", amount: 1250, type: "Debit", balance: 8750, ref: "111111111111" },
            { date: "2026-08-04", desc: "UPI/CR/222222222222/RAHUL K/x@ybl", amount: 2000, type: "Credit", balance: 10750, ref: "222222222222" }]);
    });

    test("one Amount column with a Dr/Cr column, and a signed Amount column", () => {
        const withDc = ["Txn Date,Description,Amount,Dr/Cr,Closing Balance", "05/08/2026,UPI/DR/333333333333/ZOMATO/z@ybl,300.00,DR,700.00", "06/08/2026,UPI/CR/444444444444/MOM/m@ybl,500.00,CR,1200.00"].join("\n");
        const a = ex.statementRows(ex.parseCsv(withDc));
        expect(a.map((x) => [x.type, x.amount, x.balance])).toEqual([["Debit", 300, 700], ["Credit", 500, 1200]]);
        const signed = ["Date,Narration,Amount,Balance", "05-08-2026,SWIGGY,-300.00,700.00", "06-08-2026,SALARY,500.00,1200.00"].join("\n");
        expect(ex.statementRows(ex.parseCsv(signed)).map((x) => [x.type, x.amount])).toEqual([["Debit", 300], ["Credit", 500]]);
    });

    test("a narration that runs onto the next row is joined; opening, closing and total rows are not payments", () => {
        const csv = ["Date,Particulars,Withdrawals,Deposits,Balance", ",Opening Balance,,,5000.00",
            "10-08-2026,UPI/DR/555555555555/MEESHO TECHNOLOGIES,100.00,,4900.00", ",PRIVATE LIMITED/ICIC/meesho@ybl,,,",
            "11-08-2026,ATM WDL,500.00,,4400.00", ",Total,600.00,0.00,", ",Closing Balance,,,4400.00"].join("\n");
        const rows = ex.statementRows(ex.parseCsv(csv));
        expect(rows.length).toBe(2);
        expect(rows[0].desc).toBe("UPI/DR/555555555555/MEESHO TECHNOLOGIES PRIVATE LIMITED/ICIC/meesho@ybl");
        expect(kit.describeLine(rows[0].desc).merchant).toBe("Meesho Technologies Private Limited");
    });

    test("a statement listed newest first is turned round, even when it is all one day", () => {
        const newest = ["Date,Particulars,Withdrawals,Deposits,Balance", "12-08-2026,UPI/DR/666666666666/C,10.00,,60.00", "11-08-2026,UPI/DR/777777777777/B,20.00,,70.00", "10-08-2026,UPI/CR/888888888888/A,,90.00,90.00"].join("\n");
        expect(ex.statementRows(ex.parseCsv(newest)).map((x) => x.date)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
        const oneDay = ["Date,Particulars,Withdrawals,Deposits,Balance", "12-08-2026,UPI/DR/666666666666/C,10.00,,60.00", "12-08-2026,UPI/DR/777777777777/B,20.00,,70.00", "12-08-2026,UPI/CR/888888888888/A,,90.00,90.00"].join("\n");
        const r = ex.statementRows(ex.parseCsv(oneDay));
        expect(r.map((x) => x.ref)).toEqual(["888888888888", "777777777777", "666666666666"]);       // the order the balance follows
        expect(ex.reconcile([], r, []).report.balanceBreakCount).toBe(0);
    });

    test("Excel: numbers, Excel serial dates and text cells", () => {
        // 46237 = 2026-08-03 as an Excel serial date
        const xlsx = makeXlsx([["Date", "Particulars", "Withdrawals", "Deposits", "Balance"], [46237, "UPI/DR/999999999999/SWIGGY", 250.5, "", 1000], [46238, "UPI/CR/101010101010/RAHUL", "", 100, 1100]]);
        const rows = ex.statementRows(ex.parseXlsx(xlsx));
        expect(rows.map((x) => [x.date, x.type, x.amount, x.balance])).toEqual([["2026-08-03", "Debit", 250.5, 1000], ["2026-08-04", "Credit", 100, 1100]]);
    });

    test("something that is not a statement is refused with a clear message", () => {
        expect(() => ex.statementRows([["nothing", "here"]])).toThrow(/Could not find the table/);
    });
});

describe("headlines", () => {
    test("the payee is found in the usual narrations", () => {
        const h = (d) => kit.describeLine(d);
        expect(h("UPI/DR/629482059838/META VERIFIE/UTIB/fb@ybl/Payment f")).toEqual({ method: "UPI", merchant: "Meta Verifie" });
        expect(h("UPI IN/613245678901/Zomato/ybl-zomato@ybl").merchant).toBe("Zomato");
        expect(h("TO TRANSFER-UPI/DR/666666666666/ZUDIO A UNIT/YESB/zudio@ybl").merchant).toBe("Zudio A Unit");
        expect(h("UPI/DR/111111111111/9717621793@paytm").merchant).toBe("9717621793@paytm");   // only a UPI id is given: it is the headline
        expect(h("NEFT-FDRLN26101234567-MUKTA CHAWLA-FDRL0001234")).toEqual({ method: "NEFT", merchant: "Mukta Chawla" });
        expect(h("POS/AMAZON/MUMBAI")).toEqual({ method: "POS", merchant: "Amazon" });
        expect(h("ECOM PUR/FLIPKART/BANGALORE").merchant).toBe("Flipkart");
        expect(h("ATM WDL 1234 SOME BRANCH")).toEqual({ method: "ATM", merchant: "ATM withdrawal" });
        expect(h("SMS CHARGES FOR OCT")).toEqual({ method: "Other", merchant: "Bank charges" });
    });
    test("the statement fixes a poor headline, keeps a good one, and shows both when they really differ", () => {
        expect(kit.betterName("unknown", "Rahul K")).toBe("Rahul K");
        expect(kit.betterName("919310994032", "Parveen Chawla")).toBe("Parveen Chawla");
        expect(kit.betterName("Meesho Techn", "Meesho Technologies Private Limited")).toBe("Meesho Technologies Private Limited");
        expect(kit.betterName("Swiggy", "")).toBe("Swiggy");
        expect(kit.betterName("Meesho Technologies Private Limited", "Meesho Techn")).toBe("Meesho Technologies Private Limited");   // the message's name is the fuller one: kept
        // two really different names for the payee: both are shown, so the owner can see which is better
        expect(kit.betterName("Meta Verifie", "Facebook India")).toBe("Facebook India (Meta Verifie)");
        expect(kit.betterName("9717621793@paytm", "Rahul K")).toBe("Rahul K (9717621793@paytm)");
        expect(kit.betterName("Rahul K", "9717621793@paytm")).toBe("Rahul K (9717621793@paytm)");
        // a second upload does not pile the name up again
        expect(kit.betterName("Facebook India (Meta Verifie)", "Facebook India")).toBe("Facebook India (Meta Verifie)");
    });
});

describe("how much of a statement is taken", () => {
    const lines = [{ date: "2026-05-10" }, { date: "2026-07-20" }, { date: "2026-08-02" }, { date: "2026-08-03" }, { date: "2026-10-30" }];
    test("nothing before the start date, and in Stashr storage nothing older than the 4-month limit", () => {
        const r = ex.limitStatement(lines, { startDate: "2026-08-03", cutoff: "2026-07-06", keepsOld: false });
        expect(r.kept.map((x) => x.date)).toEqual(["2026-08-03", "2026-10-30"]);
        expect(r.beforeStart).toBe(3); expect(r.tooOld).toBe(0);
        // the 4-month rule can be the tighter one when the start date is older
        const tight = ex.limitStatement(lines, { startDate: "2026-01-01", cutoff: "2026-07-06", keepsOld: false });
        expect(tight.kept.length).toBe(4); expect(tight.tooOld).toBe(1);
    });
    test("with the Google Sheet only the start date applies (older rows go to its Archive tab)", () => {
        const r = ex.limitStatement(lines, { startDate: "2026-01-01", cutoff: "2026-07-06", keepsOld: true });
        expect(r.kept.length).toBe(5); expect(r.tooOld).toBe(0);
    });
    test("no start date and nothing to cut: everything is taken", () => {
        expect(ex.limitStatement(lines).kept.length).toBe(5);
    });
});

describe("the statement is the truth", () => {
    const csv = ["Date,Particulars,Withdrawals,Deposits,Balance",
        "30-09-2026,UPI/DR/100000000001/MEESHO TECHNOLOGIES PRIVATE LIMITED/ICIC/m@ybl,100.00,,9900.00",
        "01-10-2026,UPI/DR/100000000002/META VERIFIE/UTIB/fb@ybl,200.00,,9700.00",
        "01-10-2026,UPI/DR/100000000003/META VERIFIE/UTIB/fb@ybl,200.00,,9500.00",
        "02-10-2026,UPI/CR/100000000004/RAHUL K/x@ybl,,1500.00,11000.00",
        "03-10-2026,ATM WDL 1,500.00,,10500.00"].join("\n");
    const stmt = () => ex.statementRows(ex.parseCsv(csv));

    test("a paired entry takes the statement's date, amount, name and balance, and is verified", () => {
        const rows = [
            entry(2, { date: "2026-09-30", amount: 100, merchant: "Meesho Techn", ref: "", status: "Flagged", flags: ["No reference number"] }),          // cut-off name, no reference
            entry(3, { date: "2026-09-30", amount: 200, merchant: "Meta Verifie", ref: "100000000002", status: "Flagged", flags: ["Balance 9700 does not follow the previous one"] }),   // a day off
            entry(4, { date: "2026-10-02", amount: 1400, type: "Credit", merchant: "unknown", ref: "100000000004", status: "Flagged", flags: ["x"] })];       // wrong amount, unknown payee
        const { updates, additions, report } = ex.reconcile(rows, stmt(), []);
        const u = (i) => updates.find((x) => x.index === i);
        expect(u(2).status).toBe("Verified");
        expect(u(2).fields.merchant).toBe("Meesho Technologies Private Limited");
        expect(u(2).fields.ref).toBe("100000000001");                                  // the entry had no reference; it takes the statement line's
        expect(u(2).fields.balance).toBe(9900);
        expect(u(2).fields.flags).toEqual([]);
        expect(u(3).fields.date).toBe("2026-10-01"); expect(u(3).fields.month).toBe("2026-10");
        expect(u(4).fields.amount).toBe(1500); expect(u(4).fields.merchant).toBe("Rahul K");
        expect(u(4).note).toMatch(/amount 1400 → 1500/);
        expect(additions.length).toBe(2);                                                // the second Meta payment and the ATM line
        expect(additions.map((a) => a.counterparty)).toEqual(["Meta Verifie", "ATM withdrawal"]);
        expect(report.mismatched).toBe(1); expect(report.verified).toBe(2); expect(report.renamed).toBe(2);
    });

    test("two payments of the same amount on the same day stay two payments (no duplicate, nothing lost)", () => {
        const rows = [entry(2, { date: "2026-10-01", amount: 200, merchant: "Meta Verifie", ref: "100000000002" })];
        const { updates, additions } = ex.reconcile(rows, stmt(), []);
        expect(updates.filter((x) => x.status === "Verified").length).toBe(1);
        expect(additions.filter((a) => a.amount === 200).length).toBe(1);
    });

    test("two different payments that happen to cost the same are not mixed up (different references)", () => {
        const rows = [entry(2, { date: "2026-10-01", amount: 200, merchant: "Someone", ref: "999999999999", status: "Flagged" })];
        const { updates, additions } = ex.reconcile(rows, ex.statementRows(ex.parseCsv(csv)).slice(1, 2), []);
        expect(updates.find((x) => x.index === 2).status).toBe("Not in statement");
        expect(additions.length).toBe(1);
    });

    test("every month adds up to the statement, and the report says so", () => {
        const rows = [entry(2, { date: "2026-09-30", amount: 100, merchant: "Meesho Techn" }), entry(3, { date: "2026-10-01", amount: 200, merchant: "Meta Verifie", ref: "100000000002" }),
            entry(9, { date: "2026-10-02", amount: 77, merchant: "Ghost", ref: "123123123123", status: "Flagged" })];
        const { report } = ex.reconcile(rows, stmt(), []);
        expect(report.months.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
        expect(report.months[0]).toMatchObject({ statementDebit: 100, stashrDebit: 100, match: true });
        expect(report.months[1]).toMatchObject({ statementDebit: 900, statementCredit: 1500, stashrDebit: 900, stashrCredit: 1500, match: true });   // the ghost is left out
        expect(report.allMonthsMatch).toBe(true);
        expect(report.notInStatement).toBe(1);
    });

    test("an entry the owner confirmed by hand stays, and the report shows the month no longer matches", () => {
        const rows = [entry(9, { date: "2026-10-02", amount: 77, merchant: "Cash to a friend", ref: "", status: "Confirmed" })];
        const { updates, report } = ex.reconcile(rows, stmt(), []);
        expect(updates.find((x) => x.index === 9)).toBeUndefined();
        expect(report.months[1].match).toBe(false);
        expect(report.allMonthsMatch).toBe(false);
    });

    test("uploading the same statement again changes nothing and adds nothing", () => {
        const first = ex.reconcile([entry(2, { date: "2026-09-30", amount: 100, merchant: "Meesho Techn" })], stmt(), []);
        const after = apply([entry(2, { date: "2026-09-30", amount: 100, merchant: "Meesho Techn" })], first);
        const again = ex.reconcile(after, stmt(), []);
        expect(again.additions.length).toBe(0);
        expect(again.report.notInStatement).toBe(0);
        expect(again.report.allMonthsMatch).toBe(true);
    });

    test("when the message and the statement name the payee differently, both names show, and a second upload leaves it alone", () => {
        const one = ["Date,Particulars,Withdrawals,Deposits,Balance", "01-10-2026,UPI/DR/100000000009/FACEBOOK INDIA/UTIB/fb@ybl,150.00,,9850.00"].join("\n");
        const rows = [entry(2, { date: "2026-10-01", amount: 150, merchant: "Meta Verifie", ref: "100000000009" })];
        const first = ex.reconcile(rows, ex.statementRows(ex.parseCsv(one)), []);
        expect(first.updates[0].fields.merchant).toBe("Facebook India (Meta Verifie)");
        expect(first.updates[0].fields.category).toBe("Meta Ads");                      // either name finds the category
        const again = ex.reconcile(apply(rows, first), ex.statementRows(ex.parseCsv(one)), []);
        expect(again.updates[0].fields.merchant).toBeUndefined();                       // nothing to change: the name is already there
        expect(again.report.renamed).toBe(0);
    });

    test("a category the owner chose is kept; only 'Uncategorized' is filled in from the real name", () => {
        const rows = [entry(2, { date: "2026-10-01", amount: 200, merchant: "Meta Verifie", ref: "100000000002", category: "Personal" }),
            entry(3, { date: "2026-10-02", amount: 1500, type: "Credit", merchant: "unknown", ref: "100000000004", category: "Uncategorized" })];
        const { updates } = ex.reconcile(rows, stmt(), [{ match: "rahul", category: "Friends" }]);
        expect(updates.find((x) => x.index === 2).fields.category).toBeUndefined();
        expect(updates.find((x) => x.index === 3).fields.category).toBe("Friends");
    });
});

describe("a statement that is not the whole history", () => {
    // The account already held 52,300 before this statement starts: nothing in the matching may assume a zero opening balance.
    const csv = ["Date,Particulars,Withdrawals,Deposits,Balance",
        "04-08-2026,UPI/DR/200000000001/SWIGGY/ICIC/s@ybl,300.00,,52000.00",
        "05-08-2026,UPI/CR/200000000002/RAHUL K/x@ybl,,1000.00,53000.00",
        "09-08-2026,UPI/DR/200000000003/ZOMATO/ICIC/z@ybl,250.00,,52750.00"].join("\n");
    const lines = () => ex.statementRows(ex.parseCsv(csv));

    test("it matches and reports no balance problems, whatever the balance before it was", () => {
        const rows = [entry(1, { date: "2026-08-04", amount: 300, merchant: "Swiggy", ref: "200000000001", balance: 52000 }), entry(2, { date: "2026-08-05", amount: 1000, type: "Credit", merchant: "Rahul K", ref: "200000000002", balance: 53000 }),
            entry(3, { date: "2026-08-09", amount: 250, merchant: "Zomato", ref: "200000000003", balance: 52750 })];
        const { report, additions } = ex.reconcile(rows, lines(), []);
        expect(report.balanceBreakCount).toBe(0);
        expect(additions.length).toBe(0);
        expect(report.allMonthsMatch).toBe(true);
    });

    test("an entry that an earlier check verified but this newer statement does not have is set aside, never left counted", () => {
        const rows = [entry(1, { date: "2026-08-04", amount: 300, merchant: "Swiggy", ref: "200000000001", status: "Verified" }),
            entry(8, { date: "2026-08-06", amount: 15000, merchant: "Other account transfer", ref: "", status: "Verified", source: "Statement" }),
            entry(9, { date: "2026-08-07", amount: 40, merchant: "Owner says genuine", ref: "", status: "Confirmed" })];
        const { updates, report } = ex.reconcile(rows, lines(), []);
        const set = updates.find((x) => x.index === 8);
        expect(set.status).toBe("Not in statement");
        expect(set.note).toMatch(/earlier check had verified it/);
        expect(updates.find((x) => x.index === 9)).toBe(undefined);               // the owner's own Confirmed stays
        expect(report.notInStatement).toBe(1);
        expect(report.months[0]).toMatchObject({ setAside: 1, setAsideDebit: 15000 });
        // the month now adds up (the Confirmed 40 is the owner's decision and is still counted)
        expect(report.months[0].stashrDebit).toBe(report.months[0].statementDebit + 40);
    });

    test("an entry from before the statement's first day or after its last day is not judged at all", () => {
        const rows = [entry(1, { date: "2026-08-02", amount: 77, merchant: "Before", status: "Verified" }), entry(2, { date: "2026-08-12", amount: 88, merchant: "After", status: "Verified" })];
        const { updates } = ex.reconcile(rows, lines(), []);
        expect(updates.length).toBe(0);
    });

    test("a statement taken today may stop in the middle of today: today's entries are left alone", () => {
        const rows = [entry(1, { date: "2026-08-09", amount: 60, merchant: "Later today", status: "Verified" })];
        expect(ex.reconcile(rows, lines(), [], { today: "2026-08-09" }).updates.find((x) => x.index === 1)).toBe(undefined);
        expect(ex.reconcile(rows, lines(), [], { today: "2026-08-20" }).updates.find((x) => x.index === 1).status).toBe("Not in statement");
    });
});

describe("rules that sort payments by who they went to", () => {
    test("the UPI id is the key, however the name is spelt and whichever bank handle follows", () => {
        expect(ex.ruleKey("Ramesh (paytm. s3wsjf6@pty)")).toBe("s3wsjf6");
        expect(ex.ruleKey("durgesh tea (q469914584@ybl)")).toBe("q469914584");
        expect(ex.ruleKey("SWIGGY INSTA (swiggyinstamartecom@axb)")).toBe(ex.ruleKey("swiggyinstamartecom@icic"));
        expect(ex.ruleKey("0000 : Cash Transaction TFR : Fund Trans (YASHASVI) (8527368086@ibl)")).toBe("8527368086");
    });
    test("without an id it is the first two words; a name that says nothing makes no rule", () => {
        expect(ex.ruleKey("UPIInt (Meta Ads)")).toBe("upiint meta");
        for (const g of ["No Remark", "", null, "UPI", "unknown"]) expect(ex.ruleKey(g)).toBe("");
    });
    test("a saved id-rule sorts later payments of that person whatever name the bank shows", () => {
        const rules = [{ match: "q469914584", category: "Friends" }];
        expect(ex.categorize("durgesh tea (q469914584@ybl)", "Debit", "UPI", rules)).toBe("Friends");
        expect(ex.categorize("DURGESH T (q469914584@ybl)", "Debit", "UPI", rules)).toBe("Friends");
        expect(ex.categorize("someone else (q111111111@ybl)", "Debit", "UPI", rules)).toBe("Uncategorized");
    });
    test("chai, tea and petrol are sorted without a rule", () => {
        expect(ex.categorize("GAYATRI TEA (q674348808@ybl)", "Debit", "UPI")).toBe("Food");
        expect(ex.categorize("Sharma Chai Point", "Debit", "UPI")).toBe("Food");
        expect(ex.categorize("HPCL Petrol Pump", "Debit", "UPI")).toBe("Travel");
    });
});
