import { request } from "./api";

/* ShineOne Estate website photos and videos, per sector / area (administrators): the same calls the website's Media page makes. */
const j = (path, method, body, timeout) => request(path, { method, body, timeout });

export const shine = {
  projects: () => request("/shine/projects", { timeout: 40000 }),
  addProject: (label) => j("/shine/projects", "POST", { label }),
  sign: (project, kind) => j("/shine/sign", "POST", { project, kind }),
  uploaded: () => j("/shine/uploaded", "POST", {}),
  remove: (item) => j("/shine/delete", "POST", { publicId: item.publicId, kind: item.kind }),
  site: () => request("/shine/site"),
  update: (key, update) => j(`/shine/site/${encodeURIComponent(key)}`, "PUT", update),
};

export const STAGES = ["", "Foundation", "Structure", "Finishing", "Interior Works", "Final Inspection", "Handover"];

/** Sends one file straight to Cloudinary with the signed parameters the server made. file = { uri, name, mimeType }. */
export async function uploadToCloudinary(sig, file, kind) {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name || (kind === "video" ? "video.mp4" : "photo.jpg"), type: file.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg") });
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("signature", sig.signature);
  form.append("folder", sig.folder);
  form.append("tags", sig.tags);
  const res = await fetch(sig.uploadUrl, { method: "POST", body: form });
  if (res.ok) return;
  let message = `Upload failed (${res.status})`;
  try { const body = await res.json(); message = (body.error && body.error.message) || message; } catch (e) { /* keep the generic text */ }
  throw new Error(message);
}

export const kindOf = (file) => (String(file.mimeType || "").startsWith("video/") ? "video" : "image");
