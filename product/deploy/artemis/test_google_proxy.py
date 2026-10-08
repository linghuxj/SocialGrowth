import os
import unittest
from unittest.mock import patch
from google_proxy import google_proxy_client_args


class GoogleProxyTest(unittest.TestCase):
    def test_unset_preserves_default_sdk_options(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(google_proxy_client_args(), {})

    def test_client_options_do_not_set_global_proxy_variables(self):
        env = {"SG_GOOGLE_API_PROXY": "http://127.0.0.1:17891", "UNCHANGED": "present"}
        with patch.dict(os.environ, env, clear=True):
            before = dict(os.environ)
            self.assertEqual(google_proxy_client_args(), {"proxy": env["SG_GOOGLE_API_PROXY"]})
            self.assertEqual(dict(os.environ), before)
            self.assertFalse(any(k in os.environ for k in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]))

    def test_remote_or_credentialed_endpoints_are_rejected_without_disclosure(self):
        for url in ["http://0.0.0.0:17891", "http://example.com:17891", "https://127.0.0.1:17891",
                    "http://private:secret@127.0.0.1:17891", "http://127.0.0.1:80", "http://127.0.0.1:bad",
                    "http://127.0.0.1:17891/path", "http://127.0.0.1:17891?token=private"]:
            with self.subTest(url=url), patch.dict(os.environ, {"SG_GOOGLE_API_PROXY": url}, clear=True):
                with self.assertRaisesRegex(ValueError, "^SG_GOOGLE_API_PROXY_INVALID$"):
                    google_proxy_client_args()


if __name__ == "__main__":
    unittest.main()
