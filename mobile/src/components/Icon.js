import React from "react";
import Svg, { Path, Circle, Rect } from "react-native-svg";

/* Line icons (24px grid, round caps) — same family as the website's icon set. */
const P = {
  home: [<Path key="a" d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5" />],
  shield: [<Path key="a" d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" />],
  shieldCheck: [
    <Path key="a" d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" />,
    <Path key="b" d="m9 12 2 2 4-4" />,
  ],
  lock: [<Rect key="a" x="4" y="10.5" width="16" height="10" rx="3" />, <Path key="b" d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9M12 14.6v2.2" />],
  key: [<Circle key="a" cx="8" cy="8" r="4.2" />, <Path key="b" d="M11 11l8 8M16.5 16.5l2-2M14 14l1.6-1.6" />],
  eye: [<Path key="a" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />, <Circle key="b" cx="12" cy="12" r="3" />],
  eyeOff: [
    <Path key="a" d="M4 4l16 16M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.1C3.9 8.7 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1" />,
    <Path key="b" d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  ],
  copy: [<Rect key="a" x="8.5" y="8.5" width="12" height="12" rx="2.5" />, <Path key="b" d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />],
  check: [<Path key="a" d="m5 12.5 4.5 4.5L19 7.5" />],
  close: [<Path key="a" d="M6 6l12 12M18 6 6 18" />],
  plus: [<Path key="a" d="M12 5v14M5 12h14" />],
  search: [<Circle key="a" cx="11" cy="11" r="6.5" />, <Path key="b" d="m20 20-4.3-4.3" />],
  trash: [<Path key="a" d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />],
  pencil: [<Path key="a" d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />],
  sparkle: [<Path key="a" d="M12 3c.6 4.2 1.8 5.4 6 6-4.2.6-5.4 1.8-6 6-.6-4.2-1.8-5.4-6-6 4.2-.6 5.4-1.8 6-6zM19 15c.3 1.8.8 2.4 2.5 2.7-1.7.3-2.2.9-2.5 2.7-.3-1.8-.8-2.4-2.5-2.7 1.7-.3 2.2-.9 2.5-2.7z" />],
  vault: [<Rect key="a" x="3.5" y="4.5" width="17" height="15" rx="3" />, <Circle key="b" cx="12" cy="12" r="3.5" />, <Path key="c" d="M12 8.5V7M15.5 12H17M7 19.5v1.5M17 19.5v1.5" />],
  pulse: [<Path key="a" d="M3 12h4l2.5-6 5 12 2.5-6h4" />],
  wand: [<Path key="a" d="M4 20 15 9M14 4v3M19 9h3M17.5 5.5l2-2M12 7h-2M17 12v2" />],
  settings: [
    <Circle key="a" cx="12" cy="12" r="3" />,
    <Path key="b" d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  ],
  fingerprint: [
    <Path key="a" d="M6.5 6.5A8 8 0 0 1 20 12v1.5M4 11a8 8 0 0 1 1.1-3.3M4.3 15.5A8 8 0 0 0 5 17" />,
    <Path key="b" d="M8.5 19.5A11 11 0 0 0 9 12a3 3 0 0 1 6 0c0 2.8-.4 5.4-1.3 7.8M12 12c0 3.2-.6 6.2-1.8 9M17.5 17.5c-.2 1-.4 2-.8 3" />,
  ],
  logout: [<Path key="a" d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />],
  moon: [<Path key="a" d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.6 6.6 0 0 0 9.9 9.9z" />],
  sun: [<Circle key="a" cx="12" cy="12" r="4" />, <Path key="b" d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />],
  phone: [<Rect key="a" x="6.5" y="2.5" width="11" height="19" rx="2.5" />, <Path key="b" d="M11 18.5h2" />],
  refresh: [<Path key="a" d="M20 11a8 8 0 0 0-14.8-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.8 3.5L20 15M20 20v-5h-5" />],
  chevronDown: [<Path key="a" d="m6 9 6 6 6-6" />],
  arrow: [<Path key="a" d="M5 12h14M13 6l6 6-6 6" />],
  back: [<Path key="a" d="M19 12H5M11 18l-6-6 6-6" />],
  mail: [<Rect key="a" x="3" y="5" width="18" height="14" rx="3" />, <Path key="b" d="m4 7 8 6 8-6" />],
  user: [<Circle key="a" cx="12" cy="8" r="4" />, <Path key="b" d="M4 20.5a8 8 0 0 1 16 0" />],
  globe: [<Circle key="a" cx="12" cy="12" r="9" />, <Path key="b" d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />],
  alert: [<Path key="a" d="M12 3 2.5 20h19L12 3zM12 10v4M12 17.2v.1" />],
  clock: [<Circle key="a" cx="12" cy="12" r="9" />, <Path key="b" d="M12 7v5l3 2" />],
  star: [<Path key="a" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />],
  starFill: [<Path key="a" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" fill="currentColor" />],
  folder: [<Path key="a" d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10z" />],
  note: [<Path key="a" d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20V3.5zM14.5 3.5V8H19M9 12h6M9 15.5h6" />],
  image: [<Rect key="a" x="3.5" y="4.5" width="17" height="15" rx="2" />, <Circle key="b" cx="8.5" cy="9" r="1.3" />, <Path key="c" d="m5 17 4.5-4 3 2.5 2-2 4.5 4" />],
  cloud: [<Path key="a" d="M7 18h10a4 4 0 0 0 .6-7.9A5.5 5.5 0 0 0 7 8.8 4.6 4.6 0 0 0 7 18z" />],
  scan: [<Path key="a" d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" />],
  download: [<Path key="a" d="M12 4v11M7 10l5 5 5-5M5 20h14" />],
  upload: [<Path key="a" d="M12 20V9M7 14l5-5 5 5M5 4h14" />],
  grid: [<Path key="a" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />],
  timer: [<Circle key="a" cx="12" cy="13" r="7.5" />, <Path key="b" d="M12 9v4l2.5 1.5M10 2.5h4" />],
  repeat: [<Path key="a" d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />],
};

export default function Icon({ name, size = 20, color = "#fff", strokeWidth = 1.8 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" color={color} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {P[name] || P.key}
    </Svg>
  );
}
