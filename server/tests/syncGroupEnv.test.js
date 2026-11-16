const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/* syncGroupEnv against stubs: three Render servers of ONE project, plus a server of another project that must stay untouched. */
const originalLoad = Module._load;
const writes = [];
const deploys = [];
const envs = {
  "srv-a": [["A", "1"], ["B", "2"]],
  "srv-b": [["A", "1"], ["B", "old"], ["C", "3"], ["D", "4"], ["E", "5"]],   // the fullest: the reference
  "srv-c": [["A", "9"], ["ONLY_C", "c"]],
  "srv-other": [["Z", "z"]]
};
const UserStub = { publicEntry: (entry) => ({ ...(entry.fields || {}), _id: entry._id }) };
const idOf = (path) => (path.match(/services\/([^/]+)/) || [])[1];
Module._load = function (request) {
  if (request.endsWith("/models/schema")) return UserStub;
  if (request === "./hosts") return { PROVIDERS: {} };
  if (request === "./renderOps") return { renderRequest: async (_k, path, opts) => {
    if (opts && opts.method === "PUT") { writes.push({ id: idOf(path), name: decodeURIComponent(path.split("/env-vars/")[1]), value: opts.body.value }); return {}; }
    if (/\/deploys$/.test(path) && opts && opts.method === "POST") { deploys.push(idOf(path)); return {}; }
    return { name: idOf(path), branch: "main", serviceDetails: {} };
  } };
  if (request === "./renderPaging") return { fetchAllPages: async (_fn, path) => ({ items: envs[idOf(path)].map(([key, value]) => ({ envVar: { key, value } })), truncated: false }) };
  if (request === "./renderGuards") return { mapWithConcurrency: async (items, _l, fn) => Promise.all(items.map(fn)) };
  if (request === "./projectMerge") return { linkedServices: (ps) => (ps[0].renderServices || []).map((s) => ({ ...s })) };
  if (request === "./projectServiceSync") return { projectsSharingRepo: () => [], moveServiceAccount: async () => {} };
  return originalLoad.apply(this, arguments);
};
const ops = require("../utils/deployOps");
Module._load = originalLoad;

const id = (n) => String(n).padStart(24, "0");
const svc = (serviceId) => ({ accountId: id(9), serviceId, name: serviceId });
const user = {
  renderAccounts: [{ _id: id(9), enc: "udk", fields: { name: "P", apiKey: "k" } }],
  hostAccounts: [],
  projects: [
    { _id: id(1), enc: "udk", fields: { name: "Service one", renderServices: [svc("srv-a"), svc("srv-b"), svc("srv-c")] } },
    { _id: id(2), enc: "udk", fields: { name: "Another service", renderServices: [svc("srv-other")] } }
  ],
  getDataKey: async () => "key"
};

test("the fullest server is the reference and every server of the project ends up with the same variables", async () => {
  const preview = await ops.syncGroupEnv(user, id(1), { apply: false });
  assert.equal(preview.source.name, "srv-b");
  assert.equal(preview.total, 6);                       // A B C D E + ONLY_C
  const by = Object.fromEntries(preview.targets.map((t) => [t.name, t]));
  assert.deepEqual(by["srv-a"].create.sort(), ["C", "D", "E", "ONLY_C"]);
  assert.deepEqual(by["srv-a"].update, ["B"]);
  assert.deepEqual(by["srv-b"].create, ["ONLY_C"]);     // the reference gets what only another server had
  assert.deepEqual(by["srv-c"].update, ["A"]);
  assert.equal(writes.length, 0);                       // a preview writes nothing
  assert.ok(!JSON.stringify(preview).includes("old")); // names only, never values

  const done = await ops.syncGroupEnv(user, id(1), { apply: true, deploy: true });
  assert.equal(done.applied, true);
  assert.equal(writes.filter((w) => w.id === "srv-other").length, 0); // another project is never touched
  assert.deepEqual(writes.filter((w) => w.id === "srv-a").map((w) => w.name).sort(), ["B", "C", "D", "E", "ONLY_C"]);
  assert.equal(writes.find((w) => w.id === "srv-a" && w.name === "B").value, "old"); // the reference's value wins
});

test("without overwrite only missing variables are added", async () => {
  writes.length = 0;
  await ops.syncGroupEnv(user, id(1), { apply: true, overwrite: false });
  assert.ok(!writes.some((w) => w.id === "srv-a" && w.name === "B"));
  assert.ok(writes.some((w) => w.id === "srv-a" && w.name === "C"));
});

test("needs at least two servers", async () => {
  await assert.rejects(ops.syncGroupEnv(user, id(2), {}), /at least two/);
});
