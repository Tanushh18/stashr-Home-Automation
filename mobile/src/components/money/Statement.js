import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Box, Btn, Dim, Good, Bad, Txt, Row, Input, Pick, ask } from "../home/h";
import { money } from "../../lib/moneyApi";
import { inr, dayLabel, monthLabel } from "../../lib/moneyFmt";

/** The last few months for "Month to match", newest first: ["2026-11", "2026-10", ...]. */
const recentMonths = (n = 4, now = new Date()) => Array.from({ length: n }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });

/** Check the sheet against a bank statement (PDF, Excel or CSV from net banking). A locked PDF or Excel file asks for its password. */
export default function Statement({ settings, onChecked }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [month, setMonth] = useState("");                // "" = the whole statement
  const [locked, setLocked] = useState(null);            // { name, bytes, wrong } while a locked file waits for its password
  const [password, setPassword] = useState("");
  const [savedAt, setSavedAt] = useState(0);             // bumped after a check so the saved-statement search reloads
  const last = settings.lastStatement;
  const months = useMemo(() => recentMonths(4), []);

  const send = async (name, bytes, pass) => {
    setError(""); setReport(null); setBusy(true);
    try {
      const r = await money.statement(name, bytes, { password: pass || undefined, month: month || undefined });
      setReport(r.report || r); setLocked(null); setPassword(""); setSavedAt(Date.now());
      onChecked();
    } catch (e) {
      const code = e && e.data && e.data.code;
      if (code === "password_required" || code === "wrong_password") { setLocked({ name, bytes, wrong: code === "wrong_password" }); setPassword(""); }
      else { setLocked(null); setError(e.message || "Could not check the statement."); }
    } finally { setBusy(false); }
  };
  const pick = async () => {
    setError(""); setReport(null); setLocked(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "text/csv", "text/comma-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      const name = a.name || "statement";
      if (!/\.(csv|xlsx|pdf)$/i.test(name)) { setError("Choose the statement as a PDF, an Excel (.xlsx) or a CSV file."); return; }
      const { File } = require("expo-file-system");
      const bytes = new Uint8Array(await new File(a.uri).arrayBuffer());
      await send(name, bytes, "");
    } catch (e) { setError(e.message || "Could not read the statement."); }
  };
  const r = report;
  return (
    <>
      <Box title="Check against a bank statement" subtitle="Send your Federal Bank statement (PDF, Excel or CSV) any time, in the middle of the month or at the end. Every entry is matched with it. A password-protected PDF or Excel file asks for its password.">
        <Dim>Month to match</Dim>
        <Pick options={[["", "Whole statement"], ...months.map((m) => [m, monthLabel(m)])]} value={month} onChange={setMonth} />
        <Btn kind="primary" label={busy ? "Checking…" : "Choose statement file"} onPress={pick} loading={busy} disabled={Boolean(locked)} />
        {locked ? (
          <View style={{ gap: 8 }}>
            <Txt bold>🔒 {locked.name} is locked</Txt>
            {locked.wrong ? <Bad>That password did not open it. Check it and try again.</Bad> : <Dim>Enter the password the bank gave you for this file. It is used once to open the file and is not saved.</Dim>}
            <Input value={password} onChangeText={setPassword} placeholder="Statement password" secureTextEntry autoCapitalize="none" onSubmitEditing={() => password && send(locked.name, locked.bytes, password)} />
            <Row>
              <Btn kind="primary" label="Unlock and check" onPress={() => send(locked.name, locked.bytes, password)} disabled={!password || busy} loading={busy} />
              <Btn label="Cancel" onPress={() => { setLocked(null); setPassword(""); }} disabled={busy} />
            </Row>
          </View>
        ) : null}
        {error ? <Bad>{error}</Bad> : null}
        {r ? (
          <View style={{ gap: 3 }}>
            <Txt bold>{dayLabel(r.from)} → {dayLabel(r.to)} · {r.lines} lines</Txt>
            <Good>{r.verified} matched and verified</Good>
            {r.mismatched ? <Bad>{r.mismatched} did not match (different amount)</Bad> : null}
            {r.added ? <Dim>{r.added} were in the statement but not in your sheet: added</Dim> : null}
            {r.notInStatement ? <Dim>{r.notInStatement} in your sheet are not in the statement</Dim> : null}
            {r.balanceBreakCount ? <Bad>{r.balanceBreakCount} places where the statement's own balance does not add up</Bad> : null}
            {(r.balanceBreaks || []).slice(0, 3).map((b, i) => <Dim key={i}>• {dayLabel(b.date)} {b.desc}: expected {inr(b.expected)}, got {inr(b.got)}</Dim>)}
            {r.saved ? <Dim>{r.saved} line{r.saved === 1 ? "" : "s"} saved, so you can search this statement later (below).</Dim> : null}
          </View>
        ) : last ? <Dim>Last check: {dayLabel(last.from)} → {dayLabel(last.to)}: {last.verified} verified, {last.mismatched} mismatched, {last.added} added.</Dim> : null}
      </Box>
      <SavedSearch refreshKey={savedAt} />
    </>
  );
}

/** Search the statements kept for later: a name (small slips are fine), an amount, a range (500-2000, >5000) or a reference number. */
function SavedSearch({ refreshKey }) {
  const [saved, setSaved] = useState(null);              // { statements, months }
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const seq = useRef(0);

  const loadSaved = useCallback(async () => { try { setSaved(await money.savedStatements()); } catch (e) { setError(e.message || "Could not load your saved statements."); } }, []);
  useEffect(() => { loadSaved(); }, [loadSaved, refreshKey]);
  useEffect(() => {
    const text = q.trim();
    if (!text) { setFound(null); setError(""); return undefined; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try { const r = await money.searchStatements(text, month || undefined); if (mine === seq.current) { setFound(r); setError(""); } }
      catch (e) { if (mine === seq.current) setError(e.message || "Could not search."); }
      finally { if (mine === seq.current) setBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, month, refreshKey]);

  const remove = async (s) => {
    if (!(await ask(`Delete "${s.filename || "statement"}"?`, `Its ${s.lines} saved line${s.lines === 1 ? "" : "s"} can no longer be searched. Your Money entries are not changed.`, "Delete", true))) return;
    try { await money.deleteSavedStatement(s.id); await loadSaved(); setFound(null); setQ(""); } catch (e) { setError(e.message || "Could not delete it."); }
  };
  const has = saved && saved.statements.length > 0;
  return (
    <Box title="Search your saved statements" subtitle="Every statement you check is kept (encrypted) so you can look something up months later.">
      {saved && !has ? <Dim>Nothing saved yet. Check a statement above and its lines are kept here for searching.</Dim> : null}
      {has ? (
        <>
          <Input value={q} onChangeText={setQ} placeholder="e.g. ramesh · 1200 · 500-2000 · >5000" />
          <Pick options={[["", "All months"], ...saved.months.slice(0, 5).map((m) => [m.month, monthLabel(m.month)])]} value={month} onChange={setMonth} />
          <Dim>Amounts: 1200 exact, 500-2000 a range, &gt;5000 or &lt;300. Mix with a name: ramesh 350.</Dim>
          {error ? <Bad>{error}</Bad> : null}
          {busy && !found ? <Dim>Searching…</Dim> : null}
          {found ? (found.total === 0 ? <Dim>Nothing found in {found.searched} saved line{found.searched === 1 ? "" : "s"}. Try fewer letters of the name.</Dim> : (
            <View style={{ gap: 8 }}>
              <Dim>{found.total} found{found.total > found.results.length ? ` (showing the best ${found.results.length})` : ""}</Dim>
              {found.results.slice(0, 50).map((x) => (
                <View key={x.id} style={{ gap: 2, paddingVertical: 4 }}>
                  <Row wrap={false} style={{ justifyContent: "space-between" }}>
                    <Txt bold style={{ flex: 1 }} numberOfLines={2}>{x.desc}</Txt>
                    {x.type === "Credit" ? <Good>+{inr(x.amount)}</Good> : <Txt bold>−{inr(x.amount)}</Txt>}
                  </Row>
                  <Dim>{dayLabel(x.date)}{x.balance == null ? "" : ` · balance ${inr(x.balance)}`}{x.file ? ` · ${x.file}` : ""}</Dim>
                </View>
              ))}
            </View>
          )) : null}
          <Btn label={showList ? "Hide saved statements" : `Saved statements (${saved.statements.length})`} onPress={() => setShowList((v) => !v)} />
          {showList ? saved.statements.map((s) => (
            <View key={s.id} style={{ gap: 4, paddingVertical: 4 }}>
              <Txt bold>{s.filename || "statement"}</Txt>
              <Dim>{dayLabel(s.from)} → {dayLabel(s.to)} · {s.lines} line{s.lines === 1 ? "" : "s"}{s.month ? ` · matched ${monthLabel(s.month)}` : ""}</Dim>
              <Row><Btn kind="danger" label="Delete" onPress={() => remove(s)} /></Row>
            </View>
          )) : null}
        </>
      ) : null}
    </Box>
  );
}
