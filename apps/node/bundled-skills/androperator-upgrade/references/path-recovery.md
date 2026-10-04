# Resolve missing commands before reinstalling

Exit code `127` means the current shell cannot find a command, not that the
machine lacks it. Inspect `PATH` and use `command -v` for `androperator`, `node`,
`npm`, `java`, `adb` and `brew` as relevant to the failing check.

On macOS, check `/opt/homebrew/bin/brew --version` and
`/usr/local/bin/brew --version` before concluding Homebrew is absent. If found
outside PATH, activate the discovered binary's environment for this sequence:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Use `/usr/local/bin/brew shellenv` instead when that is the discovered path.
Retry the bare commands in the repaired environment. Return to the CLI-first
upgrade route if the CLI and prerequisites now work; use the recovery installer
only if reachability or bootstrap prerequisites still fail.
