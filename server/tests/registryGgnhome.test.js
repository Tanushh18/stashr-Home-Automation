const { describe, test } = require("node:test");
const expect = require("./expect");
const { DEFAULTS, APP_LABELS, OFFABLE, urlsFor } = require("../utils/registryDefaults");

describe("the ggnhome entry of the server registry", () => {
    test("is a built-in app, so Stashr → Server URLs shows a card for it and the SMS Service app can read its address", () => {
        expect(Object.keys(DEFAULTS)).toContain("ggnhome");
        expect(APP_LABELS.ggnhome).toBe("ggnHome");
        expect(DEFAULTS.ggnhome).toEqual(["https://ggnhome-server.onrender.com"]);
    });

    test("uses what an admin saved, else the built-in address, and always keeps a server", () => {
        expect(urlsFor(null, "ggnhome")).toEqual(["https://ggnhome-server.onrender.com"]);
        expect(urlsFor({ urls: ["https://api.ggnhome.com", "https://ggnhome-server.onrender.com"] }, "ggnhome")).toEqual(["https://api.ggnhome.com", "https://ggnhome-server.onrender.com"]);
        expect(OFFABLE.has("ggnhome")).toBe(false);
    });
});
