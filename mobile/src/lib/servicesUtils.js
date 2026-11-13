const nf = (n, d = 1) => new Intl.NumberFormat(undefined, { maximumFractionDigits: d }).format(n);

/** Human-readable amount for a usage unit (bytes -> MB/GB, hours, credits, money...). */
export function formatAmount(value, unit) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "bytes") {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = value, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return nf(v, v >= 100 || i === 0 ? 0 : 1) + " " + units[i];
  }
  if (unit === "count") return nf(value, 0);
  if (/^[A-Z]{3}$/.test(unit || "")) return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + " " + unit;
  return nf(value, value >= 100 ? 0 : 1) + (unit ? " " + unit : "");
}

/** One-line forecast for a projected metric. */
export function forecastText(m) {
  if (m.status === "unknown" && m.note) return m.note;
  if (m.method === "reached") return "Limit reached.";
  if (m.willLast === true) return m.resetsInDays != null ? "On track to last until the quota resets (in " + nf(m.resetsInDays, 1) + " d)." : (m.note || "Not running out at the current rate.");
  if (m.daysLeft != null) {
    const left = m.daysLeft < 1 ? "about " + nf(m.daysLeft * 24, 0) + " h" : "about " + nf(m.daysLeft, 1) + " days";
    return "At the current rate it runs out in " + left + (m.exhaustsAt ? " (" + new Date(m.exhaustsAt).toLocaleString() + ")" : "") + ".";
  }
  return m.note || "";
}

export const STATUS_LABEL = { ok: "Healthy", warn: "Getting low", critical: "Almost out", unknown: "No limit data" };

/** Counts metrics by status across the dashboard for the summary tiles. */
export function summarize(data) {
  let tracked = 0, warn = 0, critical = 0, soonest = null;
  for (const p of data?.projects || []) for (const s of p.services) {
    if (s.state === "ok") tracked += 1;
    for (const r of s.reports || []) for (const m of r.metrics) {
      if (m.status === "warn") warn += 1;
      if (m.status === "critical") critical += 1;
      if (m.exhaustsAt && (!soonest || Date.parse(m.exhaustsAt) < Date.parse(soonest.at))) soonest = { at: m.exhaustsAt, label: m.label, project: p.name };
    }
  }
  return { tracked, warn, critical, soonest };
}

const RANK = { critical: 3, warn: 2, ok: 1, unknown: 0 };

/** Worst metric across a project's services, plus counts for the project list. */
export function projectSummary(project) {
  let worst = null, metrics = 0, issues = 0;
  for (const s of project.services || []) {
    if (s.state === "error") issues += 1;
    for (const r of s.reports || []) for (const m of r.metrics) {
      if (m.limit == null && m.kind !== "balance") continue;
      metrics += 1;
      if (m.percent != null && (!worst || RANK[m.status] > RANK[worst.status] || (RANK[m.status] === RANK[worst.status] && m.percent > worst.percent))) worst = { ...m, service: s.label };
    }
  }
  const status = worst ? worst.status : issues ? "warn" : "unknown";
  return { status, worst, metrics, issues, services: (project.services || []).length };
}

/**
 * One row per provider account: the metric that has a limit (or a balance) is the headline; figures without a limit
 * become a compact detail line under it instead of rows full of "no limit" dashes.
 */
export function accountRows(svc) {
  return (svc.reports || []).map((r) => {
    const headline = r.metrics.filter((m) => m.limit != null || m.kind === "balance");
    const details = r.metrics.filter((m) => !headline.includes(m));
    return { label: r.label, plan: r.plan, notes: r.notes || [], headline, details };
  });
}

/** Flattens a service's reports into metrics (used by summaries). */
export function metricRows(svc) {
  const rows = [];
  for (const r of svc.reports || []) for (const m of r.metrics) rows.push({ ...m, report: r.label, plan: r.plan, multi: (svc.reports || []).length > 1 });
  return rows;
}
