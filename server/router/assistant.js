/*
 * Search assistant for the phone launcher and the Stashr app's search screen.
 *   GET  /assistant/status          which AIs and web search are connected
 *   POST /assistant/ask {q, provider?}   an AI answer (Claude, ChatGPT, Groq or Gemini: whichever the server has a key for)
 *   GET  /assistant/web?q=          Google results
 * Only the typed words leave the server; no vault, money or home data is ever added to a question.
 */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const ai = require("../utils/aiAssistant");

const limiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: "Too many questions. Wait a minute." });
const fail = (res, e, fallback) => res.status(Number.isInteger(e.status) ? e.status : 500).json({ error: Number.isInteger(e.status) ? e.message : fallback });

router.get("/assistant/status", authenticate, (req, res) => { res.set("Cache-Control", "no-store"); res.json({ providers: ai.available(), web: ai.webReady() }); });
router.post("/assistant/ask", authenticate, limiter, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(await ai.ask(req.body && req.body.q, { want: String((req.body && req.body.provider) || "") })); }
    catch (e) { return fail(res, e, "Could not get an answer."); }
});
router.get("/assistant/web", authenticate, limiter, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ results: await ai.web(req.query.q), configured: ai.webReady() }); }
    catch (e) { return fail(res, e, "Could not search."); }
});

module.exports = router;
