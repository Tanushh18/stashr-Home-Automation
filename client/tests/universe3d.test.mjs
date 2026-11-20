import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { environmentFor, SCENES } from "../src/three/environments.js";
import { rng, cityPlots, sceneCount } from "../src/three/kit.js";
import { shortestAngle, DISTRICTS } from "../src/three/scenes/universe.js";

const src = (p) => new URL(`../src/${p}`, import.meta.url);

test("every environment route maps to a known scene and accent", () => {
  const cases = {
    "/dashboard": ["universe", "command"],
    "/passwords": ["vault", "vault"],
    "/generator": ["vault", "lab"],
    "/projects": ["devCity", "dev"],
    "/projects/abc123/edit": ["devCity", "dev"],
    "/money": ["devCity", "ledger"],
    "/security-center": ["soc", "security"],
    "/settings": ["soc", "security"],
    "/whatsapp": ["soc", "comms"],
    "/services/map": ["infra", "infra"],
    "/cron": ["infra", "infra"],
    "/media": ["gallery", "media"],
    "/smart-home": ["habitat", "home"],
    "/app-updates": ["universe", "admin"],
    "/apps": ["universe", "ecosystem"],
  };
  for (const [path, [scene, env]] of Object.entries(cases)) {
    const e = environmentFor(path);
    assert.ok(e, `expected an environment for ${path}`);
    assert.equal(e.scene, scene, path);
    assert.equal(e.env, env, path);
    assert.ok(SCENES.includes(e.scene), `${path} uses a registered scene`);
  }
});

test("home, photos, public shares and unknown routes get no backdrop; auth hosts its own", () => {
  for (const p of ["/", "", "/photos", "/photos/import", "/share/photos/tok", "/nope"]) assert.equal(environmentFor(p), null, p);
  assert.deepEqual([environmentFor("/signin").scene, environmentFor("/signin").env], [null, "facility"]);
  assert.equal(environmentFor("/passwords/").scene, "vault", "trailing slash is ignored");
});

test("kit helpers are deterministic and bounded", () => {
  const a = rng(7), b = rng(7);
  for (let i = 0; i < 50; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
  assert.notEqual(rng(1)().toFixed(3), rng(2)().toFixed(3), "consecutive seeds differ");
  assert.equal(cityPlots(10).length, 10);
  assert.deepEqual(cityPlots(5, { seed: 3 }), cityPlots(5, { seed: 3 }));
  assert.equal(sceneCount(NaN), 3);
  assert.equal(sceneCount(-4), 3);
  assert.equal(sceneCount(1000), 36);
  assert.equal(sceneCount(12.9), 12);
});

test("district camera math wraps angles the short way", () => {
  assert.ok(Math.abs(shortestAngle(0, Math.PI * 1.5) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(shortestAngle(3, -3) - (2 * Math.PI - 6)) < 1e-9);
  assert.equal(DISTRICTS.length, 6);
});

test("3D scenes never touch vault state, the API or crypto", async () => {
  const dir = src("three/scenes/");
  const files = (await readdir(dir)).map((f) => `three/scenes/${f}`).concat(["three/kit.js", "three/SceneHost.jsx", "three/Immersive.jsx"]);
  for (const f of files) {
    const code = await readFile(src(f), "utf8");
    assert.doesNotMatch(code, /state\/vault|from "\.\.\/\.\.\/api|lib\/crypto|localStorage|console\.log/, `${f} must stay data-free`);
  }
  // The global environment passes a project count only.
  const env = await readFile(src("three/PageEnvironment.jsx"), "utf8");
  assert.match(env, /useMemo\(\(\) => \(\{ theme, variant: env\?\.variant, count \}\)/);
  assert.doesNotMatch(env, /items|password|secret/i);
});

test("three.js is only loaded lazily and every canvas is cleaned up", async () => {
  const host = await readFile(src("three/SceneHost.jsx"), "utf8");
  assert.match(host, /import\("three"\)/);
  assert.doesNotMatch(host, /^import .* from "three"/m);
  for (const needle of ["IntersectionObserver", "visibilitychange", "renderer.dispose()", "forceContextLoss", "prefersReducedMotion", "cancelAnimationFrame"]) {
    assert.ok(host.includes(needle), `SceneHost handles ${needle}`);
  }
  const loaders = await readFile(src("three/loaders.js"), "utf8");
  for (const s of [...SCENES, "vaultCore"]) assert.match(loaders, new RegExp(`${s}: \\(\\) => import\\(`));
});

test("home keeps every destination, the Android link logic and accessible district markers", async () => {
  const home = await readFile(src("Pages/Home/Home.jsx"), "utf8");
  for (const code of ["VLT", "GEN", "SEC", "PRJ", "CTL", "APP"]) assert.match(home, new RegExp(`code: "${code}"`));
  assert.match(home, /import\.meta\.env\.VITE_ANDROID_URL \|\| import\.meta\.env\.REACT_APP_ANDROID_URL \|\| "\/apps"/);
  assert.match(home, /aria-label="Stashr districts"/);
  assert.match(home, /<ServiceStatus \/>/);
  assert.match(home, /fallback=\{<WorldScene/);
});

test("page changes fly the camera in and hand the old scene off instead of cutting", async () => {
  const env = await readFile(src("three/PageEnvironment.jsx"), "utf8");
  assert.match(env, /is-leaving/);
  assert.match(env, /page-env__transit/);
  assert.match(env, /intro=\{false\}/, "the outgoing scene does not replay its arrival");
  const host = await readFile(src("three/SceneHost.jsx"), "utf8");
  assert.match(host, /const flying = introAtMount && !reduce;/, "no flight under reduced motion");
  assert.match(host, /camera\.position\.copy\(saved\)/, "the flight offset never leaks into scene camera logic");
});

test("the cursor halo decorates but never replaces the system cursor", async () => {
  const jsx = await readFile(src("Components/CursorHalo/CursorHalo.jsx"), "utf8");
  const css = await readFile(src("Components/CursorHalo/CursorHalo.css"), "utf8");
  for (const code of [jsx, css]) assert.doesNotMatch(code, /cursor:\s*none/);
  assert.match(jsx, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("page interiors are scoped to their environment and never hide content", async () => {
  const css = await readFile(src("styles/interiors.css"), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter((r) => r.includes("{"));
  for (const r of rules) {
    const sel = r.split("{")[0].trim();
    if (sel.startsWith("@") || /^(from|to|\d+%)/.test(sel)) continue;
    const shared = /^\.(status|bell|install)/.test(sel) || sel.includes(".status[");
    assert.ok(shared || /:root\[data-env="[a-z]+"\]/.test(sel), `unscoped interior rule: ${sel}`);
  }
  assert.doesNotMatch(css, /display:\s*none|visibility:\s*hidden/);
});

test("the Android app uses the web palette", async () => {
  const mobile = await readFile(new URL("../../mobile/src/lib/theme.js", import.meta.url), "utf8");
  const web = await readFile(src("styles/theme.css"), "utf8");
  for (const hex of ["#08121A", "#0E1B1F", "#22C58F", "#F5F7F2", "#0D6E5C"]) assert.ok(mobile.includes(hex), `mobile theme has ${hex}`);
  assert.match(web, /--bg: #08121a;/);
  assert.match(web, /--bg: #f5f7f2;/);
  assert.doesNotMatch(mobile, /accent: "#22C55E"/, "the old off-palette green is gone");
});
