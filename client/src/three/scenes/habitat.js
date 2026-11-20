import { ACCENTS, palette, skyDome, mountainRing, particles, lights, rng, glowRing } from "../kit.js";

/*
  Smart Home habitat — a modern glass house on a garden plateau with trees,
  path lights and a pool. It is the backdrop only: the Smart Home page keeps
  its own real 3D house built from your rooms and live device data.
*/
export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const light = opts.theme === "light";
  const accent = ACCENTS.home;
  const r = rng(41);
  scene.fog = new THREE.FogExp2(pal.fog, 0.004);
  scene.add(skyDome(THREE, { ...pal, skyLow: light ? 0xf6e7c8 : 0x1a2a1c }));
  scene.add(lights(THREE, pal, accent));
  scene.add(mountainRing(THREE, { radius: 380, height: 110, color: light ? 0x9fbca2 : 0x0d1d14, seed: 5, y: -20 }));

  const ground = new THREE.Mesh(new THREE.CylinderGeometry(120, 110, 8, 48), new THREE.MeshStandardMaterial({ color: light ? 0x9fd08e : 0x173822, roughness: 0.95 }));
  ground.position.y = -4;
  scene.add(ground);

  // House: two offset volumes, glass walls lit warm inside, flat roofs with light strips.
  const concrete = new THREE.MeshStandardMaterial({ color: light ? 0xf1f1ec : 0x2a3236, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8e6, transparent: true, opacity: 0.35, emissive: 0xffc985, emissiveIntensity: light ? 0.15 : 0.7, metalness: 0.2, roughness: 0.05 });
  const house = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 20), glass); lower.position.set(0, 5, 0);
  const lowerRoof = new THREE.Mesh(new THREE.BoxGeometry(38, 1.2, 24), concrete); lowerRoof.position.set(0, 10.6, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 16), glass); upper.position.set(6, 15.7, -2);
  const upperRoof = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 20), concrete); upperRoof.position.set(6, 20.8, -2);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 21, 22), concrete); wall.position.set(-17, 10.5, 0);
  const stripMat = new THREE.MeshBasicMaterial({ color: accent });
  const strip1 = new THREE.Mesh(new THREE.BoxGeometry(38.2, 0.25, 0.25), stripMat); strip1.position.set(0, 10, 12);
  const strip2 = new THREE.Mesh(new THREE.BoxGeometry(26.2, 0.25, 0.25), stripMat); strip2.position.set(6, 20.2, 8);
  const pool = new THREE.Mesh(new THREE.BoxGeometry(18, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x2bb3b1, emissive: 0x2bb3b1, emissiveIntensity: 0.4, roughness: 0.05 }));
  pool.position.set(8, 0.2, 22);
  house.add(lower, lowerRoof, upper, upperRoof, wall, strip1, strip2, pool);
  scene.add(house);

  // Trees (instanced trunks + canopies).
  const tCount = tier === "low" ? 18 : 40;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 6), new THREE.MeshStandardMaterial({ color: 0x5b4632 }), tCount);
  const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3, 0), new THREE.MeshStandardMaterial({ color: light ? 0x4fa65a : 0x1f6b3a, flatShading: true }), tCount);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < tCount; i++) {
    const a = r() * Math.PI * 2, d = 40 + r() * 70, s = 0.8 + r() * 0.8;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    m4.compose(new THREE.Vector3(x, 2 * s, z), q, new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 5.5 * s, z), q, new THREE.Vector3(s, s * 1.3, s)); canopy.setMatrixAt(i, m4);
  }
  scene.add(trunks, canopy);

  // Path lights + device interaction points (decorative pulses).
  const nodes = [];
  [[-10, 4, 10], [12, 4, 10], [6, 15, 6], [-6, 15, 6], [20, 1, 22]].forEach(([x, y, z]) => {
    const n = glowRing(THREE, { radius: 1.2, color: accent, tube: 0.12 });
    n.position.set(x, y, z);
    nodes.push(n);
    scene.add(n);
  });
  const fireflies = particles(THREE, { count: tier === "low" ? 60 : 150, spread: 200, height: 20, y: 1, color: light ? 0xffffff : 0xd9f99d, size: 0.8, seed: 2, opacity: light ? 0.4 : 0.8 });
  scene.add(fireflies);

  let dist = 95;
  return {
    resize(w, h) { dist = w / h < 1 ? 140 : 95; },
    update(t, dt, pointer) {
      const a = 0.6 + Math.sin(t * 0.05) * 0.4 + pointer.x * 0.1;
      camera.position.set(Math.sin(a) * dist, 34 - pointer.y * 6, Math.cos(a) * dist);
      camera.lookAt(0, 8, 0);
      nodes.forEach((n, i) => { n.lookAt(camera.position); n.scale.setScalar(1 + 0.3 * Math.sin(t * 2 + i)); });
      fireflies.rotation.y = t * 0.02;
    },
  };
}
