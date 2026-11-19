/*
 * Bandwidth meter. The free Render plan has a small monthly allowance, so this counts the bytes that really leave the server (after
 * compression), per route, and says which routes use it. Mount it BEFORE compression() so it sees the compressed bytes.
 *   - GET /system/bandwidth (admin) shows the top routes, who calls them, and the bytes per day at the current rate.
 *   - once an hour a one-line top-5 goes to the log (Render's log page) so it can be read without logging in.
 * Counts live in memory since the last start (Render restarts a free instance when it sleeps), so the per-day figure is a rate.
 */
const startedAt = Date.now();
const routes = new Map();                                 // "GET /home/agent/state" -> { n, bytes, max, in }
let total = 0, totalIn = 0;

/** The route a request matched, with ids folded away, so /x/123 and /x/456 count together. */
const labelOf = (req) => {
  const base = (req.baseUrl || "") + ((req.route && req.route.path) || "");
  const raw = base && base !== "/" ? base : req.path;
  return `${req.method} ${String(raw).replace(/\/[0-9a-f]{24}\b/gi, "/:id").replace(/\/[0-9a-f-]{32,}/gi, "/:id").replace(/\/\d+/g, "/:n").slice(0, 90)}`;
};
const clientOf = (req) => {
  const x = String(req.headers["x-client"] || "").toLowerCase();
  if (x) return x.slice(0, 20);
  return /okhttp|dalvik|java/i.test(req.headers["user-agent"] || "") ? "android-app" : /mozilla/i.test(req.headers["user-agent"] || "") ? "browser" : "other";
};

function meter(req, res, next) {
  let out = 0;
  const write = res.write, end = res.end;
  res.write = function (chunk, ...a) { if (chunk) out += Buffer.byteLength(chunk, typeof a[0] === "string" ? a[0] : undefined); return write.call(this, chunk, ...a); };
  res.end = function (chunk, ...a) { if (chunk && typeof chunk !== "function") out += Buffer.byteLength(chunk, typeof a[0] === "string" ? a[0] : undefined); return end.call(this, chunk, ...a); };
  res.on("close", () => {
    const key = labelOf(req), inb = Number(req.headers["content-length"]) || 0;
    const e = routes.get(key) || { n: 0, bytes: 0, max: 0, in: 0, clients: {} };
    e.n++; e.bytes += out; e.in += inb; if (out > e.max) e.max = out;
    const c = clientOf(req); e.clients[c] = (e.clients[c] || 0) + out;
    routes.set(key, e);
    total += out; totalIn += inb;
    if (routes.size > 600) { const smallest = [...routes].sort((a, b) => a[1].bytes - b[1].bytes)[0]; routes.delete(smallest[0]); }
  });
  next();
}

const mb = (b) => Math.round((b / 1048576) * 100) / 100;

function report(limit = 25) {
  const hours = Math.max(0.01, (Date.now() - startedAt) / 3600000);
  const top = [...routes].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, limit).map(([route, e]) => ({
    route, requests: e.n, sentMB: mb(e.bytes), avgKB: Math.round(e.bytes / e.n / 102.4) / 10, maxKB: Math.round(e.max / 102.4) / 10, sharePct: total ? Math.round((e.bytes / total) * 1000) / 10 : 0,
    perDayMB: mb((e.bytes / hours) * 24), receivedMB: mb(e.in), byClientMB: Object.fromEntries(Object.entries(e.clients).map(([k, v]) => [k, mb(v)]))
  }));
  return { since: new Date(startedAt).toISOString(), hours: Math.round(hours * 10) / 10, sentMB: mb(total), receivedMB: mb(totalIn), perDayMB: mb((total / hours) * 24), perMonthMB: mb((total / hours) * 24 * 30), top };
}

function reset() { routes.clear(); total = 0; totalIn = 0; }

/** An hourly line for the log. */
function startLog(everyMs = 3600000) {
  const t = setInterval(() => {
    const r = report(5);
    console.log(`[bandwidth] ${r.sentMB} MB sent in ${r.hours} h (${r.perMonthMB} MB/month at this rate). Top: ` + r.top.map((x) => `${x.route} ${x.sentMB}MB/${x.requests}req`).join(" | "));
  }, everyMs);
  if (t.unref) t.unref();
  return t;
}

module.exports = { meter, report, reset, startLog, labelOf };
