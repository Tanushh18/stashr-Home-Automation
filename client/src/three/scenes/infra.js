import { ACCENTS, palette, skyDome, gridFloor, windowTexture, towers, lightPath, animatePath, clouds, particles, driftParticles, lights } from "../kit.js";

/*
  Infrastructure City — rows of server racks with LED faces, data lanes on the
  ground carrying pulses between rows, and a blue/purple cloud layer above.
  Decorative only; server status is shown by the pages from real data.
*/
export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const light = opts.theme === "light";
  const low = tier === "low";
  const accent = ACCENTS.admin;

  scene.fog = new THREE.FogExp2(pal.fog, 0.006);
  scene.add(skyDome(THREE, { ...pal, skyTop: light ? 0xa9c3ef : 0x05061a, skyMid: light ? 0xd8e2f6 : 0x101236 }));
  scene.add(lights(THREE, pal, accent));
  scene.add(gridFloor(THREE, { size: 600, divisions: 100, color: accent, opacity: light ? 0.28 : 0.2 }));

  const led = windowTexture(THREE, { lit: light ? "#2f5fd0" : "#7aa2ff", dark: light ? "#c3cde0" : "#060b1c", density: 0.6, seed: 17 });
  const rows = low ? 4 : 6, per = low ? 8 : 12;
  const racks = [];
  for (let rI = 0; rI < rows; rI++) {
    for (let k = 0; k < per; k++) {
      racks.push({ x: (k - per / 2) * 9, z: (rI - rows / 2) * 22, w: 6, d: 4, h: 10 + ((k * 7 + rI * 3) % 5) * 3 });
    }
  }
  scene.add(towers(THREE, racks, { color: light ? 0xc2cce0 : 0x0d1430, emissiveMap: led, emissiveIntensity: light ? 0.5 : 1.3, metalness: 0.7, roughness: 0.3 }));

  const lanes = [];
  for (let rI = 0; rI < rows - 1; rI++) {
    const z = (rI - rows / 2) * 22 + 11;
    const p = lightPath(THREE, [[-per * 5, 0.3, z], [0, 0.3, z], [per * 5, 0.3, z]], { color: rI % 2 ? ACCENTS.cloud : accent, radius: 0.2, pulses: low ? 2 : 4, pulseSize: 2.2 });
    lanes.push(p);
    scene.add(p);
  }
  const deck = clouds(THREE, { count: low ? 6 : 12, radius: 120, y: 60, color: ACCENTS.cloud, opacity: light ? 0.3 : 0.16, scale: 80 });
  const uplink = particles(THREE, { count: low ? 100 : 260, spread: 140, height: 60, y: 0, color: 0x9fb4ff, size: 0.9, seed: 14 });
  scene.add(deck, uplink);

  let dist = 120;
  return {
    resize(w, h) { dist = w / h < 1 ? 175 : 120; },
    update(t, dt, pointer) {
      const a = 0.5 + Math.sin(t * 0.04) * 0.35 + pointer.x * 0.08;
      camera.position.set(Math.sin(a) * dist, 52 - pointer.y * 8, Math.cos(a) * dist);
      camera.lookAt(0, 6, 0);
      lanes.forEach((l, i) => animatePath(l, t + i, i % 2 ? -0.15 : 0.15));
      driftParticles(uplink, dt, 4);
      deck.rotation.y = t * 0.01;
    },
  };
}
