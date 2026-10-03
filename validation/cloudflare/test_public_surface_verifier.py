import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('public_verifier', ROOT / '.agents/skills/geo-verify-public-surfaces/scripts/verify_public_surfaces.py')
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


class ChallengeDetectionTests(unittest.TestCase):
    def test_documentation_about_challenges_is_not_a_challenge(self):
        self.assertFalse(verifier.is_challenge_page('# Troubleshooting\nA captcha or access denied response may indicate mitigation.'))

    def test_challenge_html_is_detected(self):
        for body in ['<title>Just a moment...</title>', '<title>Attention Required! | Cloudflare</title>', '<div id="cf-challenge">Verify you are human</div>', '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>']:
            with self.subTest(body=body):
                self.assertTrue(verifier.is_challenge_page(body))

    def test_bot_mitigation_header_is_not_hidden_by_ordinary_body(self):
        from unittest.mock import patch
        with patch.object(verifier, 'run_curl_get', return_value=(0, 'HTTP/2 200\ncf-mitigated: challenge\ncontent-type: text/plain\n\n', '# Documentation')):
            failures = verifier.probe_bot_access('https://example.com/llms-full.txt')
        self.assertEqual(len(failures), len(verifier.BOT_USER_AGENTS))
        self.assertTrue(all('mitigated' in failure for failure in failures))
