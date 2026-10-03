# Install Validation

This directory contains the install-specific validation harnesses for the
shell bootstrap wrapper in `sites/landing-clawperator/public/install.sh`.

## Entry Point

Run the full installer regression suite from the repo root with:

```bash
./validation/install/test_install.sh
```

This is the expected validation command for changes to `install.sh`.

Prerequisite for local runs:

```bash
npm --prefix apps/node ci
```

The suite builds and tests `apps/node`, but it does not install Node
dependencies for you.

## Harnesses

- `test_install.sh`
  - suite runner for the install-specific tests
  - builds the Node package, runs the install-related Node tests, then runs the
    shell harnesses in this directory plus `validation/test_doctor.sh`
- `test_skill_md.sh`
  - validates the public `sites/landing-clawperator/public/skill.md` and
    `sites/landing-clawperator/public/agents.md` setup contract
  - guards package name, Node requirement, setup commands, local host artifacts,
    landing redirects, discovery links, sitemap entries, and out-of-scope
    strings
- `test_java.sh`
  - covers `check_java()` detection and provisioning branches
- `test_cli_bootstrap.sh`
  - covers shell-owned `install_cli()` npm-prefix resolution and freshly
    installed CLI binary selection
- `test_main_delegation.sh`
  - covers hermetic `main()` smoke paths for bootstrap gating, delegation to
    `clawperator install`, and top-level exit-code/message propagation

## Maintenance Rule

When a change adds or changes behavior in `sites/landing-clawperator/public/install.sh`,
update or add the matching coverage here in the same change. Do not rely on the
existing harnesses as generic coverage for new install branches.

Common examples:

- new bootstrap prerequisite branch
  - extend `test_java.sh` or `test_main_delegation.sh`
- new install delegation behavior or passthrough messaging
  - extend `test_main_delegation.sh`
- changes to bootstrap-time CLI resolution
  - extend `test_cli_bootstrap.sh`
- new `main()` branch or shell-owned summary outcome
  - extend `test_main_delegation.sh`
- installer RC or environment cleanup
  - add a shell harness case that proves the old shell-side mutation is gone

Keep install-specific validation in `validation/install/` and wire any new
harness into `test_install.sh` so the suite remains the single obvious
entrypoint.
