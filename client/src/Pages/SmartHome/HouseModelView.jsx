import React, { useEffect, useRef, useState } from "react";
import { matchParts } from "../../lib/houseGlb";
import { nodeName, markersOf, spots, roomLine } from "../../lib/houseScene";

/*
 * The 3D house (.glb), drawn with three.js: the model you imported, or one made from your layout. Parts whose names match your rooms are
 * tinted (green: someone is in, amber: the room you picked), and every room shows what is in it: people (a faded figure when the room is
 * not sure), the tablet, and the devices you gave that room (green: on the Wi-Fi now, grey: not seen lately). Tap a room to pick it.
 * three.js is loaded only when this view is opened.
 * Props: buffer (ArrayBuffer of the .glb), rooms ([{ name, people: [{ person, sure }], devices: [{ label, up }], hub }]),
 *        selected (room name), onSelect(name | ""), onInfo({ missing, extra, matched }).
 */
const COLOR = { person: 0x3b82f6, "person-unsure": 0x7d8590, hub: 0xa855f7, "device-up": 0x22c55e, "device-down": 0x9ca3af };    // the same keys as the 2D map
const CSS = { person: "#3b82f6", "person-unsure": "#7d8590", hub: "#a855f7", "device-up": "#22c55e", "device-down": "#9ca3af" };
const TINT = { empty: 0x30363d, home: 0x238636, picked: 0xd29922 };
const HEIGHT = 440;

const materialsOf = (m) => (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean);

/** Frees everything an object holds on the graphics card (geometry, materials and their pictures). */
function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) materialsOf(o).forEach((mat) => { if (mat.map) mat.map.dispose(); mat.dispose(); });
  });
}

/** A text label that always faces the camera. `size` is its height in world units. */
function textSprite(THREE, text, size, border) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = "600 30px system-ui, -apple-system, Segoe UI, sans-serif";
  const t = String(text).length > 44 ? String(text).slice(0, 43) + "…" : String(text);
  g.font = font;
  const w = Math.min(1024, Math.ceil(g.measureText(t).width) + 36), h = 56;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = "rgba(13,17,23,0.88)";
  g.beginPath(); g.moveTo(10, 1); g.lineTo(w - 10, 1); g.quadraticCurveTo(w - 1, 1, w - 1, 10); g.lineTo(w - 1, h - 10); g.quadraticCurveTo(w - 1, h - 1, w - 10, h - 1); g.lineTo(10, h - 1); g.quadraticCurveTo(1, h - 1, 1, h - 10); g.lineTo(1, 10); g.quadraticCurveTo(1, 1, 10, 1); g.closePath();
  g.fill(); g.strokeStyle = border; g.lineWidth = 3; g.stroke();
  g.fillStyle = "#e6edf3"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 10;
  sp.scale.set((size * w) / h, size, 1);
  return sp;
}

/** One marker standing on the floor at (0, 0, 0): a figure for a person, a slab for the tablet, a small box with a light for a device. */
function markerMesh(THREE, kind, u) {
  const color = COLOR[kind];
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6, transparent: kind === "person-unsure", opacity: kind === "person-unsure" ? 0.55 : 1 });
  if (kind === "person" || kind === "person-unsure") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(u * 0.45, u * 0.7, u * 1.7, 18), mat); body.position.y = u * 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(u * 0.5, 18, 12), mat); head.position.y = u * 2.2;
    g.add(body, head);
  } else if (kind === "hub") {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(u * 0.25, u * 0.9, u * 0.25), mat); stand.position.y = u * 0.45;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(u * 1.7, u * 1.1, u * 0.18), mat); screen.position.y = u * 1.3;
    g.add(stand, screen);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(u, u * 0.7, u), mat); box.position.y = u * 0.35;
    g.add(box);
    if (kind === "device-up") {
      const led = new THREE.Mesh(new THREE.SphereGeometry(u * 0.18, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7ee787 })); led.position.y = u * 0.85;
      g.add(led);
    }
  }
  return g;
}

/**
 * Tints the rooms and puts what is inside them, every time something changes. Reads everything from `v` (the latest props), never from
 * an old render, and frees the previous markers first.
 */
function paint(s, v) {
  if (!s) return;
  const { THREE, nodes, markers, root, span } = s;
  markers.children.slice().forEach((o) => { markers.remove(o); dispose(o); });
  nodes.forEach((n) => { delete n.userData.room; });
  // back to how each material came in the file, then the X-ray look if it is on
  root.traverse((m) => {
    if (!m.isMesh) return;
    materialsOf(m).forEach((mat) => {
      const o = mat.userData.orig || {};
      if (mat.emissive && o.emissive !== undefined) { mat.emissive.setHex(o.emissive); mat.emissiveIntensity = o.ei; }
      mat.transparent = v.xray ? true : o.transparent; mat.opacity = v.xray ? Math.min(o.opacity, 0.25) : o.opacity; mat.depthWrite = v.xray ? false : o.depthWrite;
      mat.needsUpdate = true;
    });
  });
  const rooms = v.rooms || [];
  const { matched, missing, extra } = matchParts(nodes.map(nodeName), rooms.map((r) => r.name));
  const u = span * 0.032;                                  // the size of a marker, from the size of the house
  for (const room of rooms) {
    const names = new Set(matched[room.name] || []);
    const mine = nodes.filter((o) => names.has(nodeName(o)));
    const top = mine.filter((o) => { for (let p = o.parent; p; p = p.parent) if (mine.includes(p)) return false; return true; });
    if (!top.length) continue;
    const box = new THREE.Box3();
    top.forEach((o) => box.expandByObject(o));
    const here = (room.people || []).length > 0, picked = room.name === v.selected;
    top.forEach((o) => {
      o.userData.room = room.name;
      o.traverse((m) => {
        if (!m.isMesh) return;
        materialsOf(m).forEach((mat) => { if (mat.emissive) { mat.emissive.setHex(picked ? TINT.picked : here ? TINT.home : TINT.empty); mat.emissiveIntensity = picked ? 0.6 : here ? 0.55 : 0.12; } });
      });
    });
    // markers stand on the floor when the walls are see-through, otherwise on top of the room so nothing hides them
    const list = markersOf(room);
    const y = v.xray ? box.min.y : box.max.y;
    const at = spots(box, list.length);
    list.forEach((mk, i) => {
      const obj = markerMesh(THREE, mk.kind, u);
      obj.position.set(at[i].x, y, at[i].z);
      obj.userData.room = room.name;
      markers.add(obj);
      if (picked) {                                         // the room's label already names its people; the picked room names every marker
        const t = textSprite(THREE, mk.label, u * 1.1, CSS[mk.kind]);
        t.position.set(at[i].x, y + u * (mk.kind.startsWith("person") ? 3.3 : mk.kind === "hub" ? 2.5 : 1.6), at[i].z);
        t.userData.room = room.name;
        markers.add(t);
      }
    });
    const c = box.getCenter(new THREE.Vector3());
    const lab = textSprite(THREE, roomLine(room), u * 1.3, picked ? "#d29922" : here ? "#3fb950" : "#484f58");
    lab.position.set(c.x, y + u * (list.length ? (picked ? 4.6 : 3.4) : 1.6), c.z);
    lab.userData.room = room.name;
    markers.add(lab);
  }
  if (v.onInfo) v.onInfo({ missing, extra: extra.slice(0, 12), matched: Object.keys(matched).length });
}

export default function HouseModelView({ buffer, rooms, selected = "", onSelect, onInfo }) {
  const host = useRef(null);
  const scene = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [xray, setXray] = useState(false);
  const latest = useRef({});
  latest.current = { rooms, selected, onSelect, onInfo, xray };

  // build the scene once per file
  useEffect(() => {
    let dead = false, raf = 0, cleanup = () => {};
    setReady(false);
    (async () => {
      try {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        if (dead || !host.current) return;
        const gltf = await new Promise((ok, no) => new GLTFLoader().parse(buffer.slice(0), "", ok, no));
        if (dead || !host.current) return;
        const el = host.current, w = el.clientWidth || 640;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, HEIGHT);
        renderer.domElement.style.display = "block"; renderer.domElement.style.touchAction = "none";
        el.appendChild(renderer.domElement);
        const sc = new THREE.Scene(); sc.background = new THREE.Color(0x0d1117);
        sc.add(new THREE.HemisphereLight(0xffffff, 0x30363d, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(5, 10, 6); sc.add(sun);
        sc.add(gltf.scene);
        // every mesh gets its own materials, and remembers how they looked, so tinting one room never changes another and can be undone
        gltf.scene.traverse((m) => {
          if (!m.isMesh) return;
          m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
          materialsOf(m).forEach((mat) => { mat.userData.orig = { emissive: mat.emissive ? mat.emissive.getHex() : undefined, ei: mat.emissiveIntensity ?? 1, opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite }; });
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
        const span = Math.max(size.x, size.y, size.z, 1);
        const grid = new THREE.GridHelper(Math.max(size.x, size.z) * 1.6, 16, 0x30363d, 0x21262d); grid.position.set(mid.x, box.min.y - 0.01, mid.z); sc.add(grid);
        const cam = new THREE.PerspectiveCamera(45, w / HEIGHT, span / 200, span * 60);
        const ctl = new OrbitControls(cam, renderer.domElement);
        ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.maxPolarAngle = Math.PI * 0.49;       // never under the floor
        ctl.minDistance = span * 0.2; ctl.maxDistance = span * 8;
        const views = {
          reset: () => { const r = span * 0.8 + 0.5; cam.position.set(mid.x + r, mid.y + r * 0.9, mid.z + r); ctl.target.copy(mid); ctl.update(); },
          top: () => { cam.position.set(mid.x, mid.y + span * 1.3 + 1, mid.z + span * 0.02); ctl.target.copy(mid); ctl.update(); }
        };
        views.reset();
        const nodes = [];
        gltf.scene.traverse((o) => { if (nodeName(o)) nodes.push(o); });
        const markers = new THREE.Group(); sc.add(markers);
        const s = { THREE, sc, nodes, markers, root: gltf.scene, span, views };
        scene.current = s;

        // a tap (not a drag) picks the room under the finger; tapping it again, or empty space, lets go
        const ray = new THREE.Raycaster();
        let down = null;
        const roomOf = (o) => { for (let x = o; x; x = x.parent) if (x.userData && x.userData.room) return x.userData.room; return ""; };
        const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
        const onUp = (e) => {
          const d = down; down = null;
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
          const r = renderer.domElement.getBoundingClientRect();
          ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
          let room = "";
          for (const h of ray.intersectObjects([markers, gltf.scene], true)) { room = roomOf(h.object); if (room) break; }
          const v = latest.current;
          if (v.onSelect) v.onSelect(room && room !== v.selected ? room : "");
        };
        renderer.domElement.addEventListener("pointerdown", onDown);
        renderer.domElement.addEventListener("pointerup", onUp);
        const tick = () => { raf = requestAnimationFrame(tick); ctl.update(); renderer.render(sc, cam); };
        tick();
        const fit = () => { const nw = el.clientWidth || w; renderer.setSize(nw, HEIGHT); cam.aspect = nw / HEIGHT; cam.updateProjectionMatrix(); };
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
        if (ro) ro.observe(el); else window.addEventListener("resize", fit);
        window.__houseModelReady = true;
        cleanup = () => {
          if (ro) ro.disconnect(); else window.removeEventListener("resize", fit);
          renderer.domElement.removeEventListener("pointerdown", onDown);
          renderer.domElement.removeEventListener("pointerup", onUp);
          cancelAnimationFrame(raf); ctl.dispose();
          dispose(sc); renderer.dispose();
          if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
          scene.current = null;
        };
        setError(""); setReady(true);
        paint(s, latest.current);
      } catch (e) { if (!dead) setError("Is model ko khol nahi paaye: " + (e && e.message ? e.message : "file kharab hai")); }
    })();
    return () => { dead = true; cleanup(); };
  }, [buffer]);

  // tint the rooms and place what is inside, every time who-is-where, the devices, the picked room or the X-ray switch change
  const key = JSON.stringify((rooms || []).map((r) => [r.name, (r.people || []).map((p) => [p.person, p.sure !== false]), (r.devices || []).map((d) => [d.label, Boolean(d.up)]), Boolean(r.hub)]));
  useEffect(() => { paint(scene.current, latest.current); }, [key, selected, xray, ready]);

  if (error) return <p className="dev-warn">{error}</p>;
  return (
    <div className="hm3d">
      <div ref={host} className="hm-3dmodel" data-testid="house-model" style={{ minHeight: HEIGHT }} />
      <div className="hm3d-tools" role="group" aria-label="3D view controls">
        <button type="button" className="rd-btn rd-btn--quiet" onClick={() => scene.current && scene.current.views.reset()} disabled={!ready}>Reset view</button>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={() => scene.current && scene.current.views.top()} disabled={!ready}>Upar se</button>
        <button type="button" className={`rd-btn ${xray ? "rd-btn--primary" : "rd-btn--quiet"}`} onClick={() => setXray(!xray)} aria-pressed={xray} disabled={!ready}>X-ray (andar dekho)</button>
      </div>
      {!ready ? <p className="sh-dim">3D bana raha hoon…</p> : null}
      <p className="sh-dim hm3d-key">
        <span className="hm-key hm-dot--person" /> insaan · <span className="hm-key hm3d-unsure" /> kamra pakka nahi · <span className="hm-key hm-dot--hub" /> tablet · <span className="hm-key hm-dot--device-up" /> device Wi-Fi par · <span className="hm-key hm-dot--device-down" /> device kuch der se nahi dikha · kamre par tap karo: details aur delete
      </p>
    </div>
  );
}
