import { request } from "./api";

/* The search assistant (server/router/assistant.js): AI answers and Google results. Only the typed words are sent. */
export const assistant = {
  status: () => request("/assistant/status", { timeout: 15000 }),
  ask: (q, provider) => request("/assistant/ask", { method: "POST", body: { q, provider }, timeout: 40000 }),
  web: (q) => request(`/assistant/web?q=${encodeURIComponent(q)}`, { timeout: 25000 }),
};
