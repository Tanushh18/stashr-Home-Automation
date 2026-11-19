import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Box, Btn, Dim, Input, Row, Sub, Txt, Bad, Good, useAct } from "../home/h";
import { money } from "../../lib/moneyApi";
import { inr } from "../../lib/moneyFmt";

const WORD = { healthy: "Healthy", watch: "Keep an eye", alert: "Needs attention" };

/** "Food=8000, Travel=3000" -> { Food: 8000, Travel: 3000 } */
export const parseBudgets = (text) => Object.fromEntries(String(text || "").split(/[,\n]/).map((p) => p.split("=")).map(([k, v]) => [(k || "").trim(), Number(String(v || "").replace(/[₹,\s]/g, ""))]).filter(([k, v]) => k && v > 0));
const budgetsText = (list) => (list || []).map((b) => `${b.category}=${b.limit}`).join(", ");

/** Money Brain: how the month is going (from the bank statement when there is one), what to do next, budgets, goals, and questions. */
export function BrainCard({ refreshKey, onChange }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [budgets, setBudgets] = useState("");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [summary, setSummary] = useState("");
  const [goal, setGoal] = useState({ name: "", target: "" });
  const act = useAct();

  const load = useCallback(async () => {
    try { const x = await money.insights(); setD(x); setBudgets(budgetsText(x.budgets)); setErr(""); } catch (e) { setErr(e.message || "Could not work out the insights."); }
  }, []);
  useEffect(() => { load(); }, [refreshKey]);

  if (err) return <Bad>{err}</Bad>;
  if (!d) return null;
  const f = d.forecast;
  const goals = (d.goals || []).map((g) => ({ name: g.name, target: g.target, saved: g.saved }));
  return (
    <Box>
      <Sub>Money Brain</Sub>
      <Txt bold>{WORD[d.verdict] || d.verdict}</Txt>
      <Dim>{d.headline}</Dim>
      <Dim>{d.trust === "high" ? "Figures come from your bank statement." : "Figures come from messages only. Upload a statement to make them the truth."}</Dim>
      {(d.reasons || []).map((r, i) => <Dim key={i}>• {r}</Dim>)}
      {(d.actions || []).length ? <View style={{ gap: 3 }}><Sub>Do next</Sub>{d.actions.map((a, i) => <Dim key={a.id}>{i + 1}. {a.text}</Dim>)}</View> : null}
      {(d.months || []).map((m) => (
        <Row key={m.month}><Dim>{m.month}{m.source === "statement" ? " ✓" : ""}</Dim>{m.result === "loss" ? <Bad>Loss {inr(Math.abs(m.net))}</Bad> : <Good>{m.result === "profit" ? "Profit " : ""}{inr(Math.abs(m.net))}</Good>}</Row>
      ))}
      {d.runway ? <Dim>Balance {inr(d.runway.balance)} lasts about {d.runway.days} days at this rate.</Dim> : null}
      {f ? <Dim>Until the next salary ({f.nextSalary}, {f.daysToSalary} days): {inr(f.left)} left, {inr(f.dueBills)} of repeat bills due. {f.status === "short" ? "You will run short." : `Safe to spend about ${inr(f.safePerDay)} a day.`}</Dim> : null}

      <Row>
        <Btn label="Write my summary" onPress={() => act(async () => { setSummary((await money.summary(false)).text); })} />
        <Btn label="Rewrite with AI" onPress={() => act(async () => { const r = await money.summary(true); setSummary(r.text + (r.ai ? ` (written by ${r.ai})` : "")); })} />
      </Row>
      {summary ? <Dim>{summary}</Dim> : null}

      {(d.anomalies || []).length ? <View style={{ gap: 3 }}><Sub>Looks unusual</Sub>{d.anomalies.slice(0, 5).map((a, i) => <Dim key={i}>• {a.text}</Dim>)}</View> : null}
      {(d.recurring || []).length ? <View style={{ gap: 3 }}><Sub>Repeats every month</Sub>{d.recurring.slice(0, 6).map((r) => <Dim key={r.payee}>• {r.payee}: {inr(r.amount)}, next about {r.next}</Dim>)}</View> : null}
      {(d.metaAds || []).length ? <View style={{ gap: 3 }}><Sub>Meta Ads</Sub>{d.metaAds.slice(-3).map((m) => <Dim key={m.month}>• {m.month}: spent {inr(m.adSpend)}, other money in {inr(m.otherIncome)} → {m.net < 0 ? "loss" : "profit"} {inr(Math.abs(m.net))}</Dim>)}</View> : null}
      {(d.suggestions || []).length ? (
        <View style={{ gap: 4 }}>
          <Dim>{d.suggestions.length} unsorted payee{d.suggestions.length === 1 ? "" : "s"} look like ones you already sorted: {d.suggestions.slice(0, 3).map((s) => `${s.merchant} → ${s.category}`).join(", ")}.</Dim>
          <Btn label="Sort them" onPress={() => act(async () => { const r = await money.applySuggestions(); await load(); onChange && onChange(); }, "Sorted")} />
        </View>
      ) : null}

      <Sub>Budgets (a limit per category; Telegram tells you at 80%)</Sub>
      {(d.budgets || []).map((b) => <Row key={b.category}><Dim>{b.category}: {inr(b.spent)} of {inr(b.limit)} ({b.pct}%)</Dim>{b.level === "ok" ? <Dim>ok</Dim> : <Bad>{b.level}</Bad>}</Row>)}
      <Input value={budgets} onChangeText={setBudgets} placeholder="Food=8000, Travel=3000" />
      <Btn label="Save budgets" onPress={() => act(async () => { await money.saveBudgets(parseBudgets(budgets)); await load(); }, "Budgets saved")} />

      <Sub>Savings goals</Sub>
      {(d.goals || []).map((g, i) => (
        <Row key={g.name + i}><Dim>{g.name}: {inr(g.saved)} of {inr(g.target)} ({g.pct}%). {g.text}</Dim><Btn label="Remove" onPress={() => act(async () => { await money.saveGoals(goals.filter((_, j) => j !== i)); await load(); })} /></Row>
      ))}
      <Input value={goal.name} onChangeText={(t) => setGoal({ ...goal, name: t })} placeholder="Goal, e.g. New phone" />
      <Input value={goal.target} onChangeText={(t) => setGoal({ ...goal, target: t })} placeholder="Target ₹" keyboardType="decimal-pad" />
      <Btn label="Add goal" onPress={() => act(async () => { await money.saveGoals([...goals, { name: goal.name, target: Number(goal.target), saved: 0 }]); setGoal({ name: "", target: "" }); await load(); }, "Goal added")} />

      <Sub>Ask your money</Sub>
      <Input value={q} onChangeText={setQ} placeholder="How much did I spend on food last month?" />
      <Btn label="Ask" onPress={() => act(async () => { if (q.trim()) setAnswer((await money.ask(q.trim())).answer); })} />
      {answer ? <Txt>{answer}</Txt> : null}
    </Box>
  );
}
