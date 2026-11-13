const { describe, test } = require("node:test");
const expect = require("./expect");
const m = require("../utils/roomModel");

// A pretend house: each room has its own "fingerprint" of what the phone hears (dBm), plus a little noise on every scan.
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const noise = (s) => Math.round((rnd() - 0.5) * 2 * s);
const FP = {
    Bedroom: { r1: -45, n1: -60, n2: -85, n3: -90, b1: -50 },
    Kitchen: { r1: -60, n1: -80, n2: -55, n3: -88, b2: -48 },
    Hall: { r1: -52, n1: -72, n2: -75, n3: -62, b3: -55 }
};
const scanOf = (room, jitter = 3) => {
    const wifi = [], ble = [];
    for (const [k, base] of Object.entries(FP[room])) (k[0] === "b" ? ble : wifi).push({ b: k, r: Math.min(-30, base + noise(jitter)) });
    return { wifi, ble };
};
const T0 = Date.UTC(2026, 10, 5), DAY = 86400000;
const sampleOf = (room, i, at = T0) => ({ room, vec: m.vectorOf(scanOf(room)), at, session: `${room}-${Math.floor(i / 4)}` });   // 4 scans per tap
const train = (perRoom = 20, at = T0) => Object.keys(FP).flatMap((r) => Array.from({ length: perRoom }, (_, i) => sampleOf(r, i, at)));

describe("scans and distance", () => {
    test("ids are hashed per household and never readable; the strongest of a repeated id wins; junk is dropped", () => {
        const a = m.hashId("owner1", "AA:BB:CC:DD:EE:01"), b = m.hashId("owner1", "aa:bb:cc:dd:ee:01"), c = m.hashId("owner2", "aa:bb:cc:dd:ee:01");
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toMatch(/^[0-9a-f]{12}$/);
        const v = m.vectorOf({ wifi: [{ b: "x", r: -70 }, { b: "x", r: -50 }, { b: "y", r: 5 }, { b: "", r: -40 }], ble: [{ b: "d", r: -80 }] });
        expect(v).toEqual({ "w:x": -50, "b:d": -80 });
    });
    test("the same scan is distance 0, a network heard in only one counts as -100 in the other, Bluetooth counts less", () => {
        const a = { "w:x": -50, "w:y": -60 };
        expect(m.distance(a, a)).toBe(0);
        expect(Math.abs(m.distance({ "w:x": -50 }, { "w:x": -50, "w:y": -60 }) - Math.sqrt((40 * 40) / 2)) < 1e-9).toBe(true);
        const wifiOnly = m.distance({ "w:x": -50 }, { "w:x": -60 }), withBle = m.distance({ "w:x": -50, "b:q": -50 }, { "w:x": -60, "b:q": -50 });
        expect(withBle < wifiOnly).toBe(true);
    });
});

describe("finding the room from ALL the samples", () => {
    const samples = train();
    test("a fresh scan from each room is recognised, with real confidence", () => {
        for (const room of Object.keys(FP)) {
            const g = m.classify(samples, m.vectorOf(scanOf(room)), T0);
            expect(g.room).toBe(room);
            expect(g.confidence > 0.6).toBe(true);
            expect(g.ranking[0].room).toBe(room);
        }
    });
    test("every sample takes part: a lone far-away sample of another room cannot overrule dozens that match", () => {
        const odd = [...samples, { room: "Kitchen", vec: m.vectorOf({ wifi: [{ b: "zz", r: -40 }] }), at: T0, session: "odd" }];
        expect(m.classify(odd, m.vectorOf(scanOf("Bedroom")), T0).room).toBe("Bedroom");
        // and the answer moves as more samples of the right room are added (nothing is cut off at a few nearest)
        const few = samples.filter((s) => s.room !== "Hall" || s.session === "Hall-0");
        const many = m.classify(samples, m.vectorOf(scanOf("Hall")), T0), fewer = m.classify(few, m.vectorOf(scanOf("Hall")), T0);
        expect(many.ranking.find((x) => x.room === "Hall").p >= fewer.ranking.find((x) => x.room === "Hall").p - 0.1).toBe(true);
    });
    test("a scan that looks like nothing known, or only one room trained, is 'not sure', never a wrong guess", () => {
        const alien = m.classify(samples, m.vectorOf({ wifi: [{ b: "q1", r: -40 }, { b: "q2", r: -45 }] }), T0);
        expect(alien.room).toBeNull();
        expect(alien.why).toMatch(/nothing here looks familiar/);
        expect(m.classify(samples.filter((s) => s.room === "Hall"), m.vectorOf(scanOf("Hall")), T0).room).toBeNull();
        expect(m.classify([], {}, T0).room).toBeNull();
    });
    test("old samples fade: a room remembered a year ago counts for little", () => {
        const stale = train(10, T0 - 365 * DAY), fresh = train(10, T0);
        const mixed = [...stale.filter((s) => s.room !== "Hall"), ...fresh.filter((s) => s.room === "Hall")];
        const g = m.classify(mixed, m.vectorOf(scanOf("Hall")), T0);
        expect(g.room).toBe("Hall");
    });
});

describe("honest accuracy", () => {
    test("hiding each tap and guessing it from the rest gives a high score on distinct rooms and shows the confusion", () => {
        const r = m.crossValidate(train(20), T0);
        expect(r.accuracy >= 85).toBe(true);
        expect(r.tested).toBe(60);
        expect(Object.keys(r.perRoom).sort()).toEqual(["Bedroom", "Hall", "Kitchen"]);
        expect(r.confusion.Bedroom.Bedroom >= 15).toBe(true);
        expect(r.thin).toEqual([]);
    });
    test("two rooms that sound the same are caught: low accuracy, a mix-up in the table, thin rooms flagged", () => {
        const same = (room, i) => ({ room, vec: m.vectorOf({ wifi: [{ b: "r1", r: -50 + noise(3) }, { b: "n1", r: -70 + noise(3) }] }), at: T0, session: `${room}-${Math.floor(i / 4)}` });
        const s = [...Array.from({ length: 20 }, (_, i) => same("A", i)), ...Array.from({ length: 20 }, (_, i) => same("B", i)), ...Array.from({ length: 3 }, (_, i) => sampleOf("Hall", i))];
        const r = m.crossValidate(s, T0);
        expect(r.thin).toEqual(["Hall"]);
        const mixups = (r.confusion.A.B || 0) + (r.confusion.B.A || 0) + (r.confusion.A["(not sure)"] || 0) + (r.confusion.B["(not sure)"] || 0);
        expect(mixups > 5).toBe(true);
    });
    test("fewer than two rooms cannot be tested", () => {
        expect(m.crossValidate(train(5).filter((s) => s.room === "Hall"), T0).tested).toBe(0);
    });
});

describe("smoothing: one scan never moves a person", () => {
    test("the first answer is taken, a different room needs two in a row, 'not sure' changes nothing", () => {
        let r = m.smooth(null, "Hall");
        expect(r.changed).toBe(true);
        r = m.smooth(r.state, "Kitchen");
        expect(r.changed).toBe(false); expect(r.state.room).toBe("Hall");
        r = m.smooth(r.state, "Hall");                      // back: the pending move is forgotten
        expect(r.state.pending).toBeNull();
        r = m.smooth(r.state, "Kitchen"); r = m.smooth(r.state, null); r = m.smooth(r.state, "Kitchen");
        expect(r.changed).toBe(false);                      // the "not sure" in between broke the streak
        r = m.smooth(r.state, "Kitchen");
        expect(r.changed).toBe(true); expect(r.state.room).toBe("Kitchen");
    });
});

/* ───────── auto-improve and accuracy (docs/ROOM_MODEL_AUTO_IMPROVE_PLAN.md) ───────── */

describe("accuracy fixes: where a label came from, Bluetooth on/off, networks that are gone", () => {
    test("a correction counts more than a tap, an auto sample less, and a room's score is a weighted average", () => {
        expect(m.srcWeight("fix") > m.srcWeight("train")).toBe(true);
        expect(m.srcWeight("auto") < m.srcWeight("train")).toBe(true);
        expect(m.srcWeight("confirm")).toBe(1);
        expect(m.srcWeight(undefined)).toBe(1);
        // the same spot labelled twice: the person's correction beats an auto label
        const v = m.vectorOf(scanOf("Hall"));
        const base = train(10).filter((s) => s.room !== "Hall");
        const tie = [...base, { room: "Hall", vec: v, at: T0, session: "x", src: "fix" }, { room: "Kitchen", vec: v, at: T0, session: "y", src: "auto" }];
        const g = m.classify(tie, v, T0);
        expect(g.ranking.find((r) => r.room === "Hall").p > g.ranking.find((r) => r.room === "Kitchen").p).toBe(true);
    });
    test("a scan taken with Bluetooth off is not 'far' from samples that had Bluetooth (only the kinds both heard count)", () => {
        const samples = train();
        const wifiOnly = (room) => ({ wifi: scanOf(room).wifi, ble: [] });
        for (const room of Object.keys(FP)) {
            const g = m.classify(samples, m.vectorOf(wifiOnly(room)), T0);
            expect(g.room).toBe(room);
            expect(g.nearest < 8).toBe(true);                     // before: the missing Bluetooth device added ~45 dBm of difference
        }
        expect(m.kindsOf({ "w:a": -50, "b:c": -60 })).toEqual({ w: true, b: true });
        expect(m.distance({ "w:a": -50 }, { "b:c": -50 }) > 30).toBe(true);    // nothing in common: far apart
    });
    test("a network loud in old samples but heard in none of the recent ones of its rooms is gone; a room with no recent data keeps its networks", () => {
        const old = (room, i) => ({ room, vec: { ...m.vectorOf(scanOf(room)), "w:oldrouter": -50, ...(room === "Hall" ? { "b:tv": -45 } : {}) }, at: T0 - 30 * DAY, session: `o-${room}-${i}` });
        const fresh = (room, i) => ({ room, vec: m.vectorOf({ wifi: scanOf(room).wifi, ble: [] }), at: T0 - DAY, session: `f-${room}-${i}` });
        const guest = (i) => ({ room: "Guest", vec: { "w:beacon": -45, "w:r1": -70 }, at: T0 - 30 * DAY, session: `g-${i}` });
        const samples = [...["Bedroom", "Kitchen", "Hall"].flatMap((r) => [0, 1, 2, 3].flatMap((i) => [old(r, i), fresh(r, i)])), guest(0), guest(1)];
        const gone = m.goneKeys(samples, T0);
        expect(gone.has("w:oldrouter")).toBe(true);
        expect(gone.has("w:beacon")).toBe(false);                 // the guest room has no recent scans: nothing is proven
        expect(gone.has("b:tv")).toBe(false);                     // the recent scans had Bluetooth off: they prove nothing about Bluetooth
        // ignoring the gone router brings a new scan much closer to its room
        const live = m.vectorOf({ wifi: scanOf("Kitchen").wifi, ble: [] });
        const oldOnly = samples.filter((s) => s.session.startsWith("o-"));
        expect(m.classify(oldOnly, live, T0, { gone }).nearest < m.classify(oldOnly, live, T0).nearest - 10).toBe(true);
    });
});

describe("auto-improve: when a live scan may teach the model", () => {
    const now = T0 + 3600000;
    const samples = train(20);
    const vec = m.vectorOf(scanOf("Bedroom"));
    const guess = m.classify(samples, vec, now);
    const ok = { on: true, ageSec: 20, guess, prevRoom: "Bedroom", prevAt: now - 15 * 60000, nextRoom: "Bedroom", samples, vec, now };
    test("a sure, settled, fresh scan at a familiar spot of a well-trained room is learned", () => {
        expect(guess.room).toBe("Bedroom");
        expect(m.autoGate(ok)).toEqual({ ok: true });
    });
    test("every rule says no on its own", () => {
        const why = (patch) => m.autoGate({ ...ok, ...patch }).why;
        expect(why({ on: false })).toMatch(/off/);
        expect(why({ pausedUntil: now + 1000 })).toMatch(/paused/);
        expect(m.autoGate({ ...ok, pausedUntil: now - 1000 }).ok).toBe(true);
        expect(why({ ageSec: NaN })).toMatch(/not fresh/);           // an older Stashr Location sends no age: never learned from
        expect(why({ ageSec: 600 })).toMatch(/not fresh/);
        expect(why({ guess: { ...guess, room: null } })).toMatch(/not sure/);
        expect(why({ guess: { ...guess, confidence: 0.6 } })).toMatch(/not sure enough/);
        expect(why({ guess: { ...guess, margin: 0.2 } })).toMatch(/close/);
        expect(why({ guess: { ...guess, nearest: 20 } })).toMatch(/familiar/);
        expect(why({ prevRoom: "Kitchen" })).toMatch(/settled/);     // just walked in
        expect(why({ prevRoom: null })).toMatch(/settled/);
        expect(why({ nextRoom: "Kitchen" })).toMatch(/settled/);
        expect(why({ prevAt: now - 3 * 3600000 })).toMatch(/settled/);   // the last scan was hours ago
        expect(why({ samples: train(3) })).toMatch(/trained enough/);
    });
    test("at most one auto sample per room every 10 minutes, and never a near copy of one from the last day", () => {
        const far = { "w:zz": -40, "w:yy": -45 };
        const recent = { room: "Bedroom", vec: far, at: now - 5 * 60000, session: "a1", src: "auto" };
        expect(m.autoGate({ ...ok, samples: [...samples, recent] }).why).toMatch(/while ago/);
        expect(m.autoGate({ ...ok, samples: [...samples, { ...recent, at: now - 15 * 60000 }] }).ok).toBe(true);
        expect(m.autoGate({ ...ok, samples: [...samples, { ...recent, vec, at: now - 2 * 3600000 }] }).why).toMatch(/already have/);
        expect(m.autoGate({ ...ok, samples: [...samples, { ...recent, room: "Kitchen", at: now - 60000 }] }).ok).toBe(true);    // another room's timer
    });
    test("a correction finds the auto samples of the last day that named another room right there", () => {
        const kitchen = m.vectorOf(scanOf("Kitchen"));
        const list = [
            { id: "wrong", room: "Bedroom", vec: kitchen, at: now - 3600000, src: "auto" },
            { id: "old", room: "Bedroom", vec: kitchen, at: now - 3 * DAY, src: "auto" },
            { id: "right", room: "Kitchen", vec: kitchen, at: now - 3600000, src: "auto" },
            { id: "person", room: "Bedroom", vec: kitchen, at: now - 3600000, src: "train" },
            { id: "elsewhere", room: "Bedroom", vec: m.vectorOf(scanOf("Bedroom")), at: now - 3600000, src: "auto" }
        ];
        expect(m.wrongAutos(list, [kitchen], "Kitchen", now)).toEqual(["wrong"]);
    });
});

describe("auto-improve: honest grading, tuning and the guard", () => {
    test("auto samples help guess but are never graded", () => {
        const samples = [...train(20), ...train(5).map((s, i) => ({ ...s, src: "auto", session: "auto" + i }))];
        const r = m.crossValidate(samples, T0);
        expect(r.tested).toBe(60);
        expect(r.accuracy >= 85).toBe(true);
        expect(r.wrong + r.unsure + r.accuracy).toBe(100);
    });
    test("the guard catches auto samples that make things worse, and leaves good ones alone", () => {
        const good = [...train(20), ...train(8).map((s, i) => ({ ...s, src: "auto", session: "a" + i }))];
        const g1 = m.guard(good, T0);
        expect(g1.hurts).toBe(false);
        expect(g1.with >= g1.without - 3).toBe(true);
        // auto samples of a room nobody trained, each a copy of a Kitchen scan: they pull Kitchen scans away
        const base = train(20);
        const bad = [...base, ...base.filter((s) => s.room === "Kitchen").map((s, i) => ({ room: "Store", vec: s.vec, at: T0, session: "b" + i, src: "auto" }))];
        const g2 = m.guard(bad, T0);
        expect(g2.hurts).toBe(true);
        expect(g2.with < g2.without).toBe(true);
    });
    test("tuning tries every width on the same test and keeps 5 dBm unless another is clearly better", () => {
        const t = m.tune(train(20), T0);
        expect(t.tried.map((x) => x.width)).toEqual(m.WIDTHS);
        expect(t.width).toBe(5);                                     // all equally good here: no reason to move
        const same = (room, i) => ({ room, vec: m.vectorOf({ wifi: [{ b: "r1", r: -50 + noise(4) }, { b: "n1", r: -70 + noise(4) }, { b: "n2", r: (room === "A" ? -75 : -80) + noise(4) }] }), at: T0, session: `${room}-${Math.floor(i / 4)}` });
        const hard = [...Array.from({ length: 20 }, (_, i) => same("A", i)), ...Array.from({ length: 20 }, (_, i) => same("B", i))];
        const h = m.tune(hard, T0);
        const score = (x) => x.accuracy - 0.5 * x.wrong;
        const base = h.tried.find((x) => x.width === 5);
        expect(score(h) >= score(base)).toBe(true);
        if (h.width !== 5) expect(score(h) >= score(base) + 2).toBe(true);
        // a tuned width is used by classify
        expect(m.classify(hard, hard[0].vec, T0, { width: 12 }).ranking.length).toBe(2);
    });
});
