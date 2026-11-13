import { request } from "./api";

/* The WhatsApp sender calls: the same ones the website's WhatsApp page makes (server/router/wa.js). */
const j = (path, method, body, timeout) => request(path, { method, body, timeout });

export const wa = {
  overview: () => request("/wa/overview", { timeout: 30000 }),
  saveSettings: (body) => j("/wa/settings", "PUT", body),
  saveSheet: (id, body) => j(`/wa/sheets/${id}`, "PATCH", body, 40000),
  createSheet: (name, source) => j("/wa/sheets", "POST", source ? { name, source } : { name }),
  // The We Three account (lead sheets that can be brought in as sheets here).
  link: () => request("/wa/threads"),
  connectLink: (mobile, mpin) => j("/wa/threads/connect", "POST", { mobile, mpin }, 45000),
  disconnectLink: () => j("/wa/threads", "DELETE"),
  origins: () => request("/wa/threads/origins", { timeout: 45000 }),
  importOrigin: (origin) => j("/wa/threads/import", "POST", { origin }, 180000),
  deleteSheet: (id) => j(`/wa/sheets/${id}`, "DELETE"),
  addPeople: (id, recipients) => j(`/wa/sheets/${id}/recipients`, "POST", { recipients }, 60000),
  retrySheet: (id) => j(`/wa/sheets/${id}/retry`, "POST", {}),
  resetSheet: (id) => j(`/wa/sheets/${id}/reset`, "POST", {}),
  reportNow: () => j("/wa/report/now", "POST", {}),
  test: (body) => j("/wa/test", "POST", body),
  send: (id) => request(`/wa/sends/${id}`),
  pictures: () => request("/wa/pictures"),
  picture: (sheet, index) => request(`/wa/pictures/${sheet}/${index}`, { timeout: 30000 }),
};

export { peopleFromLines } from "./waContacts";

/** Messages in the box are separated by a line with only three dashes (a message can have several lines). */
export const textsToBox = (texts) => (texts || []).join("\n---\n");
export const boxToTexts = (box) => String(box || "").split(/\n[ \t]*---[ \t]*\n/).map((t) => t.trim()).filter(Boolean);

const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayWord = (at) => { const d = new Date(at), n = new Date(); return d.toDateString() === n.toDateString() ? "" : d.toDateString() === new Date(n.getTime() + 864e5).toDateString() ? " tomorrow" : ` on ${d.getDate()}/${d.getMonth() + 1}`; };
const inWhen = (at) => { const m = Math.round((new Date(at).getTime() - Date.now()) / 60000); return m <= 0 ? "any moment now" : m < 60 ? `in about ${m} min` : ""; };

/** The sentence for "when is the next message": { state: next | later | blocked, at, reason, after }. */
export function nextText(plan, who = "") {
  if (!plan) return "";
  const when = plan.at ? `${clock(plan.at)}${dayWord(plan.at)}${inWhen(plan.at) ? ` (${inWhen(plan.at)})` : ""}` : "";
  const why = plan.reason ? ` ${plan.reason}.` : "";
  if (plan.state === "blocked") return plan.at ? `${plan.reason}. It will go at ${when} once that is fixed.` : `None. ${plan.reason}.`;
  if (plan.state === "later") return `After ${plan.after} other sheet${plan.after === 1 ? "" : "s"} have had their turn, about ${when}.${why}`;
  return `${who ? `From ${who}: ` : ""}${when}.${why}`;
}

export const STEP_MARK = { ok: "✓", failed: "✗", skipped: "–" };
export const WHO = { server: "The server", tablet: "The tablet", whatsapp: "WhatsApp" };
