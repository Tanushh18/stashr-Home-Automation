import {
  ACCENTS, palette, skyDome, mountainRing, windowTexture, towers, towerCaps, gridFloor, lightPath, animatePath,
  particles, driftParticles, clouds, lights, cityPlots, sceneCount, glowRing, rng,
} from "../kit.js";

/*
  Developer City — one glass tower per project (opts.count, a plain number;
  never names or values), network bridges between neighbours, database
  cylinders, and a purple cloud-infrastructure layer overhead.
  variant: "dev" (Projects) | "ledger" (Money: gold accent, calmer)
*/
export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const light = opts.theme === "light";
  const ledger = opts.variant === "ledger";
  const accent = ledger ? ACCENTS.gold : ACCENTS.dev;
  const low = tier === "low";
  const n = sceneCount(opts.count, 6, low ? 18 : 36);

  scene.fog = new THREE.FogExp2(pal.fog, 0.0032);
  scene.add(skyDome(THREE, pal));
  scene.add(lights(THREE, pal, accent));
  scene.add(mountainRing(THREE, { radius: 420, height: 120, color: pal.mountainFar, seed: 12, y: -10 }));
  scene.add(gridFloor(THREE, { size: 700, divisions: 70, color: accent, opacity: light ? 0.25 : 0.16 }));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 48), new THREE.MeshStandardMaterial({ color: pal.ground, metalness: 0.6, roughness: 0.5 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);

  // Project towers (the hero row) + a filler skyline behind.
  const plots = cityPlots(n, { spacing: 18, seed: 9, minH: 18, maxH: 78 });
  const win = windowTexture(THREE, { lit: ledger ? "#f5c86a" : light ? "#0e6d8a" : "#7dd3fc", dark: light ? "#b8cdd0" : "#081620", density: 0.5 });
  scene.add(towers(THREE, plots, { color: light ? 0xa7c8d2 : 0x0f2a3a, emissiveMap: win, emissiveIntensity: light ? 0.35 : 1.1, metalness: 0.75, roughness: 0.18 }));
  scene.add(towerCaps(THREE, plots, accent));
  const r = rng(77);
  const filler = [];
  for (let i = 0; i < (low ? 30 : 70); i++) {
    const a = r() * Math.PI * 2, d = 120 + r() * 160;
    filler.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: 6 + r() * 10, d: 6 + r() * 10, h: 10 + r() * 50 });
  }
  scene.add(towers(THREE, filler, { color: pal.glass, emissiveMap: win, emissiveIntensity: light ? 0.2 : 0.5 }));

  // Network bridges between neighbouring towers.
  const bridges = [];
  for (let i = 0; i < plots.length - 1 && bridges.length < (low ? 6 : 14); i += 1 + (i % 2)) {
    const a = plots[i], b = plots[i + 1];
    const h = Math.min(a.h, b.h) * 0.7;
    const p = lightPath(THREE, [[a.x, h, a.z], [(a.x + b.x) / 2, h + 6, (a.z + b.z) / 2], [b.x, h, b.z]], { color: accent, radius: 0.18, pulses: 1, pulseSize: 2.4 });
    bridges.push(p);
    scene.add(p);
  }

  // Database structures: stacked discs with rings.
  const dbs = [];
  const dbMat = new THREE.MeshStandardMaterial({ color: light ? 0xc8d8dc : 0x13303a, metalness: 0.8, roughness: 0.3, emissive: accent, emissiveIntensity: 0.12 });
  [[-60, 40], [70, -50], [-40, -70]].forEach(([x, z]) => {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 3, 32), dbMat);
      disc.position.y = 2 + k * 4;
      g.add(disc);
    }
    const halo = glowRing(THREE, { radius: 10, color: accent, tube: 0.15 });
    halo.rotation.x = Math.PI / 2; halo.position.y = 9;
    g.add(halo);
    g.position.set(x, 0, z);
    g.userData.halo = halo;
    dbs.push(g);
    scene.add(g);
  });

  // Cloud infrastructure layer.
  const cloudDeck = clouds(THREE, { count: low ? 6 : 14, radius: 160, y: 110, color: ledger ? 0xf5d58a : ACCENTS.cloud, opacity: light ? 0.25 : 0.14, scale: 90 });
  scene.add(cloudDeck);
  const uplinks = particles(THREE, { count: low ? 80 : 220, spread: 180, height: 110, y: 0, color: ACCENTS.cloud, size: 1.1, seed: 5, opacity: 0.6 });
  scene.add(uplinks);

  let dist = 210;
  camera.position.set(150, 110, 150);
  return {
    resize(w, h) { dist = w / h < 1 ? 300 : 210; },
    update(t, dt, pointer) {
      const a = 0.7 + t * 0.025 + pointer.x * 0.1;
      camera.position.set(Math.sin(a) * dist, 95 - pointer.y * 12, Math.cos(a) * dist);
      camera.lookAt(0, 22, 0);
      bridges.forEach((b, i) => animatePath(b, t + i * 0.3, 0.2));
      dbs.forEach((g, i) => { g.userData.halo.position.y = 9 + Math.sin(t * 1.2 + i) * 6; });
      driftParticles(uplinks, dt, 6);
      cloudDeck.rotation.y = t * 0.01;
    },
  };
}
