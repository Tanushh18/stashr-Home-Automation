import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Box, Btn, Dim, Input, Row, Sub, Toggle, Txt, Bad, useAct } from "../home/h";
import { money } from "../../lib/moneyApi";
import { inr } from "../../lib/moneyFmt";

/** Does Stashr add up to the bank? Last month's closing, what it should be now, what the bank said, the difference, and the salary left. */
export function BalanceCard({ month, refreshKey, onChange }) {
  const [r, setR] = useState(null);
  const [bank, setBank] = useState("");
  const [err, setErr] = useState("");
  const act = useAct();
  const load = useCallback(async (b) => {
    try { setR(await money.balance(month, b)); setErr(""); } catch (e) { setErr(e.message || "Could not check the balance."); }
  }, [month]);
  useEffect(() => { load(bank.trim() === "" ? undefined : bank.trim()); }, [month, refreshKey]);
  if (err) return <Bad>{err}</Bad>;
  if (!r) return null;
  const ok = r.match === true, off = r.match === false;
  return (
    <Box>
      <Sub>Balance check</Sub>
      <Dim>The bank statement is the truth: messages for days it covers are confirmed (or corrected) by it, then the balance is compared.</Dim>
      <Row><Dim>Last month's closing{r.opening ? ` (${r.opening.from})` : ""}</Dim><Txt bold>{r.opening ? inr(r.opening.balance) : "—"}</Txt></Row>
      <Row><Dim>Money in this month</Dim><Txt>{inr(r.credits)}</Txt></Row>
      <Row><Dim>Money out this month</Dim><Txt>{inr(r.debits)}</Txt></Row>
      <Row><Dim>Should be in the bank now</Dim><Txt bold>{r.expectedBalance == null ? "—" : inr(r.expectedBalance)}</Txt></Row>
      {r.bankSays ? <Row><Dim>Bank last said ({r.bankSays.from}, {r.bankSays.date})</Dim><Txt>{inr(r.bankSays.balance)}</Txt></Row> : null}
      {r.difference != null ? <Row><Dim>Difference</Dim><Txt bold>{ok ? "Matches ✓" : inr(Math.abs(r.difference))}</Txt></Row> : null}
      {r.hint ? <Dim>{r.hint}</Dim> : null}
      {r.doubtful && r.doubtful.count ? <Dim>{r.doubtful.count} set-aside entr{r.doubtful.count === 1 ? "y" : "ies"} (out {inr(r.doubtful.debit)}, in {inr(r.doubtful.credit)}) are not counted.</Dim> : null}
      <Input value={bank} onChangeText={setBank} placeholder="Balance in your bank app (to compare)" keyboardType="decimal-pad" />
      <Row>
        <Btn label="Compare" onPress={() => load(bank.trim() === "" ? undefined : bank.trim())} />
        <Btn label="Match with saved statements" kind="primary" onPress={() => act(async () => { const d = await money.recheck(month); await load(); onChange && onChange(); return d; }, "Matched with your statements")} />
        <Btn label="Remove repeats" onPress={() => act(async () => { const d = await money.dedupe(); await load(); if (d.removed) onChange && onChange(); }, "Repeats cleaned")} />
      </Row>
      {r.salary ? (
        <View style={{ gap: 4, marginTop: 6 }}>
          <Sub>Salary cycle</Sub>
          <Row><Dim>Salary received ({r.salary.date}, {r.salary.days} days ago)</Dim><Txt>{inr(r.salary.received)}</Txt></Row>
          <Row><Dim>Spent since</Dim><Txt>{inr(r.salary.spent)}</Txt></Row>
          {r.salary.otherIncome ? <Row><Dim>Other money in</Dim><Txt>{inr(r.salary.otherIncome)}</Txt></Row> : null}
          <Row><Dim>Left from salary</Dim><Txt bold>{inr(r.salary.left)}</Txt></Row>
        </View>
      ) : <Dim>No salary yet. Add a credit as "Salary" (or the words salary/payroll in its name) and it will start the cycle.</Dim>}
    </Box>
  );
}

const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

/** Add a payment by hand: cash, or anything with no bank message. */
export function AddPayment({ categories = [], onAdded }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("Debit");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [salary, setSalary] = useState(false);
  const act = useAct();
  const save = (again) => act(async () => {
    const body = { type, amount: Number(amount), merchant, date, note, again, ...(category ? { category } : {}), ...(type === "Credit" && salary ? { salary: true } : {}) };
    await money.addManual(body);
    setAmount(""); setMerchant(""); setNote(""); setSalary(false); setOpen(false);
    onAdded && onAdded();
  }, "Added");
  if (!open) return <Btn label="+ Add a payment yourself" onPress={() => setOpen(true)} />;
  return (
    <Box>
      <Sub>Add a payment</Sub>
      <Row>
        <Btn label="Money out" kind={type === "Debit" ? "primary" : "quiet"} onPress={() => setType("Debit")} />
        <Btn label="Money in" kind={type === "Credit" ? "primary" : "quiet"} onPress={() => setType("Credit")} />
      </Row>
      <Input value={amount} onChangeText={setAmount} placeholder="Amount (₹)" keyboardType="decimal-pad" />
      <Input value={merchant} onChangeText={setMerchant} placeholder={type === "Credit" ? "From whom" : "To whom / what for"} maxLength={60} />
      <Input value={date} onChangeText={setDate} placeholder="Date YYYY-MM-DD" maxLength={10} />
      <Input value={category} onChangeText={setCategory} placeholder={`Category (optional): ${categories.slice(0, 4).join(", ")}…`} maxLength={40} />
      <Input value={note} onChangeText={setNote} placeholder="Note (optional)" maxLength={120} />
      {type === "Credit" ? <Toggle label="This is my salary" hint="Starts the salary cycle: everything after it is taken from it" value={salary} onChange={setSalary} /> : null}
      <Row>
        <Btn kind="primary" label="Save" disabled={!(Number(amount) > 0)} onPress={() => save(false)} />
        <Btn label="Cancel" onPress={() => setOpen(false)} />
      </Row>
    </Box>
  );
}
