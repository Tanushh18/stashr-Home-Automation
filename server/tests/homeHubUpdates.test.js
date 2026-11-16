const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const manifest = { packageName: "com.tanush.stashr.hub", version: "1.0.0", versionCode: 100007, sha256: "b".repeat(64), sizeBytes: Buffer.byteLength("hub-apk"), releaseNotes: "Hub" };
global.fetch = async (url) => {
    const t = String(url);
    if (t.includes("/releases?per_page=")) {
        return new Response(JSON.stringify([
            { draft: false, prerelease: false, tag_name: "stashr-v2.3.1-build-100200", assets: [] },
            { draft: false, prerelease: false, tag_name: "stashr-hub-v1.0.0-build-100007", name: "Stashr Hub 1.0.0", published_at: "2026-11-02T00:00:00Z", assets: [
                { name: "stashr-hub.apk", url: "https://api.github.com/repos/x/y/releases/assets/9" },
                { name: "stashr-hub-update.json", url: "https://api.github.com/repos/x/y/releases/assets/10" }] }
        ]), { status: 200 });
    }
    if (t.endsWith("/assets/10")) return new Response(JSON.stringify(manifest), { status: 200 });
    if (t.endsWith("/assets/9")) return new Response("hub-apk", { status: 200 });
    throw new Error("Unexpected fetch URL in test: " + t);
};
const app = require("../app");

test("the hub update check finds the newest stashr-hub release, not the main app's", async () => {
    const r = await request(app).get("/api/mobile-updates/hub/latest?currentVersionCode=100001");
    assert.equal(r.status, 200);
    assert.equal(r.body.appId, "com.tanush.stashr.hub");
    assert.equal(r.body.versionCode, 100007);
    assert.equal(r.body.updateAvailable, true);
    assert.match(r.body.downloadUrl, /\/api\/mobile-updates\/hub\/download$/);
    const same = await request(app).get("/api/mobile-updates/hub/latest?currentVersionCode=100007");
    assert.equal(same.body.updateAvailable, false);
});

test("the hub APK is sent straight to GitHub, not streamed through the server", async () => {
    const r = await request(app).get("/api/mobile-updates/hub/download").redirects(0);
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /^https:\/\/github\.com\//);
});
