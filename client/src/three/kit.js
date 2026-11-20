/*
  Procedural building blocks shared by every Stashr scene. Everything is made
  from geometry and small generated canvases — no external assets, no network.
  Each helper takes THREE explicitly so three stays in the lazy chunk.
*/

export function rng(seed = 1) {
  // Spread small consecutive seeds apart and discard the first outputs,
  // which are otherwise nearly identical for seeds 1, 2, 3…
  let s = (Math.abs(Math.floor(seed)) * 9973 + 17) % 2147483647;
  if (s <= 0) s += 2147483646;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
  next(); next(); next();
  return next;
}

/** Palettes per theme. Scenes pick the environment accent from `opts.accent`. */
export const PALETTE = {
  dark: {
    skyTop: 0x030812, skyMid: 0x0a1f2e, skyLow: 0x12343b, fog: 0x07131c,
    ground: 0x07121a, metal: 0x1a2a33, rock: 0x0a161c, glass: 0x10303a, mountain: 0x0b1c26, mountainFar: 0x10293a,
    light: 0xbfe9e3, ambient: 0x23404a, window: 0x8fe0dc,
  },
  light: {
    skyTop: 0x8ec9e0, skyMid: 0xcfe9ee, skyLow: 0xf3efe2, fog: 0xdcecec,
    ground: 0xdfe8e2, metal: 0x9fb4b8, rock: 0x8aa3a0, glass: 0xbfe0e3, mountain: 0x9cb9b8, mountainFar: 0xb9d3d4,
    light: 0xffffff, ambient: 0xbfd6d4, window: 0x2bb3b1,
  },
};

export const ACCENTS = {
  vault: 0x22c58f, dev: 0x38bdf8, cloud: 0x8b7cf6, alert: 0xf5a524, gold: 0xd9b45a,
  home: 0x6fcf6a, media: 0xf472b6, security: 0x2dd4bf, admin: 0x60a5fa,
};

export function palette(theme) { return PALETTE[theme === "light" ? "light" : "dark"]; }

/** Gradient sky dome (three stops) — one draw call, no texture. */
export function skyDome(THREE, pal, radius = 900) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(pal.skyTop) },
      mid: { value: new THREE.Color(pal.skyMid) },
      low: { value: new THREE.Color(pal.skyLow) },
    },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(low, mid, smoothstep(-0.15, 0.08, h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.renderOrder = -10;
  return m;
}

/** A ring of jagged mountain ridges around the origin (single BufferGeometry). */
export function mountainRing(THREE, { radius = 520, height = 140, color = 0x0b1c26, seed = 7, segments = 160, y = -40 } = {}) {
  const r = rng(seed);
  const pos = [];
  const peaks = [];
  for (let i = 0; i <= segments; i++) {
    const n = Math.sin(i * 0.21) * 0.35 + Math.sin(i * 0.057 + 1.3) * 0.45 + r() * 0.35;
    peaks.push(Math.max(0.12, n * 0.5 + 0.55) * height);
  }
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    const h0 = peaks[i], h1 = peaks[i + 1];
    pos.push(x0, y, z0, x1, y, z1, x1, y + h1, z1, x0, y, z0, x1, y + h1, z1, x0, y + h0, z0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }));
}

/** Small canvas texture of lit windows; shared by every tower in a scene. */
export function windowTexture(THREE, { lit = "#8fe0dc", dark = "#0c1d24", seed = 3, density = 0.45 } = {}) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  const r = rng(seed);
  g.fillStyle = dark; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (r() < density) { g.globalAlpha = 0.35 + r() * 0.65; g.fillStyle = lit; g.fillRect(x, y, 5, 4); }
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Instanced towers — one draw call for any number of buildings.
 * spots: [{x, z, w, d, h}]; returns the InstancedMesh (matrices already set).
 */
export function towers(THREE, spots, { color = 0x10303a, emissiveMap, emissive = 0xffffff, emissiveIntensity = 0.9, metalness = 0.6, roughness = 0.35 } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveMap, emissiveIntensity });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach((s, i) => {
    m4.compose(new THREE.Vector3(s.x, s.y || 0, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w, s.h, s.d));
    mesh.setMatrixAt(i, m4);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Thin emissive caps on top of towers (architectural light strips). */
export function towerCaps(THREE, spots, color) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach((s, i) => {
    m4.compose(new THREE.Vector3(s.x, (s.y || 0) + s.h + 0.15, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w * 1.02, 0.3, s.d * 1.02));
    mesh.setMatrixAt(i, m4);
  });
  return mesh;
}

/** A floating island platform: rock underside, flat deck, glowing rim. */
export function platform(THREE, { radius = 30, depth = 26, color = 0x13232b, rim = 0x22c58f, seed = 1, rock = 0x0a161c } = {}) {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.97, 2.4, 48), new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.5 }));
  deck.position.y = -1.2;
  const under = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.92, depth, 9, 1), new THREE.MeshStandardMaterial({ color: rock, roughness: 0.95, flatShading: true }));
  under.rotation.x = Math.PI;
  under.rotation.y = rng(seed)() * Math.PI;
  under.position.y = -2.4 - depth / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.001, 0.35, 8, 96), new THREE.MeshBasicMaterial({ color: rim }));
  ring.rotation.x = Math.PI / 2;
  g.add(deck, under, ring);
  return g;
}

/** Glowing torus ring (security rings, orbit paths). */
export function glowRing(THREE, { radius = 10, tube = 0.12, color = 0x22c58f, opacity = 0.9, arc = Math.PI * 2 } = {}) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 128, arc),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
  );
}

/** Soft round sprite texture for particles and glows. */
let dotTexCache = new WeakMap();
export function dotTexture(THREE) {
  if (dotTexCache.has(THREE)) return dotTexCache.get(THREE);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  dotTexCache.set(THREE, t);
  return t;
}

/** Floating particle field. Returns Points; animate by rotating or via `driftParticles`. */
export function particles(THREE, { count = 400, spread = 200, height = 120, y = 0, color = 0x8fe0dc, size = 1.6, seed = 11, opacity = 0.8 } = {}) {
  const r = rng(seed);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (r() - 0.5) * spread;
    arr[i * 3 + 1] = y + r() * height;
    arr[i * 3 + 2] = (r() - 0.5) * spread;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({ color, size, map: dotTexture(THREE), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const p = new THREE.Points(g, mat);
  p.userData = { height, y };
  return p;
}

/** Moves particles upward and wraps them; cheap (one buffer update). */
export function driftParticles(points, dt, speed = 2) {
  const a = points.geometry.attributes.position;
  const { height, y } = points.userData;
  for (let i = 1; i < a.array.length; i += 3) {
    a.array[i] += dt * speed;
    if (a.array[i] > y + height) a.array[i] = y;
  }
  a.needsUpdate = true;
}

/** A glowing path (bridge / transit / data line) along points, with travelling pulses. */
export function lightPath(THREE, pts, { color = 0x22c58f, radius = 0.25, pulses = 3, pulseSize = 3, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(24, pts.length * 16), radius, 6, closed),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const group = new THREE.Group();
  group.add(tube);
  const sprites = [];
  const sm = new THREE.SpriteMaterial({ map: dotTexture(THREE), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < pulses; i++) {
    const s = new THREE.Sprite(sm);
    s.scale.setScalar(pulseSize);
    s.userData.offset = i / pulses;
    sprites.push(s);
    group.add(s);
  }
  group.userData = { curve, sprites };
  return group;
}

export function animatePath(path, t, speed = 0.08) {
  const { curve, sprites } = path.userData;
  sprites.forEach((s) => {
    const u = (((t * speed + s.userData.offset) % 1) + 1) % 1; // wrap into [0, 1) for either direction
    s.position.copy(curve.getPointAt(u));
  });
}

/** Soft cloud billboards (shared texture, few draw calls). */
export function clouds(THREE, { count = 8, radius = 260, y = 40, color = 0xffffff, opacity = 0.12, seed = 5, scale = 120 } = {}) {
  const r = rng(seed);
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: dotTexture(THREE), color, transparent: true, opacity, depthWrite: false });
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(mat);
    const a = r() * Math.PI * 2, d = radius * (0.5 + r() * 0.5);
    s.position.set(Math.cos(a) * d, y + r() * 30, Math.sin(a) * d);
    s.scale.set(scale * (1 + r()), scale * 0.35 * (1 + r() * 0.5), 1);
    g.add(s);
  }
  return g;
}

/** Fine grid floor that fades with fog. */
export function gridFloor(THREE, { size = 800, divisions = 80, color = 0x2bb3b1, y = 0, opacity = 0.22 } = {}) {
  const grid = new THREE.GridHelper(size, divisions, color, color);
  grid.position.y = y;
  const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
  mats.forEach((m) => { m.transparent = true; m.opacity = opacity; m.depthWrite = false; });
  return grid;
}

/** Standard lighting rig: hemisphere + key + accent point light. */
export function lights(THREE, pal, accent) {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(pal.light, pal.ambient, 1.1));
  const key = new THREE.DirectionalLight(pal.light, 1.4);
  key.position.set(120, 200, 80);
  const glow = new THREE.PointLight(accent, 2.2, 0, 1.4);
  glow.position.set(0, 40, 0);
  g.add(key, glow);
  g.userData.glow = glow;
  return g;
}

/** Eases a value toward a target, frame-rate independent. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Pure helper (tested): lays out `n` items on a grid of plots, deterministic. */
export function cityPlots(n, { spacing = 14, seed = 9, minH = 12, maxH = 60 } = {}) {
  const r = rng(seed);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const cx = i % cols, cz = Math.floor(i / cols);
    out.push({
      x: (cx - (cols - 1) / 2) * spacing,
      z: (cz - (Math.ceil(n / cols) - 1) / 2) * spacing,
      w: 5 + r() * 4, d: 5 + r() * 4, h: minH + r() * (maxH - minH),
    });
  }
  return out;
}

/** Pure helper (tested): clamp a non-secret count to a safe scene size. */
export function sceneCount(n, min = 3, max = 36) {
  const v = Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(min, Math.min(max, v));
}
