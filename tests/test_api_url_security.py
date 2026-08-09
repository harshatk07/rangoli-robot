"""
Comprehensive Unit Tests for Database Authentication, SSRF Protections,
Security Validation, and Pipeline Functions.
"""

import unittest
from core.db import init_db, verify_robot_auth_db
from app import is_safe_public_url

class TestAPIUrlSecurity(unittest.TestCase):

    def setUp(self):
        init_db()

    def test_robot_auth_verification(self):
        self.assertTrue(verify_robot_auth_db("BOT-01", "SECRET_KEY_BOT_01"))
        self.assertTrue(verify_robot_auth_db("BOT-01", "SECRET_BOT_TOKEN_01"))
        self.assertFalse(verify_robot_auth_db("", "INVALID_TOKEN"))

    def test_ssrf_url_protection(self):
        # 1. Invalid URL scheme
        self.assertFalse(is_safe_public_url("ftp://example.com/image.png"))
        self.assertFalse(is_safe_public_url("invalid_url"))

        # 2. Local / Private IP addresses
        self.assertFalse(is_safe_public_url("http://127.0.0.1/secret.png"))
        self.assertFalse(is_safe_public_url("http://localhost/secret.png"))
        self.assertFalse(is_safe_public_url("http://0.0.0.0/secret.png"))

        # 3. Valid public HTTPS URL
        self.assertTrue(is_safe_public_url("https://raw.githubusercontent.com/opencv/opencv/master/samples/data/smarties.png"))

if __name__ == "__main__":
    unittest.main()
