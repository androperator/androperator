from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[4]


def load_module(relative_path: str, module_name: str):
    path = REPO_ROOT / relative_path
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


published_version = load_module(
    ".agents/skills/release-update-published-version/scripts/update_published_version.py",
    "release_update_published_version",
)

TARGET_VERSION = "9.9.9"


class PublishedVersionOutputTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.tempdir.name)
        (self.repo_root / "sites/docs/site").mkdir(parents=True, exist_ok=True)
        (self.repo_root / "sites/docs/static").mkdir(parents=True, exist_ok=True)
        (self.repo_root / "sites/landing-clawperator/public").mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def write_outputs(self, version: str) -> None:
        html = (
            '<p><strong>Current release: '
            f'<a href="https://github.com/clawperator/clawperator/releases/tag/v{version}">{version}</a>'
            "</strong></p>"
        )
        text = published_version.current_release_marker_text(version)
        (self.repo_root / "sites/docs/site/index.html").write_text(html, encoding="utf-8")
        (self.repo_root / "sites/docs/site/llms-full.txt").write_text(text, encoding="utf-8")
        (self.repo_root / "sites/docs/static/llms-full.txt").write_text(text, encoding="utf-8")
        (self.repo_root / "sites/landing-clawperator/public/llms-full.txt").write_text(text, encoding="utf-8")

    def test_updates_real_markdown_release_badge(self) -> None:
        path = self.repo_root / "compatibility.md"
        path.write_text(published_version.current_release_marker_text("0.9.5") + "\n")

        self.assertTrue(published_version.update_compatibility_versioned_apk_downloads(path, "0.10.0"))
        self.assertEqual(path.read_text(), published_version.current_release_marker_text("0.10.0") + "\n")

    def test_verifies_current_release_markers_in_generated_outputs(self) -> None:
        self.write_outputs(TARGET_VERSION)

        self.assertEqual(
            published_version.published_version_output_problems(self.repo_root, TARGET_VERSION),
            [],
        )

    def test_rejects_mismatched_docs_home_marker(self) -> None:
        self.write_outputs("0.9.8")

        problems = published_version.published_version_output_problems(self.repo_root, TARGET_VERSION)

        self.assertTrue(
            any(
                f"sites/docs/site/index.html: missing current release marker for {TARGET_VERSION}" in problem
                for problem in problems
            ),
            msg=f"Expected docs homepage mismatch in problems: {problems}",
        )

    def test_rejects_mismatched_generated_release_artifact(self) -> None:
        self.write_outputs(TARGET_VERSION)
        (self.repo_root / "sites/landing-clawperator/public/llms-full.txt").write_text(
            published_version.current_release_marker_text("0.9.8"),
            encoding="utf-8",
        )

        problems = published_version.published_version_output_problems(self.repo_root, TARGET_VERSION)

        self.assertTrue(
            any(
                f"sites/landing-clawperator/public/llms-full.txt: missing current release marker for {TARGET_VERSION}"
                in problem
                for problem in problems
            ),
            msg=f"Expected generated artifact mismatch in problems: {problems}",
        )


if __name__ == "__main__":
    unittest.main()
