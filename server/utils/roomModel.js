/**
 * The room model: "which room is this phone in?" from what the phone can hear (Wi-Fi networks and Bluetooth devices with their signal
 * strength). Pure code, no database, so every rule below is tested.
 *
 * HOW IT WORKS, in five steps:
 *  1. A SCAN is a list of "what I hear and how loud": { "w:ab12cd": -48 dBm, "w:99ee01": -71, "b:77aa10": -80 ... }.
 *     A network that is not heard counts as -100 dBm ("too quiet to hear"). Wi-Fi names are never kept: ids are hashed.
 *  2. TRAINING = you stand in a room and tap "main yahan hoon": the scan(s) are saved with the room's name. These are the SAMPLES.
 *  3. To find the room of a NEW scan, it is compared with EVERY sample: the DISTANCE is how different the two lists are (the root of the
 *     average squared difference in dBm). A sample that is close counts a lot, a far one almost nothing:  weight = exp(-(distance/width)^2).
 *     Nothing is thrown away: all samples take part (not just the nearest few). Samples also fade with age (half after 30 days),
 *     so a moved router or furniture slowly stops mattering.
 *  4. Each room's SCORE is the weighted average of its samples' weights (an average, so a room with many samples does not win just for
 *     having many). The scores add up to 1: that is the CONFIDENCE for each room. Below 50%, or when nothing is close at all, the answer
 *     is "not sure".
 *  5. SMOOTHING: one scan never changes the room. The new room must win twice in a row, so a single noisy scan cannot make a person
 *     "teleport" and come back.
 * HOW GOOD IS IT: `crossValidate` hides each sample a PERSON labelled (and every sample of the same tap) and asks the model to guess it
 * from the rest. The share it gets right, and which rooms it mixes up, is the honest accuracy, shown before anyone trusts it.
 *
 * AUTO-IMPROVE (docs/ROOM_MODEL_AUTO_IMPROVE_PLAN.md, part C): the phones keep the model current by themselves.
 *  - A live scan the model is very sure about, in a room the person has been in for a while, is saved as an "auto" sample (`autoGate`).
 *  - Samples count by where their label came from (`SRC_WEIGHT`): a person's correction most, the model's own label least.
 *  - Auto samples are never graded (their label came from the model itself), and `guard` checks every hour that they help, not hurt.
 *  - `tune` picks the kernel width that suits this home and phone best, measured, not guessed.
 *  - `goneKeys` notices networks that stopped existing (a new router, a neighbour who moved) and stops counting them.
 */
const crypto = require("crypto");

const FLOOR = -100;                    // "not heard"
const WEIGHT = { w: 1, b: 0.6 };       // Wi-Fi counts fully, Bluetooth less (phones and earbuds change their address)
const MIN_WIDTH = 5;                   // dBm: how quickly a sample stops counting as it gets different (the default; `tune` may pick another)
const WIDTHS = [4, 5, 7, 9, 12];       // the widths `tune` tries
const FAR = 30;                        // dBm: if even the closest sample is this different, nothing here looks familiar
const HALF_LIFE_DAYS = 30;
const SURE = 0.5;
const DAY = 86400000;

/** How much a sample counts, by where its label came from: a correction ("Galat hai") is exactly where the model was wrong. */
const SRC_WEIGHT = { train: 1, fix: 1.5, confirm: 1, auto: 0.5 };
const srcWeight = (src) => SRC_WEIGHT[src] ?? 1;
const human = (s) => s.src !== "auto";

/** The rules for an auto sample (see `autoGate`). */
const AUTO = { conf: 0.75, margin: 0.35, near: 12, maxAgeSec: 120, everyMs: 10 * 60 * 1000, settleMs: 40 * 60 * 1000, minHuman: 5, dup: 3, dupMs: DAY, perRoom: 40 };

/** A stable but unreadable id for a Wi-Fi network or Bluetooth device, different for every household. */
const hashId = (owner, raw) => crypto.createHash("sha256").update(String(owner) + ":" + String(raw).toLowerCase()).digest("hex").slice(0, 12);

/** A scan from the phone -> { key: dBm }. kind "w" = Wi-Fi, "b" = Bluetooth; the strongest reading wins when an id repeats. */
function vectorOf(scan) {
    const v = {};
    for (const [kind, list] of [["w", scan && scan.wifi], ["b", scan && scan.ble]]) {
        for (const x of Array.isArray(list) ? list : []) {
            const r = Number(x && x.r);
            if (!x || !x.b || !(r <= -1 && r >= -127)) continue;
            const k = kind + ":" + x.b;
            if (v[k] === undefined || r > v[k]) v[k] = r;
        }
    }
    return v;
}

/** Which kinds a scan has heard: { w: true/false, b: true/false }. */
function kindsOf(v) {
    const out = { w: false, b: false };
    for (const k in v) { out[k[0]] = true; if (out.w && out.b) break; }
    return out;
}

/**
 * How different two scans are, in dBm (0 = the same). Ids heard in only one count as "-100 in the other".
 * A kind (Wi-Fi or Bluetooth) only counts when BOTH scans have it: a scan taken with Bluetooth off is not "far" from a sample that had it.
 * `ignore` (a Set of keys) are networks known to be gone (see `goneKeys`).
 */
function distance(a, b, ignore) {
    const ka = kindsOf(a), kb = kindsOf(b);
    let use = { w: ka.w && kb.w, b: ka.b && kb.b };
    if (!use.w && !use.b) use = { w: true, b: true };          // nothing in common: compare everything (they are simply far apart)
    let sum = 0, wsum = 0;
    const add = (k, x, y) => {
        if (!use[k[0]] || (ignore && ignore.has(k))) return;
        const w = WEIGHT[k[0]] || 1;
        const d = (x === undefined ? FLOOR : x) - (y === undefined ? FLOOR : y);
        sum += w * d * d; wsum += w;
    };
    for (const k in a) add(k, a[k], b[k]);
    for (const k in b) if (!(k in a)) add(k, undefined, b[k]);
    return wsum ? Math.sqrt(sum / wsum) : FAR * 2;
}

const ageFactor = (at, now) => Math.pow(0.5, Math.max(0, now - at) / (HALF_LIFE_DAYS * DAY));

/** The decision from the distances to every sample (computed once, so other widths can be tried cheaply). */
function decide(samples, ds, now, minWidth = MIN_WIDTH) {
    const rooms = [...new Set(samples.map((s) => s.room))];
    if (rooms.length < 2) return { room: null, confidence: 0, margin: 0, ranking: rooms.map((r) => ({ room: r, p: 1 })), nearest: null, why: "train at least two rooms" };
    let nearest = Infinity;
    for (const d of ds) if (d < nearest) nearest = d;
    const width = Math.max(minWidth, nearest * 1.5);                 // wider when nothing matches well, so every sample still has a say
    const sums = {}, weights = {};
    samples.forEach((s, i) => {
        const sw = srcWeight(s.src);
        const w = Math.exp(-((ds[i] / width) ** 2)) * ageFactor(s.at, now);
        sums[s.room] = (sums[s.room] || 0) + sw * w; weights[s.room] = (weights[s.room] || 0) + sw;
    });
    const score = rooms.map((r) => ({ room: r, s: sums[r] / weights[r] + 1e-9 }));
    const total = score.reduce((t, x) => t + x.s, 0);
    const ranking = score.map((x) => ({ room: x.room, p: Math.round((x.s / total) * 1000) / 1000 })).sort((a, b) => b.p - a.p);
    const top = ranking[0];
    const sure = top.p >= SURE && nearest <= FAR;
    const margin = Math.round((top.p - (ranking[1] ? ranking[1].p : 0)) * 1000) / 1000;
    return { room: sure ? top.room : null, confidence: top.p, margin, ranking, nearest: Math.round(nearest * 10) / 10, why: sure ? "" : nearest > FAR ? "nothing here looks familiar" : "two rooms look alike" };
}

/**
 * samples: [{ room, vec, at (ms), session?, src? }]. Returns { room, confidence, margin, ranking: [{ room, p }], nearest }.
 * `room` is null when the model is not sure (fewer than two rooms trained, nothing familiar, or under 50%).
 * opts: { width: the tuned kernel width, gone: Set of keys to ignore }.
 */
function classify(samples, vec, now = Date.now(), opts = {}) {
    return decide(samples, samples.map((s) => distance(vec, s.vec, opts.gone)), now, opts.width || MIN_WIDTH);
}

/** The distances from every sample a person labelled (the ones that are graded) to every sample. Computed once, reused for every setting. */
function gradeMatrix(samples, gone) {
    const tests = [];
    samples.forEach((s, i) => { if (human(s)) tests.push(i); });
    return { tests, rows: tests.map((i) => samples.map((o) => distance(samples[i].vec, o.vec, gone))) };
}

/**
 * The honest accuracy. Each sample a person labelled is hidden together with the other samples of its tap (same session) and guessed from
 * the rest. Auto samples help guess but are never graded: their label came from the model itself.
 * opts: { width, gone, matrix (from gradeMatrix), auto: false to leave the auto samples out of the guessing too }.
 * -> { accuracy, unsure, wrong, tested, perRoom: { room: { n, right, accuracy } }, confusion: { actual: { guessed: count } }, thin: [rooms with < 5 samples] }
 */
function crossValidate(samples, now = Date.now(), opts = {}) {
    const M = opts.matrix || gradeMatrix(samples, opts.gone);
    const useAuto = opts.auto !== false;
    const perRoom = {}, confusion = {};
    let right = 0, unsure = 0, tested = 0;
    const counts = {};
    for (const s of samples) if (human(s)) counts[s.room] = (counts[s.room] || 0) + 1;
    M.tests.forEach((ti, r) => {
        const s = samples[ti];
        const rest = [], ds = [];
        samples.forEach((o, j) => {
            if (j === ti || (s.session && o.session === s.session) || (!useAuto && !human(o))) return;
            rest.push(o); ds.push(M.rows[r][j]);
        });
        if (new Set(rest.map((o) => o.room)).size < 2) return;
        const g = decide(rest, ds, now, opts.width || MIN_WIDTH);
        tested++;
        const pr = perRoom[s.room] || (perRoom[s.room] = { n: 0, right: 0, accuracy: 0 });
        pr.n++;
        const guessed = g.room || "(not sure)";
        confusion[s.room] = confusion[s.room] || {};
        confusion[s.room][guessed] = (confusion[s.room][guessed] || 0) + 1;
        if (!g.room) unsure++;
        if (g.room === s.room) { right++; pr.right++; }
    });
    for (const r of Object.values(perRoom)) r.accuracy = r.n ? Math.round((100 * r.right) / r.n) : 0;
    const pct = (n) => (tested ? Math.round((100 * n) / tested) : 0);
    return { accuracy: pct(right), unsure: pct(unsure), wrong: pct(tested - right - unsure), tested, perRoom, confusion, thin: Object.keys(counts).filter((r) => counts[r] < 5) };
}

/** A wrong room is worse than "not sure": the score `tune` maximises. */
const scoreOf = (cv) => cv.accuracy - 0.5 * cv.wrong;

/**
 * The kernel width that suits this home and phone: each of WIDTHS is tried on the same hide-and-guess test, and the default (5 dBm) is
 * only replaced when another is at least 2 points better (so noise never flips it back and forth).
 * -> { width, accuracy, unsure, wrong, tested, tried: [{ width, accuracy, unsure, wrong }] }
 */
function tune(samples, now = Date.now(), opts = {}) {
    const matrix = opts.matrix || gradeMatrix(samples, opts.gone);
    const tried = WIDTHS.map((width) => { const cv = crossValidate(samples, now, { matrix, width }); return { width, accuracy: cv.accuracy, unsure: cv.unsure, wrong: cv.wrong, tested: cv.tested }; });
    const base = tried.find((t) => t.width === MIN_WIDTH);
    const best = tried.reduce((b, t) => (scoreOf(t) > scoreOf(b) ? t : b), base);
    const pick = scoreOf(best) >= scoreOf(base) + 2 ? best : base;
    return { ...pick, tried: tried.map(({ width, accuracy, unsure, wrong }) => ({ width, accuracy, unsure, wrong })) };
}

/**
 * Do the auto samples help? The same people-labelled test, guessed with and without them. -> { with, without, tested, hurts }
 * `hurts` when they cost more than 3 points (then the caller pauses auto-improve for the phone and removes them).
 */
function guard(samples, now = Date.now(), opts = {}) {
    const matrix = opts.matrix || gradeMatrix(samples, opts.gone);
    const a = crossValidate(samples, now, { matrix, width: opts.width, auto: true }), b = crossValidate(samples, now, { matrix, width: opts.width, auto: false });
    return { with: a.accuracy, without: b.accuracy, tested: a.tested, hurts: a.tested >= 20 && a.accuracy < b.accuracy - 3 };
}

/**
 * Networks that are gone: heard clearly (-80 dBm or louder) in samples older than 14 days, but in NONE of the recent (7 days) samples of
 * every room they used to be heard in, when each of those rooms has at least 3 recent samples that listened to that kind (Wi-Fi or
 * Bluetooth). A room with no recent data proves nothing, so its networks are kept. -> Set of keys.
 */
function goneKeys(samples, now = Date.now(), { recentDays = 7, oldDays = 14, minRecent = 3, loud = -80 } = {}) {
    const recentCut = now - recentDays * DAY, oldCut = now - oldDays * DAY;
    const heard = new Set(), recentBy = {}, where = new Map();
    for (const s of samples) {
        if (s.at >= recentCut) {
            const k = kindsOf(s.vec);
            const r = recentBy[s.room] || (recentBy[s.room] = { w: 0, b: 0 });
            if (k.w) r.w++;
            if (k.b) r.b++;
            for (const key in s.vec) heard.add(key);
        } else if (s.at < oldCut) {
            for (const key in s.vec) if (s.vec[key] >= loud) { if (!where.has(key)) where.set(key, new Set()); where.get(key).add(s.room); }
        }
    }
    const gone = new Set();
    for (const [key, rooms] of where) {
        if (heard.has(key)) continue;
        if ([...rooms].every((room) => ((recentBy[room] || {})[key[0]] || 0) >= minRecent)) gone.add(key);
    }
    return gone;
}

/**
 * Should this live scan become an auto sample? Only when everything says the label is right (docs/ROOM_MODEL_AUTO_IMPROVE_PLAN.md, C1).
 * in: { on, pausedUntil, ageSec (age of the scan's Wi-Fi readings), guess (classify), prevRoom + prevAt (the smoothed room before this
 *       scan and when it was worked out), nextRoom (after), samples, vec, now, gone }
 * -> { ok: true } or { ok: false, why }
 */
function autoGate({ on, pausedUntil, ageSec, guess, prevRoom, prevAt, nextRoom, samples, vec, now = Date.now(), gone }) {
    const no = (why) => ({ ok: false, why });
    if (!on) return no("auto-improve is off");
    if (pausedUntil && Number(pausedUntil) > now) return no("paused");
    if (!(Number.isFinite(ageSec) && ageSec >= 0 && ageSec <= AUTO.maxAgeSec)) return no("the scan is not fresh");
    if (!guess || !guess.room) return no("not sure");
    if (guess.confidence < AUTO.conf) return no("not sure enough");
    if ((guess.margin ?? 0) < AUTO.margin) return no("two rooms are close");
    if (!(guess.nearest <= AUTO.near)) return no("not a familiar spot");
    // settled: the room before this scan (from a recent scan, not yesterday's) is this room, and stays it
    if (prevRoom !== guess.room || nextRoom !== guess.room || !(now - Number(prevAt) <= AUTO.settleMs)) return no("the room is not settled");
    const people = {};
    for (const s of samples) if (human(s)) people[s.room] = (people[s.room] || 0) + 1;
    if (Object.values(people).filter((n) => n >= AUTO.minHuman).length < 2 || (people[guess.room] || 0) < AUTO.minHuman) return no("not trained enough by a person");
    let lastAuto = 0;
    for (const s of samples) if (s.src === "auto" && s.room === guess.room) {
        if (s.at > lastAuto) lastAuto = s.at;
        if (now - s.at < AUTO.dupMs && distance(vec, s.vec, gone) < AUTO.dup) return no("already have this spot");
    }
    if (now - lastAuto < AUTO.everyMs) return no("one a while ago");
    return { ok: true };
}

/**
 * After a correction ("Galat hai, main X mein hoon"): the auto samples of the last day that carry another room's name and sit close to the
 * corrected scans were wrong labels. -> the ids to delete.
 */
function wrongAutos(samples, fixVecs, room, now = Date.now(), gone) {
    return samples.filter((s) => s.src === "auto" && s.room !== room && now - s.at < DAY && fixVecs.some((v) => distance(v, s.vec, gone) <= AUTO.near)).map((s) => s.id).filter(Boolean);
}

/**
 * Smoothing: the room only changes after the same new room wins twice in a row. state: { room, pending, count } -> next state + whether the room changed.
 * "Not sure" (null) keeps the old room but does not count towards a change.
 */
function smooth(state, guess) {
    const s = state || { room: null, pending: null, count: 0 };
    if (!guess) return { state: { ...s, pending: null, count: 0 }, changed: false };
    if (!s.room) return { state: { room: guess, pending: null, count: 0 }, changed: true };      // the very first answer is taken at once
    if (guess === s.room) return { state: { room: s.room, pending: null, count: 0 }, changed: false };
    const count = s.pending === guess ? s.count + 1 : 1;
    if (count >= 2) return { state: { room: guess, pending: null, count: 0 }, changed: true };
    return { state: { room: s.room, pending: guess, count }, changed: false };
}

module.exports = { hashId, vectorOf, kindsOf, distance, classify, decide, gradeMatrix, crossValidate, tune, guard, goneKeys, autoGate, wrongAutos, smooth, srcWeight, FLOOR, FAR, SURE, MIN_WIDTH, WIDTHS, AUTO, SRC_WEIGHT };
