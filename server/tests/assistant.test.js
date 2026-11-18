const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const ai = require("../utils/aiAssistant");

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_CSE_KEY", "GOOGLE_CSE_CX"];
const reply = (body, ok = true) => async () => ({ ok, json: async () => body });
beforeEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("search assistant", () => {
    test("no key: a clear message, nothing sent", async () => {
        let e; try { await ai.ask("hi", { fetchImpl: async () => { throw new Error("no"); } }); } catch (x) { e = x; }
        expect(e.status).toBe(503);
    });
    test("the chosen provider answers; a failing one falls through to the next", async () => {
        process.env.ANTHROPIC_API_KEY = "a"; process.env.OPENAI_API_KEY = "b";
        const urls = [];
        const f = async (url) => { urls.push(url); return url.includes("anthropic") ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ choices: [{ message: { content: " 4 " } }] }) }; };
        const r = await ai.ask("2+2?", { want: "claude", fetchImpl: f });
        expect(r.provider).toBe("chatgpt"); expect(r.answer).toBe("4"); expect(urls.length).toBe(2);
    });
    test("Claude's reply is read from its content blocks", async () => {
        process.env.ANTHROPIC_API_KEY = "a";
        expect((await ai.ask("hello", { fetchImpl: reply({ content: [{ type: "text", text: "Namaste" }] }) })).answer).toBe("Namaste");
    });
    test("web results need the Google keys, keep only https links", async () => {
        expect(await ai.web("cricket")).toEqual([]);
        process.env.GOOGLE_CSE_KEY = "k"; process.env.GOOGLE_CSE_CX = "x";
        const r = await ai.web("cricket", { fetchImpl: reply({ items: [{ title: "A", link: "https://a.com/x", snippet: "s", displayLink: "a.com" }, { title: "B", link: "http://b.com" }] }) });
        expect(r.length).toBe(1); expect(r[0].host).toBe("a.com");
    });
});
