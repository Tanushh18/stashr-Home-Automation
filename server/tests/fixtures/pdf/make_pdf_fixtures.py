"""Makes the test bank statements for tests/pdfStatement.test.js (run once; the PDFs and statement-expected.json are committed).
Needs: reportlab, pypdf, and LibreOffice (soffice) with python3-uno only for the optional LibreOffice copy."""
import json, random, datetime, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from pypdf import PdfReader, PdfWriter

random.seed(7)
NAMES = ["Meta Verifie", "Ramesh Kumar", "Swiggy", "Zomato", "Amazon Pay India", "Rameshwar Traders", "Priya Sharma", "Jio Prepaid Recharge", "Shine One Estate", "Uber India"]
rows, bal, d = [], 50000.00, datetime.date(2026, 10, 1)
for i in range(46):
    d += datetime.timedelta(days=random.choice([0, 1, 1, 2]))
    name = random.choice(NAMES)
    if i % 9 == 4:
        amt, kind = round(random.uniform(5000, 40000), 2), "Credit"
        desc = f"NEFT/N{random.randint(10**9, 10**10-1)}/{name.upper()} PVT LTD/salary and payments for the month"
    else:
        amt, kind = round(random.uniform(20, 4800), 2), "Debit"
        desc = f"UPI/DR/{random.randint(10**11, 10**12-1)}/{name}/{random.choice(['pay', 'food', 'goods', 'rent and other charges for the whole quarter'])}"
    bal = round(bal + (amt if kind == "Credit" else -amt), 2)
    rows.append({"date": d.isoformat(), "desc": desc, "amount": amt, "type": kind, "balance": bal})

def inr(v):
    s = f"{v:,.2f}"            # 1,234.50 (Western grouping, like many bank PDFs)
    return s
HEAD = ["Date", "Value Date", "Particulars", "Tran Type", "Withdrawals", "Deposits", "Balance", "Dr/Cr"]
fmt = lambda iso: datetime.date.fromisoformat(iso).strftime("%d-%m-%Y")
small = ParagraphStyle("p", fontName="Helvetica", fontSize=7.5, leading=9)
data = [[Paragraph(f"<b>{h}</b>", small) for h in HEAD]]
for r in rows:
    data.append([fmt(r["date"]), fmt(r["date"]), Paragraph(r["desc"].replace("&", "&amp;"), small), "TFR",
                 inr(r["amount"]) if r["type"] == "Debit" else "", inr(r["amount"]) if r["type"] == "Credit" else "", inr(r["balance"]), "Cr"])
def build(path):
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=24, rightMargin=24, topMargin=36, bottomMargin=36)
    t = Table(data, repeatRows=1, colWidths=[52, 52, 170, 34, 60, 60, 66, 24])
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 7.5), ("ALIGN", (4, 1), (6, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.black), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f2f2")])]))
    head = [Paragraph("<b>FEDERAL BANK</b> - Account Statement", ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=11)), Spacer(1, 4),
            Paragraph("Account No: XXXXXX9229 &nbsp; Period: 01-10-2026 to 15-11-2026 &nbsp; Opening balance 50,000.00", small), Spacer(1, 8)]
    doc.build(head + [t])
build("statement-plain.pdf")
json.dump(rows, open("statement-expected.json", "w"), indent=1)
password = "secret123"
src = PdfReader("statement-plain.pdf")
for name, algo in [("rc4-128", "RC4-128"), ("aes-128", "AES-128"), ("aes-256", "AES-256"), ("rc4-40", "RC4-40")]:
    w = PdfWriter(clone_from=src)
    w.encrypt(user_password=password, owner_password="owner-" + password, algorithm=algo)
    w.write(f"statement-{name}.pdf")
# an owner-password-only copy: opens with no password at all
w = PdfWriter(clone_from=src); w.encrypt(user_password="", owner_password="owner-only", algorithm="AES-128"); w.write("statement-owner-only.pdf")
print(len(rows), "rows,", sum(1 for _ in PdfReader("statement-plain.pdf").pages), "pages")

# a PDF with no text at all (a scanned page is a picture)
from reportlab.pdfgen import canvas
c = canvas.Canvas("statement-scan.pdf"); c.rect(50, 50, 300, 400); c.showPage(); c.save()
# the same statement with three balances made wrong, as a badly read PDF would be
bad = [dict(r) for r in rows]
for k in (5, 17, 30): bad[k]["balance"] = round(bad[k]["balance"] + 111.11, 2)
data[:] = [data[0]] + [[fmt(r["date"]), fmt(r["date"]), Paragraph(r["desc"].replace("&", "&amp;"), small), "TFR",
    inr(r["amount"]) if r["type"] == "Debit" else "", inr(r["amount"]) if r["type"] == "Credit" else "", inr(r["balance"]), "Cr"] for r in bad]
build("statement-broken-balance.pdf")
