import { ACCENTS, palette, glowRing, particles, driftParticles, lights, damp } from "../kit.js";
import { loadModel, disposeTree } from "../models.js";

/*
  The Security Vault — an underground facility. An octagonal corridor of lit
  frames leads to a massive circular vault door with bolts, rotating rings and
  a locking wheel; behind it, an emerald security core.
  variant: "vault"    (Passwords) — door unlocks and swings open on entry, camera moves in
           "lab"      (Generator) — door open, core swaps to the purple creation glow
           "facility" (Sign in / Forgot) — door stays sealed, mechanism idles
  Purely decorative: it never receives vault data.
*/
export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const variant = opts.variant || "vault";
  const accent = variant === "lab" ? ACCENTS.cloud : ACCENTS.vault;
  const light = opts.theme === "light";
  const low = tier === "low";

  scene.background = new THREE.Color(light ? 0xdfe9e6 : 0x03080b);
  scene.fog = new THREE.Fog(light ? 0xdfe9e6 : 0x03080b, 40, 260);
  scene.add(lights(THREE, pal, accent));

  const metal = new THREE.MeshStandardMaterial({ color: light ? 0xb9c9c9 : 0x1a272d, metalness: 0.9, roughness: 0.32 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: light ? 0x8ea3a5 : 0x0e171b, metalness: 0.85, roughness: 0.45 });
  const strip = new THREE.MeshBasicMaterial({ color: accent });

  // Corridor: octagonal frames with light strips, floor plates.
  const frames = new THREE.Group();
  const frameCount = low ? 8 : 14;
  for (let i = 0; i < frameCount; i++) {
    const z = 20 + i * 16;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(40, 2.2, 4, 8), i % 2 ? metal : darkMetal);
    ring.rotation.z = Math.PI / 8;
    ring.position.z = z;
    const glow = new THREE.Mesh(new THREE.TorusGeometry(37.6, 0.18, 4, 8), strip);
    glow.rotation.z = Math.PI / 8;
    glow.position.z = z;
    frames.add(ring, glow);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(56, 300), new THREE.MeshStandardMaterial({ color: light ? 0xc9d6d3 : 0x0a1216, metalness: 0.7, roughness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -34, 140);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 300), strip);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, -33.9, 140);
  scene.add(frames, floor, lane);

  // Glass control rooms on both sides.
  const glass = new THREE.MeshStandardMaterial({ color: 0x8fe0dc, transparent: true, opacity: light ? 0.25 : 0.12, metalness: 0.1, roughness: 0.05, emissive: accent, emissiveIntensity: 0.08 });
  [-1, 1].forEach((side) => {
    const room = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 30), glass);
    room.position.set(side * 28, -22, 90);
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    holo.position.set(side * 24, -20, 90);
    holo.rotation.y = -side * Math.PI / 2.4;
    scene.add(room, holo);
  });

  // Vault door assembly (hinged on the left edge).
  const hinge = new THREE.Group();
  hinge.position.set(-31, 0, 0);
  const door = new THREE.Group();
  door.position.set(31, 0, 0);
  hinge.add(door);
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 6, 64), metal);
  slab.rotation.x = Math.PI / 2;
  door.add(slab);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 6.6, 64), darkMetal);
  face.rotation.x = Math.PI / 2;
  door.add(face);
  // Bolts around the rim (instanced).
  const boltGeo = new THREE.CylinderGeometry(1.1, 1.1, 8, 10);
  boltGeo.rotateZ(Math.PI / 2);
  const bolts = new THREE.InstancedMesh(boltGeo, metal, 20);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    e.set(0, 0, a);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(Math.cos(a) * 31, Math.sin(a) * 31, 0), q, new THREE.Vector3(1, 1, 1));
    bolts.setMatrixAt(i, m4);
  }
  door.add(bolts);
  const doorRings = [glowRing(THREE, { radius: 20, color: accent, tube: 0.25 }), glowRing(THREE, { radius: 14, color: 0x8fe0dc, tube: 0.15, opacity: 0.7, arc: Math.PI * 1.5 }), glowRing(THREE, { radius: 9, color: accent, tube: 0.2, arc: Math.PI * 1.2 })];
  doorRings.forEach((r) => { r.position.z = 3.6; door.add(r); });
  // Locking wheel: rim + spokes.
  let wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(6, 0.7, 8, 32), metal));
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 0.8), metal);
    spoke.rotation.z = (i / 4) * Math.PI;
    wheel.add(spoke);
  }
  wheel.position.z = 4.4;
  door.add(wheel);
  // Frame around the door.
  const jamb = new THREE.Mesh(new THREE.TorusGeometry(32.5, 3, 12, 64), darkMetal);
  scene.add(hinge, jamb);

  // Swap the code-built door for the .glb model when it arrives; the glow rings stay live.
  let closed = false;
  loadModel("vaultDoor").then((model) => {
    if (closed) { disposeTree(model); return; }
    const part = (n) => model.getObjectByName(n);
    if (light) {
      ["slab", "bolts", "wheel"].forEach((n) => part(n)?.traverse((o) => o.isMesh && o.material.color.set(0xb9c9c9)));
      ["face", "jamb"].forEach((n) => part(n)?.traverse((o) => o.isMesh && o.material.color.set(0x8ea3a5)));
    }
    // Free only geometry: the metal materials are shared with the corridor frames.
    const dropGeometry = (m) => m.traverse((o) => o.geometry?.dispose());
    [slab, face, bolts, wheel].forEach((m) => { door.remove(m); dropGeometry(m); });
    scene.remove(jamb); dropGeometry(jamb);
    const spin = wheel.rotation.z;
    ["slab", "face", "bolts"].forEach((n) => part(n) && door.add(part(n)));
    wheel = part("wheel") || wheel;
    wheel.rotation.z = spin;
    door.add(wheel);
    if (part("jamb")) scene.add(part("jamb"));
    door.userData.source = "glb";
  }).catch(() => { /* keep the code-built door */ });

  // Emerald core behind the door.
  const coreMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.6, roughness: 0.2 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(8, 1), coreMat);
  core.position.z = -40;
  const coreLight = new THREE.PointLight(accent, 0, 200, 1.5);
  coreLight.position.z = -30;
  const coreRings = [glowRing(THREE, { radius: 13, color: accent }), glowRing(THREE, { radius: 17, color: 0x8fe0dc, opacity: 0.5 })];
  coreRings.forEach((r) => { r.position.z = -40; scene.add(r); });
  scene.add(core, coreLight);
  // Front fill so the door's metal reads clearly from the corridor.
  const fill = new THREE.PointLight(light ? 0xffffff : 0x8fe0dc, light ? 1.2 : 2.4, 260, 1.2);
  fill.position.set(0, 26, 70);
  scene.add(fill);

  const data = particles(THREE, { count: low ? 120 : 360, spread: 60, height: 70, y: -34, color: accent, size: 0.9, seed: 31 });
  data.position.z = 60;
  scene.add(data);

  const startOpen = variant === "lab";
  const sealed = variant === "facility";
  const camFrom = sealed ? 110 : 175, camTo = sealed ? 92 : startOpen ? 82 : 78;
  camera.position.set(0, 2, startOpen ? camTo : camFrom);
  let t0 = null;
  let unlockAt = null; // facility: when a sign-in starts, the door opens
  let aspect = 1.6;

  return {
    dispose() { closed = true; },
    resize(w, h) { aspect = w / h; },
    update(t, dt, pointer, o) {
      if (t0 === null) t0 = t;
      if (sealed && o.unlock && unlockAt === null) unlockAt = t;
      if (sealed && !o.unlock) unlockAt = null;
      const k = sealed ? (unlockAt === null ? 0 : t - unlockAt) : t - t0; // seconds since entering / unlocking
      // Timeline: 0–1.2s wheel spins, 0.8–2.6s door swings, camera dollies in.
      const unlock = startOpen ? 1 : sealed && unlockAt === null ? 0 : Math.min(1, Math.max(0, (k - 0.8) / 1.8));
      const ease = unlock * unlock * (3 - 2 * unlock);
      wheel.rotation.z = sealed && unlockAt === null ? t * 0.15 : startOpen ? t * 0.1 : Math.min(k, 1.4) * 4.5;
      hinge.rotation.y = -ease * 1.75;
      doorRings[0].rotation.z = t * 0.25; doorRings[1].rotation.z = -t * 0.4; doorRings[2].rotation.z = t * 0.6;
      coreLight.intensity = 0.3 + ease * 3.2;
      coreMat.emissiveIntensity = 1.2 + Math.sin(t * 1.5) * 0.3;
      core.rotation.y = t * 0.3; core.rotation.x = t * 0.17;
      coreRings[0].rotation.y = t * 0.4; coreRings[1].rotation.x = t * 0.3;
      const zTarget = (sealed ? camTo - ease * 30 : camFrom + (camTo - camFrom) * ease) * (aspect < 1 ? (sealed ? 1.05 : 1.3) : 1);
      camera.position.z = damp(camera.position.z, zTarget, 2.5, dt);
      camera.position.x = pointer.x * 4;
      camera.position.y = 2 - pointer.y * 3;
      camera.lookAt(0, 0, -20);
      driftParticles(data, dt, 3);
    },
  };
}
