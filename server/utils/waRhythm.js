/**
 * The WhatsApp sender's rhythm: everything that makes one day and one week look different from the last, so the sending
 * never falls into a pattern. Pure functions only (the database part is in waSender.js), with the random source injectable
 * so tests can pin it.
 *
 *   - Rest days: each week a few days (2 by default) are picked at random when nothing goes out. A week never rests on the
 *     same weekdays as the week before, a weekday is never a rest day three weeks running, there are never too many sending
 *     days in a row, and the rest days never add up to a long silence.
 *   - The day: each day picks its own number of messages (a random number a little under the limit), its own start and
 *     stop time (a little after the window opens, a little before it closes), a lunch break, and splits the messages into a few
 *     rounds spread over the day with long breaks between them, the way a person works through a list between other things.
 *   - The gap: a different wait after every message, anywhere between the shortest and the longest gap, with a longer break now and then.
 *   - The tablet: a random pause on the chat ("reading it") before Send is pressed.
 *   - The text: {Hi|Hello|Hey} in a message picks one of the words at random for each person.
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
 * Today's own plan, picked once a day:
 *   - how many messages: a random number from 70% of the limit up to the limit;
 *   - when sending starts and stops: up to 90 minutes after the window opens, up to 60 minutes before it closes (less for a short
 *     window), so with 10:00 to 18:00 the first message goes between 10:00 and 11:30 and the last one before 17:00 to 18:00;
 *   - a lunch break: starting between 13:00 and 14:00, 30 to 75 minutes long (when the day has room for it);
 *   - rounds: the messages are split into 1 to 4 rounds (more rounds for more messages) spread over the day, with the spare time
 *     shared out at random between the breaks, so the messages are never all fired off in one burst.
 * `basis` changes when the window, the limit or the gaps change, so a new plan is made then.
 */
function dayPlanFor(s, date, random = secureRandom) {
    const from = toMinutes(s.from), to = toMinutes(s.to);
    const limit = Math.max(0, Math.round(Number(s.dailyLimit) || 0));
    const win = from !== null && to !== null && to > from ? to - from : 0;
    const late = Math.floor(random() * (Math.min(90, win * 0.2) + 1));
    const early = Math.floor(random() * (Math.min(60, win * 0.125) + 1));
    const low = limit > 0 ? Math.max(1, Math.ceil(limit * 0.7)) : 0;
    const target = Math.min(limit, low + Math.floor(random() * (limit - low + 1)));
    const start = (from || 0) + late;
    const end = Math.max(start + 1, (to || 0) - early);
    const lunch = lunchFor(start, end, random);
    const rounds = roundsFor({ start, end, target, lunch, gapMin: s.gapMin, gapMax: s.gapMax }, random);
    return { day: date, target, start, end, lunch, rounds, basis: basisOf(s) };
}
const basisOf = (s) => `v2 ${s.from}-${s.to} ${Math.round(Number(s.dailyLimit) || 0)} ${Number(s.gapMin) || 6}-${Number(s.gapMax) || 12}`;
const toMinutes = (v) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** A lunch break starting between 13:00 and 14:00, 30 to 75 minutes long, when the day has at least an hour of work before it and half an hour after it. */
function lunchFor(start, end, random = secureRandom) {
    const at = 13 * 60 + Math.floor(random() * 61);
    const length = 30 + Math.floor(random() * 46);
    return at >= start + 60 && at + length <= end - 30 ? { start: at, end: at + length } : null;
}

/** The messages split into `k` rounds of at least one each, at random cut points. */
function splitCount(total, k, random = secureRandom) {
    if (k <= 1 || total <= 1) return [Math.max(0, total)];
    const spots = Array.from({ length: total - 1 }, (_, i) => i + 1);
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    const cuts = spots.slice(0, Math.min(k, total) - 1).sort((a, b) => a - b);
    return [...cuts, total].map((c, i, all) => c - (i ? all[i - 1] : 0));
}

/**
 * When each round starts (minutes since midnight) and how many messages it has. The first round starts at the day's start; a round
 * takes about one average gap per message; the time left over is shared out at random between the breaks (and a little after the
 * last round), on a clock that skips the lunch break. A day too full for breaks is one round.
 */
function roundsFor({ start, end, target, lunch, gapMin, gapMax }, random = secureRandom) {
    if (!(target > 0)) return [];
    const lo = Math.max(1, Number(gapMin) || 6), hi = Math.max(lo, Number(gapMax) || 12), avg = (lo + hi) / 2;
    const fewest = target > 6 ? 2 : 1, most = target <= 3 ? 1 : target <= 6 ? 2 : target <= 12 ? 3 : 4;
    const k = fewest + Math.floor(random() * (most - fewest + 1));
    const counts = splitCount(target, k, random);
    const lunchLength = lunch ? lunch.end - lunch.start : 0;
    const needs = counts.map((c) => c * avg);
    const spare = end - start - lunchLength - needs.reduce((a, b) => a + b, 0);
    if (counts.length === 1 || spare <= 0) return [{ at: start, count: target }];
    const weights = counts.map(() => 0.25 + random());
    const total = weights.reduce((a, b) => a + b, 0);
    const clock = (m) => { const at = Math.round(m); return lunch && at >= lunch.start ? at + lunchLength : at; };
    const out = [];
    let t = start;
    counts.forEach((count, i) => { out.push({ at: clock(t), count }); t += needs[i] + (spare * weights[i]) / total; });
    return out;
}

/** How many of the day's messages may have gone out by `minutes`: every round that has started (the whole day without rounds). */
function allowedBy(plan, minutes) {
    const rounds = plan && Array.isArray(plan.rounds) && plan.rounds.length ? plan.rounds : null;
    if (!rounds) return plan ? plan.target : 0;
    return rounds.filter((r) => r.at <= minutes).reduce((a, r) => a + r.count, 0);
}

/** The first round that has not started by `minutes`, or null. */
const nextRound = (plan, minutes) => ((plan && plan.rounds) || []).find((r) => r.at > minutes) || null;

/** True during the day's lunch break. */
const atLunch = (plan, minutes) => Boolean(plan && plan.lunch && minutes >= plan.lunch.start && minutes < plan.lunch.end);

/**
 * How long the tablet waits on the open chat before pressing Send, in milliseconds: 3 to 9 seconds, and up to 3 more for a long
 * message, the time a person takes to look at it. Never the same twice.
 */
function sendPauseMs(text, random = secureRandom) {
    const extra = Math.min(3000, String(text || "").length * 10);
    return Math.round(3000 + random() * 6000 + random() * extra);
}

/**
 * {Hi|Hello|Hey} picks one of the choices at random for each message (choices can be empty: {|🙂}, and groups can be inside
 * each other). {name} is left alone for the sender to fill in.
 */
function spin(text, random = secureRandom) {
    let out = String(text || "").replace(/\{name\}/gi, "\u0001");
    for (let i = 0; i < 100; i++) {
        const next = out.replace(/\{([^{}]*\|[^{}]*)\}/, (_, body) => { const opts = body.split("|"); return opts[Math.min(opts.length - 1, Math.floor(random() * opts.length))]; });
        if (next === out) break;
        out = next;
    }
    return out.replace(/\u0001/g, "{name}");
}

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

module.exports = { secureRandom, addDays, weekdayOf, weekOf, daysOfWeek, daysBetween, dayLabel, hhmm, combos, longestRun, shareOf, planWeek, dayPlanFor, basisOf, lunchFor, splitCount, roundsFor, allowedBy, nextRound, atLunch, sendPauseMs, spin, nextGap, triangular, nextSendingDay, MAX_REST_DAYS, BREAK_CHANCE, WEEKDAY };
