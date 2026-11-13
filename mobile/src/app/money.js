import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Page, Loading, Note } from "../components/kit";
import { Boundary, Dim } from "../components/home/h";
import { SheetSetup, StartDate, SmsAccess } from "../components/money/Setup";
import { MonthView, Flagged, QuickSort } from "../components/money/Month";
import Statement from "../components/money/Statement";
import { money } from "../lib/moneyApi";
import { hasPermission } from "../lib/sms";
import { lastResult, syncNow, onMoneySynced } from "../lib/moneySync";
import { dayLabel } from "../lib/moneyFmt";

/** Money: UPI and bank payments from Federal Bank SMS, sorted into categories, kept in your own Google Sheet. */
export default function Money() {
  const [settings, setSettings] = useState(null);
  const [data, setData] = useState(null);
  const [month, setMonth] = useState("");
  const [filter, setFilter] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [last, setLast] = useState({ result: null, error: "", ran: 0 });
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async (m) => {
    try { const d = await money.list(m || undefined); setData(d); if (!m) setMonth(d.month); setError(""); } catch (e) { setError(e.message || "Could not load the list."); }
  }, []);
  const loadSettings = useCallback(async () => {
    try { const s = await money.settings(); setSettings(s); return s; } catch (e) { setError(e.message || "Could not load."); return null; }
  }, []);
  const loadAll = useCallback(async (m) => {
    const s = await loadSettings();
    setAllowed(await hasPermission());
    setLast(await lastResult());
    if (s && s.configured && !s.needsStartDate) await loadList(m ?? month);
  }, [loadSettings, loadList, month]);

  // Opening the screen: show what is there, run a sync in the background, then show the new numbers.
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      await loadAll();
      const r = await syncNow();
      if (!alive) return;
      setLast(await lastResult());
      if (r && !r.skipped && !r.error && (r.added || r.flagged)) loadList(month || undefined);
    })();
    return () => { alive = false; };
  }, []));

  // A pass finished (also one the website asked for after changing the start date): show the new date, status and payments.
  useEffect(() => onMoneySynced(() => { loadAll(month || undefined); }), [loadAll, month]);

  useEffect(() => { if (month && settings && settings.configured && !settings.needsStartDate) loadList(month); }, [month]);

  const refresh = async () => { setRefreshing(true); await loadAll(month); setRefreshing(false); };
  const afterStart = async () => { await loadAll(); await syncNow(); setLast(await lastResult()); await loadList(undefined); };
  const afterSync = async () => { setLast(await lastResult()); await loadList(month || undefined); };

  const ready = settings && settings.configured && !settings.needsStartDate;
  return (
    <Page title="Money" subtitle="Your UPI and bank payments, sorted by month and category, kept in your own Google Sheet." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {settings === null && !error ? <Loading /> : null}
      {settings ? (
        <View style={{ gap: 14 }}>
          {!settings.configured ? <Boundary name="Setup"><SheetSetup settings={settings} onSaved={() => loadAll()} /></Boundary> : null}
          {settings.configured && settings.needsStartDate ? <Boundary name="Start date"><StartDate onDone={afterStart} /></Boundary> : null}
          {settings.configured && !settings.needsStartDate ? (
            <>
              <Boundary name="SMS access"><SmsAccess settings={settings} allowed={allowed} setAllowed={setAllowed} last={last} onSynced={afterSync} /></Boundary>
              {data ? <Boundary name="Needs checking"><Flagged rows={data.flagged} onChange={() => loadList(month || undefined)} /></Boundary> : null}
              {data ? <Boundary name="Sort quickly"><QuickSort month={month || data.month} categories={settings.categories || []} refreshKey={data} onChange={() => loadList(month || undefined)} /></Boundary> : null}
              {data ? <Boundary name="This month"><MonthView data={data} categories={settings.categories || []} month={month || data.month} setMonth={setMonth} filter={filter} setFilter={setFilter} onChange={() => loadList(month || undefined)} /></Boundary> : <Loading />}
              <Boundary name="Statement"><Statement settings={settings} onChecked={() => { loadAll(month); }} /></Boundary>
              <Dim>Reading messages from {dayLabel(settings.startDate)}. Entries stay for {settings.retentionMonths || 4} months in this list; older ones move to the Archive tab of your sheet. Nothing is stored in Stashr's database.</Dim>
            </>
          ) : null}
          {ready ? null : null}
        </View>
      ) : null}
    </Page>
  );
}
