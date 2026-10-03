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

    def test_clean_reviewdog_report_without_diagnostics_emits_no_annotations(self):
        output = io.StringIO()
        with patch.object(check.sys, "stdout", output):
            check.emit_annotations({"source": {"name": "security"}})
        self.assertEqual(output.getvalue(), "")

    def test_scanner_errors_cannot_be_reported_as_clean(self):
        with self.assertRaisesRegex(ValueError, "reported errors"):
            check.diagnostics({"results": [], "errors": [{"message": "invalid rule"}]})
        with self.assertRaisesRegex(ValueError, "results list"):
            check.diagnostics({})

    def test_findings_preserve_location_severity_and_rule(self):
        report = check.diagnostics({"results": [{
            "path": "sample.py", "start": {"line": 2, "col": 3},
            "end": {"line": 2, "col": 9}, "check_id": "insecure-call",
            "extra": {"message": "Unsafe call", "severity": "ERROR",
                      "metadata": {"category": "security", "subcategory": ["vuln"]}}}]})
        finding = report["diagnostics"][0]
        self.assertEqual(finding["location"]["range"]["start"], {"line": 2, "column": 3})
        self.assertEqual(finding["severity"], "ERROR")
        self.assertEqual(finding["code"]["value"], "insecure-call")

    def test_rule_policy_keeps_security_and_discards_lint(self):
        for category, subcategory, rule, expected in [
            ("security", ["vuln"], "command-injection", True),
            ("security", ["secure default"], "subprocess-shell-true", True),
            ("audit", ["vuln"], "unpinned-action", True),
            ("security", ["audit"], "curl-pipe-bash", True),
            ("security", ["audit"], "dangerous-subprocess-use-audit", False),
            ("correctness", [], "style", False),
            ("portability", [], "internationalization", False),
        ]:
            result = {"check_id": rule, "extra": {"metadata": {"category": category, "subcategory": subcategory}}}
            self.assertEqual(check.security_rule(result), expected)

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

    def test_scanner_install_requires_hashes_and_invalidates_changed_lock(self):
        lock = json.loads(check.LOCK.read_text())
        self.assertIn(f"semgrep=={lock['semgrep']['version']}", check.REQUIREMENTS.read_text())
        self.assertIn(f"semgrep=={lock['semgrep']['version']}",
                      Path(__file__).with_name("requirements.in").read_text().splitlines())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            requirements = root / "requirements.txt"
            requirements.write_text("first lock")

            def fake_extract(_archive, destination):
                destination.mkdir(parents=True, exist_ok=True)
                (destination / "reviewdog").write_text("reporter fixture")

            def fake_run(command, **_kwargs):
                if "venv" in command:
                    binary = Path(command[-1]) / "bin" / "semgrep"
                    binary.parent.mkdir(parents=True, exist_ok=True)
                    binary.write_text("scanner fixture")
                return process_result(command, 0)

            with patch.object(check, "REQUIREMENTS", requirements), \
                 patch.object(check, "download", return_value=root / "archive"), \
                 patch.object(check, "extract", side_effect=fake_extract), \
                 patch.object(check, "run", side_effect=fake_run) as run:
                first, _ = check.install(lock, root, root / "temporary")
                command = run.call_args.args[0]
                self.assertIn("--require-hashes", command)
                self.assertIn("--only-binary=:all:", command)
                self.assertEqual(command[-2:], ["-r", str(requirements)])
                run.reset_mock()
                check.install(lock, root, root / "temporary")
                run.assert_not_called()
                requirements.write_text("changed lock")
                second, _ = check.install(lock, root, root / "temporary")
                self.assertNotEqual(first["semgrep"], second["semgrep"])
                requirements.write_text("failed lock")
                run.side_effect = subprocess.CalledProcessError(1, "pip")
                with self.assertRaises(subprocess.CalledProcessError):
                    check.install(lock, root, root / "temporary")
                digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
                self.assertEqual(list(root.glob(f"semgrep-*-{digest}/.installed")), [])

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
                self.assertIn("-filter-mode=file", report.call_args.args[0])
                self.assertIn("-diff=git diff --no-ext-diff --no-textconv -U0 merge-sha", report.call_args.args[0])

    def test_only_exact_parser_exclusions_skip_a_diff_scan(self):
        paths = "gradlew\0sites/docs/overrides/main.html\0"
        responses = [process_result([], 0, "base-sha\n"),
                     process_result([], 0, "merge-sha\n"), process_result([], 0, paths)]
        with patch.object(check.sys, "argv", ["check.py"]), \
             patch.object(check, "run", side_effect=responses), \
             patch.object(check, "install") as install:
            self.assertEqual(check.main(), 0)
            install.assert_not_called()
        # A similarly named application file is not exempt.
        self.assertNotIn("app/gradlew", check.PARSER_EXCLUSIONS)

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
            # Include the actual parser-incompatible files to exercise the exclusions.
            for path in check.PARSER_EXCLUSIONS:
                fixture = root / path
                fixture.parent.mkdir(parents=True, exist_ok=True)
                fixture.write_text((check.ROOT / path).read_text())
            subprocess.run(["git", "-C", directory, "add", *check.PARSER_EXCLUSIONS], check=True)
            script = root / "sample.py"
            # This creates source text for the scanner; the fixture is never executed.
            script.write_text("import subprocess\nsubprocess.call(user_input, shell=True)\n")
            subprocess.run(["git", "-C", directory, "add", "sample.py"], check=True)
            with patch.object(check, "ROOT", root), patch.object(check.sys, "argv", ["check.py", "--base", "HEAD"]):
                self.assertEqual(check.main(), 1)
                subprocess.run(["git", "-C", directory, "-c", "user.name=Fixture",
                                "-c", "user.email=fixture@example.invalid", "commit",
                                "-qm", "Add known fixture finding"], check=True)
                # An unchanged file is not scanned, but a full scan reports its finding.
                self.assertEqual(check.main(), 0)
                with patch.object(check.sys, "argv", ["check.py", "--full", "--reporter", "github-annotations"]):
                    self.assertEqual(check.main(), 1)
                # Change only a later line: the existing finding must still block and annotate.
                script.write_text("import subprocess\nsubprocess.call(user_input, shell=True)\nprint(42)\n")
                subprocess.run(["git", "-C", directory, "add", "sample.py"], check=True)
                with patch.object(check.sys, "argv", ["check.py", "--base", "HEAD", "--reporter", "github-annotations"]), \
                     patch.object(check.sys, "stdout", io.StringIO()) as output:
                    self.assertEqual(check.main(), 1)
                    self.assertIn("file=sample.py,line=2", output.getvalue())
                script.write_text("print(42)\n")
                subprocess.run(["git", "-C", directory, "add", "sample.py"], check=True)
                with patch.object(check.sys, "argv", ["check.py", "--base", "HEAD", "--reporter", "github-annotations"]), \
                     patch.object(check.sys, "stdout", io.StringIO()) as output:
                    self.assertEqual(check.main(), 0)
                    self.assertEqual(output.getvalue(), "")
                # A reviewed operation stays suppressed after unrelated edits and line movement.
                reviewed = ("import subprocess\n"
                            "# Fixture intentionally exercises a shell call.\n"
                            "# nosemgrep: subprocess-shell-true\n"
                            "subprocess.call(user_input, shell=True)\n")
                script.write_text(reviewed)
                self.assertEqual(check.main(), 0)
                script.write_text("# Unrelated heading\n\n" + reviewed + "print(42)\n")
                self.assertEqual(check.main(), 0)
                # The same rule at a new occurrence must still block.
                script.write_text(reviewed + "subprocess.call(other_input, shell=True)\n")
                self.assertEqual(check.main(), 1)
                # Suppressing a different rule cannot hide this finding.
                script.write_text(reviewed.replace("subprocess-shell-true", "unrelated-rule"))
                self.assertEqual(check.main(), 1)
                script.write_text("print(42)\n")
                # The same unsupported syntax at another path must still fail the scan.
                other_wrapper = root / "other-wrapper.sh"
                other_wrapper.write_text((root / "gradlew").read_text())
                subprocess.run(["git", "-C", directory, "add", "other-wrapper.sh"], check=True)
                with self.assertRaisesRegex(ValueError, "reported errors"):
                    check.main()


if __name__ == "__main__":
    unittest.main()
