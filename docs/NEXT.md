# Next up

## Fun effects (added 26 Oct)
- [ ] Web: robots fly by every 10 to 20 s, a plane lands now and then; save an item -> plane lands, delete forever -> explosion, new incident -> explosion at the bell. Settings -> "Fun effects" turns it off; reduced-motion devices never see it.
- [ ] Control Center -> Servers -> "Floor": your real servers run between Jobs and Rack (speed from CPU, crates from load, RAM bar, "Memory bhar gayi" warning). With no servers it shows a labelled demo fleet.
- [ ] Android: same effects (needs a new APK build); Settings -> "Fun effects".

## Live check 26 Oct (public URLs, from outside)
| URL | Result |
|---|---|
| stashr.tanush.qd.je | 200 OK |
| password-manager-server-xxdr.onrender.com /health | 200 OK (DB connected) |
| dealradar-0oza.onrender.com | 200 OK |
| password-manager-server.onrender.com /health | 503, Render says `suspend-by-user` (suspended on purpose) |
| password-manager-server-8gvj.onrender.com /health | 404, deleted on Render. Removed from the code and from every app's server list (2026-11-15); the live registry no longer lists it |
| password-website.onrender.com | 404 (service gone; still listed in the API's CORS list in `server/app.js`) |
| stashr.ggnhome.com, dealradar.ggnhome.com | 403 from Cloudflare to a script (bot challenge; probably fine in a browser) |
| GitHub "Monitor tick" workflow | last 10 runs: 9 success, 1 cancelled; GitHub fires it every 2 to 6 hours, not every 5 minutes. The in-server scheduler is the real 5-minute cron |
Cron page now has a "Combined status report" (200 OK vs failed, copy and CSV).

## Shipped 26 Oct (upgrade)  see docs/ROADMAP.md
- [ ] Verify live: Trash (Passwords -> Trash chip), password history in the editor, Select mode, folder rename/merge.
- [ ] Verify live: change an item on one device and watch it appear on another within seconds (needs `/vault/events`
      reachable through the host's proxy; if not, the 60 s timer still syncs).
- [ ] Android: these changes are in the source but `client/public/apps/stashr.apk` is the OLD build. Build a new APK
      (run the Stashr Android Release workflow in GitHub Actions) before expecting them on the phone. The extension zip was rebuilt.
- [ ] Set `EXTENSION_ORIGINS=chrome-extension://<id>` on the server if the extension calls the API with cookies.
- [ ] Sign-in limits now live in MongoDB (`rate_hits`): confirm repeated bad logins return 429 and survive a restart.
- [ ] Settings -> Devices and activity: sign out another device; check the activity log fills in.
- [ ] Add a card, a secure note and an identity (web and app); export CSV and re-import to confirm they round-trip.
- [ ] Photos -> Select: favourite / share link / remove several photos.
- [ ] Infrastructure tab bar: check spacing on Servers / Usage / Map / Cron pages (could not be viewed in a browser here).

# Earlier notes (planned 15 Oct 2026)

## Shipped 15 Oct (v2.1) — verify live
- [ ] Server scheduler runs every 5 min (Cron page → "Background scheduler: Ran Xm ago"). GitHub's schedule only fired every 2–5 h.
- [x] Dead backup server …-8gvj (deleted on Render): removed from all apps, the website and the registry list.
- [ ] Render → Services: Board view (health, deploy, CPU/memory/latency graphs, actions), bulk Restart/Deploy/Suspend/Resume.
- [ ] Monitoring: every app is a ready-made group; crashes / restarts / deploys from Render's event log; peaks.
- [ ] Cron page: ping jobs, /health scan, "Add /health + merge" (opens a PR and merges it), Render cron jobs.

- [ ] Service → "Domains & URL": add / verify / remove a custom domain; "Use … in web + app" updates the Stashr
      server list (apps read it on start); "Frontends that have this address built in" rewrites env vars + redeploys.
- [ ] Projects fill blank details on their own: databases (provider from the connection host), "Services used (auto)",
      custom domain, DNS provider (from the domain's nameservers).
- Only apps that read the Stashr server list follow a URL change instantly; a mobile app with the URL compiled
  in needs a new build (or to read /registry/<app>).

## Site audit (15 Oct) — still open
Render
- [ ] Automatic monitoring groups are not shown in the Monitoring tab (no charts for them yet).
- [ ] Monitoring checks at most 15 services per tick and the tick comes from GitHub Actions (~5 min, often late):
      not instant. Move the scheduler into the server / a Render cron job (ties into "instant down alerts").
- [ ] No bulk suspend / resume; favourites are per browser (localStorage), not synced across devices.
Services (usage)
- [ ] Off until "Turn on usage tracking" is clicked; only a few providers have usage APIs (Mongo, Cloudinary,
      Brevo, Twilio, Deepgram); suspended services are not listed (by design).
Projects
- [ ] Duplicates still need one "Merge into one" click; forks are imported too; env changes need "Push to Render".
- [ ] Health / drift badges only look at the main server, not every deployment.
Passwords
- [ ] Breach check only runs when clicked (could run weekly); folders can't be renamed or merged.
- [ ] Items that fail to decrypt are not counted ("broken" is hard-coded to 0) — check what the card shows.
Incidents
- [ ] Alerts go to Telegram only (no in-app push yet); the log keeps the last 200 events.
Everywhere
- [ ] "Render" and "Services" overlap: consider one "Infrastructure" page with tabs (Apps, Usage, Incidents,
      Monitoring, Settings). Navbar wraps "Sign out" on laptop widths.

## v2.0.0 shipped 15 Oct — verify on the live site (stashr.tanush.qd.je)
- [ ] Projects: opens with "Auto-sync is on"; every repo of the connected GitHub token(s) shows up (source badge
      GitHub); hand-made projects stay untouched; archived ones are under the Archived tab.
- [ ] Projects: the 3 Deal-Radar projects → "Merge into one" banner → one card with a "N servers" dropdown.
- [ ] Render → Services: servers of one repo are one row with a dropdown; delete a service on Render → gone within ~30 s.
- [ ] Services (usage) page: deleted services are gone (list is read live every minute now, no 2-min cache).
- [ ] Render → Incidents: one row per outage, stale ones flagged ("Close it"), Resolve / Resolve all / Clear resolved work.
- [ ] Whole app re-syncs on its own: Projects 2 min, Render 30 s, Services 1 min, Incidents 1 min, server tick every 5 min.
- [ ] Render → Services: 🗑 on every row deletes a live or suspended service (type its name); "Delete selected" for several
      (type DELETE when a live one is included). The group checkbox selects only the main server.
- [ ] Projects → open a merged project (Deal-Radar): "Deployments" lists every server with its URL, status, last deploy; the env
      matrix shows which variables are common / differ (same letter = same value) / only on some servers / only in Stashr.
      Render → Services: each app and server shows its deployed URL.
- Known gaps: monitoring groups keep deleted services as members (only their incidents are auto-closed);
  GitHub forks are imported too (say if you want them skipped); "Sync now" does not merge duplicates (use the banner).

## 0. Check what shipped on 14 Oct (Projects ↔ Render sync)
- [ ] Projects page → "Sync with Render": duplicate Deal-Radar projects merge into one; repos running on any
      connected Render account without a project get one. Verify on stashr.tanush.qd.je with real data.
- [ ] "Merge into one" banner shows for projects with the same GitHub repo.
- [ ] Delete a service on Render → its link disappears from the project after the next check (page open or tick).
- [ ] Project env → "Push to Render" writes to EVERY Render service of that repo (all accounts) and can deploy all.
- [ ] Decide: delete the suspended duplicates dealradar-93do / dealradar-t04t on Render?
- Not built yet: creating projects for new Render repos happens only on "Sync with Render" (not automatic,
  so a project you delete isn't recreated). Make it automatic? Needs an "ignored repos" list.
- Not built yet: changing an env var doesn't push by itself; it's still the "Push to Render" button. Auto-push on save?
- Not built yet: committing env changes to GitHub (e.g. .env.example). "New commit" today = Render redeploy.

## 1. Cron jobs in Stashr
- Create and manage Render cron jobs from Stashr (like web services today: create, deploy, see runs/logs).
- Show them alongside the project they belong to (group by GitHub repo, same as the Services page).

## 2. Simplified server view
- One simple card per server: name, up/down, last deploy, URL, quick actions.
- Hide the advanced details (metrics, env vars, deploy history) behind "More".

## 3. Instant "server down" notification in the app
- As soon as a server goes down, send a push notification to the mobile app (not only Telegram).
- Today's monitoring: `.github/workflows/monitor-tick.yml` calls the monitor tick every ~5 min
  (GitHub schedules can be late), which raises incidents and sends Telegram alerts.
- To make it immediate: run the check from the server itself (or a Render cron job) every minute,
  and send a push via Expo / FCM to the registered devices when an incident opens (and when it recovers).
- Avoid spam: alert once per incident, plus a "back up" message.
