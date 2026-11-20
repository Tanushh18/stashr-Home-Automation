/*
  Builds Stashr's original 3D models as .glb files in public/models.
  Run: npm run models   (deterministic: the same input always writes the same bytes)
  The scenes load these at runtime and fall back to the same geometry built in code.
*/
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { writeGlb } from "./glb.mjs";

const prep = (g) => { const x = g.index ? g : g; x.deleteAttribute("uv"); return x; };
const placed = (g, { p = [0, 0, 0], r = [0, 0, 0] } = {}) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1));
  return prep(g).applyMatrix4(m);
};

export function shieldShape(s = 1) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 10 * s);
  sh.bezierCurveTo(4 * s, 8.6 * s, 7 * s, 8.4 * s, 8.4 * s, 8 * s);
  sh.bezierCurveTo(8.4 * s, -1 * s, 5 * s, -6.5 * s, 0, -10 * s);
  sh.bezierCurveTo(-5 * s, -6.5 * s, -8.4 * s, -1 * s, -8.4 * s, 8 * s);
  sh.bezierCurveTo(-7 * s, 8.4 * s, -4 * s, 8.6 * s, 0, 10 * s);
  return sh;
}

/** The Stashr shield: brushed-metal shell, emerald inlay, keyhole. Centred, facing +Z. */
export function shieldParts() {
  const shell = new THREE.ExtrudeGeometry(shieldShape(), { depth: 2.4, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.7, bevelSegments: 4, curveSegments: 24 });
  shell.center();
  const inlay = new THREE.ExtrudeGeometry(shieldShape(0.62), { depth: 1, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 2, curveSegments: 20 });
  inlay.center();
  inlay.translate(0, 0, 1.9);
  const hole = mergeGeometries([
    placed(new THREE.CylinderGeometry(1.1, 1.1, 1, 24), { p: [0, 1.2, 2.6], r: [Math.PI / 2, 0, 0] }),
    placed(new THREE.BoxGeometry(0.9, 3, 1), { p: [0, -0.8, 2.6] }),
  ].map((g) => g.toNonIndexed()));
  return [
    { name: "shell", geometry: prep(shell), material: { color: 0x1d3640, metalness: 0.92, roughness: 0.26 } },
    { name: "inlay", geometry: prep(inlay), material: { color: 0x22c58f, emissive: 0x22c58f, metalness: 0.3, roughness: 0.25 } },
    { name: "keyhole", geometry: hole, material: { color: 0x04110d, metalness: 0, roughness: 0.9 } },
  ];
}

/** The vault door: slab, recessed face, 20 rim bolts, locking wheel and jamb. Faces +Z, radius 30. */
export function vaultDoorParts() {
  const slab = placed(new THREE.CylinderGeometry(30, 30, 6, 64), { r: [Math.PI / 2, 0, 0] });
  const face = placed(new THREE.CylinderGeometry(24, 24, 6.6, 64), { r: [Math.PI / 2, 0, 0] });
  const ridges = [20, 14, 9].map((r) => placed(new THREE.TorusGeometry(r, 0.45, 8, 72), { p: [0, 0, 3.35] }));
  const bolts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    bolts.push(placed(new THREE.CylinderGeometry(1.1, 1.1, 8, 10), { p: [Math.cos(a) * 31, Math.sin(a) * 31, 0], r: [0, 0, a + Math.PI / 2] }));
  }
  const wheel = [placed(new THREE.TorusGeometry(6, 0.7, 10, 40))];
  for (let i = 0; i < 4; i++) wheel.push(placed(new THREE.BoxGeometry(12, 0.8, 0.8), { r: [0, 0, (i / 4) * Math.PI] }));
  wheel.push(placed(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 20), { r: [Math.PI / 2, 0, 0] }));
  const jamb = placed(new THREE.TorusGeometry(32.5, 3, 12, 72));
  const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  return [
    { name: "slab", geometry: merge([slab, ...ridges]), material: { color: 0x2a3a40, metalness: 0.9, roughness: 0.32 } },
    { name: "face", geometry: face, material: { color: 0x141f24, metalness: 0.85, roughness: 0.45 } },
    { name: "bolts", geometry: merge(bolts), material: { color: 0x3b5058, metalness: 0.95, roughness: 0.25 } },
    { name: "wheel", geometry: merge(wheel), material: { color: 0x3b5058, metalness: 0.95, roughness: 0.22 }, position: [0, 0, 4.4] },
    { name: "jamb", geometry: jamb, material: { color: 0x0e171b, metalness: 0.85, roughness: 0.45 } },
  ];
}

/** Weld identical vertices (position + normal must both match, so hard edges stay hard). */
export function weld(parts) {
  return parts.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    return { ...p, geometry: mergeVertices(g, 1e-4) };
  });
}

export const MODELS = { "stashr-shield.glb": () => weld(shieldParts()), "vault-door.glb": () => weld(vaultDoorParts()) };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, parts] of Object.entries(MODELS)) {
    const bytes = writeGlb(parts());
    await writeFile(new URL(`../public/models/${file}`, import.meta.url), bytes);
    console.log(`${file}: ${(bytes.length / 1024).toFixed(1)} KB`);
  }
}
