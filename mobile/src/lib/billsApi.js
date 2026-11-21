import { request } from "./api";

/* The Bills calls (server/router/bills.js). Marking a bill paid also adds the expense to Money on the server. */
export const bills = {
  due: (days = 3) => request(`/bills/due?days=${days}`, { timeout: 30000 }),
  pay: (id, amount) => request(`/bills/${id}/pay`, { method: "POST", body: amount ? { amount } : {}, timeout: 40000 }),
};

export const billWhen = (b) => {
  const d = b.daysLeft;
  return d == null ? "" : d < 0 ? `overdue by ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`;
};
