# Node API Design: Guiding Principles

Audience: agents and developers implementing or extending the Androperator CLI
and Node API. Read this before designing a new command, flag, or output format.
Review it after implementation to verify compliance.

---

## The API Is the Product

Androperator is an actuator. Its value is entirely mediated through its API. The
Android receiver, the accessibility service, the execution engine - all of these
exist in service of the CLI and Node API that agents call. If the API is hard to
use, none of the underlying capability matters.

The primary consumer of this API is not a human developer reading docs. It is an
LLM agent that has never seen Androperator before, operating under token pressure,
making decisions about which commands to try based on training data from other
tools. Design every surface for that consumer first.

---

## Why Agent UX Requires Deliberate Design

The following excerpt from Steve Yegge's
"[Six New Tips for Better Coding with Agents](https://steve-yegge.medium.com/six-new-tips-for-better-coding-with-agents-d4e9c86e42a9)"
(March 2025) captures the core problem:

> Agent UX matters at least as much as Human UX
>
> One of the interesting themes I heard at the AI Engineering Conference in NYC
> a couple weeks ago was that although many people are building tools for AIs,
> they are finding it very hard to get the AIs to use those tools.
>
> It's tricky to get AI to use a tool it's not trained on. They have certain
> ways of thinking and working, and they tend to reach for familiar tools (e.g.
> grep instead of a fancier search). I've talked with many people who wanted to
> build a tool for their agents to use, and they'd work with the frontier models
> to design the perfect agent-friendly interface - one the models swore up and
> down would get them to use it.
>
> And then haha, no, the agents don't use it. You prompt and prompt, they ignore
> and ignore. So what do you do? How do you get them to use your tools?
>
> [...]
>
> For the agent side, once we had the initial structure in place (the issue
> tracker itself), the primary UX issue became tooling ergonomics. My agents
> were trying to use Beads, but they kept giving it the wrong arguments. For
> example, they'd use --body instead of --description when filing an issue,
> which would fail. Why? Because they were trained on GH Issues, and GHI's CLI
> tool uses --body for filing issues. Reaching for the familiar again!
>
> So in that particular case, told it to add --body as an alias for
> --description, which it did, and that bit of Agent UX friction went away
> forever. I've done this many, many times in Beads. As the agent works, I watch
> how it's using the tool, and whenever it encounters an error, I ask it, how did
> you want it to work there? How can we change it to make the behavior be more
> easily guessable?
>
> Over the past few months we've made dozens of tweaks, adding flags and
> commands, and the agents now rarely have trouble using Beads fluently.

This is directly applicable to Androperator. The lesson is not "add lots of
aliases." The lesson is: **the command an agent tries first, based on intuition
from other tools, should work.** When it does not, the fix is to change the API,
not to write better documentation for the existing API.

---

## Principles

### 1. Guessability Over Taxonomy

If an agent has to read help text to find the right command, the API has already
failed once. The command surface should be guessable from general knowledge of
CLI tools, mobile automation, and common English verbs.

**Test:** imagine an agent that has read a one-sentence description of
Androperator ("CLI tool for automating Android devices") and nothing else. What
commands would it try? Those commands should work.

Anti-pattern (removed - do not use): deprecated nested command families are not supported. They are not documented here as runnable examples because agents and crawlers sometimes copy code blocks verbatim.

Good (current):
```
androperator open com.android.settings
androperator snapshot
androperator click --text "Wi-Fi"
```

### 2. Flat Commands for Actions, Namespaces Only for Subsystems

Every device interaction verb should be a top-level command. Namespaces are
reserved for subsystems with shared lifecycle or state management (e.g. `recording` and
`emulator`).

**The rule:** if a command is a single action with no siblings that share state,
it is a top-level command. If it is one of several operations on a shared
resource, it belongs in a namespace.

- `click` - top-level (single action)
- `emulator create`, `emulator start`, `emulator stop` - namespace (shared
  lifecycle)

Do not create namespaces for organizational convenience. `action` and `observe`
were organizational namespaces that leaked implementation taxonomy into the
public API. They doubled the search space for every command.

### 3. Familiar Vocabulary First

Agents are trained on existing tools. When the same verb means the same thing,
use the same verb. When two communities use different verbs for the same action,
accept both.

Sources agents draw from:
- **Playwright:** `click`, `fill`, `screenshot`, `tap` (mobile)
- **adb:** `shell`, `devices`, `install`
- **GitHub CLI:** `--json`, `list`, `run`, `status`
- **General CLI conventions:** positional arguments for the primary target,
  `--flag` for modifiers, `--help` for usage

When naming a new command or flag, ask: "What would an agent type if it had used
Playwright yesterday and is using Androperator today?" Use that name as the
primary. Accept other reasonable guesses as synonyms.

Note: this does not mean blindly copying Playwright names. Playwright uses
`fill` for text entry, but `type` is a shorter, more universal verb that agents
reach for first. Androperator uses `type` as the primary name and accepts `fill`
as a synonym. Apply the same judgment to each case: familiarity is a signal, not
a mandate.

### 4. One Primary Name, Accept Synonyms

Every command and flag has one canonical name used in docs, help text, and
examples. Synonyms are accepted by the parser but not documented prominently.
This avoids decision paralysis in docs while remaining forgiving in practice.

- Document: `click`. Accept: `tap`.
- Document: `type`. Accept: `fill`.
- Document: `press`. Accept: `press-key`.
- Document: `--device`. Accept: `--device-id`.
- Document: JSON output as the default. Prefer `--output json` when explicit
  JSON selection is needed. Accept `--format json` and `--json` as aliases.

When adding a new command, choose the primary name by asking: which name would
an agent try first? That is the primary. Any other reasonable name is a synonym.

### 5. Simple Arguments Over Structured Input

The most common usage of a command should require no JSON, no complex quoting,
and no knowledge of internal schema. JSON input should be the advanced escape
hatch, not the default path.

Bad:
```
androperator click --selector '{"text":"Login"}'
androperator type --selector '{"contentDescription":"Search"}' --text "hello"
```

Good:
```
androperator click --text "Login"
androperator type "hello" --desc "Search"
```

**Rules for new commands:**
- If the command has one obvious primary argument, make it positional:
  `open <target>`, `press <key>`, `type <text>`, `scroll <direction>`
- If the command targets a UI element, accept `--text`, `--id`, `--desc`,
  `--role` as simple selector flags
- Reserve `--selector <json>` for multi-field matchers that cannot be expressed
  with simple flags

### 6. Short, Generic Flag Names

Agents guess short, generic flags based on training data from other tools. Use
the shortest unambiguous name.

- `--device` not `--device-id`
- default JSON output first; `--output json` is the preferred explicit spelling
- use the canonical timeout flag form only
- `--operator-package` not `--operator-package` ("receiver" is an Android
  implementation detail; "operator" is Androperator's own terminology)
- `--text` not `--text-equals`
- `--desc` not `--content-description`

When the short name could be ambiguous, prefer clarity over brevity. But the
threshold for "ambiguous" is high - `--device` is not ambiguous in a tool that
targets one device at a time.

When adding a new flag, accept the old verbose form as a silent alias if one
exists. Do not show the old form in help text.

### 7. Errors Must Teach

Every error message is a learning opportunity. An agent that gets an error should
be able to fix its command on the next attempt without reading docs.

**Every error must include:**
1. What went wrong (specific, not generic)
2. What the valid options are (list them)
3. An example of the correct usage

Bad:
```
Error: Missing required option
```

Good:
```
Error: click requires a selector.

Use one of:
  --text <text>           Exact visible text
  --id <resource-id>      Android resource ID
  --desc <text>           Content description
  --role <role>           Element role

Example:
  androperator click --text "Wi-Fi"
```

**"Did you mean?" guidance:** when an agent uses a removed or misspelled
command, suggest the correct one. When an agent uses a wrong flag name, suggest
the closest match. This is not optional polish - it is a core requirement for
agent recovery.

### 8. Deterministic Behavior Over Convenience Heuristics

Androperator is an actuator, not an assistant. Commands must behave identically
given identical inputs. Do not add "smart" behavior that varies based on context
unless the variation is explicitly controlled by a flag.

- If multiple elements match a selector, always select the first in
  accessibility traversal order. Do not guess which one the agent "probably"
  meant.
- If an argument is ambiguous, error rather than guess. Explicit is better than
  clever.
- If a flag has a default value, document it. Do not change defaults based on
  context.

The one exception is `open`, where target detection (`https://` -> URL, `*://`
-> URI, else package) is deterministic and based on string format, not runtime
context.

### 9. Output Is Also API

The output of every command is consumed by an agent, not read by a human. Both
the human-readable (pretty) and machine-readable (JSON) output formats are API
surfaces.

**Rules:**
- Default output must be parseable by `JSON.parse()` with no surrounding text
- Default JSON output schema must be stable - adding fields is fine, removing
  or renaming fields is a breaking change
- Pretty output should be scannable but is not a contract - agents should use
  default JSON for programmatic consumption
- Error output in default JSON mode must also be valid JSON with a consistent
  error schema
- `--output json` is the preferred explicit JSON form; `--format json` and
  `--json` remain accepted aliases

### 10. Implementation Details Are Not API

Flag names, command names, and output schemas should reflect what the agent
wants to do, not how Androperator does it internally.

Bad examples of implementation leaking into API:
- `--operator-package` (agent does not know what a "receiver" is; renamed to
  `--operator-package` which uses Androperator's own terminology)
- `snapshot` (flat command - no nested namespace)
- `open` (direct verb - the agent wants to open something)
- `RESULT_ENVELOPE_TIMEOUT` (useful in logs, not in agent-facing errors)

When adding a new command, ask: "Would an agent who has never read the Androperator
source code understand what this flag/command/output field means?" If not, rename
it at the API boundary. Internal names can differ from external names.

---

## Checklist for New Commands and Flags

Before merging any CLI or API change, verify:

- [ ] **Guessability:** would an agent try this name without reading help text?
- [ ] **Positional arguments:** does the primary target have a positional form?
- [ ] **Flag names:** are they the shortest unambiguous names? Do they match
      conventions from Playwright, adb, or GitHub CLI?
- [ ] **Synonyms:** are reasonable alternative names accepted? Is there exactly
      one primary name for docs?
- [ ] **Selector flags:** if the command targets a UI element, does it accept
      `--text`, `--id`, `--desc`, `--role` in addition to `--selector`?
- [ ] **Error messages:** does every failure path include what went wrong, valid
      options, and an example?
- [ ] **"Did you mean?":** if this command replaces or renames an old one, does
      the old name produce a helpful redirect error?
- [ ] **JSON output:** is default output valid JSON with a stable schema, and
      do `--output json`, `--format json`, and `--json` still work?
- [ ] **No implementation leaks:** do all external names make sense to an agent
      that has never read the source?
- [ ] **Deterministic:** does the command behave identically given identical
      inputs?

## Keep daemon clients independent of direct execution loading

Normal CLI commands should not load the direct device execution implementation
before trying the existing daemon. Command construction and validation remain in
the caller; `domain/executions/lazyExecution.ts` loads the canonical direct runtime
only when an existing direct-execution or fallback path actually calls it. Builders
shared with direct domain helpers must preserve this import boundary too. Importing
a builder must not pull in screenshot capture, result readers or device readiness.

The CLI registry also defers emulator storage normalization until an emulator
command needs it. Ordinary device commands and help must not load the emulator
implementation simply to construct the command registry.

This is a loading optimization, not a new execution protocol. Preserve daemon
ownership/build checks, validation, command/task correlation, caller-relative file
handling, stdout/stderr and exit classification. In particular, a returned daemon
failure is still a failure; loading direct execution must never introduce a replay
after uncertain dispatch. `--no-daemon`, unsupported-daemon paths and eligible
pre-dispatch fallback continue through the same canonical runtime. Test import
boundaries in a fresh process so another test's module cache cannot hide eager
loading regressions.
