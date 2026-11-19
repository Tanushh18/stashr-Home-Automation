import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getMoneySummary, getMoneyInsights, saveMoneyBudgets, saveMoneyGoals, askMoney, applyMoneySuggestions } from "../../api/client";
import { Section, Skeleton } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { inr, monthLabel } from "../../lib/money";

const TONE = { healthy: "ok", watch: "warn", alert: "bad" };
const WORD = { healthy: "Healthy", watch: "Keep an eye", alert: "Needs attention" };

/** "Food=8000, Travel=3000" <-> { Food: 8000, Travel: 3000 } */
export const parseBudgets = (text) => Object.fromEntries(String(text || "").split(/[,\n]/).map((p) => p.split("=")).map(([k, v]) => [(k || "").trim(), Number(String(v || "").replace(/[₹,\s]/g, ""))]).filter(([k, v]) => k && v > 0));
export const budgetsText = (list) => (list || []).map((b) => `${b.category}=${b.limit}`).join(", ");

function Months({ months }) {
  if (!months || !months.length) return null;
  const top = Math.max(1, ...months.map((m) => Math.max(m.income, m.spend)));
  return (
    <ul className="mn-pl" aria-label="Profit or loss by month">
      {months.map((m) => (
        <li key={m.month}>
          <span>{monthLabel(m.month)}{m.source === "statement" ? " ✓" : ""}</span>
          <span className="mn-pl__bars" aria-hidden="true"><i style={{ width: `${(m.income / top) * 100}%` }} className="in" /><i style={{ width: `${(m.spend / top) * 100}%` }} className="out" /></span>
          <b className={m.result === "loss" ? "mn-bad" : "mn-ok"}>{m.result === "loss" ? "Loss " : m.result === "profit" ? "Profit " : ""}{inr(Math.abs(m.net))}</b>
        </li>
      ))}
    </ul>
  );
}

export default function MoneyBrain({ refreshKey, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [budgetText, setBudgetText] = useState("");
  const [goal, setGoal] = useState({ name: "", target: "", saved: "" });
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");

  const load = useCallback(async () => {
    try { const x = await getMoneyInsights(); setD(x); setErr(""); setBudgetText(budgetsText(x.budgets)); }
    catch (e) { setErr(errorMessage(e, "Could not work out the insights.")); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const saveBudgets = async () => { try { await saveMoneyBudgets(parseBudgets(budgetText)); toast.success("Budgets saved"); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } };
  const addGoal = async () => {
    const goals = [...(d.goals || []).map((g) => ({ name: g.name, target: g.target, saved: g.saved })), { name: goal.name, target: Number(goal.target), saved: Number(goal.saved) || 0 }];
    try { await saveMoneyGoals(goals); setGoal({ name: "", target: "", saved: "" }); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const dropGoal = async (i) => { try { await saveMoneyGoals(d.goals.filter((_, j) => j !== i).map((g) => ({ name: g.name, target: g.target, saved: g.saved }))); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } };
  const ask = async (e) => { e.preventDefault(); if (!q.trim()) return; try { setAnswer((await askMoney(q)).answer); } catch (x) { setAnswer(errorMessage(x, "Could not answer.")); } };
  const [sum, setSum] = useState("");
  const summarize = async (ai) => { try { const r = await getMoneySummary(ai); setSum(r.text + (r.ai ? `  (written by ${r.ai})` : "")); } catch (x) { setSum(errorMessage(x, "Could not write the summary.")); } };
  const apply = async () => { try { const r = await applyMoneySuggestions(); toast.success(`${r.updated} payment${r.updated === 1 ? "" : "s"} sorted`); load(); if (onChanged) onChanged(); } catch (x) { toast.error(errorMessage(x, "Could not sort.")); } };

  if (err) return <p className="mn-bad" role="alert">{err}</p>;
  if (!d) return <Skeleton lines={4} />;
  const f = d.forecast;
  return (
    <>
      <Section title="Money Brain" subtitle={d.headline}>
        <p><span className={`mn-badge mn-badge--${TONE[d.verdict]}`}>{WORD[d.verdict]}</span> <span className="mn-dim">{d.trust === "high" ? "Figures come from your bank statement." : "Figures come from messages only. Upload a statement to make them the truth."}</span></p>
        <ul className="mn-reasons">{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {d.actions.length ? <><h4>Do next</h4><ol className="mn-reasons">{d.actions.map((a) => <li key={a.id}>{a.text}</li>)}</ol></> : null}
        <Months months={d.months} />
        <p><button type="button" className="rd-btn" onClick={() => summarize(false)}>Write my summary</button> <button type="button" className="rd-btn rd-btn--quiet" onClick={() => summarize(true)} title="Needs an AI key on the server. Only totals are sent.">Rewrite with AI</button></p>
        {sum ? <p role="status">{sum}</p> : null}
        {d.runway ? <p className="mn-dim">Balance {inr(d.runway.balance)} (as of {d.runway.asOf}) lasts about {d.runway.days} days at this rate.</p> : null}
        <p className="mn-dim">At this pace {monthLabel(d.thisMonth.month)} ends {d.projection.net >= 0 ? "with a profit of" : "with a loss of"} {inr(Math.abs(d.projection.net))}.</p>
      </Section>

      {f ? (
        <Section title="Until the next salary" subtitle={`Expected ${f.nextSalary} (${f.daysToSalary} days)`}>
          <p>You have {inr(f.left)} left; {inr(f.dueBills)} of repeat bills fall due. <b className={f.status === "short" ? "mn-bad" : f.status === "tight" ? "mn-warn-text" : "mn-ok"}>{f.status === "short" ? "You will run short." : `Safe to spend about ${inr(f.safePerDay)} a day.`}</b></p>
        </Section>
      ) : null}

      <Section className="mn-brain" title="Budgets" subtitle="A monthly limit per category. Stashr tells you on Telegram at 80% and when you pass it.">
        {d.budgets.length ? <ul className="mn-reasons">{d.budgets.map((b) => <li key={b.category}><b>{b.category}</b>: {inr(b.spent)} of {inr(b.limit)} ({b.pct}%) <span className={`mn-badge mn-badge--${b.level === "over" ? "bad" : b.level === "near" ? "warn" : "ok"}`}>{b.level}</span></li>)}</ul> : <p className="mn-dim">No budgets yet.</p>}
        <label className="mn-field"><span>Limits, like <code>Food=8000, Travel=3000</code></span><input value={budgetText} onChange={(e) => setBudgetText(e.target.value)} /></label>
        <button type="button" className="rd-btn" onClick={saveBudgets}>Save budgets</button>
      </Section>

      <Section className="mn-brain" title="Savings goals" subtitle="How long each goal takes at what you keep in an average month.">
        {d.goals.map((g, i) => <p key={i}><b>{g.name}</b>: {inr(g.saved)} of {inr(g.target)} ({g.pct}%). {g.text} <button type="button" className="mn-link" onClick={() => dropGoal(i)}>remove</button></p>)}
        <div className="mn-editor">
          <input placeholder="Goal, e.g. New phone" value={goal.name} onChange={(e) => setGoal({ ...goal, name: e.target.value })} />
          <input placeholder="Target ₹" inputMode="numeric" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} />
          <input placeholder="Saved so far ₹" inputMode="numeric" value={goal.saved} onChange={(e) => setGoal({ ...goal, saved: e.target.value })} />
          <button type="button" className="rd-btn" disabled={!goal.name || !Number(goal.target)} onClick={addGoal}>Add goal</button>
        </div>
      </Section>

      {d.anomalies.length || d.recurring.length || d.suggestions.length || d.metaAds.length ? (
        <Section title="Noticed by the brain">
          {d.anomalies.length ? <><h4>Looks unusual</h4><ul className="mn-reasons">{d.anomalies.map((a, i) => <li key={i}>{a.text}</li>)}</ul></> : null}
          {d.recurring.length ? <><h4>Repeats every month</h4><ul className="mn-reasons">{d.recurring.slice(0, 8).map((r) => <li key={r.payee}>{r.payee}: {inr(r.amount)}, next about {r.next}</li>)}</ul></> : null}
          {d.metaAds.length ? <><h4>Meta Ads: profit or loss</h4><ul className="mn-reasons">{d.metaAds.slice(-4).map((m) => <li key={m.month}>{monthLabel(m.month)}: spent {inr(m.adSpend)}, other money in {inr(m.otherIncome)} → <b className={m.net < 0 ? "mn-bad" : "mn-ok"}>{m.net < 0 ? "loss " : "profit "}{inr(Math.abs(m.net))}</b></li>)}</ul></> : null}
          {d.suggestions.length ? <><h4>Sorted for you</h4><p className="mn-dim">{d.suggestions.length} unsorted payee{d.suggestions.length === 1 ? "" : "s"} look like ones you already sorted: {d.suggestions.slice(0, 4).map((s) => `${s.merchant} → ${s.category}`).join(", ")}.</p><button type="button" className="rd-btn" onClick={apply}>Sort them</button></> : null}
        </Section>
      ) : null}

      <Section className="mn-brain" title="Ask your money" subtitle="Try: how much did I spend on food last month · biggest payments this month · profit in october">
        <form className="mn-editor" onSubmit={ask}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" maxLength={200} /><button className="rd-btn" type="submit">Ask</button></form>
        {answer ? <p role="status">{answer}</p> : null}
      </Section>
    </>
  );
}
