import { ACCENTS, palette, particles, lights, rng, glowRing } from "../kit.js";

/*
  Media Universe — a floating gallery: two arcs of frames around the viewer,
  each holding an abstract generated gradient (never user photos — those stay
  behind the page's own permission checks), over a dark reflective floor.
*/
function artTexture(THREE, seed, light) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 128; c.height = 96;
  const g = c.getContext("2d");
  const hues = [330, 280, 200, 170, 35, 220];
  const h1 = hues[Math.floor(r() * hues.length)], h2 = h1 + 40 + r() * 80;
  const gr = g.createLinearGradient(0, 0, 128, 96);
  gr.addColorStop(0, `hsl(${h1} 42% ${light ? 74 : 30}%)`);
  gr.addColorStop(1, `hsl(${h2} 38% ${light ? 86 : 14}%)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 96);
  g.globalAlpha = 0.18; g.fillStyle = "#fff";
  g.beginPath(); g.arc(30 + r() * 70, 30 + r() * 40, 10 + r() * 20, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const light = opts.theme === "light";
  const accent = ACCENTS.media;
  scene.background = new THREE.Color(light ? 0xf3eef2 : 0x07050b);
  scene.fog = new THREE.Fog(light ? 0xf3eef2 : 0x07050b, 40, 180);
  scene.add(lights(THREE, pal, accent));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: light ? 0xe6dde4 : 0x0d0a12, metalness: 0.9, roughness: 0.25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -12;
  const ring = glowRing(THREE, { radius: 40, color: accent, tube: 0.15 });
  ring.rotation.x = Math.PI / 2; ring.position.y = -11.8;
  scene.add(floor, ring);

  const frameMat = new THREE.MeshStandardMaterial({ color: light ? 0xffffff : 0x1c1822, metalness: 0.7, roughness: 0.3 });
  const frames = [];
  const count = tier === "low" ? 10 : 18;
  for (let i = 0; i < count; i++) {
    const tier2 = i % 2;
    const a = (i / count) * Math.PI * 2;
    const rad = tier2 ? 58 : 46;
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(14, 10.5, 0.6), frameMat);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 9.4), new THREE.MeshBasicMaterial({ map: artTexture(THREE, i + 3, light) }));
    art.position.z = 0.31;
    g.add(back, art);
    g.position.set(Math.cos(a) * rad, tier2 ? 10 : -1, Math.sin(a) * rad);
    g.lookAt(0, g.position.y, 0);
    g.userData.base = g.position.y;
    g.userData.phase = i * 0.7;
    frames.push(g);
    scene.add(g);
  }
  const motes = particles(THREE, { count: tier === "low" ? 80 : 200, spread: 120, height: 40, y: -10, color: 0xf9a8d4, size: 0.8, seed: 22, opacity: 0.6 });
  scene.add(motes);

  camera.position.set(0, 4, 0.1);
  let fov = 60;
  return {
    resize(w, h) { fov = w / h < 1 ? 78 : 60; camera.fov = fov; camera.updateProjectionMatrix(); },
    update(t, dt, pointer) {
      const yaw = t * 0.03 + pointer.x * 0.3;
      camera.lookAt(Math.sin(yaw) * 10, 3 - pointer.y * 3, -Math.cos(yaw) * 10);
      frames.forEach((f) => { f.position.y = f.userData.base + Math.sin(t * 0.6 + f.userData.phase) * 0.8; });
      motes.rotation.y = -t * 0.02;
    },
  };
}
