# Personalized Skills Follow-Up

## Purpose

Track follow-up work that was discovered while closing
`tasks/skills/personalized-skills` and that does not belong in the completed
PR-1 cleanup.

The durable public policy now lives in `docs/skills/personalized-skills.md`.
This task is only for remaining downstream or cross-repo cleanup.

## Follow-Up Items

| ID | Owning repo or surface | Path or scope | Required action | Validation |
| --- | --- | --- | --- | --- |
| PS-FOLLOWUP-1 | OpenClaw personal workspace | `~/.openclaw/workspace/skills/home-get-solax-battery/` | Replace or retire the older ActionTask-oriented battery skill after `home-battery-get-level` is accepted as the personal wrapper. | `openclaw skills list --eligible --json`; `openclaw skills info home-battery-get-level --json`; safe OpenClaw forward call once a session target is configured. |
| PS-FOLLOWUP-2 | OpenClaw personal workspace | `~/.openclaw/workspace/skills/home-get-globird-usage/` | Replace or retire the older ActionTask-oriented GloBird skill after `home-energy-get-yesterday-usage-cost` is accepted as the personal wrapper. | `openclaw skills list --eligible --json`; `openclaw skills info home-energy-get-yesterday-usage-cost --json`; safe OpenClaw forward call once a session target is configured. |
| PS-FOLLOWUP-3 | OpenClaw personal workspace | `~/.openclaw/workspace/skills/home-set-aircon/` and `~/.openclaw/workspace/skills/home-get-aircon-status/` | Replace older ActionTask-oriented HVAC guidance with `home-hvac-control` if the unified wrapper is accepted for the personal surface. | `openclaw skills list --eligible --json`; `openclaw skills info home-hvac-control --json`; safe OpenClaw forward call once a session target is configured. |
| PS-FOLLOWUP-4 | `<workspace>` | SolaX, GloBird, Netflix, and AirTouch runtime skill docs | Consider adding a short cross-reference to `docs/skills/personalized-skills.md`, especially where runtime skills are commonly wrapped by personalized host-agent skills. | Sibling repo docs/test workflow. |

## Current Status

- `docs/skills/personalized-skills.md` defines the skill taxonomy and the
  local-versus-shared policy.
- The four personal wrappers were created under `~/.agents/skills/` and
  committed in the owning personal repo during the original task.
- This follow-up does not block merging the `skills/user-skills` branch.
