#!/usr/bin/env python3
"""python3 launcher-app/test_apply.py : checks the rename in apply.py on small made-up strings.xml files."""
import pathlib, sys, tempfile, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import apply as A

EN = '''<resources>
    <string name="managed_by_lawnchair">Managed by Lawnchair</string>
    <string name="onboarding_welcome">Welcome to Lawnchair!</string>
    <string name="a11y">Lawnchair uses `performGlobalAction`. Stashr discards events.</string>
    <string name="search_provider_sponsored_description">%1$s and Lawnchair have a revenue share agreement.\\n\\nSearching with %1$s helps support Lawnchair.</string>
    <string name="privacy">Read https://lawnchair.app/privacy_policy and lawnchair://settings/about today</string>
    <string name="uses_app">app.lawnchair.LawnchairLauncher must stay</string>
    <string name="plain">No name here</string>
</resources>
'''
FI = '''<resources>
    <string name="s1">Lawnchairin virheraportti</string>
    <string name="s2">Lawnchairが最近使ったアプリ</string>
    <string name="s3">Cài lawnchair</string>
    <string name="search_provider_sponsored_description">%1$s ja Lawnchair ovat sopineet tulojen jakamisesta.</string>
</resources>
'''

class RenameTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        for folder, text in (("values", EN), ("values-fi", FI)):
            d = self.root / "lawnchair" / "res" / folder
            d.mkdir(parents=True)
            (d / "strings.xml").write_text(text, encoding="utf-8")
        A.rename_strings(self.root)
        self.en = (self.root / "lawnchair/res/values/strings.xml").read_text(encoding="utf-8")
        self.fi = (self.root / "lawnchair/res/values-fi/strings.xml").read_text(encoding="utf-8")

    def test_every_visible_name_is_stashr_in_every_language(self):
        self.assertIn("Welcome to Stashr!", self.en)
        self.assertIn(">Managed by Stashr<", self.en)
        self.assertIn("Stashrin virheraportti", self.fi)          # attached ending
        self.assertIn("Stashrが最近使ったアプリ", self.fi)          # attached Japanese
        self.assertIn("Cài stashr", self.fi)                       # lower case
        self.assertNotRegex(self.fi.replace("lawnchair://", ""), r"(?i)lawnchair")

    def test_resource_names_class_names_and_links_are_not_touched(self):
        self.assertIn('name="managed_by_lawnchair"', self.en)
        self.assertIn("app.lawnchair.LawnchairLauncher must stay", self.en)
        self.assertIn("https://lawnchair.app/privacy_policy", self.en)
        self.assertIn("lawnchair://settings/about", self.en)

    def test_revenue_share_notice_names_no_one_and_translations_fall_back_to_english(self):
        self.assertIn("shares revenue with the open-source project", self.en)
        self.assertNotIn("Lawnchair have a revenue", self.en)
        self.assertNotIn("search_provider_sponsored_description", self.fi)   # removed: English is shown
        self.assertNotIn("tulojen", self.fi)

    def test_nothing_else_in_the_files_changes(self):
        self.assertIn('<string name="plain">No name here</string>', self.en)
        self.assertEqual(self.en.count("<string "), 7)

    def test_it_stops_when_lawnchair_changed_its_text(self):
        root = pathlib.Path(tempfile.mkdtemp())
        d = root / "lawnchair" / "res" / "values"; d.mkdir(parents=True)
        (d / "strings.xml").write_text('<resources><string name="x">Hello</string></resources>', encoding="utf-8")
        with self.assertRaises(SystemExit): A.rename_strings(root)

if __name__ == "__main__":
    unittest.main()
