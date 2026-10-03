import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("security_check", Path(__file__).with_name("check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def process_result(args, returncode, stdout=""):
    return SimpleNamespace(args=args, returncode=returncode, stdout=stdout, stderr="")


class SecurityCheckTests(unittest.TestCase):
    def test_annotation_escapes_workflow_commands_and_file_properties(self):
        report = {"diagnostics": [{"message": "unsafe\n::error::injected%",
                  "severity": "ERROR", "code": {"value": "rule"},
                  "location": {"path": "a,b:c.py", "range": {"start": {"line": 2, "column": 3}}}}]}
        output = io.StringIO()
        with patch.object(check.sys, "stdout", output):
            check.emit_annotations(report)
        self.assertEqual(output.getvalue(),
                         "::error file=a%2Cb%3Ac.py,line=2,col=3::[rule] unsafe%0A::error::injected%25\n")

    def test_scanner_errors_cannot_be_reported_as_clean(self):
        with self.assertRaisesRegex(ValueError, "reported errors"):
            check.diagnostics({"results": [], "errors": [{"message": "invalid rule"}]})
        with self.assertRaisesRegex(ValueError, "results list"):
            check.diagnostics({})

    def test_findings_preserve_location_severity_and_rule(self):
        report = check.diagnostics({"results": [{
            "path": "sample.py", "start": {"line": 2, "col": 3},
            "end": {"line": 2, "col": 9}, "check_id": "insecure-call",
            "extra": {"message": "Unsafe call", "severity": "ERROR"}}]})
        finding = report["diagnostics"][0]
        self.assertEqual(finding["location"]["range"]["start"], {"line": 2, "column": 3})
        self.assertEqual(finding["severity"], "ERROR")
        self.assertEqual(finding["code"]["value"], "insecure-call")

    def test_download_rejects_checksum_mismatch_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)

            def fake_download(command, **kwargs):
                Path(command[command.index("--output") + 1]).write_bytes(b"corrupt")

            with patch.object(check, "run", side_effect=fake_download):
                with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                    check.download("https://example.invalid/tool", "0" * 64, cache)
            self.assertEqual(list(cache.iterdir()), [])

    def test_cached_download_is_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            digest = hashlib.sha256(b"valid").hexdigest()
            (cache / digest).write_bytes(b"valid")
            with patch.object(check, "run") as run:
                self.assertEqual(check.download("unused", digest, cache), cache / digest)
                run.assert_not_called()
            (cache / digest).write_bytes(b"tampered")
            with patch.object(check, "run", side_effect=OSError("offline")):
                with self.assertRaisesRegex(OSError, "offline"):
                    check.download("unused", digest, cache)

    def test_archive_rejects_escape_and_links(self):
        for name, kind in (("../escape", tarfile.REGTYPE), ("link", tarfile.SYMTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "archive.tar.gz"
                with tarfile.open(archive, "w:gz") as bundle:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "/tmp/elsewhere"
                    bundle.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    check.extract(archive, root / "output")

    def test_full_reporter_status_is_propagated(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(check.sys, "argv", ["check.py", "--full"]), \
                 patch.dict(check.os.environ, {"XDG_CACHE_HOME": directory}), \
                 patch.object(check, "install", return_value=({"semgrep": "scan", "reviewdog": "report"}, [])), \
                 patch.object(check, "run", return_value=process_result([], 0, '{"results": []}')), \
                 patch.object(check.subprocess, "run", return_value=process_result([], 1)) as report:
                self.assertEqual(check.main(), 1)
                self.assertIn("-filter-mode=nofilter", report.call_args.args[0])
                self.assertEqual(json.loads(report.call_args.kwargs["input"])["diagnostics"], [])

    def test_diff_uses_resolved_merge_base_and_disables_external_diff(self):
        with tempfile.TemporaryDirectory() as directory:
            responses = [process_result([], 0, "base-sha\n"),
                         process_result([], 0, "merge-sha\n"),
                         process_result([], 0, "sample.py\0"),
                         process_result([], 0, '{"results": []}')]
            with patch.object(check.sys, "argv", ["check.py", "--base", "topic"]), \
                 patch.dict(check.os.environ, {"XDG_CACHE_HOME": directory}), \
                 patch.object(check, "install", return_value=({"semgrep": "scan", "reviewdog": "report"}, [])), \
                 patch.object(check, "run", side_effect=responses) as run, \
                 patch.object(check.subprocess, "run", return_value=process_result([], 0)) as report:
                self.assertEqual(check.main(), 0)
                self.assertIn("--end-of-options", run.call_args_list[0].args[0])
                self.assertIn("./sample.py", run.call_args_list[3].args[0])
                self.assertIn("-diff=git diff --no-ext-diff --no-textconv -U0 merge-sha", report.call_args.args[0])

    def test_scanner_process_failure_prevents_reporter(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(check.sys, "argv", ["check.py", "--full"]), \
                 patch.dict(check.os.environ, {"XDG_CACHE_HOME": directory}), \
                 patch.object(check, "install", return_value=({"semgrep": "scan", "reviewdog": "report"}, [])), \
                 patch.object(check, "run", side_effect=subprocess.CalledProcessError(2, "scan")), \
                 patch.object(check.subprocess, "run") as report:
                with self.assertRaises(subprocess.CalledProcessError):
                    check.main()
                report.assert_not_called()


@unittest.skipUnless(os.environ.get("SECURITY_RUN_LIVE") == "1", "Set SECURITY_RUN_LIVE=1 to download and test real tools")
class LiveSecurityCheckTests(unittest.TestCase):
    def test_real_tools_find_insecure_call_and_accept_fixed_call(self):
        with tempfile.TemporaryDirectory(prefix="security-fixture-") as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            subprocess.run(["git", "-C", directory, "-c", "user.name=Fixture",
                            "-c", "user.email=fixture@example.invalid", "commit",
                            "--allow-empty", "-qm", "Initial fixture"], check=True)
            script = root / "sample.py"
            # This creates source text for the scanner; the fixture is never executed.
            script.write_text("import subprocess\nsubprocess.call(user_input, shell=True)\n")
            subprocess.run(["git", "-C", directory, "add", "sample.py"], check=True)
            with patch.object(check, "ROOT", root), patch.object(check.sys, "argv", ["check.py", "--base", "HEAD"]):
                self.assertEqual(check.main(), 1)
                subprocess.run(["git", "-C", directory, "-c", "user.name=Fixture",
                                "-c", "user.email=fixture@example.invalid", "commit",
                                "-qm", "Add known fixture finding"], check=True)
                # An existing finding is filtered out of the diff, but a full scan reports it.
                self.assertEqual(check.main(), 0)
                with patch.object(check.sys, "argv", ["check.py", "--full", "--reporter", "github-annotations"]):
                    self.assertEqual(check.main(), 1)
                script.write_text("print(42)\n")
                subprocess.run(["git", "-C", directory, "add", "sample.py"], check=True)
                self.assertEqual(check.main(), 0)


if __name__ == "__main__":
    unittest.main()
