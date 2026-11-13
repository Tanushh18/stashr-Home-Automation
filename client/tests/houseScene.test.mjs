import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { nodeName, markersOf, spots, roomLine, roomFacts } from "../src/lib/houseScene.js";
import { buildGlb, matchParts } from "../src/lib/houseGlb.js";

describe("the 3D view matches parts by the name they had in the file", () => {
  test("three.js renames 'Bedroom.001' and 'Bedroom 2'; the original name (userData.name) is the one that matches the rooms", async () => {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const buf = buildGlb([{ name: "Bedroom.001", x: 0, y: 0, w: 2, h: 2, z: 1 }, { name: "Bedroom 2", x: 3, y: 0, w: 2, h: 2, z: 1 }, { name: "Kitchen_wall", x: 0, y: 3, w: 2, h: 2, z: 1 }]);
    const gltf = await new Promise((ok, no) => new GLTFLoader().parse(buf, "", ok, no));
    const objs = [];
    gltf.scene.traverse((o) => { if (nodeName(o)) objs.push(o); });
    assert.deepEqual(objs.map((o) => o.name).sort(), ["Bedroom001", "Bedroom_2", "Kitchen_wall"]);       // what three.js calls them
    assert.deepEqual(objs.map(nodeName).sort(), ["Bedroom 2", "Bedroom.001", "Kitchen_wall"]);           // what the file calls them
    const rooms = ["Bedroom", "Bedroom 2", "Kitchen"];
    const byThree = matchParts(objs.map((o) => o.name), rooms), byFile = matchParts(objs.map(nodeName), rooms);
    assert.equal(byThree.matched.Bedroom, undefined);                     // the old way missed Blender's copy
    assert.deepEqual(byFile.matched, { Bedroom: ["Bedroom.001"], "Bedroom 2": ["Bedroom 2"], Kitchen: ["Kitchen_wall"] });
    assert.deepEqual(byFile.missing, []);
  });
  test("an object without a file name falls back to its own name", () => {
    assert.equal(nodeName({ name: "Hall", userData: {} }), "Hall");
    assert.equal(nodeName({ name: "", userData: {} }), "");
    assert.equal(nodeName(null), "");
  });
});

describe("what is drawn in a room", () => {
  const room = { name: "Hall", people: [{ person: "Papa" }, { person: "Mom", sure: false }], hub: true, devices: [{ label: "TV", up: true }, { label: "Speaker", up: false, tag: "audio" }] };
  test("people first (faded when the room is not sure), then the tablet, then devices on or off", () => {
    assert.deepEqual(markersOf(room), [
      { kind: "person", label: "Papa" }, { kind: "person-unsure", label: "Mom ?" }, { kind: "hub", label: "Tablet" },
      { kind: "device-up", label: "TV" }, { kind: "device-down", label: "Speaker" }
    ]);
    assert.deepEqual(markersOf({}), []);
  });
  test("the label above the room says who is in it and how many devices are on", () => {
    assert.equal(roomLine(room), "Hall · Papa, Mom? · tablet · 2 devices (1 on)");
    assert.equal(roomLine({ name: "Store", people: [], devices: [{ label: "x", up: true }] }), "Store · 1 device");
    assert.equal(roomLine({ name: "Empty" }), "Empty");
  });
  test("the tapped room's panel: people, devices (on first), the tablet, and each phone's training", () => {
    const f = roomFacts(room, { training: { Papa: 32, Mom: 0 }, autoTraining: { Papa: 5 } });
    assert.deepEqual(f.people, ["Papa", "Mom (pakka nahi)"]);
    assert.deepEqual(f.devices.map((d) => d.label), ["TV", "Speaker"]);
    assert.equal(f.hub, true);
    assert.deepEqual(f.training, ["Papa: 32 scan + 5 apne aap", "Mom: 0 scan"]);
    assert.equal(f.empty, false);
    assert.equal(roomFacts({ name: "Store" }).empty, true);
  });
});

describe("where the markers stand", () => {
  const box = { min: { x: 0, z: 0 }, max: { x: 4, z: 2 } };
  test("every marker gets its own spot inside the room, away from the walls", () => {
    for (const n of [1, 2, 3, 5, 9, 14]) {
      const at = spots(box, n);
      assert.equal(at.length, n);
      for (const p of at) { assert.ok(p.x > 0 && p.x < 4, `x ${p.x}`); assert.ok(p.z > 0 && p.z < 2, `z ${p.z}`); }
      assert.equal(new Set(at.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)).size, n);
    }
    assert.deepEqual(spots(box, 1), [{ x: 2, z: 1 }]);              // one marker: the middle
    assert.deepEqual(spots(box, 0), []);
  });
  test("a long room puts markers in a row along its length", () => {
    const at = spots({ min: { x: 0, z: 0 }, max: { x: 8, z: 1 } }, 3);
    assert.equal(new Set(at.map((p) => p.z)).size, 1);
  });
});
