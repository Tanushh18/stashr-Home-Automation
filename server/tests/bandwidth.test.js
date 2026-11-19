// The bandwidth meter counts the bytes that really leave (after compression), per route with ids folded away.
const { describe, test } = require("node:test");
const expect = require("./expect");
const express = require("express");
const compression = require("compression");
const request = require("supertest");
const bw = require("../middlewares/bandwidth");

const app = express();
app.use(bw.meter);
app.use(compression());
const big = { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, text: "the same words again and again " + i })) };
app.get("/things/:id", (req, res) => res.json(big));
app.get("/small", (req, res) => res.json({ ok: true }));

describe("bandwidth meter", () => {
    test("counts compressed bytes per route, folds ids together, and ranks the heaviest first", async () => {
        bw.reset();
        for (const id of ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012", "7"]) await request(app).get("/things/" + id).set("Accept-Encoding", "gzip");
        await request(app).get("/small");
        await new Promise((r) => setTimeout(r, 50));
        const r = bw.report();
        expect(r.top[0].route).toMatch(/^GET \/things\/:/);
        expect(r.top[0].requests).toBe(3);
        const raw = Buffer.byteLength(JSON.stringify(big)) * 3;
        expect(r.top[0].sentMB * 1048576 < raw / 3).toBe(true);        // gzip made it far smaller than the raw JSON
        expect(r.top.some((x) => x.route === "GET /small")).toBe(true);
        expect(r.perMonthMB > 0).toBe(true);
    });
});
