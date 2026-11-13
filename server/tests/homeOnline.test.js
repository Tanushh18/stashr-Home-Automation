const { describe, test } = require("node:test");
const expect = require("./expect");
const home = require("../utils/home");

const NOW = Date.parse("2026-11-13T12:00:00Z");
const hub = (battery, silentMs, kind = "hub") => ({ kind, lastSeen: new Date(NOW - silentMs), status: battery ? { battery } : {} });

describe("when a device counts as online", () => {
    test("on the charger a tablet is online for 150 seconds of silence, not much longer", () => {
        expect(home.isOnline(hub({ pct: 80, charging: true }, 100 * 1000), NOW)).toBe(true);
        expect(home.isOnline(hub({ pct: 80, charging: true }, 200 * 1000), NOW)).toBe(false);
    });

    test("a tablet on its battery above 20% stays online for 6 minutes of silence (Android may delay its reports)", () => {
        expect(home.isOnline(hub({ pct: 60, charging: false }, 200 * 1000), NOW)).toBe(true);
        expect(home.isOnline(hub({ pct: 21, charging: false }, 5 * 60 * 1000), NOW)).toBe(true);
        expect(home.isOnline(hub({ pct: 60, charging: false }, 7 * 60 * 1000), NOW)).toBe(false);
    });

    test("at 20% or less on the battery the normal window applies again", () => {
        expect(home.isOnline(hub({ pct: 20, charging: false }, 200 * 1000), NOW)).toBe(false);
        expect(home.isOnline(hub({ pct: 8, charging: false }, 100 * 1000), NOW)).toBe(true);
    });

    test("the longer window is only for the home tablet; the TV and a tablet that reports no battery keep 150 seconds", () => {
        expect(home.isOnline(hub({ pct: 60, charging: false }, 200 * 1000, "tv"), NOW)).toBe(false);
        expect(home.isOnline(hub(null, 200 * 1000), NOW)).toBe(false);
        expect(home.isOnline({ kind: "hub" }, NOW)).toBe(false);          // never seen
    });

    test("the battery may be reported as a plain number with a separate charging flag", () => {
        const d = { kind: "hub", lastSeen: new Date(NOW - 200 * 1000), status: { battery: 55, charging: false } };
        expect(home.isOnline(d, NOW)).toBe(true);
    });
});
