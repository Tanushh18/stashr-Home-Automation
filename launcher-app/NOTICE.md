# Notice

The Stashr Launcher is **Lawnchair** (https://github.com/LawnchairLauncher/lawnchair), which is itself built on the Android Open Source
Project's Launcher3. Both are licensed under the **Apache License, Version 2.0** (see `LICENSE.txt` in the Lawnchair repository:
"Copyright (c) 2005-2008, The Android Open Source Project; Copyright (c) 2024, Lawnchair").

This folder does **not** contain Lawnchair's source code. It contains only the changes Stashr makes to it, and a script that applies them
to a checkout of Lawnchair at the commit pinned in `UPSTREAM`.

## Changes made to Lawnchair (all in `apply.py` and `overlay/`)
- Application name "Stashr Launcher" and package id `com.tanush.stashr.launcher` (so it installs next to a real Lawnchair).
- Version name and code are set by the Stashr build.
- The default accent colour is the Stashr green.
- The word "Lawnchair" in the app's own text (settings, onboarding, prompts, in every language, including forms like "Lawnchairin") reads
  "Stashr". Web addresses are left alone. The search-provider revenue-share notice, which described the Lawnchair project's own agreement, is
  rewritten without any name. Class names and internal links inside the code still say "lawnchair" (people never see them), and the
  license text in Settings → About stays as the Apache License requires.
- The launcher icon (adaptive, round and themed/monochrome) is the Stashr house drawing.

"Lawnchair" is the name of someone else's project. Stashr Launcher is an independent build and is not made, endorsed or supported by the
Lawnchair team. Do not report problems with it to them.
