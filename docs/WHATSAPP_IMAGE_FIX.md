# WhatsApp pictures: sending the right picture (Hub 1.9.3)

## The problem
The tablet saved a lead's picture to the gallery and then tapped "the newest photo" in WhatsApp's picker. If another photo was saved at
the same moment (a download, a screenshot), that photo was sent instead.

## What changed (branch `whatsapp-image-fix`)
1. The picture is stored in its own folder, `cache/wa-share/`, as `wa-<message id>.<ext>`: one file per message, so two messages can never
   share a file and nothing else on the tablet can be taken for it. Leftovers older than an hour are deleted. Nothing is written to the
   gallery any more (`hub-app/.../whatsapp/WaImage.kt`, tested in `WaImageTest.kt`).
2. The chat is opened first (an invalid number is still caught: "not on WhatsApp"). When the chat is open, that exact file is shared into
   that chat (`ACTION_SEND`, WhatsApp Business only, `jid` = the number, the text as the caption) and Send is pressed.
3. When it does not work, the failure now says where it stopped and which WhatsApp view ids were on screen
   (`Timed out before pressing Send (step 3, picture shared; screen: ...)`). The website's Steps list shows this, so the flow can be tuned
   from a failed test message, without reading logs on the tablet.

## Not tested on a tablet
This was written and compiled by CI only. WhatsApp's screens differ between versions. The two things to check on the tablet:
- after the chat opens, WhatsApp shows the picture preview with the caption (not a contact list);
- the preview's Send button is found (`send_media_btn` or `send`).

## When the tablet is connected (USB)
1. Settings → About → tap Build number 7 times → Developer options → USB debugging on. Plug it in, then on the computer:
   ```bash
   adb devices
   adb logcat -s StashrWA
   ```
2. From the website (WhatsApp sender → Test) send a test with a picture to your own number. Watch the log line `wa stage=…`.
3. If it stops, dump what WhatsApp is showing and send me the file:
   ```bash
   adb shell uiautomator dump /sdcard/wa.xml
   adb pull /sdcard/wa.xml
   ```
4. If the share does not open the chat with a preview on this WhatsApp version, the fallback is the **folder** way: store the picture in the
   gallery folder `Pictures/StashrWA` under its own name, open WhatsApp's picker, open the `StashrWA` album and take its first item (the
   album holds only that message's picture). Those accessibility steps need the real screens, so they are done with the tablet connected.

## The two WhatsApp apps on the tablet
The tablet has normal WhatsApp (used by Stashr Smart home for its group messages) and WhatsApp Business (used by the lead sender). They are
separate apps, so there is no account clash: lead messages always use Business (`com.whatsapp.w4b`), group messages use normal WhatsApp
(`com.whatsapp`, found first). One thing was wrong: the group sender did not check whether a lead message was in progress, so a place or
arrival message could pull normal WhatsApp to the front in the middle of a lead's send and break it. It now waits (up to 90 s) for the lead
message to finish; the lead sender already refused to start while a group message was running (the website then puts that lead back in line).
Group messages now use normal WhatsApp only: if it is missing, the message fails with "WhatsApp is not installed (Smart home messages use normal
WhatsApp, not WhatsApp Business)" instead of going out from the business number.

## Rolling it out safely
Set Stashr Hub to Hold under Settings → App updates before merging, merge, then choose Selected → the tablet, test, and only then everyone.
