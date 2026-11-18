/*
 * Two (or more) family phones travelling together share one position and take turns reporting, so the battery of both lasts longer.
 *   - who is together: utils/homeAutomation.js groupTogether (inside 250 m, still together up to 400 m; only phones that are out and fresh)
 *   - lead: the phone that checks at the normal pace for the current slot; the others rest (look less often) and take the lead's fix
 *   - gap: when the phones drift more than 400 m apart the group dissolves and every phone is on its own again
 * A phone with syncing off is never in a group and never gets anyone's position.
 */
const SLOT_MS = 10 * 60 * 1000;          // the lead changes every 10 minutes
const LOW = 35;                          // a phone at or below this (and not charging) rests while another can lead

const batteryOf = (ph) => { const n = Number(ph && ph.status && ph.status.battery); return Number.isFinite(n) ? n : null; };
const charging = (ph) => Boolean(ph && ph.status && ph.status.charging === true);

/** Everyone grouped with `key` (including it), as phone objects; [] when the phone is on its own. `groups` is groupTogether's map (companion -> major). */
function membersOf(key, phones, groups) {
    const major = (k) => groups.get(k) || k;
    const root = major(String(key));
    const members = (phones || []).filter((p) => !p.syncPaused && major(String(p._id)) === root);
    return members.length >= 2 && members.some((p) => String(p._id) === String(key)) ? members : [];
}

/**
 * Who reports at the normal pace in this slot. Charging phones lead first; phones that are low are left to rest while a better one can
 * lead; otherwise the lead rotates. Returns the lead's id, or "" when nobody can lead (then everyone reports normally).
 */
function pickLead(members, now, slotMs = SLOT_MS) {
    const ok = (members || []).filter((p) => !p.syncPaused);
    if (ok.length < 2) return "";
    const charge = ok.filter(charging);
    let pool = charge.length ? charge : ok.filter((p) => !(batteryOf(p) != null && batteryOf(p) <= LOW));
    if (!pool.length) pool = ok.filter((p) => batteryOf(p) == null || batteryOf(p) > 15);     // everyone low: only the fullest-above-15 leads
    if (!pool.length) return "";
    pool = pool.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)));
    return String(pool[Math.floor(now / slotMs) % pool.length]._id);
}

/** The delay for a phone: normal for the lead (or when nobody is grouped), about double for a resting phone, never above 7 minutes. */
function nextCheck(normalSec, isLead, grouped, nearHome) {
    if (!grouped || isLead || nearHome) return normalSec;
    return Math.min(Math.max(normalSec * 2, 240), 420);
}

/** The phones whose stored position should become the reporter's: grouped mates whose own fix is older than the reporter's. */
function mirrorTargets(reporterId, members, fix) {
    return (members || []).filter((p) => String(p._id) !== String(reporterId) && !p.syncPaused
        && !(p.status && p.status.location && Number(p.status.location.at) >= Number(fix.at) - 30_000));
}

module.exports = { membersOf, pickLead, nextCheck, mirrorTargets, SLOT_MS, LOW };
