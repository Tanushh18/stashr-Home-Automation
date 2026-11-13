import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The item model, sync helpers and the house map / Room Lab helpers are shared by the web and Android apps as copies. They must stay identical. */
for (const file of ["items.js", "sync.js", "alerts.js", "fx.js", "roomLab.js", "homeMap.js"]) {
  test(`client and mobile ${file} are identical`, () => {
    const web = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
    const app = readFileSync(new URL(`../../mobile/src/lib/${file}`, import.meta.url), "utf8");
    assert.equal(app, web, `copy ${file} between client/src/lib and mobile/src/lib so they match`);
  });
}
