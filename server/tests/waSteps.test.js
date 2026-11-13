const { describe, test } = require("node:test");
const expect = require("./expect");
const { fromAnswer, neverDelivered } = require("../utils/waSteps");

const states = (r) => r.steps.map((x) => x.key + ":" + x.state).join(" ");

describe("waSteps", () => {
    test("a sent message has every step ok", () => {
        const r = fromAnswer(true, "Sent to +919810000001", { withImage: true });
        expect(r.where).toBe("");
        expect(r.steps.every((x) => x.state === "ok")).toBe(true);
        expect(r.steps.map((x) => x.key)).toEqual(["checks", "picture", "opened", "send", "confirmed"]);
    });
    test("Accessibility off and WhatsApp missing are the tablet's, before anything else", () => {
        expect(states(fromAnswer(false, "Turn on Stashr Hub in Accessibility settings"))).toBe("checks:failed opened:skipped send:skipped confirmed:skipped");
        expect(fromAnswer(false, "WhatsApp Business is not installed").where).toBe("tablet");
    });
    test("a number that is not on WhatsApp is WhatsApp's, after the chat was opened", () => {
        const r = fromAnswer(false, "That number is not on WhatsApp");
        expect(r.where).toBe("whatsapp");
        expect(states(r)).toBe("checks:ok opened:failed send:skipped confirmed:skipped");
    });
    test("a timeout names the picture step the tablet got stuck on", () => {
        expect(fromAnswer(false, "Timed out before pressing Send (step 2)", { withImage: true }).steps.find((x) => x.state === "failed").note).toMatch(/newest photo/);
        expect(fromAnswer(false, "Timed out before pressing Send (step 0)", { withImage: false }).steps.find((x) => x.state === "failed").key).toBe("send");
    });
    test("pressed Send without confirmation is WhatsApp's, and says to check WhatsApp", () => {
        const r = fromAnswer(false, "Pressed Send but WhatsApp did not confirm");
        expect(r.where).toBe("whatsapp");
        expect(r.steps.find((x) => x.state === "failed").key).toBe("confirmed");
        expect(r.summary).toMatch(/check WhatsApp/);
    });
    test("no answer after the tablet took it is the tablet's; an unknown failure still names a step", () => {
        expect(fromAnswer(false, "No answer from the tablet after it took the message (it may have been sent: check WhatsApp)").where).toBe("tablet");
        const r = fromAnswer(false, "something odd");
        expect(r.steps.some((x) => x.state === "failed")).toBe(true);
        expect(r.steps.find((x) => x.state === "failed").note).toBe("something odd");
    });
    test("never delivered fails at the delivery step", () => {
        const r = neverDelivered();
        expect(r.steps[0]).toMatchObject({ key: "delivered", state: "failed" });
        expect(r.where).toBe("tablet");
    });
});
