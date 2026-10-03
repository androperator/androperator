from __future__ import annotations

import importlib.util
import sys
import warnings
from pathlib import Path
from tempfile import TemporaryDirectory
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


cli_reference = load_module(
    ".agents/skills/docs-build/scripts/generate_cli_reference.py",
    "docs_generate_generate_cli_reference",
)
selector_table = load_module(
    ".agents/skills/docs-build/scripts/generate_selector_table.py",
    "docs_generate_generate_selector_table",
)
error_table = load_module(
    ".agents/skills/docs-build/scripts/generate_error_table.py",
    "docs_generate_generate_error_table",
)
llms_full = load_module(
    ".agents/skills/docs-build/scripts/generate_llms_full.py",
    "docs_generate_generate_llms_full",
)
docs_organization = load_module(
    ".agents/skills/docs-build/scripts/validate_docs_organization.py",
    "docs_validate_docs_organization",
)


class GenerateCliReferenceTests(unittest.TestCase):
    def test_extract_command_bodies_stops_at_block_end(self) -> None:
        text = """
COMMANDS["first"] = {
  summary: "First command",
  group: "Test",
  topLevelBlock: `  first`,
};

const helper = {
  nested: true,
};

COMMANDS["second"] = {
  summary: "Second command",
  group: "Test",
  topLevelBlock: `  second`,
};
"""

        bodies = cli_reference.extract_command_bodies(text)

        self.assertEqual([name for name, _ in bodies], ["first", "second"])
        self.assertNotIn("helper", bodies[0][1])
        self.assertNotIn('COMMANDS["second"]', bodies[0][1])
        self.assertIn('summary: "Second command"', bodies[1][1])

    def test_parse_subcommands_handles_quoted_keys(self) -> None:
        body = """
  subtopics: {
    start: "Start recording",
    "export-evidence": "Export evidence",
    stop: "Stop recording",
  },
"""

        self.assertEqual(
            cli_reference.parse_subcommands(body),
            ["start", "export-evidence", "stop"],
        )

    def test_public_reference_uses_docs_metadata_not_regex_flags(self) -> None:
        body = """
  summary: "Tap something",
  group: "Device Interaction",
  documentedFlags: ["--text", "--id", "--desc", "--role"],
  help: `Also accepted as: --resource-id, --content-desc`,
  topLevelBlock: `  click --text <text>
                                            Tap something`,
"""

        command = cli_reference.parse_command_info("click", body)

        self.assertEqual(command.flags, ["--text", "--id", "--desc", "--role"])
        self.assertNotIn("--resource-id", command.flags)
        self.assertNotIn("--content-desc", command.flags)

    def test_public_reference_omits_shims_and_peer_alias_commands(self) -> None:
        commands = [
            cli_reference.CommandInfo(
                name="setup",
                aliases=[],
                group="Setup",
                summary="Guidance shim",
                syntax=[],
                flags=[],
                subcommands=[],
                docs_visibility="shim",
                docs_alias_of=None,
            ),
            cli_reference.CommandInfo(
                name="emulator",
                aliases=[],
                group="Device Management",
                summary="Manage emulators",
                syntax=["emulator provision"],
                flags=[],
                subcommands=["provision"],
                docs_visibility="normal",
                docs_alias_of=None,
            ),
            cli_reference.CommandInfo(
                name="provision",
                aliases=[],
                group="Device Management",
                summary="Provision emulator",
                syntax=[],
                flags=[],
                subcommands=["emulator"],
                docs_visibility="alias",
                docs_alias_of="emulator provision",
            ),
        ]

        rendered = cli_reference.render_reference(
            commands,
            {
                "emulator": cli_reference.DetailLink(
                    href="serve.md#endpoint-post-android-provision-emulator",
                    label="Emulator provisioning",
                ),
            },
        )

        self.assertNotIn("### `setup`", rendered)
        self.assertNotIn("| [`setup`]", rendered)
        self.assertNotIn("### `provision`", rendered)
        self.assertNotIn("| [`provision`]", rendered)
        self.assertIn("`provision emulator` is an alias for `emulator provision`.", rendered)
        self.assertIn('<a id="command-emulator"></a>', rendered)

    def test_public_reference_keeps_recording_discoverable(self) -> None:
        commands = [
            cli_reference.CommandInfo(
                name="recording",
                aliases=["record"],
                group="Recording",
                summary="Manage recording sessions",
                syntax=["recording start", "recording export --input <file>"],
                flags=["--session-id", "--input", "--out"],
                subcommands=["start", "export"],
                docs_visibility="normal",
                docs_alias_of=None,
            ),
        ]

        rendered = cli_reference.render_reference(
            commands,
            {
                "recording": cli_reference.DetailLink(
                    href="recording.md",
                    label="Recording workflow",
                ),
            },
        )

        self.assertIn("[`recording`](#command-recording)", rendered)
        self.assertIn("### `recording`", rendered)
        self.assertIn("`record`", rendered)
        self.assertIn("[Recording workflow](recording.md)", rendered)

    def test_missing_documented_flags_warns_without_regex_fallback(self) -> None:
        body = """
  summary: "Read text",
  group: "Device Interaction",
  help: `Also accepted as: --resource-id, --content-desc`,
  topLevelBlock: `  read --text <text>
                                            Read text`,
"""

        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            command = cli_reference.parse_command_info("read", body)

        self.assertEqual(command.flags, [])
        self.assertTrue(
            any(
                "Command read has no documentedFlags metadata" in str(warning.message)
                for warning in captured
            )
        )

    def test_public_reference_renders_detail_and_action_links(self) -> None:
        commands = [
            cli_reference.CommandInfo(
                name="click",
                aliases=["tap"],
                group="Device Interaction",
                summary="Tap the first matching UI element",
                syntax=["click --text <text>"],
                flags=["--text", "--id", "--desc", "--role"],
                subcommands=[],
                docs_visibility="normal",
                docs_alias_of=None,
            ),
        ]
        details = {
            "click": cli_reference.DetailLink(
                href="actions.md#action-click",
                label="Action: click",
                action_links=("click",),
                see_also=(("selectors.md#selector-flag-text", "Selectors"),),
            ),
        }

        rendered = cli_reference.render_reference(commands, details)

        self.assertIn("| [`click`](#command-click)", rendered)
        self.assertIn("[Action: click](actions.md#action-click)", rendered)
        self.assertIn("[`click`](actions.md#action-click)", rendered)
        self.assertIn("[Selectors](selectors.md#selector-flag-text)", rendered)

    def test_public_reference_fails_for_missing_detail_links(self) -> None:
        commands = [
            cli_reference.CommandInfo(
                name="snapshot",
                aliases=[],
                group="Device Interaction",
                summary="Get current Android UI hierarchy as XML",
                syntax=["snapshot"],
                flags=[],
                subcommands=[],
                docs_visibility="normal",
                docs_alias_of=None,
            ),
        ]

        with self.assertRaisesRegex(
            ValueError,
            "Missing command detail ownership for: snapshot",
        ):
            cli_reference.render_reference(commands, {})


class GenerateSelectorTableTests(unittest.TestCase):
    def test_known_flag_uses_explicit_documentation(self) -> None:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            description, note = selector_table.describe_flag("--selector")

        self.assertEqual(description, "Raw NodeMatcher JSON for an element.")
        self.assertEqual(
            note,
            "Mutually exclusive with shorthand element selector flags.",
        )
        self.assertEqual(captured, [])

    def test_unknown_flag_warns_and_uses_fallback_text(self) -> None:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            description, note = selector_table.describe_flag("--fancy-new-flag")

        self.assertEqual(description, "Element selector flag.")
        self.assertEqual(
            note,
            "May be combined with other shorthand selector flags.",
        )
        self.assertTrue(
            any(
                "Unrecognized selector flag --fancy-new-flag" in str(warning.message)
                for warning in captured
            )
        )


class GenerateErrorTableTests(unittest.TestCase):
    def test_error_anchor_uses_lowercase_kebab_case(self) -> None:
        self.assertEqual(
            error_table.anchor_for_code("NODE_NOT_FOUND"),
            "error-node-not-found",
        )


class GenerateLlmsFullTests(unittest.TestCase):
    def test_decodes_entities_inside_code_only(self) -> None:
        rendered = llms_full.decode_code_entities(
            "Use <code>SKILL_EXECUTION_&#x54;IMEOUT</code> but keep XML Network &amp; internet."
        )

        self.assertIn("<code>SKILL_EXECUTION_TIMEOUT</code>", rendered)
        self.assertIn("Network &amp; internet", rendered)

    def test_decodes_entities_inside_multiline_code_blocks(self) -> None:
        rendered = llms_full.decode_code_entities(
            '<pre><code>{\n  "code": "SKILL_EXECUTION_&#x54;IMEOUT"\n}</code></pre>'
        )

        self.assertIn('"code": "SKILL_EXECUTION_TIMEOUT"', rendered)


class ValidateDocsOrganizationTests(unittest.TestCase):
    def test_valid_anchor_link_has_no_warning(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build = root / "build"
            build.mkdir()
            (build / "target.md").write_text(
                '<a id="action-click"></a>\n## Click\n',
                encoding="utf-8",
            )
            (build / "source.md").write_text(
                "[Click](target.md#action-click)\n",
                encoding="utf-8",
            )

            warnings = docs_organization.check_internal_anchors(build)

        self.assertEqual(warnings, [])

    def test_missing_anchor_warns(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build = root / "build"
            build.mkdir()
            (build / "target.md").write_text("## Click\n", encoding="utf-8")
            (build / "source.md").write_text(
                "[Click](target.md#action-click)\n",
                encoding="utf-8",
            )

            warnings = docs_organization.check_internal_anchors(build)

        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0].kind, "anchor")
        self.assertIn("#action-click", warnings[0].message)

    def test_compatibility_selector_alias_warns_in_authored_docs(self) -> None:
        with TemporaryDirectory() as tmp:
            docs = Path(tmp)
            (docs / "api").mkdir()
            (docs / "api" / "actions.md").write_text(
                "Prefer --id, not --resource-id.\n",
                encoding="utf-8",
            )

            warnings = docs_organization.check_compatibility_aliases(docs)

        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0].kind, "compat-alias")
        self.assertIn("--resource-id", warnings[0].message)

    def test_generated_command_without_detail_link_warns(self) -> None:
        with TemporaryDirectory() as tmp:
            cli_reference = Path(tmp) / "cli.md"
            cli_reference.write_text(
                "| Command | Group | Primary syntax | Primary flags | Details | Summary |\n"
                "| --- | --- | --- | --- | --- | --- |\n"
                "| [`read`](#command-read) | Device | `read --text <text> \\| --id <id>` | - | - | Read |\n",
                encoding="utf-8",
            )

            warnings = docs_organization.check_generated_cli_details(cli_reference)

        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0].kind, "command-detail")
        self.assertIn("read", warnings[0].message)

    def test_generated_command_with_planned_detail_warns(self) -> None:
        with TemporaryDirectory() as tmp:
            cli_reference = Path(tmp) / "cli.md"
            cli_reference.write_text(
                "| Command | Group | Primary syntax | Primary flags | Details | Summary |\n"
                "| --- | --- | --- | --- | --- | --- |\n"
                "| [`recording`](#command-recording) | Execution | `recording export` | - | Planned: `recording.md` | Recording |\n",
                encoding="utf-8",
            )

            warnings = docs_organization.check_generated_cli_details(cli_reference)

        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0].kind, "command-detail")
        self.assertIn("recording", warnings[0].message)


if __name__ == "__main__":
    unittest.main()
