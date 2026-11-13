import { request, requestBytes } from "./api";

/* The Money calls (server/router/expenses.js). Transactions live only in the owner's Google Sheet; the server reads and writes it. */
const j = (path, method, body, timeout) => request(path, { method, body, timeout });

export const money = {
  settings: () => request("/expenses/settings"),
  saveSheet: (sheetUrl) => j("/expenses/sheet", "PUT", { sheetUrl }, 40000),
  start: (date) => j("/expenses/start", "POST", { date }),
  syncDone: (result) => j("/expenses/sync-done", "POST", { result }, 20000),
  sms: (messages) => j("/expenses/sms", "POST", { messages }, 60000),
  list: (month) => request(`/expenses${month ? `?month=${encodeURIComponent(month)}` : ""}`, { timeout: 40000 }),
  setCategory: (index, category, remember) => j("/expenses/category", "PUT", { index, category, remember: Boolean(remember) }, 40000),
  uncategorized: (month) => request(`/expenses/uncategorized${month ? `?month=${encodeURIComponent(month)}` : ""}`, { timeout: 30000 }),
  review: (index, action) => j("/expenses/review", "PUT", { index, action }, 40000),
  // A locked Excel file: the password goes in a header (URL-encoded), never the address. month = "YYYY-MM" to match only that month.
  statement: (filename, bytes, { password, month } = {}) => requestBytes(
    `/expenses/statement?filename=${encodeURIComponent(filename)}${month ? `&month=${encodeURIComponent(month)}` : ""}`, bytes,
    { timeout: 120000, headers: password ? { "X-Statement-Password": encodeURIComponent(password) } : undefined }),
  // Statements kept (encrypted) for searching later.
  savedStatements: () => request("/expenses/statement/saved", { timeout: 30000 }),
  searchStatements: (q, month) => request(`/expenses/statement/search?q=${encodeURIComponent(q)}${month ? `&month=${encodeURIComponent(month)}` : ""}`, { timeout: 30000 }),
  deleteSavedStatement: (id) => j(`/expenses/statement/saved/${id}`, "DELETE"),
};
