import {
  ACCENTS, palette, rng, skyDome, mountainRing, windowTexture, towers, towerCaps, platform, glowRing,
  particles, driftParticles, lightPath, animatePath, clouds, lights, damp,
} from "../kit.js";

/*
  The Stashr Universe — a floating city around a central security core, with
  one district island per module. Used by the Home hero (with HTML district
  markers that track the 3D positions) and as the Dashboard / Apps / Admin backdrop.
  opts: { theme, variant: "hero" | "backdrop", accent, focus, anchors() => Map<id, HTMLElement> }
  Receives no user data at all.
*/
export const DISTRICTS = [
  { id: "vault", accent: ACCENTS.vault, angle: -2.5, dist: 118, y: 6, style: "dome" },
  { id: "generator", accent: ACCENTS.cloud, angle: -1.55, dist: 132, y: 18, style: "crystal" },
  { id: "security", accent: ACCENTS.gold, angle: -0.6, dist: 120, y: -4, style: "ring" },
  { id: "projects", accent: ACCENTS.dev, angle: 0.35, dist: 128, y: 12, style: "spires" },
  { id: "control", accent: ACCENTS.admin, angle: 1.3, dist: 124, y: 0, style: "antenna" },
  { id: "apps", accent: ACCENTS.media, angle: 2.25, dist: 116, y: 10, style: "dish" },
];

/** Signed difference from angle a to b in (-π, π]. */
export function shortestAngle(a, b) {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

export default function build({ THREE, scene, camera, tier, opts }) {
  const pal = palette(opts.theme);
  const hero = opts.variant !== "backdrop";
  const low = tier === "low";
  const accent = opts.accent || ACCENTS.vault;
  const r = rng(21);

  scene.fog = new THREE.FogExp2(pal.fog, hero ? 0.0021 : 0.0028);
  scene.add(skyDome(THREE, pal));
  scene.add(lights(THREE, pal, accent));
  scene.add(mountainRing(THREE, { radius: 640, height: 210, color: pal.mountainFar, seed: 3, y: -90 }));
  scene.add(mountainRing(THREE, { radius: 430, height: 130, color: pal.mountain, seed: 8, y: -80 }));

  // Mist sea far below the floating islands.
  const mist = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshBasicMaterial({ color: pal.fog, transparent: true, opacity: 0.85 }));
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = -95;
  scene.add(mist);

  const winTex = windowTexture(THREE, { lit: opts.theme === "light" ? "#1c6f6c" : "#8fe0dc", dark: opts.theme === "light" ? "#a9c4c6" : "#0b1a21" });

  // ── Central island: the city around the security core.
  const core = new THREE.Group();
  core.add(platform(THREE, { radius: 52, depth: 60, rim: accent, color: pal.metal, seed: 2, rock: pal.rock }));
  const citySpots = [];
  const n = low ? 26 : hero ? 54 : 34;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = 16 + r() * 32;
    const h = 8 + Math.pow(r(), 1.6) * (d < 26 ? 46 : 26);
    citySpots.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: 3 + r() * 4, d: 3 + r() * 4, h });
  }
  core.add(towers(THREE, citySpots, { color: pal.glass, emissiveMap: winTex, emissiveIntensity: opts.theme === "light" ? 0.35 : 1 }));
  core.add(towerCaps(THREE, citySpots.filter((_, i) => i % 3 === 0), accent));

  // Security core: crystal + beam + three rings.
  const crystalMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.92 });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(9, 0), crystalMat);
  crystal.scale.set(1, 2.1, 1);
  crystal.position.y = 52;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(7, 11, 30, 8), new THREE.MeshStandardMaterial({ color: pal.metal, metalness: 0.8, roughness: 0.3 }));
  plinth.position.y = 15;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 400, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = 200;
  const rings = [glowRing(THREE, { radius: 17, color: accent }), glowRing(THREE, { radius: 22, color: pal.window, opacity: 0.55, tube: 0.08 }), glowRing(THREE, { radius: 27, color: accent, opacity: 0.4, tube: 0.06, arc: Math.PI * 1.4 })];
  rings.forEach((ring, i) => { ring.position.y = 52; ring.rotation.x = Math.PI / 2 + (i - 1) * 0.35; });
  core.add(crystal, plinth, beam, ...rings);
  scene.add(core);

  // Orbital transit loop around the city.
  const loopPts = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; loopPts.push([Math.cos(a) * 78, 14 + Math.sin(a * 2) * 6, Math.sin(a) * 78]); }
  const loop = lightPath(THREE, loopPts, { color: pal.window, closed: true, radius: 0.35, pulses: low ? 3 : 6, pulseSize: 4 });
  scene.add(loop);

  // ── District islands.
  const districtObjs = DISTRICTS.map((d, di) => {
    const g = new THREE.Group();
    const x = Math.cos(d.angle) * d.dist, z = Math.sin(d.angle) * d.dist;
    g.position.set(x, d.y, z);
    g.add(platform(THREE, { radius: 18, depth: 26, rim: d.accent, color: pal.metal, seed: di + 4, rock: pal.rock }));
    const dr = rng(100 + di);
    const spots = [];
    const count = low ? 5 : 9;
    for (let i = 0; i < count; i++) {
      const a = dr() * Math.PI * 2, dd = 6 + dr() * 9;
      const tall = d.style === "spires" ? 18 + dr() * 34 : 4 + dr() * 14;
      spots.push({ x: Math.cos(a) * dd, z: Math.sin(a) * dd, w: 2 + dr() * 3, d: 2 + dr() * 3, h: tall });
    }
    g.add(towers(THREE, spots, { color: pal.glass, emissiveMap: winTex, emissiveIntensity: opts.theme === "light" ? 0.3 : 0.8 }));
    const accentMat = new THREE.MeshStandardMaterial({ color: d.accent, emissive: d.accent, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.3 });
    let landmark;
    if (d.style === "dome") {
      landmark = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: pal.glass, metalness: 0.9, roughness: 0.2, emissive: d.accent, emissiveIntensity: 0.25 }));
      const door = glowRing(THREE, { radius: 4.5, color: d.accent, tube: 0.3 });
      door.position.set(0, 3.5, 7);
      g.add(door);
    } else if (d.style === "crystal") {
      landmark = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(2 + dr() * 2, 0), accentMat);
        c.scale.y = 2.5; c.position.set((dr() - 0.5) * 8, 6 + dr() * 6, (dr() - 0.5) * 8);
        landmark.add(c);
      }
    } else if (d.style === "ring") {
      landmark = new THREE.Group();
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 26, 8), new THREE.MeshStandardMaterial({ color: pal.metal, metalness: 0.8, roughness: 0.3 }));
      tw.position.y = 13;
      const halo = glowRing(THREE, { radius: 7, color: d.accent, tube: 0.25 });
      halo.position.y = 24; halo.rotation.x = Math.PI / 2;
      landmark.add(tw, halo);
      landmark.userData.spin = halo;
    } else if (d.style === "antenna") {
      landmark = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.6, 34, 6), new THREE.MeshStandardMaterial({ color: pal.metal, metalness: 0.9, roughness: 0.3 }));
      mast.position.y = 17;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), accentMat);
      tip.position.y = 35;
      landmark.add(mast, tip);
    } else if (d.style === "dish") {
      landmark = new THREE.Group();
      const dish = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3), new THREE.MeshStandardMaterial({ color: pal.metal, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }));
      dish.rotation.x = Math.PI * 0.8; dish.position.y = 12;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 10, 6), dish.material);
      stem.position.y = 5;
      landmark.add(dish, stem);
      landmark.userData.spin = dish;
    } else {
      landmark = new THREE.Group();
    }
    g.add(landmark);
    // Beacon: the point the HTML marker tracks.
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 8), new THREE.MeshBasicMaterial({ color: d.accent }));
    beacon.position.y = d.style === "spires" ? 58 : d.style === "antenna" ? 38 : 30;
    g.add(beacon);
    scene.add(g);

    // Bridge from core to district: an arched light path.
    const from = [Math.cos(d.angle) * 50, 6, Math.sin(d.angle) * 50];
    const to = [x - Math.cos(d.angle) * 18, d.y + 1, z - Math.sin(d.angle) * 18];
    const mid = [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 14, (from[2] + to[2]) / 2];
    const bridge = lightPath(THREE, [from, mid, to], { color: d.accent, radius: 0.22, pulses: low ? 1 : 2, pulseSize: 3 });
    scene.add(bridge);
    return { d, group: g, beacon, landmark, bridge, base: g.position.y, phase: di * 1.1 };
  });

  // Energy streams and atmosphere.
  const motes = particles(THREE, { count: low ? 160 : hero ? 520 : 300, spread: 420, height: 160, y: -60, color: pal.window, size: 1.4, opacity: opts.theme === "light" ? 0.5 : 0.75 });
  const stream = particles(THREE, { count: low ? 60 : 160, spread: 10, height: 140, y: 30, color: accent, size: 2.2, seed: 4 });
  scene.add(motes, stream);
  const cloudLayer = clouds(THREE, { count: low ? 5 : 10, radius: 300, y: 70, color: opts.theme === "light" ? 0xffffff : 0x9fc7cf, opacity: opts.theme === "light" ? 0.5 : 0.08 });
  scene.add(cloudLayer);

  // ── Camera: carefully framed three-quarter view, slow drift, pointer parallax, focus easing.
  const look = new THREE.Vector3(0, hero ? 26 : 30, 0);
  const lookTarget = look.clone();
  const camState = { yaw: hero ? -0.35 : 0.2, dist: hero ? 330 : 320, height: hero ? 125 : 135 };
  const tmp = new THREE.Vector3();
  let viewW = 1, viewH = 1;

  return {
    resize(w, h) {
      viewW = w; viewH = h;
      // Portrait screens: pull back so the city still fits.
      camState.dist = (hero ? 330 : 320) * (w / h < 1 ? 1.35 : 1);
      // Wide hero: shift the city right of centre so the headline column stays clear.
      if (hero && w / h > 1.15) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
      else camera.clearViewOffset();
    },
    update(t, dt, pointer, o) {
      const focus = DISTRICTS.find((x) => x.id === o.focus);
      // Camera yaw drifts slowly; a focused district pulls the view toward it.
      const baseYaw = (hero ? -0.35 : 0.2) + Math.sin(t * 0.05) * 0.18 + pointer.x * 0.08;
      // Yaw that puts the focused district between camera and core, blended 35% from the resting view.
      const targetYaw = focus ? baseYaw + shortestAngle(baseYaw, Math.PI / 2 - focus.angle) * 0.35 : baseYaw;
      camState.yaw = damp(camState.yaw, targetYaw, 1.4, dt);
      const yaw = camState.yaw;
      camera.position.set(Math.sin(yaw) * camState.dist, camState.height - pointer.y * 10, Math.cos(yaw) * camState.dist);
      if (focus) {
        const fd = districtObjs.find((x) => x.d.id === focus.id);
        lookTarget.set(fd.group.position.x * 0.45, 24, fd.group.position.z * 0.45);
      } else lookTarget.set(0, hero ? 26 : 30, 0);
      look.x = damp(look.x, lookTarget.x, 1.5, dt); look.y = damp(look.y, lookTarget.y, 1.5, dt); look.z = damp(look.z, lookTarget.z, 1.5, dt);
      camera.lookAt(look);

      crystal.rotation.y = t * 0.4;
      crystal.position.y = 52 + Math.sin(t * 0.9) * 1.5;
      rings[0].rotation.z = t * 0.3; rings[1].rotation.z = -t * 0.2; rings[2].rotation.z = t * 0.12;
      crystalMat.emissiveIntensity = 1.2 + Math.sin(t * 1.6) * 0.25;
      animatePath(loop, t, 0.03);
      driftParticles(motes, dt, 1.5);
      driftParticles(stream, dt, 14);
      cloudLayer.rotation.y = t * 0.004;

      const anchors = o.anchors?.();
      districtObjs.forEach((x) => {
        x.group.position.y = x.base + Math.sin(t * 0.5 + x.phase) * 1.6;
        if (x.landmark.userData.spin) x.landmark.userData.spin.rotation.z = t * 0.5;
        animatePath(x.bridge, t, 0.12);
        const on = o.focus === x.d.id;
        x.beacon.scale.setScalar(damp(x.beacon.scale.x, on ? 2.2 : 1, 6, dt));
        const el = anchors?.get(x.d.id);
        if (el) {
          x.beacon.getWorldPosition(tmp);
          tmp.project(camera);
          const sx = ((tmp.x + 1) / 2) * viewW, sy = ((1 - tmp.y) / 2) * viewH;
          // Hidden when off-screen, behind the camera, or over the headline column on wide screens.
          const clearOfText = viewW / viewH <= 1.15 || sx > viewW * 0.46;
          const vis = tmp.z < 1 && sx > 40 && sx < viewW - 40 && sy > 60 && sy < viewH - 40 && clearOfText;
          el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          el.dataset.visible = vis ? "1" : "0";
          el.dataset.edge = sx > viewW - 140 ? "r" : sx < 140 ? "l" : "";
        }
      });
    },
  };
}
