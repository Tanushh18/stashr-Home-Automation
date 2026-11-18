#!/usr/bin/env python3
"""Makes a Lawnchair checkout into the Stashr Launcher.

    python3 launcher-app/apply.py <path to the Lawnchair checkout>

What it does, and nothing else:
  1. edits a few lines of Lawnchair's own files (name, package id, version, default accent colour). Every edit says exactly which text it
     expects to find; if Lawnchair has changed that text, this script stops with a message instead of guessing, so a wrong build is never made;
  2. renames "Lawnchair" to "Stashr" in the text the person sees (strings.xml in every language; web links untouched); the revenue-share notice is rewritten without any name;
  3. copies launcher-app/overlay/ over the checkout (the Stashr icon and colour).

It changes data (strings, resources, Gradle constants, default settings) and adds Stashr's own Kotlin file (overlay/.../StashrSearch.kt) plus one line registering it. See launcher-app/README.md.
"""
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
STASHR_GREEN = "#ff0d6e5c"          # Lawnchair stores a colour as "custom|#AARRGGBB"

# (file, text Lawnchair has now, text it should have). Each must be found exactly once.
EDITS = [
    # the package id of the "github" channel, so Stashr Launcher installs next to (and never over) a real Lawnchair
    ("build.gradle",
     "        github {\n            applicationId 'app.lawnchair'\n",
     "        github {\n            applicationId 'com.tanush.stashr.launcher'\n"),
    # the name under the icon and in Settings
    ("build.gradle",
     '        release {\n            resValue("string", "derived_app_name", "Lawnchair")\n',
     '        release {\n            resValue("string", "derived_app_name", "Stashr Launcher")\n'),
    # version: an increasing code so each build can update the one before it (CI sets both from launcher-app/version.txt and the run number)
    ("build.gradle",
     '        versionCode 16_00_02_01_00\n        versionName "${versionDisplayName}"\n',
     '        versionCode((System.getenv("STASHR_VERSION_CODE") ?: "1600020100") as int)\n        versionName(System.getenv("STASHR_VERSION_NAME") ?: "${versionDisplayName}")\n'),
    # the dock search bar opens Stashr Search (AI, Google, statements, the house) when the Stashr app is installed; otherwise the next provider is used
    ("lawnchair/res/values/config.xml",
     '<string name="config_default_qsb_search_provider_id" translatable="false">google</string>',
     '<string name="config_default_qsb_search_provider_id" translatable="false">stashr_search</string>'),
    ("lawnchair/src/app/lawnchair/qsb/providers/QsbSearchProvider.kt",
     "        fun values() = listOf(\n            AppSearch,\n",
     "        fun values() = listOf(\n            StashrSearch,\n            AppSearch,\n"),
    # squircle icons (cleaner than the system shape on most phones; changeable in Settings)
    ("lawnchair/res/values/config.xml", '<string name="config_default_icon_shape" translatable="false">system</string>', '<string name="config_default_icon_shape" translatable="false">squircle</string>'),
    # a faster, cleaner first start: no icon reload on every launch, no top shadow or scrollbar, no network calls for announcements or nightly updates
    ("lawnchair/res/values/config.xml", '<bool name="config_default_always_reload_icons">true</bool>', '<bool name="config_default_always_reload_icons">false</bool>'),
    ("lawnchair/res/values/config.xml", '<bool name="config_default_show_top_shadow">true</bool>', '<bool name="config_default_show_top_shadow">false</bool>'),
    ("lawnchair/res/values/config.xml", '<bool name="config_default_show_scrollbar">true</bool>', '<bool name="config_default_show_scrollbar">false</bool>'),
    ("lawnchair/res/values/config.xml", '<bool name="config_default_live_information_enabled">true</bool>', '<bool name="config_default_live_information_enabled">false</bool>'),
    ("lawnchair/res/values/config.xml", '<bool name="config_default_live_information_show_announcements">true</bool>', '<bool name="config_default_live_information_show_announcements">false</bool>'),
    ("lawnchair/res/values/config.xml", '<bool name="config_default_enable_nightly_auto_updater">true</bool>', '<bool name="config_default_enable_nightly_auto_updater">false</bool>'),
    # the accent colour a fresh install starts with (the Stashr green); the person can still change it in Settings
    ("lawnchair/res/values/config.xml",
     '<string name="config_default_accent_color" translatable="false">no_default</string>',
     f'<string name="config_default_accent_color" translatable="false">custom|{STASHR_GREEN}</string>'),
]

# The search-provider revenue-share notice names the Lawnchair project's own agreement, which Stashr does not have, so it must not
# say "Stashr". It is rewritten without any name (English), and its translations are removed so every language shows the English text.
SPONSORED = "search_provider_sponsored_description"
SPONSORED_TEXT = "%1$s shares revenue with the open-source project this launcher is built on.\\n\\nSearching with %1$s helps support that project."
STRING = re.compile(r'(<string name="([^"]+)"[^>]*>)(.*?)(</string>)', re.S)
URL = re.compile(r"(https?://\S+|lawnchair://\S+)")
NAME = re.compile(r"lawnchair", re.I)


def _swap_name(text):
    """Lawnchair -> Stashr (lawnchair -> stashr) in the words people read, in every language, including forms like "Lawnchairin"
    and "Lawnchairが". Web addresses and app links are left alone so nothing breaks."""
    parts = URL.split(text)          # odd positions are the URLs
    count = 0
    for i in range(0, len(parts), 2):
        parts[i], n = NAME.subn(lambda m: "Stashr" if m.group(0)[0].isupper() else "stashr", parts[i])
        count += n
    return "".join(parts), count


def rename_strings(root):
    """Replace the name in the visible text of every strings.xml (all languages). Resource names, class names and comments are
    untouched (only the text between <string ...> and </string> changes)."""
    total = 0
    for path in sorted((root / "lawnchair" / "res").glob("values*/strings.xml")):
        text = path.read_text(encoding="utf-8")
        english = path.parent.name == "values"
        count = 0

        def swap(m):
            nonlocal count
            name, body = m.group(2), m.group(3)
            if name == SPONSORED:
                count += 1
                return (m.group(1) + SPONSORED_TEXT + m.group(4)) if english else ""
            if "app.lawnchair" in body:
                return m.group(0)
            new, n = _swap_name(body)
            count += n
            return m.group(1) + new + m.group(4)

        text = STRING.sub(swap, text)
        if count:
            path.write_text(text, encoding="utf-8")
            print(f"renamed  {path.relative_to(root)} ({count})")
        total += count
    if total == 0:
        sys.exit("Found no \"Lawnchair\" text in lawnchair/res/values*/strings.xml. Lawnchair changed; update launcher-app/apply.py.")


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    root = pathlib.Path(argv[1]).resolve()
    if not (root / "build.gradle").is_file() or not (root / "lawnchair").is_dir():
        sys.exit(f"{root} does not look like a Lawnchair checkout (no build.gradle and lawnchair/ folder).")

    for rel, old, new in EDITS:
        path = root / rel
        if not path.is_file():
            sys.exit(f"Lawnchair has no {rel} any more. Update launcher-app/apply.py for this Lawnchair version.")
        text = path.read_text(encoding="utf-8")
        found = text.count(old)
        if found != 1:
            sys.exit(f"Expected to find this exactly once in {rel}, found {found} times:\n{old}\nLawnchair changed; update launcher-app/apply.py.")
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
        print(f"edited   {rel}")

    rename_strings(root)

    overlay = HERE / "overlay"
    for src in sorted(p for p in overlay.rglob("*") if p.is_file()):
        dest = root / src.relative_to(overlay)
        dest.parent.mkdir(parents=True, exist_ok=True)
        replaced = dest.exists()
        shutil.copyfile(src, dest)
        print(f"{'replaced' if replaced else 'added   '} {src.relative_to(overlay)}")
    print("Stashr changes applied.")


if __name__ == "__main__":
    main(sys.argv)
