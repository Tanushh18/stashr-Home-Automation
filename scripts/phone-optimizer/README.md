# Phone optimizer (Windows + ADB)

`optimize.ps1` inspects a connected Android phone and makes it faster **only after you approve each category**.
It is the computer-side companion of the *Phone setup* checklist in the Stashr app (a phone cannot switch other apps off by itself;
Android allows that only from a computer with USB debugging).

1. Phone: Settings → About → tap Build number 7 times → Developer options → USB debugging ON. Connect, accept the prompt.
2. Windows: install Android *platform-tools*, then `powershell -ExecutionPolicy Bypass -File optimize.ps1` (audit only, changes nothing).
3. Read `reports\<time>\` (device, apps, memory, **call-screen**, storage), then run again with `-Apply`.

Never touched: Phone/Telecom/SIM/emergency, SystemUI, Contacts, SMS, WhatsApp, Google Play services, banking/UPI apps, Stashr apps.
Nothing is deleted or cleared; no root; every change has a line in `restore-commands.ps1`. Reports stay on your computer.
