import { ACCENTS, palette, gridFloor, glowRing, particles, lights, rng } from "../kit.js";

/*
  Security Operations Center — a dark room with a curved holographic display
  wall, a floor radar with a rotating sweep, and a ring of sensor pylons.
  The displays show abstract panels and waveforms only: no numbers, so the
  scene can never be mistaken for real security status (pages show that).
  variant: "soc" (Security / Security Center / Settings) | "comms" (WhatsApp / SMS)
*/
function wallTexture(THREE, accentCss, light) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = light ? "#dbe9e8" : "#041014"; g.fillRect(0, 0, 1024, 256);
  const r = rng(13);
  for (let i = 0; i < 8; i++) {
    const x = 10 + i * 127, w = 112;
    g.strokeStyle = accentCss; g.globalAlpha = 0.55; g.lineWidth = 2;
    g.strokeRect(x, 20, w, 216);
    g.globalAlpha = 0.25;
    for (let y = 40; y < 230; y += 14) { g.fillStyle = accentCss; g.fillRect(x + 8, y, (0.2 + r() * 0.75) * (w - 16), 4); }
    g.globalAlpha = 0.8; g.beginPath();
    for (let k = 0; k <= w - 16; k += 4) g.lineTo(x + 8 + k, 120 + Math.sin(k * 0.12 + i) * 18 * r());
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function radarTexture(THREE, accentCss) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.strokeStyle = accentCss; g.lineWidth = 2;
  for (let i = 1; i <= 5; i++) { g.globalAlpha = 0.5 - i * 0.05; g.beginPath(); g.arc(256, 256, i * 48, 0, Math.PI * 2); g.stroke(); }
  g.globalAlpha = 0.35;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + Math.cos(a) * 250, 256 + Math.sin(a) * 250); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const light = opts.theme === "light";
  const comms = opts.variant === "comms";
  const accent = comms ? ACCENTS.media : ACCENTS.security;
  const accentCss = "#" + new THREE.Color(accent).getHexString();
  scene.background = new THREE.Color(light ? 0xe4eeec : 0x02070a);
  scene.fog = new THREE.Fog(light ? 0xe4eeec : 0x02070a, 60, 220);
  scene.add(lights(THREE, pal, accent));
  scene.add(gridFloor(THREE, { size: 300, divisions: 60, color: accent, opacity: light ? 0.3 : 0.18 }));

  const wallTex = wallTexture(THREE, accentCss, light);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(70, 70, 34, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, transparent: true, opacity: light ? 0.85 : 0.9 })
  );
  wall.position.y = 20;
  const wallTop = glowRing(THREE, { radius: 70, color: accent, tube: 0.2, arc: Math.PI * 0.76 });
  wallTop.rotation.set(Math.PI / 2, 0, Math.PI * 0.12 - Math.PI);
  wallTop.position.y = 37.2;
  scene.add(wall, wallTop);

  const radar = new THREE.Mesh(new THREE.CircleGeometry(26, 64), new THREE.MeshBasicMaterial({ map: radarTexture(THREE, accentCss), transparent: true, depthWrite: false }));
  radar.rotation.x = -Math.PI / 2; radar.position.y = 0.1;
  const sweep = new THREE.Mesh(new THREE.CircleGeometry(26, 32, 0, Math.PI / 5), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sweep.rotation.x = -Math.PI / 2; sweep.position.y = 0.2;
  const edge = glowRing(THREE, { radius: 26.5, color: accent, tube: 0.2 });
  edge.rotation.x = Math.PI / 2;
  scene.add(radar, sweep, edge);

  // Sensor pylons around the radar.
  const pylons = [];
  const pylonMat = new THREE.MeshStandardMaterial({ color: light ? 0xb5c6c6 : 0x14232a, metalness: 0.85, roughness: 0.3 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 1.4), pylonMat);
    p.position.set(Math.cos(a) * 34, 3.5, Math.sin(a) * 34);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: accent, transparent: true }));
    tip.position.y = 4.2;
    p.add(tip);
    pylons.push(tip);
    scene.add(p);
  }
  const holo = particles(THREE, { count: tier === "low" ? 80 : 240, spread: 50, height: 30, y: 1, color: accent, size: 0.7, seed: 8 });
  scene.add(holo);

  let back = 78;
  return {
    resize(w, h) { back = w / h < 1 ? 115 : 78; },
    update(t, dt, pointer) {
      sweep.rotation.z = -t * 0.9;
      pylons.forEach((p, i) => { p.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2 - i * 0.52)); });
      wallTex.offset.x = (t * 0.005) % 1;
      holo.rotation.y = t * 0.05;
      camera.position.set(pointer.x * 8, 30 - pointer.y * 5, back);
      camera.lookAt(0, 10, -10);
    },
  };
}
