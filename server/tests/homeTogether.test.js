const { describe, test } = require("node:test");
const expect = require("./expect");
const t = require("../utils/homeTogether");

const ph = (id, battery, over = {}) => ({ _id: id, kind: "phone", status: { battery, charging: false, location: { at: 1000 } }, ...over });
const groups = new Map([["b", "a"]]);       // b travels with a

describe("phones travelling together", () => {
    test("members of a pair; a phone on its own, or with syncing off, is not grouped", () => {
        const phones = [ph("a", 80), ph("b", 70), ph("c", 60)];
        expect(t.membersOf("a", phones, groups).map((p) => p._id).sort()).toEqual(["a", "b"]);
        expect(t.membersOf("b", phones, groups).map((p) => p._id).sort()).toEqual(["a", "b"]);
        expect(t.membersOf("c", phones, groups)).toEqual([]);
        expect(t.membersOf("a", [ph("a", 80), ph("b", 70, { syncPaused: true })], groups)).toEqual([]);
    });
    test("the lead rotates every slot, so the two phones take turns", () => {
        const m = [ph("a", 80), ph("b", 80)];
        const leads = [0, 1, 2, 3].map((i) => t.pickLead(m, i * t.SLOT_MS + 5));
        expect(leads).toEqual(["a", "b", "a", "b"]);
    });
    test("a charging phone always leads; a low phone rests while the other is fine", () => {
        const charging = ph("b", 50); charging.status.charging = true;
        expect([0, 1, 2, 3].map((i) => t.pickLead([ph("a", 90), charging], i * t.SLOT_MS))).toEqual(["b", "b", "b", "b"]);
        expect([0, 1, 2, 3].map((i) => t.pickLead([ph("a", 20), ph("b", 90)], i * t.SLOT_MS))).toEqual(["b", "b", "b", "b"]);
        expect(t.pickLead([ph("a", 10), ph("b", 12)], 0)).toBe("");
    });
    test("a resting phone looks about half as often, never above 7 minutes; near home both stay normal", () => {
        expect(t.nextCheck(300, true, true, false)).toBe(300);
        expect(t.nextCheck(300, false, true, false)).toBe(420);
        expect(t.nextCheck(120, false, true, false)).toBe(240);
        expect(t.nextCheck(300, false, true, true)).toBe(300);
        expect(t.nextCheck(300, false, false, false)).toBe(300);
    });
    test("only a mate whose own fix is older gets the reporter's position", () => {
        const a = ph("a", 80), b = ph("b", 80);
        expect(t.mirrorTargets("a", [a, b], { at: 100000 }).map((p) => p._id)).toEqual(["b"]);
        b.status.location.at = 99990;                                        // b reported 10 s ago itself
        expect(t.mirrorTargets("a", [a, b], { at: 100000 })).toEqual([]);
    });
});
