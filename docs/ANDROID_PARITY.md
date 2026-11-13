# Website vs Android app: what each has

The main Android app (`mobile/`) is checked page by page against the website (`client/src/Pages`). ✅ = on the app, 🆕 = added in this
round, ⛔ = not on the app (with the reason).

| Website page | Android app |
|---|---|
| Passwords, Generator | ✅ Passwords tab, Generator tab |
| Photos, Photo Cloud, Shared, Albums, share links | ✅ Photos tab, Albums, Shared with me, Photo backup, Photo folders, People |
| Projects (list, detail, edit, deploy) | ✅ Projects, Project editor, Deploy new |
| Settings, 2FA, password, delete account, sessions | ✅ Settings and Account screens |
| Security Center (score, checkpoints, breach check) | ✅ Health tab |
| Money: entries, categories, flagged, Google Sheet, SMS reading | ✅ Money |
| Money: **locked (password) statements** | 🆕 password prompt, wrong password retry (password sent once, never stored) |
| Money: **month to match** | 🆕 month chips before choosing the file |
| Money: **search saved statements** (name, amount, range, reference), delete a saved statement | 🆕 "Search your saved statements" on the Money screen |
| Smart home: Overview, Devices, Camera & alerts, Automations, Insights, Media & network, Health | ✅ all seven tabs |
| Smart home: **disconnect** a device | ✅ Remove / Disconnect on tablets, TVs and phones |
| Smart home: **merge** a device linked again under another name | 🆕 "Merge into…" on tablets, TVs, Hub phones and Location phones |
| **WhatsApp sender**: on/off, limits, test, nightly report, sheets (messages, pictures, people), latest messages | 🆕 WhatsApp sender screen (Settings → Workspace) |
| WhatsApp sender: **next message time** per sheet and for the whole sender | 🆕 |
| WhatsApp sender: **steps of every message** and who stopped a failed one (server, tablet, WhatsApp) | 🆕 |
| WhatsApp sender: **use a saved picture** from another sheet | 🆕 |
| **App updates** (who is offered each new APK) | 🆕 App updates (administrators) |
| **Admin panel** (users, features, delete account) | 🆕 Admin (administrators) |
| **Apps** (download Hub, TV, Location, Cast) | 🆕 Apps screen opens each download |
| Servers (Render services, deploys), Monitoring (health pings, incidents), Server URLs | ✅ Servers, Monitoring, Server URLs |

## Added in the second round
| Website page | Android app |
|---|---|
| Smart home: 24-hour **trail** | 🆕 Insights tab: a route sketch (no street map) of every phone, the stops with addresses and a link to open each in Maps |
| Smart home: **house map** (2D and isometric 3D) | 🆕 Insights tab, read-only (2D / 3D switch, devices and people on the zones) |
| Smart home: **Room Lab** (start/stop the room model, rooms, per-phone training, accuracy) | 🆕 Insights tab |
| WhatsApp sender: **We Three** import | 🆕 WhatsApp sender → We Three sheets (connect, import unsent leads) |
| WhatsApp sender: **Google Contacts CSV** group | 🆕 WhatsApp sender → Group from Google contacts |
| WhatsApp sender: the **25 We Three quotes** button | 🆕 on every sheet |
| **Media** (ShineOne Estate website photos and videos, status shown on the website) | 🆕 ShineOne Estate Manager (administrators): sectors, upload photos/videos, show/hide, status, remove |
| **Services** (usage and limits of each app's providers) | 🆕 Services screen |

## Still web only
| Website page | Why |
|---|---|
| Smart home: editing the **house layout** (drag rooms), the imported **3-D model** (.glb), the street-map tiles under the trail | Needs a 3-D engine and a map-tile library the app does not have (a native change and a new build with new dependencies). The phone shows the map as a diagram and the trail as a route sketch. |
| **Cron** setup (ping and alert rules), Render **domain panel**, **robot army**, server-list **propagation**, Render **audit log**, **service map** | Operations dashboards built for a wide screen. The app already shows service status, incidents, pings and deploys on Servers and Monitoring. |
| **Photo import pipeline** (Google Photos into Drive, administrators) | A long-running administrator pipeline view. |
| **Security scans** (GitHub scan status) | Only links to GitHub; open it in a browser. |
| **Dashboard** and **Privacy** | The app's tabs are the dashboard; the privacy text is on the website. |
