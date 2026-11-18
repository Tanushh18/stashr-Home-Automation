import React, { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { router } from "expo-router";
import { Page, Note } from "../components/kit";
import { Box, Btn, Dim, Input, Row, Sub, Txt, Bad, useAct } from "../components/home/h";
import { assistant } from "../lib/assistantApi";
import { money } from "../lib/moneyApi";
import { home } from "../lib/homeApi";
import { findScreens, looksLikeCommand } from "../lib/searchIndex";
import { inr } from "../lib/moneyFmt";

/**
 * Stashr Search: one box for the app's screens, your saved bank statement lines, the house ("tv band karo"), Google results and an AI answer
 * (Claude, ChatGPT, Gemini or Groq, whichever the server has a key for). Tap the mic on the keyboard to speak instead of typing.
 */
export default function Search() {
  const act = useAct();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(null);
  const [web, setWeb] = useState(null);
  const [lines, setLines] = useState(null);
  const [ai, setAi] = useState(null);
  const [house, setHouse] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => { assistant.status().then(setStatus).catch(() => setStatus({ providers: [], web: false })); }, []);

  // typing: screens are instant; web results and statement lines follow after a short pause
  useEffect(() => {
    const text = q.trim();
    setAi(null); setHouse(null);
    if (text.length < 2) { setWeb(null); setLines(null); return undefined; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (/\d|^[a-z]{3,}/i.test(text)) money.searchStatements(text).then((r) => mine === seq.current && setLines(r)).catch(() => mine === seq.current && setLines(null));
      if (status && status.web) assistant.web(text).then((r) => mine === seq.current && setWeb(r.results)).catch(() => mine === seq.current && setWeb(null));
    }, 500);
    return () => clearTimeout(t);
  }, [q, status]);

  const ask = async (provider) => {
    setBusy("ai"); setError("");
    try { setAi(await assistant.ask(q.trim(), provider)); } catch (e) { setError(e.message || "No answer."); } finally { setBusy(""); }
  };
  const command = async () => {
    setBusy("house"); setError("");
    try { setHouse(await home.assistant(q.trim())); } catch (e) { setError(e.message || "Could not do that."); } finally { setBusy(""); }
  };

  const text = q.trim();
  const screens = findScreens(text);
  const providers = (status && status.providers) || [];
  return (
    <Page title="Search" subtitle="Screens, statements, the house, Google and AI in one box. Use the keyboard's mic to speak.">
      <View style={{ gap: 14 }}>
        <Input value={q} onChangeText={setQ} placeholder="Search or ask anything…" autoCapitalize="sentences" />
        {error ? <Bad>{error}</Bad> : null}

        {screens.length ? (
          <Box title="Open">
            {screens.map((s) => <Row key={s.path + s.title}><Btn label={s.title} kind="primary" onPress={() => router.push(s.path)} /><Dim>{s.sub}</Dim></Row>)}
          </Box>
        ) : null}

        {text.length >= 2 && looksLikeCommand(text) ? (
          <Box title="Tell the house">
            <Row><Btn label={`Do: “${text}”`} kind="primary" disabled={busy === "house"} onPress={command} /></Row>
            {house ? <Txt>{house.reply || "Done."}</Txt> : null}
          </Box>
        ) : null}

        {lines && lines.total > 0 ? (
          <Box title={`In your bank statements (${lines.total})`}>
            {lines.results.slice(0, 5).map((x, i) => (
              <Row key={i} style={{ justifyContent: "space-between" }}>
                <View style={{ flexShrink: 1 }}><Txt numberOfLines={1}>{x.desc || x.merchant || "—"}</Txt><Dim>{x.date}</Dim></View>
                <Txt bold>{x.type === "Credit" ? "+" : "−"}{inr(x.amount)}</Txt>
              </Row>
            ))}
            <Btn label="Open Money" onPress={() => router.push("/money")} />
          </Box>
        ) : null}

        {text.length >= 2 ? (
          <Box title="Ask an AI">
            {providers.length ? (
              <Row>{providers.map((p, i) => <Btn key={p.id} label={p.label} kind={i === 0 ? "primary" : "quiet"} disabled={busy === "ai"} onPress={() => ask(p.id)} />)}</Row>
            ) : <Dim>No AI is connected. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or GROQ_API_KEY on the server.</Dim>}
            {busy === "ai" ? <Dim>Thinking…</Dim> : null}
            {ai ? <><Txt>{ai.answer}</Txt><Dim>Answered by {ai.label}. Only the words you typed were sent.</Dim></> : null}
          </Box>
        ) : null}

        {text.length >= 2 ? (
          <Box title="Google">
            {(web || []).map((w) => (
              <View key={w.link} style={{ gap: 2 }}>
                <Txt bold onPress={() => Linking.openURL(w.link)}>{w.title}</Txt>
                <Dim>{w.host} · {w.snippet}</Dim>
              </View>
            ))}
            <Row><Btn label="Search on Google" onPress={() => Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(text)}`)} /></Row>
            {status && !status.web ? <Dim>For results right here, set GOOGLE_CSE_KEY and GOOGLE_CSE_CX on the server.</Dim> : null}
          </Box>
        ) : null}
      </View>
    </Page>
  );
}
