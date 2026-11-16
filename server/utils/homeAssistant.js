/**
 * The Stashr Home assistant: turns a short sentence ("tv ki volume badhao", "pause the movie", "open netflix") into
 * a command for one of your devices. Plain rules, no AI service, so it works offline and never guesses wildly:
 * a sentence it does not understand is answered with a question, not an action.
 *
 * Understands English and Hinglish. Returns { reply, commands: [{ kind, type, args }] } or { reply } alone.
 */

const APPS = [
    { names: ["netflix"], package: "com.netflix.ninja", label: "Netflix" },
    { names: ["prime", "amazon", "prime video"], package: "com.amazon.amazonvideo.livingroom", label: "Prime Video" },
    { names: ["hotstar", "jiohotstar", "disney"], package: "in.startv.hotstar", label: "JioHotstar" },
    { names: ["youtube music", "yt music"], package: "com.google.android.youtube.tvmusic", label: "YouTube Music" },
    { names: ["youtube", "yt"], package: "com.google.android.youtube.tv", label: "YouTube" },
    { names: ["mx player", "mx"], package: "com.mxtech.videoplayer.television", label: "MX Player" },
    { names: ["zee5", "zee 5"], package: "com.graymatrix.did", label: "Zee5" },
    { names: ["discovery"], package: "com.discoveryplus.tv.android", label: "Discovery+" },
    { names: ["news18"], package: "com.news18.atv", label: "News18" },
    { names: ["abp"], package: "com.abpnewslive", label: "ABP News" },
    { names: ["ndtv"], package: "com.july.ndtv", label: "NDTV" },
    { names: ["india today"], package: "com.indiatoday.tv", label: "India Today" },
    { names: ["zee news"], package: "com.zeenews.tv", label: "Zee News" },
    { names: ["cnbc"], package: "com.cnbc.client", label: "CNBC" }
];

const has = (text, words) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(text));
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s.%+-]/gu, " ").replace(/\s+/g, " ").trim();

function findApp(text) {
    // Longest name first, so "zee news" is not taken for "zee5" and "prime video" not for "prime".
    const all = APPS.flatMap((a) => a.names.map((n) => ({ n, a }))).sort((x, y) => y.n.length - x.n.length);
    const hit = all.find(({ n }) => has(text, [n.replace(/ /g, " ")]));
    return hit ? hit.a : null;
}

const MUSIC_WORDS = ["gaana", "gaane", "gana", "gane", "song", "songs", "music", "bajao", "sunao", "gaano", "geet"];
const FILLER = new Set(["play", "chalao", "chala", "chalaao", "lagao", "laga", "bajao", "sunao", "gaana", "gaane", "gana", "gane", "gaano", "geet", "song", "songs",
    "music", "on", "the", "tv", "par", "pe", "pr", "mein", "me", "ke", "ki", "ka", "ko", "tablet", "please", "plz", "karo", "kar", "do", "de", "yt", "youtube", "a", "some", "kuch", "koi", "and"]);
const musicQuery = (text) => text.split(" ").filter((w) => !FILLER.has(w)).join(" ").trim();

/**
 * scenes: your saved scenes ([{ id, name }]), so "movie night" runs the scene of that name.
 */
function parse(sentence, devices, scenes = []) {
    const text = norm(sentence);
    if (!text) return { reply: "Say something like “pause the movie” or “tv ki volume badhao”." };
    const tv = (devices || []).find((d) => d.kind === "tv");
    const hub = (devices || []).find((d) => d.kind === "hub");
    const toTv = (type, args = {}, reply) => (tv ? { reply, commands: [{ kind: "tv", type, args }] } : { reply: "No TV is added to Stashr Home yet." });

    // Questions about the house are answered from what the devices last reported.
    if (has(text, ["status", "kya chal raha", "whats on", "what is playing", "kya chal rha"])) return { reply: "status", status: true };

    // Who is home
    if (has(text, ["kaun ghar", "kon ghar", "who is home", "whos home", "ghar pe kaun", "ghar par kaun", "ghar me kaun", "ghar mein kaun", "anyone home"])) return { reply: "presence", presence: true };

    // Ask the phones for a fresh location now
    if (has(text, ["locate", "location refresh", "refresh location", "location sync", "sync location", "location update karo", "abhi kahan", "location kahan", "kahan hain abhi"]) && !has(text, ["tv", "map"])) return { reply: "locate", locate: true };

    // The live map of the family on the TV
    if (has(text, ["live location", "location live", "live map", "kaun kahan", "kahan hain sab", "sab kahan", "family kahan", "live dikhao"]) && tv) return toTv("live_location", {}, "Opening the live map on the TV.");

    // Who is on the way home
    if (has(text, ["kab aayenge", "kab aayega", "kab aayegi", "kab tak aayenge", "kab pahunchenge", "kab pahunchega", "kitni der mein", "aa rahe", "aa raha", "eta", "on the way", "when will"]) && !has(text, ["tv", "movie"])) return { reply: "coming", coming: true };

    // "Stashr today updates": open the list of today's news on the tablet
    if (has(text, ["updates", "update", "khabar", "khabrein", "news"]) && has(text, ["today", "aaj", "aaj ke", "aaj ki", "aaj ka", "stashr", "ghar"]) && !has(text, ["sync", "download", "movies", "movie", "tv"])) return { reply: "Showing today’s updates on the tablet.", today: true };

    // A saved scene by its name: "movie night", "good night"
    const scene = (scenes || []).slice().sort((a, b) => String(b.name).length - String(a.name).length).find((sc) => sc && sc.name && text.includes(norm(sc.name)));
    if (scene) return { reply: `Running “${scene.name}”.`, scene: scene.id };

    const toHub = (type, args, reply) => (hub ? { reply, commands: [{ kind: "hub", type, args }] } : { reply: "The tablet is not added to Stashr Home yet." });
    if (has(text, ["screen"]) && has(text, ["off", "band", "bandh", "sleep", "dark"]) && !has(text, ["tv", "mirror", "cast"])) return toHub("screen_off", {}, "Putting the tablet screen to sleep.");
    if (has(text, ["wifi", "wi-fi", "wi fi"]) && has(text, ["motion", "halchal", "movement", "sensing", "walk"]) && has(text, ["test", "check", "try"])) return toHub("wifi_motion_test", {}, "Starting the Wi-Fi motion test on the tablet. It takes about 2 minutes: first one minute of nobody moving, then one minute of somebody walking between the tablet and the router. The tablet tells you what to do.");
    if (has(text, ["room model", "kamre ka model", "kamra model", "room location"]) && !has(text, ["kis", "kaun", "which", "kahan"])) return toHub("show_room", {}, "Showing the room model on the tablet.");
    if (has(text, ["map", "naksha", "nakshe", "naqsha"]) && has(text, ["ghar", "home", "house", "mera", "dikhao", "show"]) && !has(text, ["google", "maps", "route", "directions"])) return toHub("show_map", {}, "Showing the house map on the tablet.");
    if (has(text, ["speed test", "internet speed", "net speed", "speed check", "speedtest"])) return toHub("speed_test", {}, "Running an internet speed test on the tablet. The result shows up in a minute.");
    if (has(text, ["camera"])) {
        if (has(text, ["off", "band", "disarm", "stop", "bandh"])) return toHub("camera", { action: "disarm" }, "Turning the tablet camera alerts off.");
        if (has(text, ["live", "dikhao live"])) return toHub("camera", { action: "live" }, "Live view is on for 2 minutes. Open Smart home → Camera to watch.");
        if (has(text, ["video", "clip", "recording"])) return toHub("camera", { action: "clip" }, "Recording a short clip on the tablet camera.");
        if (has(text, ["photo", "pic", "picture", "snapshot", "dikhao", "dekho"])) return toHub("camera", { action: "snapshot" }, "Taking a photo with the tablet camera.");
        if (has(text, ["on", "chalu", "start", "arm", "shuru"])) return toHub("camera", { action: "arm" }, "Camera alerts are on: you get a photo when someone comes into view.");
    }
    if (has(text, ["wake", "jagao", "jaga", "uthao"]) && !has(text, ["tv"])) return { reply: "wake", wake: text.replace(/\b(wake|up|jagao|jaga|uthao|on|the|ko|please)\b/g, " ").replace(/\s+/g, " ").trim() };

    if (has(text, ["scan", "wifi", "wi-fi", "devices"]) && hub && has(text, ["scan", "refresh", "check", "dekho", "update"])) {
        return { reply: "Scanning the Wi-Fi now.", commands: [{ kind: "hub", type: "scan_now", args: {} }] };
    }

    // A YouTube link: opened in the TV's YouTube app (your Premium account is signed in there).
    const link = /https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i.exec(String(sentence || ""));
    if (link) return toTv("open_url", { url: link[0] }, "Opening that on the TV’s YouTube app.");

    // Volume
    const level = /(?:volume|awaaz|awaz)[^0-9]*([0-9]{1,3})\b|\b([0-9]{1,3}) ?%/.exec(text);
    if (has(text, ["volume", "awaaz", "awaz", "sound", "mute", "unmute", "louder", "quieter"])) {
        if (has(text, ["mute", "unmute", "chup"])) return toTv("volume", { action: "mute" }, "Toggling mute on the TV.");
        if (level && Number(level[1] || level[2]) <= 100) return toTv("volume", { level: Number(level[1] || level[2]) }, `Setting the TV volume to ${level[1] || level[2]}.`);
        if (has(text, ["up", "badhao", "badha", "zyada", "jyada", "increase", "louder", "high", "tez"])) return toTv("volume", { action: "up" }, "Turning the TV volume up.");
        if (has(text, ["down", "kam", "ghatao", "decrease", "lower", "quieter", "low", "dheere", "dhire"])) return toTv("volume", { action: "down" }, "Turning the TV volume down.");
    }

    // Songs: on the tablet through YouTube Music, or on the TV through its YouTube app (your Premium account)
    const opening = findApp(text) && has(text, ["open", "kholo", "khol", "launch"]);
    if (has(text, MUSIC_WORDS) && !opening && !has(text, ["pause", "roko", "rok", "ruko", "stop", "next", "agla", "agli", "skip", "previous", "prev", "pichla", "pichli", "awaaz", "awaz", "volume"])) {
        const query = musicQuery(text) || "top hindi songs";
        if (has(text, ["tv"]) || !hub) return tv ? { reply: `Playing “${query}” on the TV.`, youtube: query, music: true } : { reply: "No TV is added to Stashr Home yet." };
        return { reply: `Playing “${query}” on the tablet with YouTube Music.`, commands: [{ kind: "hub", type: "play_music", args: { query } }] };
    }

    // Play / pause / next / previous: whatever is playing on the TV
    if (has(text, ["pause", "roko", "rok", "ruko", "stop"])) return toTv("media", { action: "play_pause" }, "Pausing.");
    if (has(text, ["resume", "play", "chalao", "chala", "continue", "shuru"]) && !findApp(text) && !/movie|film/.test(text.replace(/the (movie|film)/, "$1")) ) return toTv("media", { action: "play_pause" }, "Playing.");
    if (has(text, ["next", "agla", "agli", "skip"])) return toTv("media", { action: "next" }, "Next.");
    if (has(text, ["previous", "pichla", "pichli", "back track", "prev"])) return toTv("media", { action: "previous" }, "Previous.");

    // Home / back
    if (has(text, ["home"]) && has(text, ["tv", "jao", "go", "screen", "button"]) || text === "home") return toTv("key", { key: "HOME" }, "Going to the TV home screen.");
    if (text === "back" || has(text, ["peeche", "pichhe"]) && has(text, ["jao", "go"])) return toTv("key", { key: "BACK" }, "Going back.");

    // Open an app
    const app = findApp(text);
    if (app && has(text, ["open", "kholo", "khol", "launch", "start", "chalao", "chala", "lagao", "laga", "play", "dikhao", "on"])) {
        return toTv("launch_app", { package: app.package }, `Opening ${app.label} on the TV.`);
    }

    // Sync movies from the cloud folder
    if (has(text, ["sync"]) || (has(text, ["download", "update"]) && has(text, ["movies", "movie", "film"]))) return toTv("sync_now", {}, "Asking the TV to sync its movies.");

    return { reply: "I did not understand that. Try: “volume up”, “pause”, “open netflix”, “mute the tv”, or “status”." };
}

/** One line about everything, built from the devices' last reports. */
function statusLine(devices) {
    const lines = [];
    for (const d of devices || []) {
        if (d.kind === "tv") {
            if (!d.online) { lines.push(`${d.name} is off or not connected.`); continue; }
            const s = d.status || {};
            if (s.screen === "off") { lines.push(`${d.name} is in standby.`); continue; }
            const m = s.media && s.media.title ? `, ${s.media.state === "paused" ? "paused" : "playing"} “${s.media.title}”` : "";
            lines.push(`${d.name} is on${s.app && s.app.label ? ", showing " + s.app.label : ""}${m}.`);
        } else if (d.kind === "hub") {
            lines.push(d.online ? `${d.name}: ${(d.lan || []).filter((x) => x.up).length} devices on the Wi-Fi.` : `${d.name} is not reporting.`);
        } else if (d.kind === "phone" && require("./home").batteryOf(d.status)) {
            const b = require("./home").batteryOf(d.status);
            lines.push(`${d.name}: battery ${b.pct}%${b.charging ? " (charging)" : ""}.`);
        }
    }
    return lines.length ? lines.join(" ") : "No devices added yet.";
}

/** "Mom is home, Dad is out." */
function presenceLine(people) {
    if (!people || !people.length) return "Nobody is set up yet. Give a Wi-Fi device a person (Name / room → Person), or pair a family phone.";
    const ago = (m) => (m === undefined ? "" : m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`);
    const home = people.filter((p) => p.home).map((p) => p.person);
    const out = people.filter((p) => !p.home).map((p) => {
        const far = p.distanceKm !== undefined ? `${p.distanceKm} km away` : "";
        if (p.stale) return `${p.person} (location not updating${p.fixAgeMin !== undefined ? ` for ${ago(p.fixAgeMin).replace(" ago", "")}` : ""}${far ? `, last ${far}` : ""})`;
        const bits = [far, p.fixAgeMin !== undefined ? `updated ${ago(p.fixAgeMin)}` : ""].filter(Boolean).join(", ");
        return bits ? `${p.person} (${bits})` : p.person;
    });
    return [home.length ? `Home: ${home.join(", ")}.` : "Nobody is home.", out.length ? `Out: ${out.join(", ")}.` : ""].join(" ").trim();
}

module.exports = { parse, statusLine, presenceLine, musicQuery, APPS };
