const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

// The phone launcher is served like the other side apps, from its own stashr-launcher-v… release.
const manifest = { packageName: "com.tanush.stashr.launcher", version: "1.0.0", versionCode: 100003, sha256: "c".repeat(64), sizeBytes: Buffer.byteLength("launcher-apk"), releaseNotes: "Launcher" };
global.fetch = async (url) => {
    const t = String(url);
    if (t.includes("/releases?per_page=")) {
        return new Response(JSON.stringify([
            { draft: false, prerelease: false, tag_name: "stashr-v2.6.0-build-100060", assets: [] },
            { draft: false, prerelease: false, tag_name: "stashr-launcher-v1.0.0-build-100003", name: "Stashr Launcher 1.0.0", published_at: "2026-11-15T00:00:00Z", assets: [
                { name: "stashr-launcher.apk", url: "https://api.github.com/repos/x/y/releases/assets/21" },
                { name: "stashr-launcher-update.json", url: "https://api.github.com/repos/x/y/releases/assets/22" }] }
        ]), { status: 200 });
    }
    if (t.endsWith("/assets/22")) return new Response(JSON.stringify(manifest), { status: 200 });
    if (t.endsWith("/assets/21")) return new Response("launcher-apk", { status: 200 });
    throw new Error("Unexpected fetch URL in test: " + t);
};
const app = require("../app");

test("the launcher update check finds the newest stashr-launcher release and offers it to everyone", async () => {
    const r = await request(app).get("/api/mobile-updates/launcher/latest?currentVersionCode=100002");
    assert.equal(r.status, 200);
    assert.equal(r.body.appId, "com.tanush.stashr.launcher");
    assert.equal(r.body.versionCode, 100003);
    assert.equal(r.body.updateAvailable, true);
    assert.match(r.body.downloadUrl, /\/api\/mobile-updates\/launcher\/download$/);
    const same = await request(app).get("/api/mobile-updates/launcher/latest?currentVersionCode=100003");
    assert.equal(same.body.updateAvailable, false);
});

test("the launcher APK is sent straight to GitHub, not streamed through the server", async () => {
    const r = await request(app).get("/api/mobile-updates/launcher/download").redirects(0);
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /^https:\/\/github\.com\//);
});
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/vnd.android.package-archive");
    assert.equal(r.body.toString(), "launcher-apk");
});
