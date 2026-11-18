/*
 * The Stashr search assistant: answers a typed (or dictated) question with whichever AI provider the server has a key for, and fetches
 * Google results when a Programmable Search key is set. Only the words the person typed are sent out: never passwords, money or any
 * other Stashr data. Every network call takes an injectable `fetchImpl` so the tests run without the internet.
 */
const SYSTEM = "You are Stashr Assistant inside a phone launcher's search bar. Answer in the language the person used (Hinglish is fine), in at most 6 short lines. Be direct. If you are not sure, say so. Never ask for passwords or bank details.";
const TIMEOUT = 20000;

/** Providers in the order they are tried when none is chosen. Each is on only when its key is in the server's environment. */
const PROVIDERS = [
    { id: "claude", label: "Claude", key: "ANTHROPIC_API_KEY", model: () => process.env.ANTHROPIC_MODEL || "claude-haiku-5-5" },
    { id: "chatgpt", label: "ChatGPT", key: "OPENAI_API_KEY", model: () => process.env.OPENAI_MODEL || "gpt-4.1-mini" },
    { id: "groq", label: "Groq", key: "GROQ_API_KEY", model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
    { id: "gemini", label: "Gemini", key: "GEMINI_API_KEY", model: () => process.env.GEMINI_MODEL || "gemini-2.0-flash" }
];

const available = () => PROVIDERS.filter((p) => process.env[p.key]).map((p) => ({ id: p.id, label: p.label, model: p.model() }));
const webReady = () => Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX);
const clean = (q, n = 400) => String(q || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

async function postJson(fetchImpl, url, headers, body) {
    const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error("The AI provider rejected the request."), { status: 502 });
    return j;
}

const CALLS = {
    claude: async (f, key, model, q) => {
        const j = await postJson(f, "https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, { model, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: q }] });
        return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    },
    chatgpt: async (f, key, model, q) => (await postJson(f, "https://api.openai.com/v1/chat/completions", { Authorization: `Bearer ${key}` }, { model, max_tokens: 400, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }] }))?.choices?.[0]?.message?.content,
    groq: async (f, key, model, q) => (await postJson(f, "https://api.groq.com/openai/v1/chat/completions", { Authorization: `Bearer ${key}` }, { model, max_tokens: 400, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }] }))?.choices?.[0]?.message?.content,
    gemini: async (f, key, model, q) => (await postJson(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: q }] }] }))?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n")
};

/** -> { provider, label, answer }. `want` picks a provider; when it is missing or fails, the next available one answers. */
async function ask(question, { want = "", fetchImpl = fetch } = {}) {
    const q = clean(question);
    if (!q) throw Object.assign(new Error("Type a question first."), { status: 400 });
    const list = available();
    if (!list.length) throw Object.assign(new Error("No AI is connected yet. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY or GEMINI_API_KEY on the server."), { status: 503 });
    const order = [...list.filter((p) => p.id === want), ...list.filter((p) => p.id !== want)];
    let last = null;
    for (const p of order) {
        try {
            const def = PROVIDERS.find((x) => x.id === p.id);
            const text = await CALLS[p.id](fetchImpl, process.env[def.key], p.model, q);
            if (typeof text === "string" && text.trim()) return { provider: p.id, label: p.label, answer: text.trim().slice(0, 2000) };
        } catch (e) { last = e; }
    }
    throw Object.assign(new Error((last && last.message) || "The AI did not answer."), { status: 502 });
}

/** Google results through a Programmable Search Engine: [{ title, link, snippet, host }]; [] when it is not set up. */
async function web(query, { fetchImpl = fetch, count = 6 } = {}) {
    const q = clean(query, 200);
    if (!q || !webReady()) return [];
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_CX)}&num=${Math.min(10, count)}&q=${encodeURIComponent(q)}`;
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error("Google search did not answer."), { status: 502 });
    return (j.items || []).map((i) => ({ title: String(i.title || "").slice(0, 160), link: String(i.link || ""), snippet: String(i.snippet || "").replace(/\s+/g, " ").slice(0, 240), host: String(i.displayLink || "") })).filter((i) => /^https:\/\//.test(i.link));
}

module.exports = { ask, web, available, webReady, clean };
