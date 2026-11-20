/*
  Minimal, dependency-free glTF 2.0 binary (.glb) writer for Stashr's own models.
  Input: [{ name, geometry (three BufferGeometry, indexed or not), material: { color, metalness,
  roughness, emissive, emissiveStrength, opacity } }] → Uint8Array (a valid .glb).
  Only POSITION, NORMAL and indices are written; that is all the scenes need.
*/
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125, SHORT = 5122, BYTE = 5120;

const pad4 = (n) => (n + 3) & ~3;
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => +linear(v / 255).toFixed(5));

export function writeGlb(parts, { generator = "stashr build-models", quantize = true } = {}) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [], meshes = [], nodes = [], materials = [], roots = [];

  const addView = (typed, target, byteStride) => {
    const offset = byteLength;
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push({ offset, bytes });
    byteLength = pad4(offset + bytes.byteLength);
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target };
    if (byteStride) view.byteStride = byteStride;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };

  for (const part of parts) {
    const g = part.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = new Float32Array(g.attributes.position.array);
    const nor = new Float32Array(g.attributes.normal.array);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    const count = pos.length / 3;
    let posAcc, norAcc, scale = null;
    if (quantize) {
      // KHR_mesh_quantization: positions as normalized int16 (node scale restores size), normals as normalized int8.
      // Vertex attributes need 4-byte-aligned strides, so each element is padded (8 and 4 bytes).
      scale = Math.max(...min.map(Math.abs), ...max.map(Math.abs)) || 1;
      const qp = new Int16Array(count * 4), qn = new Int8Array(count * 4);
      const qmin = [32767, 32767, 32767], qmax = [-32767, -32767, -32767];
      for (let v = 0; v < count; v++) for (let k = 0; k < 3; k++) {
        const q = Math.round((pos[v * 3 + k] / scale) * 32767);
        qp[v * 4 + k] = q; qmin[k] = Math.min(qmin[k], q); qmax[k] = Math.max(qmax[k], q);
        qn[v * 4 + k] = Math.round(Math.max(-1, Math.min(1, nor[v * 3 + k])) * 127);
      }
      posAcc = accessors.push({ bufferView: addView(qp, ARRAY_BUFFER, 8), componentType: SHORT, normalized: true, count, type: "VEC3", min: qmin, max: qmax }) - 1;
      norAcc = accessors.push({ bufferView: addView(qn, ARRAY_BUFFER, 4), componentType: BYTE, normalized: true, count, type: "VEC3" }) - 1;
    } else {
      posAcc = accessors.push({ bufferView: addView(pos, ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3", min: min.map((v) => +v.toFixed(5)), max: max.map((v) => +v.toFixed(5)) }) - 1;
      norAcc = accessors.push({ bufferView: addView(nor, ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3" }) - 1;
    }
    const prim = { attributes: { POSITION: posAcc, NORMAL: norAcc }, mode: 4 };
    if (g.index) {
      const big = count > 65535;
      const idx = big ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array);
      prim.indices = accessors.push({ bufferView: addView(idx, ELEMENT_ARRAY_BUFFER), componentType: big ? UNSIGNED_INT : UNSIGNED_SHORT, count: idx.length, type: "SCALAR" }) - 1;
    }
    const m = part.material || {};
    const mat = {
      name: part.name + "-material",
      pbrMetallicRoughness: { baseColorFactor: [...rgb(m.color ?? 0x888888), m.opacity ?? 1], metallicFactor: m.metalness ?? 0.5, roughnessFactor: m.roughness ?? 0.5 },
    };
    if (m.emissive) mat.emissiveFactor = rgb(m.emissive);
    if (m.opacity !== undefined && m.opacity < 1) mat.alphaMode = "BLEND";
    prim.material = materials.push(mat) - 1;
    const mesh = meshes.push({ name: part.name, primitives: [prim] }) - 1;
    // Quantized meshes sit under a parent node carrying the de-quantization scale, so the
    // named node (which scenes animate) keeps a plain transform.
    const node = { name: part.name };
    if (part.position) node.translation = part.position;
    if (scale) {
      const inner = nodes.length + 1;
      node.children = [inner];
      nodes.push(node);
      nodes.push({ name: part.name + "-mesh", mesh, scale: [scale, scale, scale] });
      roots.push(nodes.length - 2);
      continue;
    }
    node.mesh = mesh;
    roots.push(nodes.length);
    nodes.push(node);
  }

  const json = {
    asset: { version: "2.0", generator },
    ...(quantize ? { extensionsUsed: ["KHR_mesh_quantization"], extensionsRequired: ["KHR_mesh_quantization"] } : {}),
    scene: 0,
    scenes: [{ name: "Scene", nodes: roots }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length), binLen = pad4(byteLength);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen); // pad JSON with spaces
  const binStart = 20 + jsonLen;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  for (const c of chunks) out.set(c.bytes, binStart + 8 + c.offset);
  return out;
}

/** Reads a .glb back (header + JSON chunk) — used by tests to validate the files. */
export function readGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const version = dv.getUint32(4, true), length = dv.getUint32(8, true);
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error("first chunk is not JSON");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binLen = dv.getUint32(20 + jsonLen, true);
  if (dv.getUint32(24 + jsonLen, true) !== 0x004e4942) throw new Error("second chunk is not BIN");
  return { version, length, json, binLength: binLen };
}
