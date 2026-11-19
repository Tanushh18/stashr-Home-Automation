const { describe, test } = require("node:test");
const expect = require("./expect");
const { resolveFeatures, hasFeature, requireFeature, CATALOG } = require("../utils/features");

const ADMIN = "tanushchawla16@gmail.com";

describe("features", () => {
  test("ordinary people get the everyone features, not the admin ones", () => {
    const f = resolveFeatures("someone@example.com");
    expect(f.projects).toBe(true);
    expect(f.servers).toBe(true);
    expect(f.serverUrls).toBe(false);
    expect(f.adminPanel).toBe(false);
  });
  test("the admin gets everything", () => {
    const f = resolveFeatures(ADMIN.toUpperCase());
    expect(Object.values(f).every(Boolean)).toBe(true);
  });
  test("an override can switch a feature on or off for one person", () => {
    expect(resolveFeatures("a@b.co", { projects: false }).projects).toBe(false);
    expect(resolveFeatures(ADMIN, { servers: false }).servers).toBe(false);
    expect(resolveFeatures("a@b.co", { servers: true }).servers).toBe(true);
  });
  test("locked admin features cannot be granted by override", () => {
    const f = resolveFeatures("a@b.co", { serverUrls: true, adminPanel: true, security: true });
    expect(f.serverUrls || f.adminPanel || f.security).toBe(false);
  });
  test("ignores junk overrides and unknown keys", () => {
    expect(resolveFeatures("a@b.co", { projects: "no", nonsense: true }).projects).toBe(true);
    expect("nonsense" in resolveFeatures("a@b.co", { nonsense: true })).toBe(false);
  });
  test("requireFeature lets allowed people through and refuses others with 403", () => {
    let status = 0, nexted = false;
    const res = { status(s) { status = s; return this; }, json() {} };
    requireFeature("adminPanel")({ rootUser: { email: ADMIN } }, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    requireFeature("adminPanel")({ rootUser: { email: "a@b.co" } }, res, () => { throw new Error("should not pass"); });
    expect(status).toBe(403);
    expect(hasFeature(null, "projects")).toBe(false);
  });
  test("every catalog entry has a key, label and audience", () => {
    expect(CATALOG.every((f) => f.key && f.label && ["all", "admin"].includes(f.audience))).toBe(true);
  });
});
