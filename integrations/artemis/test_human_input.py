"""Run using the installed Artemis virtualenv; no device actions, passwords or network."""
import unittest
from socialgrowth_human_input import password_target, account_screen_labels, verify_masked_input


class ProtectedFieldTests(unittest.TestCase):
    def test_masked_length_must_be_proven_before_login(self) -> None:
        xml = '<hierarchy><node password="true" focused="true" enabled="true" package="com.facebook.katana" text="••••" resource-id="pw" class="EditText" bounds="[0,0][100,100]" /></hierarchy>'
        target = password_target(xml, "com.facebook.katana", require_empty=False)
        verify_masked_input(xml, "com.facebook.katana", target, 4)
        for changed in [xml.replace("••••", "•••"), xml.replace("••••", "test"), xml.replace("pw", "other")]:
            with self.assertRaises(ValueError):
                verify_masked_input(changed, "com.facebook.katana", target, 4)

    def test_account_context_changes_are_detected_but_system_clock_is_ignored(self) -> None:
        xml = '<hierarchy><node package="com.facebook.katana" text="Account A"/><node package="com.android.systemui" text="12:00"/><node package="com.facebook.katana" password="true" text="masked"/></hierarchy>'
        labels = account_screen_labels(xml, "com.facebook.katana")
        self.assertEqual(labels, ("Account A",))
        self.assertEqual(labels, account_screen_labels(xml.replace("12:00", "12:01"), "com.facebook.katana"))
        self.assertNotEqual(labels, account_screen_labels(xml.replace("Account A", "Account B"), "com.facebook.katana"))

    def test_only_empty_focused_protected_target_is_accepted(self) -> None:
        xml = '<hierarchy><node password="true" focused="true" enabled="true" package="com.facebook.katana" text="" resource-id="pw" class="EditText" bounds="[0,0][100,100]" /></hierarchy>'
        self.assertEqual(password_target(xml, "com.facebook.katana"), ("pw", "EditText", "[0,0][100,100]"))
        self.assertEqual(password_target(xml.replace('text=""', 'text="masked"'), "com.facebook.katana", require_empty=False), ("pw", "EditText", "[0,0][100,100]"))
        for old, new in [('password="true"', 'password="false"'), ('focused="true"', 'focused="false"'), ('enabled="true"', 'enabled="false"'), ('text=""', 'text="masked"'), ('com.facebook.katana', 'untrusted.package')]:
            with self.subTest(new=new), self.assertRaises(ValueError):
                password_target(xml.replace(old, new), "com.facebook.katana")
        with self.assertRaises(ValueError):
            password_target(xml.replace('</hierarchy>', xml.split('<hierarchy>')[1]), "com.facebook.katana")


if __name__ == '__main__':
    unittest.main()
