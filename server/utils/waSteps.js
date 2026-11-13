/**
 * The steps of one WhatsApp message, and where it stopped. Pure (no database), so it is unit-tested.
 *
 * The server writes the first steps itself (picked, queued, delivered to the tablet). The tablet only answers once, at the end, with a
 * sentence; `fromAnswer` turns that sentence into the rest of the steps, so the website can say which one failed and who is responsible:
 * "server", "tablet" (the Stashr Hub app: Accessibility, WhatsApp not installed, buttons not found) or "whatsapp" (the number, no confirmation).
 */

const LABELS = {
    picked: "Server picked the person, the text and the picture",
    queued: "Server queued the message for the tablet",
    delivered: "Tablet received the message",
    checks: "Tablet checked it can send (Accessibility on, WhatsApp installed, not busy)",
    picture: "Tablet got the picture and attached it",
    opened: "Tablet opened the chat in WhatsApp",
    send: "Tablet pressed Send",
    confirmed: "WhatsApp confirmed the message was sent"
};

const WHERE_TEXT = { server: "the server", tablet: "the tablet", whatsapp: "WhatsApp" };

/** The tablet's attach-picture stages (see WaLeadSender.Job.stage): where a "timed out before pressing Send" stopped. */
const STAGE_TEXT = [
    "the tablet could not find the button to attach the picture (the chat may not have opened)",
    "the tablet could not open the Gallery in WhatsApp",
    "the tablet could not pick the newest photo",
    "the tablet could not find the Send button on the picture preview"
];

const step = (key, state, note = "") => ({ key, label: LABELS[key], state, note });

/**
 * The steps that follow "Tablet received the message", from the tablet's answer.
 * Returns { steps, where, summary }: where is "" when it was sent.
 */
function fromAnswer(ok, message, { withImage = false } = {}) {
    const m = String(message || "").trim();
    const order = ["checks", ...(withImage ? ["picture"] : []), "opened", "send", "confirmed"];
    const build = (failKey, where, note) => {
        const steps = [];
        let failed = false;
        for (const key of order) {
            if (failed) steps.push(step(key, "skipped"));
            else if (key === failKey) { steps.push(step(key, "failed", note)); failed = true; }
            else steps.push(step(key, "ok"));
        }
        return { steps, where, summary: `Failed at "${LABELS[failKey]}" (${WHERE_TEXT[where]}): ${note}` };
    };
    if (ok) return { steps: order.map((k) => step(k, "ok", k === "confirmed" ? m : "")), where: "", summary: "Sent" };

    if (/accessibility/i.test(m)) return build("checks", "tablet", "Stashr Hub is not switched on in the tablet's Accessibility settings.");
    if (/not installed/i.test(m)) return build("checks", "tablet", "WhatsApp Business is not installed on the tablet.");
    if (/another message is being sent/i.test(m)) return build("checks", "tablet", "The tablet was still busy with another message.");
    if (/nothing to send/i.test(m)) return build("checks", "server", "The sheet has no message and no picture.");
    if (/not a valid number/i.test(m)) return build("checks", "server", "The number is not a valid mobile number.");
    if (/picture/i.test(m) && /save|available|gallery|attach/i.test(m)) return build("picture", "tablet", m);
    if (/not on whatsapp|isn't on whatsapp|invalid/i.test(m)) return build("opened", "whatsapp", "WhatsApp says this number is not on WhatsApp.");
    const t = /before pressing send.*step (\d+)/i.exec(m);
    if (t) {
        const n = Number(t[1]);
        if (withImage && n <= 3) return build("picture", "tablet", `Stopped at step ${n}: ${STAGE_TEXT[Math.max(0, Math.min(3, n))]}.`);
        return build("send", "tablet", `The tablet opened WhatsApp but could not press Send (step ${n}).`);
    }
    if (/before pressing send/i.test(m)) return build("send", "tablet", "The tablet never picked the message up, so Send was never pressed.");
    if (/did not confirm/i.test(m)) return build("confirmed", "whatsapp", "The tablet pressed Send, but WhatsApp never showed the message as sent. It may have gone out: check WhatsApp.");
    if (/no answer from the tablet/i.test(m)) return build("send", "tablet", "The tablet took the message but never answered. It may have been sent: check WhatsApp.");
    return build("send", "tablet", m || "The tablet reported a failure without a reason.");
}

/** "The tablet never picked the message up": the failure is at the delivery step, with nothing after it. */
function neverDelivered(withImage = false) {
    const keys = ["checks", ...(withImage ? ["picture"] : []), "opened", "send", "confirmed"];
    return {
        steps: [step("delivered", "failed", "The tablet never asked for the message: it is offline, asleep or Stashr Hub is not running."), ...keys.map((k) => step(k, "skipped"))],
        where: "tablet", summary: "Failed at \"Tablet received the message\" (the tablet): it never picked the message up."
    };
}

module.exports = { LABELS, fromAnswer, neverDelivered, step };
