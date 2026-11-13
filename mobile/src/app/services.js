import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Page, Loading, Note } from "../components/kit";
import { Box, Btn, Dim, Good, Bad, Txt, Row, Boundary } from "../components/home/h";
import { admin } from "../lib/adminApi";
import { useTheme, alpha } from "../lib/theme";
import { formatAmount, forecastText, summarize, projectSummary, accountRows, metricRows, STATUS_LABEL } from "../lib/servicesUtils";

const STATE_TEXT = {
  "no-credentials": "Keys needed to read usage are not set on this service",
  "in-code": "Used in the code, but no credentials are set",
  "no-reader": "No usage API",
  disabled: "Tracking off",
  error: "Could not read usage",
};

function Bar({ percent, status }) {
  const { theme } = useTheme();
  const colour = status === "critical" ? theme.danger : status === "warn" ? theme.warn : theme.ok;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(theme.textFaint, 0.25), overflow: "hidden" }}>
      <View style={{ width: `${Math.max(2, Math.min(100, percent || 0))}%`, height: 8, backgroundColor: colour }} />
    </View>
  );
}

const Status = ({ status }) => (status === "ok" ? <Good>{STATUS_LABEL.ok}</Good> : status === "unknown" ? <Dim>{STATUS_LABEL.unknown}</Dim> : <Bad>{STATUS_LABEL[status]}</Bad>);

/** Services: how much of each provider's limit every Render app is using (database storage, bandwidth, build hours, credits...). */
export default function Services() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (fresh) => { try { setData(await admin.liveDashboard(fresh)); setError(""); } catch (e) { setError(e.message || "Could not load the services."); } }, []);
  useEffect(() => { load(false); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };
  const sum = data ? summarize(data) : null;
  return (
    <Page title="Services" subtitle="How close each app is to the limits of the services it uses." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <View style={{ gap: 14 }}>
          <Box title="Overview">
            <Row gap={18}>
              <View><Txt bold>{data.projectCount ?? data.projects.length}</Txt><Dim>live projects</Dim></View>
              <View><Txt bold>{sum.tracked}</Txt><Dim>services tracked</Dim></View>
              <View>{sum.warn + sum.critical ? <Bad>{sum.warn + sum.critical}</Bad> : <Good>0</Good>}<Dim>need attention</Dim></View>
            </Row>
            {sum.soonest ? <Dim>{`Soonest to run out: ${sum.soonest.project} · ${sum.soonest.label}, about ${new Date(sum.soonest.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}</Dim> : null}
            <Dim>{`${data.liveCount} of ${data.totalCount} Render services are live.`}</Dim>
          </Box>
          {data.projects.map((p) => {
            const s = projectSummary(p), isOpen = open === p.id;
            return (
              <Boundary key={p.id} name={p.name}>
                <Box title={p.name} subtitle={`${s.services} service${s.services === 1 ? "" : "s"}${p.accountName ? ` · ${p.accountName}` : ""}`} right={<Status status={s.status} />}>
                  {s.worst ? (
                    <View style={{ gap: 4 }}>
                      <Bar percent={s.worst.percent} status={s.worst.status} />
                      <Dim>{`${Math.round(s.worst.percent)}% · ${s.worst.service} · ${s.worst.label}`}</Dim>
                      <Dim>{forecastText(s.worst)}</Dim>
                    </View>
                  ) : <Dim>No limit data.</Dim>}
                  <Row><Btn label={isOpen ? "Hide details" : "Details"} onPress={() => setOpen(isOpen ? "" : p.id)} /></Row>
                  {isOpen ? (p.services || []).map((svc) => {
                    const withData = svc.state === "ok" && metricRows(svc).length;
                    return (
                      <View key={svc.label + (svc.id || "")} style={{ gap: 4, paddingTop: 8 }}>
                        <Txt bold>{svc.label}</Txt>
                        {!withData ? <Dim>{STATE_TEXT[svc.state] || svc.state}{svc.error ? `: ${svc.error}` : ""}</Dim> : accountRows(svc).map((r, i) => (
                          <View key={i} style={{ gap: 3 }}>
                            {r.label || r.plan ? <Dim>{[r.label, r.plan].filter(Boolean).join(" · ")}</Dim> : null}
                            {r.headline.map((m, j) => (
                              <View key={j} style={{ gap: 2 }}>
                                {m.percent != null ? <Bar percent={m.percent} status={m.status} /> : null}
                                <Dim>{`${m.label}: ${formatAmount(m.used, m.unit)}${m.limit != null ? ` of ${formatAmount(m.limit, m.unit)}` : ""}${m.percent != null ? ` (${Math.round(m.percent)}%)` : ""}`}</Dim>
                                {forecastText(m) ? <Dim>{forecastText(m)}</Dim> : null}
                              </View>
                            ))}
                            {r.details.length ? <Dim>{r.details.map((m) => `${m.label.replace(/ this month$/i, "")} ${formatAmount(m.used, m.unit)}`).join(" · ")}</Dim> : null}
                            {(r.notes || []).map((n, k) => <Dim key={k}>{n}</Dim>)}
                          </View>
                        ))}
                      </View>
                    );
                  }) : null}
                </Box>
              </Boundary>
            );
          })}
        </View>
      ) : null}
    </Page>
  );
}
