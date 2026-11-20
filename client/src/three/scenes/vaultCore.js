import { ACCENTS, glowRing, particles, lights, palette, damp, dotTexture } from "../kit.js";
import { loadModel, disposeTree } from "../models.js";

/*
  Vault command deck: a metallic shield core inside three orbital rings, with
  four station markers (vault, dev, security, tools) linked to the core by
  energy lines. Transparent background — the panel's own surface shows through.
  opts: { theme, focus: "vault"|"dev"|"security"|"tools" }
*/
export const STATIONS = [
  { id: "vault", color: ACCENTS.vault, ring: 0, phase: 0.2 },
  { id: "dev", color: ACCENTS.dev, ring: 1, phase: 1.9 },
  { id: "security", color: ACCENTS.gold, ring: 2, phase: 3.4 },
  { id: "tools", color: ACCENTS.cloud, ring: 1, phase: 4.9 },
];

function shieldShape(THREE, s = 1) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 10 * s);
  sh.bezierCurveTo(4 * s, 8.6 * s, 7 * s, 8.4 * s, 8.4 * s, 8 * s);
  sh.bezierCurveTo(8.4 * s, -1 * s, 5 * s, -6.5 * s, 0, -10 * s);
  sh.bezierCurveTo(-5 * s, -6.5 * s, -8.4 * s, -1 * s, -8.4 * s, 8 * s);
  sh.bezierCurveTo(-7 * s, 8.4 * s, -4 * s, 8.6 * s, 0, 10 * s);
  return sh;
}

export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const accent = ACCENTS.vault;
  scene.add(lights(THREE, pal, accent));
  const rim = new THREE.DirectionalLight(0x8fe0dc, 1.2);
  rim.position.set(-40, 20, -30);
  scene.add(rim);

  const core = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shieldShape(THREE), { depth: 2.4, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.7, bevelSegments: 4, curveSegments: 24 }),
    new THREE.MeshStandardMaterial({ color: opts.theme === "light" ? 0xd8e6e4 : 0x1d3640, metalness: 0.92, roughness: 0.26 })
  );
  shell.geometry.center();
  const inner = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shieldShape(THREE, 0.62), { depth: 1, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.25 })
  );
  inner.geometry.center();
  inner.position.z = 1.9;
  // Keyhole.
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1, 24), new THREE.MeshBasicMaterial({ color: 0x04110d }));
  hole.rotation.x = Math.PI / 2; hole.position.set(0, 1.2, 2.6);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3, 1), hole.material);
  slot.position.set(0, -0.8, 2.6);
  core.add(shell, inner, hole, slot);
  scene.add(core);

  // Swap the code-built shield for the .glb model once it loads (same shape, authored file).
  let closed = false;
  loadModel("shield").then((model) => {
    if (closed) { disposeTree(model); return; }
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.parent?.name === "shell" && opts.theme === "light") o.material.color.set(0xd8e6e4);
      if (o.parent?.name === "inlay") o.material.emissiveIntensity = 0.9;
    });
    [shell, inner, hole, slot].forEach((m) => { core.remove(m); disposeTree(m); });
    core.add(model);
    core.userData.source = "glb";
  }).catch(() => { /* keep the code-built shield */ });

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(THREE), color: accent, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(38);
  scene.add(halo);

  const ringDefs = [
    { radius: 15, tilt: [1.2, 0, 0.2], speed: 0.35 },
    { radius: 20, tilt: [1.45, 0.5, -0.3], speed: -0.22 },
    { radius: 25, tilt: [1.7, -0.4, 0.5], speed: 0.15 },
  ];
  const ringObjs = ringDefs.map((d, i) => {
    const pivot = new THREE.Group();
    pivot.rotation.set(...d.tilt);
    const ring = glowRing(THREE, { radius: d.radius, tube: i === 0 ? 0.14 : 0.09, color: i === 1 ? 0x8fe0dc : accent, opacity: 0.75 - i * 0.15 });
    pivot.add(ring);
    // Small ticks on the ring (mechanical feel).
    for (let k = 0; k < 8; k++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0x8fe0dc, transparent: true, opacity: 0.8 }));
      const a = (k / 8) * Math.PI * 2;
      tick.position.set(Math.cos(a) * d.radius, Math.sin(a) * d.radius, 0);
      ring.add(tick);
    }
    scene.add(pivot);
    return { pivot, ring, d };
  });

  const markerObjs = STATIONS.map((s) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 1.2 }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(THREE), color: s.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(6);
    m.add(glow);
    scene.add(m);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
    scene.add(line);
    return { s, m, line, glow };
  });

  const dust = particles(THREE, { count: tier === "low" ? 80 : 220, spread: 80, height: 60, y: -30, color: 0x8fe0dc, size: 0.5, opacity: 0.7 });
  scene.add(dust);

  camera.position.set(0, 4, 62);
  camera.lookAt(0, 0, 0);
  const v = new THREE.Vector3();

  return {
    dispose() { closed = true; },
    resize(w, h) { camera.position.z = w / h < 1 ? 84 : 62; },
    update(t, dt, pointer, o) {
      core.rotation.y = Math.sin(t * 0.4) * 0.35 + pointer.x * 0.25;
      core.rotation.x = -pointer.y * 0.15;
      core.position.y = Math.sin(t * 0.8) * 0.8;
      halo.material.opacity = 0.28 + Math.sin(t * 1.4) * 0.07;
      ringObjs.forEach((r) => { r.ring.rotation.z = t * r.d.speed; });
      markerObjs.forEach((mo) => {
        const r = ringObjs[mo.s.ring];
        const a = t * r.d.speed * 0.8 + mo.s.phase;
        v.set(Math.cos(a) * r.d.radius, Math.sin(a) * r.d.radius, 0).applyEuler(r.pivot.rotation);
        mo.m.position.copy(v);
        mo.m.rotation.y = t;
        const on = o.focus === mo.s.id;
        mo.m.scale.setScalar(damp(mo.m.scale.x, on ? 1.8 : 1, 8, dt));
        mo.line.material.opacity = damp(mo.line.material.opacity, on ? 0.95 : 0.3, 8, dt);
        const p = mo.line.geometry.attributes.position;
        p.setXYZ(0, 0, core.position.y, 0); p.setXYZ(1, v.x, v.y, v.z); p.needsUpdate = true;
      });
      dust.rotation.y = t * 0.03;
    },
  };
}
