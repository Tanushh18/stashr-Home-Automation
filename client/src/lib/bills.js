/* Bills: wording for due dates, and the banner's "hide until tomorrow" memory (this browser only). */

export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function whenWord(bill) {
  const d = bill.daysLeft;
  if (bill.status === "paid") return bill.paidAt ? `paid on ${bill.paidAt}` : "paid";
  if (d == null) return "";
  if (d < 0) return `overdue by ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

export const TONE = { overdue: "bad", today: "bad", soon: "warn", later: "", paid: "ok" };

const KEY = "stashr.bills.hiddenDay";
const DAYS_KEY = "stashr.bills.bannerDays";

/** The banner is hidden for the rest of the day it was dismissed on; the next day it comes back. */
export function hiddenToday(today = todayLocal()) { try { return localStorage.getItem(KEY) === today; } catch { return false; } }
export function hideForToday(today = todayLocal()) { try { localStorage.setItem(KEY, today); } catch { /* private window */ } }
export function bannerDays() { try { const n = Number(localStorage.getItem(DAYS_KEY)); return Number.isFinite(n) && n >= 0 && n <= 30 && localStorage.getItem(DAYS_KEY) !== null ? Math.round(n) : 3; } catch { return 3; } }
export function setBannerDays(n) { try { localStorage.setItem(DAYS_KEY, String(n)); } catch { /* ignore */ } }
