/* What the Stashr search can open without the network: the app's own screens, found by name or by what people call them. */
export const SCREENS = [
  { title: "Money", sub: "Payments, balance check, salary", path: "/money", words: "money paisa balance salary statement upi bank expense kharcha transaction" },
  { title: "Smart home", sub: "Devices, TV, cameras, who is home", path: "/home", words: "home ghar tv device camera light scene tablet hub" },
  { title: "Live map", sub: "Where the family is", path: "/stashr-home", words: "map location live where family" },
  { title: "Passwords", sub: "Your vault", path: "/(tabs)", words: "password vault login item" },
  { title: "Photos", sub: "Photo cloud and albums", path: "/albums", words: "photo picture album gallery" },
  { title: "Projects", sub: "Servers, env, deploys", path: "/projects", words: "project server env deploy github" },
  { title: "WhatsApp sender", sub: "Send messages", path: "/whatsapp", words: "whatsapp message send lead" },
  { title: "Phone setup", sub: "Fast phone checklist, default Home app, payments", path: "/phone-setup", words: "setup fast speed slow battery accessibility gpay payment default home launcher cleanup" },
  { title: "Apps", sub: "Download or update Stashr apps and the launcher", path: "/apps", words: "app update launcher download install" },
  { title: "Monitoring", sub: "Service health", path: "/monitoring", words: "monitor health uptime incident" },
];

/** Screens whose name or keywords contain every word typed. */
export function findScreens(q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SCREENS.filter((s) => { const hay = `${s.title} ${s.sub} ${s.words}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

/** Does the sentence look like something to tell the house to do ("tv band karo", "turn off lights", "who is home")? */
export const looksLikeCommand = (q) => /\b(on|off|band|chalu|karo|kar do|play|pause|mute|volume|lock|scene|who is|kaun|ghar|tv|light|status|open)\b/i.test(String(q || ""));
