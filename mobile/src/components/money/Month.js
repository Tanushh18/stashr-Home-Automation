import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Badge } from "../ui";
import { Box, Btn, Dim, Input, Row, Sub, Toggle, Txt, Bad, ask, useAct } from "../home/h";
import { money } from "../../lib/moneyApi";
import { useTheme, alpha } from "../../lib/theme";
import { inr, monthLabel, dayLabel, groupByDay, sharePct, monthList, STATUS_TONE } from "../../lib/moneyFmt";

function tone(theme, t) { return { ok: theme.ok, bad: theme.danger, warn: theme.warn, mute: theme.textFaint }[STATUS_TONE[t] || "mute"]; }

export function StatusBadge({ status }) {
  const { theme } = useTheme();
  return <Badge text={status === "Verified" ? "Verified ✓" : status || "Unverified"} color={tone(theme, status)} />;
}

/** Choose a category for one entry; "remember" makes it the rule for that merchant. */
function CategoryPicker({ tx, categories, onClose, onPick }) {
  const { theme } = useTheme();
  const [custom, setCustom] = useState("");
  const [remember, setRemember] = useState(true);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, maxHeight: "80%" }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }}>{tx.merchant || "This payment"} · {inr(tx.amount)}</Text>
          <Toggle label={`Remember for “${tx.merchant}”`} hint="Next time this name gets this category automatically" value={remember} onChange={setRemember} />
          <ScrollView contentContainerStyle={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}>
            {categories.map((c) => (
              <Btn key={c} label={c} kind={c === tx.category ? "primary" : "quiet"} onPress={() => onPick(c, remember)} />
            ))}
          </ScrollView>
          <Input value={custom} onChangeText={setCustom} placeholder="New category…" autoCapitalize="words" maxLength={30} />
          <Row>
            <Btn kind="primary" label="Use new category" disabled={!custom.trim()} onPress={() => onPick(custom.trim(), remember)} />
            <Btn label="Cancel" onPress={onClose} />
          </Row>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Entry({ tx, categories, onChange }) {
  const { theme } = useTheme();
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [describe, setDescribe] = useState(false);
  const [text, setText] = useState(tx.description || "");
  const credit = tx.type === "Credit";
  return (
    <View style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.line, gap: 6 }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt bold numberOfLines={1}>{tx.merchant || "—"}</Txt>
          <Dim>{tx.time || ""}{tx.method ? ` · ${tx.method}` : ""}{tx.account ? ` · ${tx.account}` : ""}</Dim>
        </View>
        <Text style={{ color: credit ? theme.ok : theme.text, fontFamily: theme.font.bodySemi, fontSize: 15 }}>{credit ? "+" : ""}{inr(tx.amount)}</Text>
      </Pressable>
      <Row>
        <Btn label={tx.category} kind={tx.category === "Uncategorized" ? "primary" : "quiet"} onPress={() => setPick(true)} />
        <StatusBadge status={tx.status} />
        <Btn label={tx.description ? "Edit description" : "+ Description"} kind="quiet" onPress={() => { setText(tx.description || ""); setDescribe(!describe); }} />
      </Row>
      {tx.description && !describe ? <Dim>{tx.description}</Dim> : null}
      {describe ? (
        <Row>
          <View style={{ flex: 1, minWidth: 160 }}><Input value={text} onChangeText={setText} placeholder="What was this for?" maxLength={300} /></View>
          <Btn kind="primary" label="Save" onPress={async () => { if (await act(() => money.setDescription(tx.index, text), "Description saved")) { setDescribe(false); onChange(); } }} />
        </Row>
      ) : null}
      {open ? (
        <View style={{ gap: 2 }}>
          {tx.ref ? <Dim>Reference {tx.ref}</Dim> : null}
          {tx.balance != null ? <Dim>Balance after: {inr(tx.balance)}</Dim> : null}
          <Dim>Source: {tx.source || "SMS"}{tx.note ? ` · ${tx.note}` : ""}</Dim>
          {(tx.flags || []).map((f) => <Bad key={f}>• {f}</Bad>)}
        </View>
      ) : null}
      {pick ? <CategoryPicker tx={tx} categories={categories} onClose={() => setPick(false)} onPick={async (c, remember) => { setPick(false); if (await act(() => money.setCategory(tx.index, c, remember), "Category saved")) onChange(); }} /> : null}
    </View>
  );
}

/** Month view: switcher, tiles, category bars, the list by day. */
export function MonthView({ data, categories, month, setMonth, filter, setFilter, onChange }) {
  const { theme } = useTheme();
  const t = data.totals || {};
  const months = monthList(data.months, month);
  const i = months.indexOf(month);
  const shown = filter ? data.rows.filter((r) => r.category === filter) : data.rows;
  const groups = groupByDay(shown);
  const max = Math.max(1, ...(t.byCategory || []).map((c) => c.amount));
  const Tile = ({ label, value, color }) => (
    <View style={{ flexGrow: 1, flexBasis: "45%", backgroundColor: alpha(theme.accent, 0.06), borderRadius: 12, padding: 10 }}>
      <Dim>{label}</Dim>
      <Text style={{ color: color || theme.heading, fontFamily: theme.font.bodySemi, fontSize: 18 }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ gap: 14 }}>
      <Box>
        <Row gap={6} wrap={false}>
          <Btn label="‹" disabled={i >= months.length - 1} onPress={() => setMonth(months[i + 1])} />
          <View style={{ flex: 1, alignItems: "center" }}><Txt bold style={{ fontSize: 17 }}>{monthLabel(month)}</Txt></View>
          <Btn label="›" disabled={i <= 0} onPress={() => setMonth(months[i - 1])} />
        </Row>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Tile label="Spent" value={inr(t.debit)} />
          <Tile label="Received" value={inr(t.credit)} color={theme.ok} />
          <Tile label="Net" value={inr(t.net, { sign: true })} color={t.net < 0 ? theme.danger : theme.ok} />
          <Tile label="Needs checking" value={String(t.flagged || 0)} color={t.flagged ? theme.danger : undefined} />
        </View>
      </Box>

      <Box title="Where it went" subtitle={filter ? `Showing only ${filter}` : "Tap a category to see only those payments"} right={filter ? <Btn label="Show all" onPress={() => setFilter("")} /> : null}>
        {(t.byCategory || []).length ? (t.byCategory || []).map((c) => (
          <Pressable key={c.category} onPress={() => setFilter(filter === c.category ? "" : c.category)} style={{ gap: 3, opacity: filter && filter !== c.category ? 0.45 : 1 }}>
            <Row gap={8} wrap={false}>
              <Txt bold style={{ flex: 1 }} numberOfLines={1}>{c.category}</Txt>
              <Dim>{sharePct(c.amount, t.debit)}% · {c.count}</Dim>
              <Txt bold>{inr(c.amount)}</Txt>
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(theme.accent, 0.12) }}>
              <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, (c.amount / max) * 100)}%`, backgroundColor: c.category === "Uncategorized" ? theme.warn : theme.accent }} />
            </View>
          </Pressable>
        )) : <Dim>No payments in this month yet.</Dim>}
        {data.uncategorized ? <Dim>{data.uncategorized} payment{data.uncategorized > 1 ? "s are" : " is"} still Uncategorized: tap the highlighted category on the entry to sort {data.uncategorized > 1 ? "them" : "it"}.</Dim> : null}
      </Box>

      <Box title="Payments" subtitle="Doubtful entries are listed under “Needs checking” and not counted here.">
        {groups.length ? groups.map((g) => (
          <View key={g.date}>
            <Row gap={6} wrap={false} style={{ marginTop: 6 }}>
              <Sub>{dayLabel(g.date)}</Sub>
              <View style={{ flex: 1 }} />
              {g.total ? <Dim>{inr(g.total)} spent</Dim> : null}
            </Row>
            {g.rows.map((r) => <Entry key={r.index} tx={r} categories={categories} onChange={onChange} />)}
          </View>
        )) : <Dim>Nothing to show.</Dim>}
      </Box>
    </View>
  );
}

/** Doubtful entries, with the reasons and what to do. */
export function Flagged({ rows, onChange }) {
  const { theme } = useTheme();
  const act = useAct();
  if (!rows || !rows.length) return null;
  const genuine = async (tx) => { if (await act(() => money.review(tx.index, "genuine"), "Marked as genuine")) onChange(); };
  const remove = async (tx) => { if (await ask("Delete this entry?", `${tx.merchant} · ${inr(tx.amount)} will be removed from your sheet.`, "Delete", true) && (await act(() => money.review(tx.index, "delete"), "Deleted"))) onChange(); };
  return (
    <Box title={`Needs checking (${rows.length})`} subtitle="These look doubtful, so they are not counted. Upload your bank statement below to check them automatically, or decide yourself.">
      {rows.map((tx) => (
        <View key={tx.index} style={{ borderWidth: 1, borderColor: alpha(theme.danger, 0.4), borderRadius: 12, padding: 10, gap: 6 }}>
          <Row gap={8} wrap={false}>
            <View style={{ flex: 1 }}><Txt bold numberOfLines={1}>{tx.merchant || "—"}</Txt><Dim>{dayLabel(tx.date)} {tx.time} · {tx.type}</Dim></View>
            <Txt bold>{inr(tx.amount)}</Txt>
          </Row>
          {(tx.flags || []).map((f) => <Bad key={f}>• {f}</Bad>)}
          <Row>
            <Btn kind="primary" label="This is genuine" onPress={() => genuine(tx)} />
            <Btn kind="danger" label="Delete (fake)" onPress={() => remove(tx)} />
          </Row>
        </View>
      ))}
    </Box>
  );
}

/** Unsorted payments in groups. One pick sorts every payment to or from the same UPI id or name, old and new, and later ones follow. */
export function QuickSort({ categories, refreshKey, month, onChange }) {
  const act = useAct();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);                  // the group whose category list is showing
  useEffect(() => { let live = true; money.uncategorized(month).then((d) => { if (live) setData(d); }).catch(() => {}); return () => { live = false; }; }, [refreshKey, month]);
  if (!data || !data.groups || !data.groups.length) return null;
  const options = (categories || []).filter((c) => c && c !== "Uncategorized");
  const pick = async (g, c) => { setOpen(null); if (await act(() => money.setCategory(g.index, c, g.remembers), g.remembers ? "Sorted, and remembered for this name" : "Sorted")) onChange(); };
  return (
    <Box title={`Sort quickly: ${month ? monthLabel(month) : "all"} (${data.total} unsorted)`} subtitle="Pick a category once. Every payment to or from the same UPI id or name follows it, now and later.">
      {data.groups.slice(0, 10).map((g) => (
        <View key={g.key} style={{ gap: 6 }}>
          <Row gap={8} wrap={false}>
            <View style={{ flex: 1 }}><Txt bold numberOfLines={1}>{g.label}</Txt><Dim>{g.count} {g.count === 1 ? "payment" : "payments"}{g.debit ? ` · spent ${inr(g.debit)}` : ""}{g.credit ? ` · received ${inr(g.credit)}` : ""}</Dim></View>
            <Btn label={open === g.key ? "Close" : "Sort"} kind="quiet" onPress={() => setOpen(open === g.key ? null : g.key)} />
          </Row>
          {open === g.key ? <Row gap={8} wrap>{options.map((c) => <Btn key={c} label={c} kind="quiet" onPress={() => pick(g, c)} />)}</Row> : null}
        </View>
      ))}
    </Box>
  );
}
