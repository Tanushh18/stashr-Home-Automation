import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readGlb, writeGlb } from "../scripts/glb.mjs";
import { MODELS } from "../scripts/build-models.mjs";

const file = (name) => new URL(`../public/models/${name}`, import.meta.url);

test("every model is a valid, quantized glTF 2.0 binary with the parts the scenes use", async () => {
  const expected = { "stashr-shield.glb": ["shell", "inlay", "keyhole"], "vault-door.glb": ["slab", "face", "bolts", "wheel", "jamb"] };
  for (const [name, parts] of Object.entries(expected)) {
    const bytes = new Uint8Array(await readFile(file(name)));
    const { version, length, json, binLength } = readGlb(bytes);
    assert.equal(version, 2, name);
    assert.equal(length, bytes.length, `${name} header length matches the file`);
    assert.equal(json.buffers[0].byteLength <= binLength, true);
    assert.deepEqual(json.extensionsRequired, ["KHR_mesh_quantization"]);
    const names = json.scenes[0].nodes.map((i) => json.nodes[i].name);
    assert.deepEqual(names, parts, `${name} top-level parts`);
    for (const a of json.accessors) {
      const view = json.bufferViews[a.bufferView];
      assert.ok(view.byteOffset + view.byteLength <= json.buffers[0].byteLength, `${name} accessor fits in the buffer`);
    }
    assert.ok(bytes.length < 160 * 1024, `${name} stays small (${bytes.length} bytes)`);
  }
});

test("the committed models are exactly what scripts/build-models.mjs produces", async () => {
  for (const [name, build] of Object.entries(MODELS)) {
    const fresh = writeGlb(build());
    const committed = new Uint8Array(await readFile(file(name)));
    assert.equal(Buffer.compare(Buffer.from(fresh), Buffer.from(committed)), 0, `${name} is reproducible — run npm run models`);
  }
});
