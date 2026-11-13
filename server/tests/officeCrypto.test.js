// Opening a password-protected Excel file. Pure (no database): node --test tests/officeCrypto.test.js
const { describe, test } = require("node:test");
const expect = require("./expect");
const fs = require("fs");
const path = require("path");
const oc = require("../utils/officeCrypto");
const ex = require("../utils/expenses");
const { agileLock, compound } = require("./helpers/agileLock");

// Made by LibreOffice (an independent program): a real locked workbook, "Standard" encryption, password secret123.
const LOCKED = fs.readFileSync(path.join(__dirname, "fixtures", "statement-locked.xlsx"));
const PLAIN = fs.readFileSync(path.join(__dirname, "fixtures", "statement-plain.xlsx"));

describe("a workbook locked with Standard encryption (made by LibreOffice)", () => {
    test("it is recognised as locked, and an ordinary file is not", () => {
        expect(oc.isCompoundFile(LOCKED)).toBe(true);
        expect(oc.isEncryptedWorkbook(LOCKED)).toBe(true);
        expect(oc.isCompoundFile(PLAIN)).toBe(false);
        expect(oc.isEncryptedWorkbook(PLAIN)).toBe(false);
        expect(oc.isEncryptedWorkbook(Buffer.from("Date,Particulars\n1,2"))).toBe(false);
    });
    test("the right password gives back the workbook, and its lines are read", () => {
        const plain = oc.decryptWorkbook(LOCKED, "secret123");
        expect(plain.subarray(0, 2).toString()).toBe("PK");
        const rows = ex.statementRows(ex.parseXlsx(plain));
        expect(rows.length).toBe(3);
        expect(rows[0]).toMatchObject({ date: "2026-11-01", amount: 1200.5, type: "Debit", ref: "613112345678" });
        expect(rows[2]).toMatchObject({ amount: 60000, type: "Credit" });
    });
    test("a wrong or empty password is refused with a code, and nothing is returned", () => {
        for (const bad of ["wrong", "", "Secret123", "secret123 "]) {
            let err; try { oc.decryptWorkbook(LOCKED, bad); } catch (e) { err = e; }
            expect(err && err.code).toBe("wrong_password");
        }
    });
});

describe("a workbook locked with Agile encryption (Excel 2010 and newer)", () => {
    const rows = [["Date", "Particulars", "Withdrawals", "Deposits", "Balance"], ["05-11-2026", "UPI/613112345680/SWIGGY", 250, "", 1000]];
    const xlsx = PLAIN;                                         // any workbook will do: it is carried through unchanged
    test("opens with the right password, byte for byte", () => {
        const locked = agileLock(xlsx, "p@ss wörd ₹1");
        expect(oc.isEncryptedWorkbook(locked)).toBe(true);
        expect(oc.decryptWorkbook(locked, "p@ss wörd ₹1").equals(xlsx)).toBe(true);
    });
    test("a longer workbook (many 4096-byte segments) opens too", () => {
        const big = Buffer.concat([xlsx, Buffer.alloc(30000, 7)]);
        expect(oc.decryptWorkbook(agileLock(big, "k"), "k").equals(big)).toBe(true);
    });
    test("a wrong password is refused", () => {
        let err; try { oc.decryptWorkbook(agileLock(xlsx, "right"), "wrong"); } catch (e) { err = e; }
        expect(err && err.code).toBe("wrong_password");
        expect(rows.length).toBe(2);
    });
});

describe("files that are not locked workbooks", () => {
    test("an OLE file without the encryption streams (an old .xls) is not treated as locked", () => {
        expect(oc.isEncryptedWorkbook(compound({ Workbook: Buffer.alloc(600, 1) }))).toBe(false);
    });
    test("an unknown lock type is explained, not guessed", () => {
        const info = Buffer.alloc(40); info.writeUInt16LE(1, 0); info.writeUInt16LE(1, 2);
        let err; try { oc.decryptWorkbook(compound({ EncryptionInfo: info, EncryptedPackage: Buffer.alloc(16) }), "x"); } catch (e) { err = e; }
        expect(err && err.code).toBe("unsupported");
    });
});
