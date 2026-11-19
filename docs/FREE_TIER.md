# Running Stashr on the free plans (Render bandwidth, MongoDB 512 MB)

## See what uses what (admin only)
| Call | Shows |
|---|---|
| `GET /system/bandwidth` | bytes sent per route since the last start (after compression), who calls it, and the MB per month at that rate. `POST /system/bandwidth/reset` starts over. An hourly one-line top 5 also goes to the log. |
| `GET /system/db/usage` | every collection's documents and MB, biggest first, against the 512 MB. |
| `GET /system/db` | the old to new database move (see `MONGO_URL_NEW` in `server/config.env.example`). |

## What is kept, and for how long
| Data | Kept | Setting |
|---|---|---|
| Camera **clips** | **1 day**, swept every 6 hours | `MEDIA_CLIP_KEEP_DAYS` |
| Camera photos | 3 days, and all camera files together at most 60 MB per account | `MEDIA_KEEP_DAYS`, `MEDIA_KEEP_MB` |
| Camera allowance | 40 MB a day per account; over it, photos are kept but not sent to Telegram and clips are refused. A clip over 8 MB is kept but not uploaded to Telegram | `MEDIA_DAILY_MB`, `TELEGRAM_CLIP_MAX_MB` |
| Live camera frames | 10 minutes (the newest one only) | |
| Home events (online, arrived, camera...) | **3 days** | `DB_RETENTION=full` keeps the models' own times |
| Telegram message copies | **3 days** | same |
| WhatsApp send records | 30 days | same |
| Wi-Fi access-point sightings | 21 days | same |
| Internet speed tests | 30 days | same |
| Account activity log | 90 days | same |
| Money entries | 4 months (the 4-month rule) | |

## Bandwidth: what was changed and why
- The website and the Android app reloaded the **whole vault and projects every 10 minutes** while open; now every 6 hours. Small "what changed" checks do the rest, and when the live stream is connected they run only every 10 minutes.
- Dashboards on the website stop polling after 5 minutes without a touch, key press or scroll, and catch up when you return.
- The live camera view stops asking the tablet for frames when nobody is around (website) and closes itself after 10 minutes (Android): every frame goes through the database and back.
- The 5-minute background scheduler still pings and monitors every tick; the syncs that only copy data between services (links, projects, environment variables, registry, usage, status pages, URL propagation) run every `HEAVY_STEP_MINUTES` (30).
- App and OTA downloads are redirected to GitHub, so they do not use this server's bandwidth.

## Data from the removed Photos feature
Accounts may still hold `photoMedia`, `photoAlbums`, `photoFolders`, `photoBackupJobs`, `photoSettings`, `photoShares`, and the collections `photoimportbatches`, `photoimportitems`, `photofoldershares`. They are **not** deleted automatically. Set `PHOTO_DATA_CLEANUP=true` for one start to delete them (the Google connections used for the TV's movies are kept), then remove the variable. They are never copied to a new database.
