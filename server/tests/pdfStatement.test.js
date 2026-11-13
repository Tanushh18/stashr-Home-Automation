// PDF bank statements: opening a locked PDF, reading the text and the table, and the check that refuses a misread one.
// Fixtures (tests/fixtures/pdf, made by make_pdf_fixtures.py with reportlab, pypdf and LibreOffice): the same 46-line statement, plain and
// locked with RC4 40/128, AES-128 and AES-256 (password secret123), an owner-password-only copy, a LibreOffice export (embedded subset font
// with a ToUnicode map), a PDF with no text, and one whose balances are wrong. Pure (no database): node --test tests/pdfStatement.test.js
const { describe, test } = require("node:test");
const expect = require("./expect");
const fs = require("fs");
const path = require("path");
const pdf = require("../utils/pdfRead");
const sp = require("../utils/statementPdf");
const ex = require("../utils/expenses");
const run = require("../utils/statementRun");

const read = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "pdf", name));
const WANT = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "pdf", "statement-expected.json"), "utf8"));
const rowsOf = (name, pw) => ex.statementRows(sp.tableFromPdf(read(name), pw));
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return ""; };

describe("opening a PDF", () => {
    test("a plain PDF opens, and its text and positions are there", () => {
        const doc = pdf.openPdf(read("statement-plain.pdf"));
        expect(doc.pages.length).toBe(2);
        const all = doc.pages.flatMap((p) => p.items);
        expect(all.some((i) => i.text === "Balance")).toBe(true);
        expect(all.some((i) => /UPI\/DR\/\d{12}\//.test(i.text))).toBe(true);
        const bal = all.find((i) => i.text === "Balance"), wd = all.find((i) => i.text === "Withdrawals");
        expect(bal.x > wd.x).toBe(true);
        expect(Math.abs(bal.y - wd.y) < 1).toBe(true);
    });
    test("every kind of lock: no password asks for one, a wrong one is refused, the right one opens it", () => {
        for (const n of ["rc4-40", "rc4-128", "aes-128", "aes-256"]) {
            const f = `statement-${n}.pdf`;
            expect(code(() => pdf.openPdf(read(f)))).toBe("password_required");
            expect(code(() => pdf.openPdf(read(f), ""))).toBe("password_required");
            expect(code(() => pdf.openPdf(read(f), "wrong"))).toBe("wrong_password");
            expect(code(() => pdf.openPdf(read(f), "Secret123"))).toBe("wrong_password");
            expect(pdf.openPdf(read(f), "secret123").pages.length).toBe(2);
            expect(pdf.needsPassword(read(f))).toBe(true);
        }
        expect(pdf.needsPassword(read("statement-plain.pdf"))).toBe(false);
    });
    test("a file locked only against editing (owner password) opens with no password at all", () => {
        expect(pdf.needsPassword(read("statement-owner-only.pdf"))).toBe(false);
        expect(pdf.openPdf(read("statement-owner-only.pdf")).pages.length).toBe(2);
    });
    test("what is not a PDF, is damaged, or has no text is explained", () => {
        expect(code(() => pdf.openPdf(Buffer.from("Date,Particulars\n1,2")))).toBe("not_pdf");
        expect(code(() => pdf.openPdf(read("statement-scan.pdf")))).toBe("no_text");
        expect(code(() => pdf.openPdf(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF")))).toBe("corrupt");
        expect(pdf.isPdf(read("statement-plain.pdf"))).toBe(true);
        expect(pdf.isPdf(Buffer.from("hello world, not a pdf"))).toBe(false);
    });
});

describe("reading the table", () => {
    const same = (got, want, prefix = false) => {
        expect(got.length).toBe(want.length);
        got.forEach((g, i) => {
            expect(g.date).toBe(want[i].date);
            expect(g.amount).toBe(want[i].amount);
            expect(g.type).toBe(want[i].type);
            expect(g.balance).toBe(want[i].balance);
            expect(prefix ? want[i].desc.startsWith(g.desc) : g.desc === want[i].desc).toBe(true);
        });
    };
    test("all 46 lines come out right, with the narrations that wrap onto several lines joined", () => {
        same(rowsOf("statement-plain.pdf"), WANT);
        expect(rowsOf("statement-plain.pdf").some((r) => r.desc.includes("whole quarter"))).toBe(true);
        expect(rowsOf("statement-plain.pdf")[0].ref).toMatch(/^\d{12}$/);
    });
    test("every locked copy gives exactly the same lines as the plain one", () => {
        for (const n of ["rc4-40", "rc4-128", "aes-128", "aes-256"]) same(rowsOf(`statement-${n}.pdf`, "secret123"), WANT);
        same(rowsOf("statement-owner-only.pdf"), WANT);
    });
    test("a LibreOffice PDF (embedded subset font) reads the same; LibreOffice itself cut two descriptions short inside the PDF", () => {
        same(rowsOf("statement-libreoffice.pdf"), WANT, true);
    });
    test("the pages of one statement are one table (the header repeats, page numbers are dropped)", () => {
        const { table } = { table: sp.tableFromPdf(read("statement-plain.pdf")) };
        expect(table[0].join("|")).toMatch(/Date.*Particulars.*Withdrawals.*Deposits.*Balance/);
        expect(table.filter((r) => /^date$/i.test(r[0])).length).toBe(1);
    });
    test("a PDF with no table in it is explained", () => {
        let err; try { sp.tableFromDoc({ pages: [{ width: 600, height: 800, items: [{ x: 10, y: 700, x2: 90, size: 10, text: "Hello world" }] }] }); } catch (e) { err = e; }
        expect(err.code).toBe("no_table");
    });
});

describe("refusing a misread PDF", () => {
    test("a statement whose balances do not follow its amounts is refused, with the number of lines that failed", async () => {
        const table = sp.tableFromPdf(read("statement-broken-balance.pdf"));
        expect(run.chainBreaks(ex.statementRows(table)) >= 3).toBe(true);
        const store = { keepsOld: true, async list() { return []; }, async updateMany() {}, async append(t) { return { stored: t, added: t.length }; } };
        let err; try { await run.processStatement({ s: { startDate: "" }, st: store, bytes: Buffer.alloc(0), table, source: "pdf" }); } catch (e) { err = e; }
        expect(err.status).toBe(400);
        expect(err.message).toMatch(/could not be read reliably/);
        expect(err.message).toMatch(/Excel or CSV/);
    });
    test("a correct PDF passes the same check, and the report says it came from a PDF", async () => {
        const table = sp.tableFromPdf(read("statement-plain.pdf"));
        expect(run.chainBreaks(ex.statementRows(table))).toBe(0);
        const added = [];
        const store = { keepsOld: true, async list() { return []; }, async updateMany() {}, async append(t) { added.push(...t); return { stored: t, added: t.length }; } };
        const { report } = await run.processStatement({ s: { startDate: "" }, st: store, bytes: Buffer.alloc(0), table, source: "pdf" });
        expect(report.source).toBe("pdf");
        expect(report.lines).toBe(46);
        expect(added.length).toBe(46);
    });
});
