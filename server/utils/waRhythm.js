/**
 * The WhatsApp sender's rhythm: everything that makes one day and one week look different from the last, so the sending
 * never falls into a pattern. Pure functions only (the database part is in waSender.js), with the random source injectable
 * so tests can pin it.
 *
 *   - Rest days: each week a few days (2 by default) are picked at random when nothing goes out. A week never rests on the
 *     same weekdays as the week before, a weekday is never a rest day three weeks running, there are never too many sending
 *     days in a row, and the rest days never add up to a long silence.
 *   - The day: each day picks its own number of messages (a random number a little under the limit) and its own start and
 *     stop time (a little after the window opens, a little before it closes).
 *   - The gap: a different wait after every message, anywhere between the shortest and the longest gap, with a longer break now and then.
 *
 * Dates are the account's local dates as "YYYY-MM-DD"; weeks start on Monday.
 */
const crypto = require("crypto");

/** A random number in [0, 1) from the operating system's random source (not Math.random's predictable generator). */
function secureRandom() {
    return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** 0 for Monday up to 6 for Sunday. */
const weekdayOf = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
/** The Monday of the week a date is in. */
const weekOf = (date) => addDays(date, -weekdayOf(date));
const daysOfWeek = (week) => Array.from({ length: 7 }, (_, i) => addDays(week, i));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Tue 17 Nov". */
const dayLabel = (date) => `${WEEKDAY[weekdayOf(date)]} ${Number(date.slice(8, 10))} ${MONTH[Number(date.slice(5, 7)) - 1]}`;
const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

const MAX_REST_DAYS = 3;
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

/** Every way to choose k items of a list (at most 35 for a week). */
function combos(list, k) {
    const out = [];
    const walk = (start, acc) => {
        if (acc.length === k) { out.push(acc.slice()); return; }
        for (let i = start; i <= list.length - (k - acc.length); i++) { acc.push(list[i]); walk(i + 1, acc); acc.pop(); }
    };
    if (k >= 0 && k <= list.length) walk(0, []);
    return out;
}

/** The longest run of `value` in a list of booleans. */
function longestRun(flags, value) {
    let best = 0, run = 0;
    for (const f of flags) { run = f === value ? run + 1 : 0; best = Math.max(best, run); }
    return best;
}

/**
 * A fair share of the rest days for a week that is already under way: with 2 rest days a week and 3 days left, 2 × 3/7 = 0.86,
 * so one rest day 86% of the time and none otherwise. A whole week always gets all of them.
 */
function shareOf(perWeek, daysLeft, random = secureRandom) {
    if (daysLeft >= 7) return perWeek;
    const share = (perWeek * Math.max(0, daysLeft)) / 7;
    return Math.min(daysLeft, Math.floor(share) + (random() < share - Math.floor(share) ? 1 : 0));
}

/**
 * Picks a week's rest days. `count` is how many the week should have in total, `fixed` the ones already decided that stay
 * (days that are over), `free` the days that may still become one, `history` the earlier weeks ({ week, days }).
 * Among every choice that keeps the rules, one is taken at random; when none keeps them all, the least important rule is
 * dropped first (the order is below). Returns the week's rest days, sorted.
 */
function planWeek({ week, perWeek = 2, count = perWeek, fixed = [], free = daysOfWeek(week), history = [], random = secureRandom }) {
    const days = daysOfWeek(week);
    const fixedSet = new Set(fixed.filter((d) => days.includes(d)));
    const freeList = free.filter((d) => days.includes(d) && !fixedSet.has(d));
    const need = Math.max(0, Math.min(freeList.length, count - fixedSet.size));
    if (need === 0) return [...fixedSet].sort();
    const prev = (history.find((w) => w.week === addDays(week, -7)) || {}).days || null;
    const prev2 = (history.find((w) => w.week === addDays(week, -14)) || {}).days || null;
    const prevWeekdays = prev ? new Set(prev.map(weekdayOf)) : null;
    const twiceRested = prev && prev2 ? new Set(prev.map(weekdayOf).filter((w) => prev2.some((d) => weekdayOf(d) === w))) : new Set();
    const prevFlags = prev ? daysOfWeek(addDays(week, -7)).map((d) => prev.includes(d)) : [];
    const flagsOf = (set) => [...prevFlags, ...days.map((d) => set.includes(d))];
    // 2 rest days a week: never more than 7 sending days in a row, and never more than 3 rest days in a row. When the days
    // that are over already break a limit (rest days were just switched on), the limit is the best that can still be done.
    const maxSending = Math.max(7 - perWeek + 2, longestRun(flagsOf([...fixedSet, ...freeList]), false));
    const maxResting = Math.max(perWeek + 1, longestRun(flagsOf([...fixedSet]), true));
    const rules = {
        // The rest days fall on other weekdays than last week, so there is no weekly pattern.
        notLikeLastWeek: (set) => !prevWeekdays || prevWeekdays.size !== set.length || set.some((d) => !prevWeekdays.has(weekdayOf(d))),
        // A weekday is never a rest day three weeks running.
        noThirdWeek: (set) => !set.some((d) => twiceRested.has(weekdayOf(d))),
        // It always does rest: never too many sending days in a row, counting from last week.
        restsInTime: (set) => longestRun(flagsOf(set), false) <= maxSending,
        // Rest days never add up to a long silence.
        noLongSilence: (set) => longestRun(flagsOf(set), true) <= maxResting
    };
    const order = [["notLikeLastWeek", "restsInTime", "noLongSilence", "noThirdWeek"], ["notLikeLastWeek", "restsInTime", "noLongSilence"], ["notLikeLastWeek", "restsInTime"], ["notLikeLastWeek"], []];
    const all = combos(freeList, need).map((c) => [...fixedSet, ...c].sort());
    for (const keep of order) {
        const ok = all.filter((set) => keep.every((r) => rules[r](set)));
        if (ok.length) return pick(ok, random);
    }
    return pick(all, random);
}

/**
 * Today's own plan, picked once a day: how many messages (a random number from 70% of the limit up to the limit) and when
 * sending starts and stops (up to 75 minutes after the window opens, up to 40 minutes before it closes; less for a short window).
 * `basis` changes when the window or the limit changes, so a new plan is made then.
 */
function dayPlanFor(s, date, random = secureRandom) {
    const from = toMinutes(s.from), to = toMinutes(s.to);
    const limit = Math.max(0, Math.round(Number(s.dailyLimit) || 0));
    const win = from !== null && to !== null && to > from ? to - from : 0;
    const late = Math.floor(random() * (Math.min(75, win * 0.15) + 1));
    const early = Math.floor(random() * (Math.min(40, win * 0.08) + 1));
    const low = limit > 0 ? Math.max(1, Math.ceil(limit * 0.7)) : 0;
    const target = Math.min(limit, low + Math.floor(random() * (limit - low + 1)));
    const start = (from || 0) + late;
    return { day: date, target, start, end: Math.max(start + 1, (to || 0) - early), basis: basisOf(s) };
}
const basisOf = (s) => `${s.from}-${s.to}-${Math.round(Number(s.dailyLimit) || 0)}`;
const toMinutes = (v) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

const BREAK_CHANCE = 0.12;

/** A triangular draw between a and b that peaks at c, from one uniform number u. */
function triangular(a, c, b, u) {
    if (b <= a) return a;
    const f = (c - a) / (b - a);
    return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/**
 * Minutes to wait after a message. Never the same twice: most gaps fall anywhere between the shortest and the longest gap,
 * leaning towards the gap that spreads today's messages over today's window; about one in eight is a longer break (one to three
 * times the longest gap on top), the way a person stops for a while.
 */
function nextGap({ gapMin, gapMax, windowMinutes, target }, random = secureRandom) {
    const lo = Math.max(1, Number(gapMin) || 6);
    const hi = Math.max(lo, Number(gapMax) || 12);
    const spread = windowMinutes > 0 ? windowMinutes / Math.max(1, Number(target) || 1) : (lo + hi) / 2;
    const peak = Math.min(hi, Math.max(lo, spread));
    const shape = random(), u = random();
    let gap = shape < 0.7 ? triangular(lo, peak, hi, u) : lo + (hi - lo) * u;
    if (random() >= 1 - BREAK_CHANCE) gap += hi * (1 + 2 * random());
    return gap;
}

/** The first day after `date` that is not a rest day (two weeks are known ahead at most). */
function nextSendingDay(date, restDays) {
    const rest = new Set(restDays);
    for (let i = 1; i <= 21; i++) { const d = addDays(date, i); if (!rest.has(d)) return d; }
    return addDays(date, 1);
}

module.exports = { secureRandom, addDays, weekdayOf, weekOf, daysOfWeek, daysBetween, dayLabel, hhmm, combos, longestRun, shareOf, planWeek, dayPlanFor, basisOf, nextGap, triangular, nextSendingDay, MAX_REST_DAYS, BREAK_CHANCE, WEEKDAY };
