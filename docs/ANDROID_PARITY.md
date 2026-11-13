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

## Not on the app yet (web only)
| Website page | Why |
|---|---|
| Smart home: 24-hour trail **map**, **house map** and 3-D house model, **Room Lab** tuning | Map and 3-D drawing need a map/3-D library the app does not have (a native change and a new APK build with new dependencies). The phone shows the same facts as text on the Insights and Overview tabs. |
| WhatsApp sender: **We Three import**, **Google Contacts CSV** import, the "25 We Three quotes" starter button | Large file import and the We Three login are easier on a computer; people can still be added one per line on the app. |
| **Media** (ShineOne Estate website photos and videos, uploaded to Cloudinary) | Signed Cloudinary uploads of large photos and videos: needs its own screen and testing on a real phone. |
| **Services** map and usage limits, **Cron** setup, Render **domain panel**, **robot army**, server-list **propagation**, Render audit log | Operations dashboards built for a wide screen. The app already shows service status, incidents and deploys on Servers and Monitoring. |
| **Photo import pipeline** (Google Photos into Drive, administrators) | A long-running administrator pipeline view. |
| **Security scans** (GitHub scan status) | Only links to GitHub; open it in a browser. |
| **Dashboard** and **Privacy** | The app's tabs are the dashboard; the privacy text is on the website. |
