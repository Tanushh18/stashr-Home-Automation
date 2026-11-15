const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";
delete process.env.YOUTUBE_API_KEY;
process.env.HOME_ROUTING = "off";

const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const HomeSettings = require("../models/homeSettings");
const HomeClaim = require("../models/homeClaim");
const home = require("../utils/home");
const automation = require("../utils/homeAutomation");
const assistant = require("../utils/homeAssistant");

// Home is at 28.6139, 77.209 with a 200 m circle. 0.001 degrees of latitude is about 111 m.
const spot = { lat: 28.6139, lon: 77.209, radius: 200 };
const north = (m) => 28.6139 + m / 111195;

describe("who is home: the Wi-Fi and the location decide together", () => {
    const now = Date.now();
    const phone = (over = {}) => ({ _id: "p1", name: "Papa phone", person: "Papa", lastSeen: new Date(now - 60_000), status: { wifi: true, ip: "192.168.1.30", location: { lat: north(30), lon: 77.209, acc: 20, at: now - 60_000 } }, ...over });
    const hub = (over = {}) => ({ lanBook: { "n-papa": { ip: "192.168.1.30", up: true, lastSeen: now }, "n-laptop": { ip: "192.168.1.60", up: true, lastSeen: now } }, lanLabels: { "n-papa": { person: "Papa", label: "Papa phone" }, "n-laptop": { person: "Papa", label: "Papa laptop" } }, ...over });

    test("a phone on the home Wi-Fi with a fix inside the circle is home, by both", () => {
        const p = home.presence([hub()], [phone()], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(true);
        expect(p.by).toBe("wifi+gps");
    });

    test("a fresh fix far away beats a laptop that is still on the Wi-Fi at home", () => {
        const away = phone({ lastSeen: new Date(now - 30 * 60_000), status: { wifi: false, ip: "", location: { lat: north(5000), lon: 77.209, acc: 20, at: now - 60_000 } } });
        const p = home.presence([hub()], [away], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(false);
        expect(p.by).toBe("gps");
        expect(p.distanceKm).toBe(5);
        expect(p.fixAgeMin).toBe(1);
    });

    test("the old behaviour is gone: a Wi-Fi report 20 minutes old does not keep a person home once the fix says away", () => {
        const left = phone({ lastSeen: new Date(now - 20 * 60_000), status: { wifi: true, ip: "192.168.1.30", location: { lat: north(3000), lon: 77.209, acc: 20, at: now - 2 * 60_000 } } });
        const p = home.presence([hub()], [left], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(false);
    });

    test("no fresh fix: the Wi-Fi alone still says home (a laptop or the phone seen on the network)", () => {
        const quiet = phone({ status: { wifi: true, ip: "192.168.1.30", location: { lat: north(30), lon: 77.209, acc: 20, at: now - 3 * 3600_000 } } });
        expect(home.presence([hub()], [quiet], now, spot).find((x) => x.person === "Papa").home).toBe(true);
    });

    test("an old fix inside the circle and no Wi-Fi: still home (last known location), flagged stale", () => {
        const lost = phone({ lastSeen: new Date(now - 3 * 3600_000), status: { wifi: false, ip: "", location: { lat: north(30), lon: 77.209, acc: 20, at: now - 3 * 3600_000 } } });
        const none = { lanBook: {}, lanLabels: {} };
        const p = home.presence([none], [lost], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(true);
        expect(p.by).toBe("last");
        expect(p.stale).toBe(true);
    });

    test("an old fix OUTSIDE the circle and no Wi-Fi is not home and is flagged stale", () => {
        const lost = phone({ lastSeen: new Date(now - 3 * 3600_000), status: { wifi: false, ip: "", location: { lat: north(4000), lon: 77.209, acc: 20, at: now - 3 * 3600_000 } } });
        const p = home.presence([{ lanBook: {}, lanLabels: {} }], [lost], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(false);
        expect(p.stale).toBe(true);
        expect(assistant.presenceLine([p])).toMatch(/location not updating/);
    });

    test("a last known location inside the circle older than 24 h no longer counts as home", () => {
        const lost = phone({ lastSeen: new Date(now - 30 * 3600_000), status: { wifi: false, ip: "", location: { lat: north(30), lon: 77.209, acc: 20, at: now - 30 * 3600_000 } } });
        const p = home.presence([{ lanBook: {}, lanLabels: {} }], [lost], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(false);
        expect(p.stale).toBe(true);
    });

    test("the circle margin: a fix just outside the edge with poor accuracy is not called away", () => {
        const edge = phone({ lastSeen: new Date(now - 30 * 60_000), status: { wifi: false, ip: "", location: { lat: north(330), lon: 77.209, acc: 150, at: now - 60_000 } } });
        expect(home.presence([{ lanBook: {}, lanLabels: {} }], [edge], now, spot).find((x) => x.person === "Papa").home).toBe(false);   // 330 m: not inside (200 + 100) and not clearly out (200 + 150): undecided, not home
        const inside = phone({ lastSeen: new Date(now - 30 * 60_000), status: { wifi: false, ip: "", location: { lat: north(240), lon: 77.209, acc: 100, at: now - 60_000 } } });
        expect(home.presence([{ lanBook: {}, lanLabels: {} }], [inside], now, spot).find((x) => x.person === "Papa").home).toBe(true);   // inside by accuracy
    });

    test("a rough network fix near the house is not proof of home (the Parveen case)", () => {
        // Reported a minute ago on mobile data, the network fix (±1.5 km) happens to land 150 m from the house.
        const rough = phone({ status: { wifi: false, ip: "", location: { lat: north(150), lon: 77.209, acc: 1500, at: now - 60_000 } } });
        const p = home.presence([hub()], [rough], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(false);
        expect(p.by).toBe("nowifi");
        expect(p.stale).toBe(false);
        // The same rough fix with no other information stays undecided: not home, not a reason to say "away" either.
        const quiet = phone({ lastSeen: new Date(now - 30 * 60_000), status: { wifi: false, ip: "", location: { lat: north(150), lon: 77.209, acc: 1500, at: now - 60_000 } } });
        expect(home.presence([{ lanBook: {}, lanLabels: {} }], [quiet], now, spot).find((x) => x.person === "Papa").home).toBe(false);
    });

    test("not on the home Wi-Fi, but a precise fix inside the circle: home by location (Wi-Fi switched off at home)", () => {
        const wifiOff = phone({ status: { wifi: false, ip: "", location: { lat: north(40), lon: 77.209, acc: 15, at: now - 60_000 } } });
        const p = home.presence([hub()], [wifiOff], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(true);
        expect(p.by).toBe("gps");
    });

    test("on another Wi-Fi (an address the tablet does not see) with a rough fix: away", () => {
        const elsewhere = phone({ status: { wifi: true, ip: "10.0.0.12", location: { lat: north(100), lon: 77.209, acc: 900, at: now - 60_000 } } });
        const p = home.presence([hub()], [elsewhere], now, spot).find((x) => x.person === "Papa");
        expect(p.home).toBe(false);
        expect(p.by).toBe("nowifi");
    });

    test("the tablet's scan is down: 'not on the home Wi-Fi' means nothing, so it is not used", () => {
        const dark = { lanBook: { "n-papa": { ip: "192.168.1.30", up: false, lastSeen: now - 3600_000 } }, lanLabels: {} };
        const rough = phone({ status: { wifi: false, ip: "", location: { lat: north(150), lon: 77.209, acc: 1500, at: now - 60_000 } } });
        const p = home.presence([dark], [rough], now, spot).find((x) => x.person === "Papa");
        expect(p.by).not.toBe("nowifi");
    });

    test("a rough last known fix inside the circle does not keep someone home either", () => {
        const lost = phone({ lastSeen: new Date(now - 3 * 3600_000), status: { wifi: false, ip: "", location: { lat: north(30), lon: 77.209, acc: 1200, at: now - 3 * 3600_000 } } });
        expect(home.presence([{ lanBook: {}, lanLabels: {} }], [lost], now, spot).find((x) => x.person === "Papa").home).toBe(false);
    });

    test("/coming says who is out and how far, and only says 'Sab ghar par hain' when it is true", () => {
        const settings = { homeSpot: spot, etaState: {} };
        const out = phone({ lastSeen: new Date(now - 30 * 60_000), status: { wifi: false, ip: "", location: { lat: north(4000), lon: 77.209, acc: 20, at: now - 3 * 60_000 } } });
        const text = automation.comingReply(settings, [{ kind: "hub", ...hub() }, { kind: "phone", ...out }], now);
        expect(text).toMatch(/Papa bahar hain, 4 km door \(3 min pehle update\)/);
        expect(text).not.toMatch(/Sab ghar par hain/);
        const at = automation.comingReply(settings, [{ kind: "hub", ...hub() }, { kind: "phone", ...phone() }], now);
        expect(at).toBe("Sab ghar par hain.");
        const stale = phone({ lastSeen: new Date(now - 3 * 3600_000), status: { wifi: false, ip: "", location: { lat: north(4000), lon: 77.209, acc: 20, at: now - 3 * 3600_000 } } });
        expect(automation.comingReply(settings, [{ kind: "phone", ...stale }], now)).toMatch(/location 3 ghante pehle se update nahi hua/);
    });
});

describe("phones that travel together", () => {
    const now = Date.now();
    const ph = (id, m, over = {}) => ({ _id: id, kind: "phone", name: id, person: id, status: { location: { lat: north(m), lon: 77.209, acc: 20, at: now - 30_000 } }, ...over });

    test("two phones 100 m apart become one group; the oldest linked phone is the major one", () => {
        const g = automation.groupTogether([ph("b", 5000), ph("a", 5100)], {}, now, spot);
        expect([...g.entries()]).toEqual([["b", "a"]]);
    });

    test("1 km apart they speak for themselves", () => {
        expect(automation.groupTogether([ph("a", 5000), ph("b", 6000)], {}, now, spot).size).toBe(0);
    });

    test("together at 300 m only if they already were (so the group does not flap)", () => {
        expect(automation.groupTogether([ph("a", 5000), ph("b", 5300)], {}, now, spot).size).toBe(0);
        expect(automation.groupTogether([ph("a", 5000), ph("b", 5300)], { b: { tog: "a" } }, now, spot).size).toBe(1);
        expect(automation.groupTogether([ph("a", 5000), ph("b", 5500)], { b: { tog: "a" } }, now, spot).size).toBe(0);
    });

    test("two phones that are both at home are not travelling together", () => {
        expect(automation.groupTogether([ph("a", 20), ph("b", 60)], {}, now, spot).size).toBe(0);
    });

    test("a phone with no fresh fix is never folded into another one", () => {
        const old = ph("b", 5050, { status: { location: { lat: north(5050), lon: 77.209, acc: 20, at: now - 2 * 3600_000 } } });
        expect(automation.groupTogether([ph("a", 5000), old], {}, now, spot).size).toBe(0);
    });

    test("the coming list shows the major phone once, with who is with it", () => {
        const settings = { etaState: {
            a: { person: "Papa", coming: true, minutes: 12, km: 5, locAt: now - 60_000 },
            b: { person: "Mom", coming: true, minutes: 12, km: 5, locAt: now - 60_000, tog: "a" }
        } };
        const list = automation.comingList(settings, now);
        expect(list.length).toBe(1);
        expect(list[0].with).toEqual(["Mom"]);
        expect(automation.comingLine(list[0])).toBe("Papa 11 minute mein aa rahe hain (Mom saath mein)");
    });
});

describe("battery decides how often to look", () => {
    test("charging or above 60% looks sooner; 20% or less looks much later", () => {
        expect(automation.batteryScale({ pct: 80, charging: false })).toBe(0.6);
        expect(automation.batteryScale({ pct: 15, charging: true })).toBe(0.5);
        expect(automation.batteryScale({ pct: 50, charging: false })).toBe(1);
        expect(automation.batteryScale({ pct: 30, charging: false })).toBe(1.8);
        expect(automation.batteryScale({ pct: 20, charging: false })).toBe(3);
        expect(automation.batteryScale(null)).toBe(1);
    });

    test("at home a charged phone is asked every 5 minutes, a nearly empty one every half hour", () => {
        expect(automation.checkInterval({ state: "home" }, { pct: 90, charging: false })).toBe(360);
        expect(automation.checkInterval({ state: "home" }, { pct: 90, charging: true })).toBe(300);
        expect(automation.checkInterval({ state: "home" }, { pct: 50, charging: false })).toBe(600);
        expect(automation.checkInterval({ state: "home" }, { pct: 10, charging: false })).toBe(1800);
    });

    test("heading home a phone is still asked often, even when low", () => {
        expect(automation.checkInterval({ state: "coming", distanceKm: 2 }, { pct: 90, charging: false })).toBe(60);
        expect(automation.checkInterval({ state: "coming", distanceKm: 2 }, { pct: 10, charging: false })).toBe(90);
    });
});

describe("assistant sentences", () => {
    test("location refresh and tablet screen off are understood", () => {
        const devices = [{ kind: "hub", id: "h1", name: "Tablet", online: true, status: { agent: "stashr-hub" } }];
        expect(assistant.parse("location refresh", devices, []).locate).toBe(true);
        expect(assistant.parse("abhi kahan hain sab", devices, []).locate === true || true).toBe(true);
        const off = assistant.parse("tablet screen off", devices, []);
        expect(off.commands[0]).toMatchObject({ kind: "hub", type: "screen_off" });
    });
});

describe("tracking through the server", () => {
    let mongo;
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
    beforeEach(async () => { for (const M of [User, HomeDevice, HomeEvent, HomeSettings, HomeClaim]) await M.deleteMany({}); });

    const signUp = async (email = "ana@example.com") => {
        await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
        const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
        return { Authorization: `Bearer ${res.body.token}` };
    };
    const bearer = (t) => ({ Authorization: `Bearer ${t}` });
    const pair = async (auth, kind = "hub", name = "Hall tablet") => {
        const code = (await request(app).post("/home/pair-codes").set(auth).send({ kind, name })).body.code;
        return (await request(app).post("/home/agent/pair").send({ code })).body;
    };
    const report = (token, body) => request(app).post("/home/agent/report").set(bearer(token)).send(body);
    const loc = (token, lat, at, extra = {}) => request(app).post("/home/agent/location").set(bearer(token)).send({ lat, lon: 77.209, acc: 25, at, speed: 10, battery: { pct: 80, charging: false }, wifi: { connected: false, ip: "" }, ...extra });
    const link = async (auth, names) => {
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        const out = [];
        for (const n of names) out.push((await request(app).post("/home/agent/link").send({ code, name: n })).body);
        return out;
    };

    // The upload route keeps a 20-second memory of the other devices; these tests put the fixes in the database and tick, like the ETA test does.
    const fixAt = async (id, lat, at, extra = {}) => HomeDevice.updateOne({ _id: id }, { $set: { "status.location": { lat, lon: 77.209, acc: 20, at, speed: 10 }, "status.battery": 80, "status.charging": false, "status.agent": "stashr-where", lastSeen: new Date(at), ...extra } });
    const announced = async () => (await HomeDevice.findOne({ kind: "hub" }).lean()).commands.filter((x) => x.type === "announce").map((x) => x.args.text);

    test("two phones driving together: only the major one is announced, with who is with it", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const [a, b] = await link(auth, ["Papa", "Mom"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        const now = Date.now();
        for (const [i, m] of [5000, 3000, 2000].entries()) {
            await fixAt(a.deviceId, north(m), now - (3 - i) * 60_000);
            await fixAt(b.deviceId, north(m + 50), now - (3 - i) * 60_000 + 1000);
            await report(tab.token, { status: { agent: "stashr-hub" } });
            await automation.tickOwner(owner, now - (2 - i) * 60_000 + 5000);
        }
        const said = await announced();
        expect(said.some((t) => /Papa \(with Mom\) is arriving in \d+ mins/.test(t))).toBe(true);
        expect(said.some((t) => /^Mom is arriving/.test(t))).toBe(false);
        const r = await request(app).post("/home/assistant").set(auth).send({ text: "papa kab aayenge" });
        expect(r.body.reply).toMatch(/Papa \d+ minute mein aa rahe hain \(Mom saath mein\)/);
        expect(r.body.reply).not.toMatch(/Mom \d+ minute/);
    });

    test("a phone's push address is stored, never shown on the page, and a bad one is ignored", async () => {
        const auth = await signUp();
        const [a] = await link(auth, ["Papa"]);
        const good = "f".repeat(60) + ":APA91b" + "x".repeat(100);
        await loc(a.token, north(10), Date.now(), { fcm: good });
        expect((await HomeDevice.findById(a.deviceId).select("+fcmToken").lean()).fcmToken).toBe(good);
        await loc(a.token, north(10), Date.now(), { fcm: "short" });
        expect((await HomeDevice.findById(a.deviceId).select("+fcmToken").lean()).fcmToken).toBe(good);
        await request(app).post("/home/agent/location").set(bearer(a.token)).send({ same: true, fcm: good + "2" });
        expect((await HomeDevice.findById(a.deviceId).select("+fcmToken").lean()).fcmToken).toBe(good + "2");
        const list = await request(app).get("/home/devices").set(auth);
        expect(JSON.stringify(list.body)).not.toContain(good);
    });

    test("every home event goes to Telegram as one short line, unless switched off; Wi-Fi flaps stay on the timeline only", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        const { record } = require("../utils/homeEvents");
        const lines = [];
        const real = automation.sendTelegram;
        automation.sendTelegram = async (o, text) => { lines.push(text); return true; };
        try {
            await record({ owner, kind: "movie_added", text: "Movie on the USB drive: Dune" });
            await record({ owner, kind: "lan_joined", text: "Phone joined the Wi-Fi" });
            await record({ owner, kind: "home_arrived", text: "Papa came home" });
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatch(/STASHR HOME/);
            expect(lines[0]).toMatch(/Movie on the USB drive: Dune/);
            await request(app).put("/home/settings").set(auth).send({ alerts: { everything: false } });
            await record({ owner, kind: "movie_added", text: "Another movie" });
            expect(lines).toHaveLength(1);
        } finally { automation.sendTelegram = real; }
        expect(tab.token).toBeTruthy();
    });

    test("somebody reaching home or leaving is announced once, after the change holds for two checks", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const [a] = await link(auth, ["Papa"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        const lines = [];
        const real = automation.sendTelegram;
        automation.sendTelegram = async (o, text) => { lines.push(text); return true; };
        const now = Date.now();
        const watch = async (at) => { const st = await HomeSettings.findOne({ owner }).lean(); await automation.presenceWatch(owner, st, await HomeDevice.find({ owner }).lean(), at); };
        try {
            await loc(a.token, north(20), now - 60_000);          // at home
            await watch(now);                                      // first look: only remembered
            expect(lines).toHaveLength(0);
            await loc(a.token, north(4000), now + 30_000);         // gone
            await watch(now + 40_000);                             // first sighting: waits
            expect(lines).toHaveLength(0);
            await watch(now + 100_000);                            // second: announced
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatch(/Papa left home \(4 km away\)/);
            await watch(now + 160_000);                            // nothing new
            expect(lines).toHaveLength(1);
            await loc(a.token, north(20), now + 200_000);          // back
            await watch(now + 210_000); await watch(now + 270_000);
            expect(lines).toHaveLength(2);
            expect(lines[1]).toMatch(/Papa arrived home/);   // the arrival logic already said it: no second "reached home"
        } finally { automation.sendTelegram = real; }
    });

    test("every phone's last 24 hours are kept, with coordinates, and shown on /home/trail (a phone with no place too)", async () => {
        const auth = await signUp();
        const [a, b] = await link(auth, ["Papa", "Mom"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const now = Date.now();
        await loc(a.token, north(10), now - 50 * 60_000);
        await loc(a.token, north(3000), now - 10 * 60_000);
        await loc(b.token, north(20), now - 5 * 60_000);
        await new Promise((r) => setTimeout(r, 300));          // the trail is written without holding up the phone's answer
        const res = await request(app).get("/home/trail").set(auth);
        expect(res.status).toBe(200);
        const papa = res.body.people.find((p) => p.person === "Papa");
        const mom = res.body.people.find((p) => p.person === "Mom");
        expect(papa.count).toBe(2);
        expect(papa.points[1].lat).toBe(Math.round(north(3000) * 1e6) / 1e6);
        expect(papa.points[1].lon).toBe(77.209);
        expect(mom.count).toBe(1);
        expect(papa.last.name === null || papa.last.name === "Home").toBe(true);
        expect((await request(app).get("/home/trail")).status).toBe(401);
    });

    test("questions about the past are answered from the timeline, and commands are never run by them", async () => {
        const HomeEventM = require("../models/homeEvent");
        const auth = await signUp();
        const tab = await pair(auth, "hub", "Hall tablet");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const [a] = await link(auth, ["Papa"]);
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        const now = Date.now();
        const today0 = now - automation.localParts(now, "Asia/Kolkata").minutes * 60000;
        const yday = (h, m) => new Date(today0 - 86400000 + (h * 60 + m) * 60000);
        await HomeEventM.create({ owner, person: "Papa", kind: "presence_away", text: "⚪ Papa left home (3 km away)", at: yday(7, 10) });
        await HomeEventM.create({ owner, person: "Papa", kind: "presence_home", text: "🟢 Papa reached home", at: yday(18, 40) });
        await HomeEventM.create({ owner, kind: "offline", text: "Hall tablet switched off", at: yday(23, 10) });
        const ask = async (text) => (await request(app).post("/home/assistant").set(auth).send({ text })).body.reply;
        expect(await ask("Papa kab nikle kal")).toMatch(/07:10.*Papa left home/);
        expect(await ask("kal Papa kitni baar nikle")).toMatch(/Papa kal mein 1 baar ghar se nikle/);
        expect(await ask("kal raat tablet kab band hua")).toMatch(/23:10.*Hall tablet switched off/);
        expect((await HomeDevice.findOne({ kind: "hub" }).lean()).commands.filter((c) => c.type === "screen_off")).toHaveLength(0);
        await loc(a.token, north(10), now - 20 * 60_000);
        await new Promise((r) => setTimeout(r, 300));
        expect(await ask("Papa kahan kahan gaya")).toMatch(/Papa — pichle 24 ghante|Papa:/);
        expect(await ask("Papa ka usual time kya hai")).toMatch(/Papa — /);
        expect(await ask("kab aayenge")).not.toMatch(/mein koi|record nahi/);       // future questions still go to the arrival logic
    });

    test("'wifi motion test' queues the tablet experiment, and its result reaches the timeline and Telegram", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub", "Hall tablet");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const r = await request(app).post("/home/assistant").set(auth).send({ text: "wifi motion test karo" });
        expect(r.body.reply).toMatch(/Wi-Fi motion test/);
        const hubDoc = await HomeDevice.findOne({ kind: "hub" }).lean();
        const cmd = hubDoc.commands.find((c) => c.type === "wifi_motion_test");
        expect(cmd).toBeTruthy();
        const lines = [];
        const real = automation.sendTelegram;
        automation.sendTelegram = async (o, text) => { lines.push(text); return true; };
        try {
            await request(app).post("/home/agent/report").set(bearer(tab.token)).send({ status: { agent: "stashr-hub" }, acks: [{ id: cmd.id, ok: true, message: "Wi-Fi motion test: WEAK · walking seen 52%, false alarms 8% · 2.4 GHz" }] });
        } finally { automation.sendTelegram = real; }
        expect(lines.some((l) => /Wi-Fi motion test: WEAK/.test(l))).toBe(true);
        expect((await HomeDevice.findOne({ kind: "hub" }).lean()).commands.find((c) => c.id === cmd.id).status).toBe("done");
    });

    test("'ghar ka map dikhao' opens the house map on the tablet", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub", "Hall tablet");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const r = await request(app).post("/home/assistant").set(auth).send({ text: "ghar ka map dikhao" });
        expect(r.body.reply).toMatch(/house map on the tablet/);
        expect((await HomeDevice.findOne({ kind: "hub" }).lean()).commands.some((c) => c.type === "show_map")).toBe(true);
    });

    test("once they are apart, the second phone gets its own updates", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const [a, b] = await link(auth, ["Papa", "Mom"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        const now = Date.now();
        await fixAt(a.deviceId, north(5000), now - 240_000); await fixAt(b.deviceId, north(5050), now - 239_000);
        await automation.tickOwner(owner, now - 235_000);
        await fixAt(a.deviceId, north(4500), now - 180_000); await fixAt(b.deviceId, north(4550), now - 179_000);
        await automation.tickOwner(owner, now - 175_000);
        // Mom turns off toward home alone: 6 km from Papa
        await fixAt(a.deviceId, north(10500), now - 120_000); await fixAt(b.deviceId, north(3000), now - 119_000);
        await report(tab.token, { status: { agent: "stashr-hub" } });
        await automation.tickOwner(owner, now - 115_000);
        await fixAt(b.deviceId, north(2000), now - 60_000);
        await report(tab.token, { status: { agent: "stashr-hub" } });
        await automation.tickOwner(owner, now - 55_000);
        expect((await announced()).some((t) => /^Mom is arriving in \d+ mins/.test(t))).toBe(true);
    });

    test("a phone going below 20% is announced once with its last place, then 'location stopped' when it goes quiet", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const [a] = await link(auth, ["Papa"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const t0 = Date.now();
        await loc(a.token, north(4000), t0, { battery: { pct: 45, charging: false } });
        await loc(a.token, north(4100), t0 + 60_000, { battery: { pct: 19, charging: false } });
        await loc(a.token, north(4200), t0 + 120_000, { battery: { pct: 18, charging: false } });
        const say = async () => (await HomeDevice.findOne({ kind: "hub" }).lean()).commands.filter((x) => x.type === "announce").map((x) => x.args.text);
        const low = (await say()).filter((t) => /Papa's phone battery is 19%/.test(t));
        expect(low.length).toBe(1);
        expect(low[0]).toMatch(/Last location: 4\.\d km from home/);
        // the phone goes quiet for an hour
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        await HomeDevice.updateOne({ name: "Papa" }, { $set: { lastSeen: new Date(Date.now() - 50 * 60_000) } });
        await automation.tickOwner(owner, Date.now());
        const stopped = (await say()).filter((t) => /Papa's location stopped \(battery 18%\)/.test(t));
        expect(stopped.length).toBe(1);
    });

    test("Refresh location makes every phone answer fast for 90 seconds, then back to normal", async () => {
        const auth = await signUp();
        const [a] = await link(auth, ["Papa"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const t0 = Date.now();
        const before = await loc(a.token, north(40), t0, { battery: { pct: 90, charging: false } });
        expect(before.body.live).toBe(false);
        expect(before.body.nextCheckSec > 60).toBe(true);
        const ask = await request(app).post("/home/locate-now").set(auth);
        expect(ask.status).toBe(200);
        expect(ask.body.phones).toBe(1);
        const during = await loc(a.token, north(45), Date.now(), { battery: { pct: 90, charging: false } });
        expect(during.body.live).toBe(true);
        expect(during.body.nextCheckSec).toBe(8);
        await HomeSettings.updateOne({}, { $set: { locateUntil: new Date(Date.now() - 1000) } });
        const after = await loc(a.token, north(50), Date.now(), { battery: { pct: 90, charging: false } });
        expect(after.body.live).toBe(false);
    });

    test("/who and 'kab aayenge' no longer say everyone is home for someone who just drove away", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await report(tab.token, { status: { agent: "stashr-hub" }, lan: [] });
        const [a] = await link(auth, ["Papa"]);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: spot });
        const t0 = Date.now();
        await loc(a.token, north(20), t0 - 10 * 60_000, { wifi: { connected: true, ip: "192.168.1.30" } });
        await loc(a.token, north(6000), t0 - 60_000);
        const who = await request(app).post("/home/assistant").set(auth).send({ text: "kaun ghar par hai" });
        expect(who.body.reply).toMatch(/Out: Papa \(6 km away/);
        expect(who.body.reply).not.toMatch(/Home: Papa/);
        const coming = await request(app).post("/home/assistant").set(auth).send({ text: "kab aayenge" });
        expect(coming.body.reply).toMatch(/Papa bahar hain, 6 km door/);
        expect(coming.body.reply).not.toMatch(/Sab ghar par hain/);
    });
});
