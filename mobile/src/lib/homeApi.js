import { request } from "./api";

/* Stashr Home: the same calls the website's Smart home page makes (client/src/api/client.js). */
const j = (path, method, body, timeout) => request(path, { method, body, timeout });

export const home = {
  devices: () => request("/home/devices"),
  renameDevice: (id, name) => j(`/home/devices/${id}`, "PUT", { name }),
  removeDevice: (id) => j(`/home/devices/${id}`, "DELETE"),
  // A device linked again under another name: everything of the old entry (id) moves to the one kept (into), then the old one is removed.
  mergeDevice: (id, into) => j(`/home/devices/${id}/merge`, "POST", { into }, 40000),
  command: (id, type, args = {}) => j(`/home/devices/${id}/commands`, "POST", { type, args }),
  labelLan: (id, key, body) => j(`/home/devices/${id}/lan/${key}`, "PUT", body),
  mergeLan: (id, key, into) => j(`/home/devices/${id}/lan/${key}/merge`, "POST", { into }),
  forgetLan: (id, key) => j(`/home/devices/${id}/lan/${key}`, "DELETE"),
  setPerson: (id, person) => j(`/home/devices/${id}/person`, "PUT", { person }),
  events: (limit = 40) => request(`/home/events?limit=${limit}`),
  assistant: (text) => j("/home/assistant", "POST", { text }),
  pairCode: (kind, name) => j("/home/pair-codes", "POST", { kind, name }),
  settings: () => request("/home/settings"),
  saveSettings: (body) => j("/home/settings", "PUT", body),
  dashboard: () => request("/home/dashboard"),
  locationCode: () => request("/home/location-code"),
  rotateLocationCode: () => j("/home/location-code/rotate", "POST", {}),
  hubCode: () => request("/home/hub-code"),
  rotateHubCode: () => j("/home/hub-code/rotate", "POST", {}),
  where: () => request("/home/where"),
  live: (passive) => request(`/home/live${passive ? "?passive=1" : ""}`),
  insights: () => request("/home/insights", { timeout: 40000 }),
  saveHistory: (body) => j("/home/history", "PUT", body),
  deleteHistory: () => j("/home/history", "DELETE"),
  saveSpots: (spots) => j("/home/spots", "PUT", { spots }),
  geocode: (q) => request(`/home/geocode?q=${encodeURIComponent(q)}`, { timeout: 15000 }),
  savePlaces: (places) => j("/home/places", "PUT", { places }),
  testPlace: (id, text) => j(`/home/places/${id}/test`, "POST", { text }),
  saveSchedules: (schedules) => j("/home/schedules", "PUT", { schedules }),
  saveScenes: (scenes) => j("/home/scenes", "PUT", { scenes }),
  runScene: (id) => j(`/home/scenes/${id}/run`, "POST", {}),
  usage: (days = 14) => request(`/home/usage?days=${days}`),
  speed: (days = 7) => request(`/home/speed?days=${days}`),
  media: () => request("/home/media"),
  deleteMedia: (id) => j(`/home/media/${id}`, "DELETE"),
  testBrief: (which = "brief") => j("/home/brief/test", "POST", { which }),
  movies: () => request("/home/movies/settings", { timeout: 40000 }),
  saveMovies: (body) => j("/home/movies/settings", "PUT", body, 40000),
};

/** URL of one stored camera picture or clip (loaded with authHeaders()). */
export const mediaPath = (id) => `/home/media/${id}`;
