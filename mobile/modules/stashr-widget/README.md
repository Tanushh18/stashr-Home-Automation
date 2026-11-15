# stashr-widget

Android only. Two things on the phone's home screen, for any launcher (Stashr Launcher included):

- **Stashr Home widget** (`StashrHomeWidget`): who is on the way, who is home, the weather and the TV. It draws a small snapshot of
  display text that the app saves (`setSnapshot`); it holds no token and makes no network calls. A tap opens `stashr://home`
  (the app asks for the unlock first). The app refreshes the snapshot when Smart home loads and about every 15 minutes in the
  background, only while a widget is on the home screen (`src/lib/homeWidget.js`).
- **Long-press shortcuts** on the Stashr icon (`setShortcuts`): Smart home, TV remote, Camera, Money, Passwords. Each opens a
  `stashr://` link inside this app only.
