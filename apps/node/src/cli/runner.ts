import { PERSISTENT_CLI_COMMANDS } from "./persistentCliProtocol.cjs";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { createAndroperatorLogger } from "../adapters/logger.js";
import {
  COMMANDS,
  ON_SCREEN_LOG_FLAGS,
  UsageError,
  didYouMean,
  generateTopLevelHelp,
  resolveHelpFromRegistry,
  resolveSupportedFlagsFromRegistry,
  type HandlerContext,
} from "./registry.js";
import {
  expandSupportedFlagsWithAliases,
  normalizeCliFlagAliasesBeforeForwardSeparator,
  type CliFlagAliasSpec,
} from "./flagAliases.js";
import { shouldCliStdoutForceExitCode1 } from "./stdoutExitCode.js";
import { maybeShowStarHint } from "./starHint.js";

function levenshteinDistance(s1: string, s2: string): number {
  const track = Array(s2.length + 1).fill(null).map(() =>
    Array(s1.length + 1).fill(null));
  for (let i = 0; i <= s1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= s2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator);
    }
  }
  return track[s2.length][s1.length];
}

function similarityRatio(s1: string, s2: string): number {
  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - (dist / maxLen);
}

function findClosestFlagMatch(flag: string, candidates: Iterable<string>): { match?: string; score: number } {
  let match: string | undefined;
  let score = 0;
  for (const candidate of candidates) {
    const candidateScore = similarityRatio(flag, candidate);
    if (candidateScore > score) {
      score = candidateScore;
      match = candidate;
    }
  }
  return { match, score };
}

const FLAG_VALUE_ARITY = new Map<string, number>([
  ["--start", 2],
  ["--duration-ms", 1],
  ["--duration", 1],
  ["--cancel", 0],
  ["--end", 2],
  ...Object.keys(ON_SCREEN_LOG_FLAGS).map(flag => [flag, 1] as [string, number]),
  ["--device", 1],
  ["--device-id", 1],
  ["--operator-package", 1],
  ["--receiver-package", 1],
  ["--output", 1],
  ["--format", 1],
  ["--timeout", 1],
  ["--timeout-ms", 1],
  ["--log-level", 1],
  ["--apk", 1],
  ["--name", 1],
  ["--path", 1],
  ["--file", 1],
  ["--app", 1],
  ["--package", 1],
  ["--package-id", 1],
  ["--application-id", 1],
  ["--app-id", 1],
  ["--url", 1],
  ["--uri", 1],
  ["--key", 1],
  ["--button", 1],
  ["--direction", 1],
  ["--text", 1],
  ["--text-contains", 1],
  ["--id", 1],
  ["--resource-id", 1],
  ["--desc", 1],
  ["--content-desc", 1],
  ["--desc-contains", 1],
  ["--content-desc-contains", 1],
  ["--role", 1],
  ["--selector", 1],
  ["--container-text", 1],
  ["--container-text-contains", 1],
  ["--container-id", 1],
  ["--container-resource-id", 1],
  ["--container-desc", 1],
  ["--container-content-desc", 1],
  ["--container-desc-contains", 1],
  ["--container-content-desc-contains", 1],
  ["--container-role", 1],
  ["--container-selector", 1],
  ["--payload", 1],
  ["--execution", 1],
  ["--goal", 1],
  ["--skill-id", 1],
  ["--artifact", 1],
  ["--vars", 1],
  ["--summary", 1],
  ["--description", 1],
  ["--session-id", 1],
  ["--session", 1],
  ["--capability", 1],
  ["--limit", 1],
  ["--max-text-chars", 1],
  ["--wait-timeout-ms", 1],
  ["--out", 1],
  ["--input", 1],
  ["--baseline", 1],
  ["--result", 1],
  ["--mode", 1],
  ["--skill", 1],
  ["--label", 1],
  ["--label-text", 1],
  ["--label-id", 1],
  ["--label-desc", 1],
  ["--ref", 1],
  ["--port", 1],
  ["--host", 1],
  ["--bind", 1],
  ["--intent", 1],
  ["--keyword", 1],
  ["--expect-contains", 1],
  ["--coordinate", 2],
  ["--disable-star-suggestions", 0],
  ["--no-daemon", 0],
]);

const COMMANDS_ALLOW_LEADING_POSITIONAL = new Set([
  "exec",
]);

const GLOBAL_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--device", aliases: ["--device-id"] },
  { canonical: "--operator-package", aliases: ["--receiver-package"] },
  { canonical: "--output", aliases: ["--format"] },
  { canonical: "--timeout", aliases: ["--timeout-ms"] },
] as const;

function getGlobalOpts(argv: string[]): {
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  output: "json" | "pretty";
  /** True when the user set JSON output via --json or an explicit --output/--format json (not the CLI default). */
  explicitJsonOutput: boolean;
  verbose: boolean;
  noDaemon: boolean;
  rest: string[];
} {
  argv = normalizeCliFlagAliasesBeforeForwardSeparator(argv, GLOBAL_FLAG_ALIASES, FLAG_VALUE_ARITY);
  const rest: string[] = [];
  let deviceId: string | undefined;
  let operatorPackage: string | undefined;
  let timeoutMs: number | undefined;
  let logLevel: "debug" | "info" | "warn" | "error" | undefined;
  let output: "json" | "pretty" = "json";
  let explicitJsonOutput = false;
  let verbose = false;
  let noDaemon = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") {
      // Stop scanning for global flags. Push `--` and all remaining tokens to `rest` verbatim so
      // callers can forward them to subprocess scripts.
      rest.push(...argv.slice(i));
      break;
    } else if (argv[i] === "--device" && argv[i + 1]) {
      deviceId = argv[++i];
    } else if (argv[i] === "--operator-package") {
      const value = argv[i + 1];
      if (value === undefined || value.trim().length === 0 || value.startsWith("-")) {
        throw new UsageError("--operator-package requires a value");
      }
      operatorPackage = value;
      i++;
    } else if (argv[i] === "--json") {
      // json is explicit
      output = "json";
      explicitJsonOutput = true;
    } else if (argv[i] === "--output") {
      const next = argv[i + 1];
      if (next === undefined || next.trim().length === 0 || next.startsWith("-")) {
        throw new UsageError("--output requires a value: json or pretty");
      }
      if (next !== "json" && next !== "pretty") {
        throw new UsageError("--output must be one of: json, pretty");
      }
      i++;
      output = next;
      if (output === "json") {
        explicitJsonOutput = true;
      }
    } else if (argv[i] === "--timeout") {
      if (!argv[i + 1]) {
        throw new UsageError("--timeout requires a value");
      }
      timeoutMs = Number(argv[++i]);
    } else if (argv[i] === "--log-level") {
      if (!argv[i + 1]) {
        throw new UsageError("--log-level requires a value");
      }
      const value = argv[++i].toLowerCase();
      if (value === "debug" || value === "info" || value === "warn" || value === "error") {
        logLevel = value;
      } else {
        throw new UsageError("--log-level must be one of: debug, info, warn, error");
      }
    } else if (argv[i] === "--verbose") {
      verbose = true;
    } else if (argv[i] === "--disable-star-suggestions") {
      // consumed; hint module reads process.argv directly
    } else if (argv[i] === "--no-daemon") {
      noDaemon = true;
    } else {
      rest.push(argv[i]);
    }
  }
  return { deviceId, operatorPackage, timeoutMs, logLevel, output, explicitJsonOutput, verbose, noDaemon, rest };
}

/**
 * Tokens after the first forwarding `--` are passed through verbatim (for example to skill scripts).
 * A `--` that immediately follows a one-value flag is instead treated as the escape marker for a
 * literal value that starts with `--`, so scanning must skip over both tokens in that case.
 */
function argvPrefixBeforeForwardSeparator(argv: string[]): string[] {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--") {
      continue;
    }

    const previous = argv[i - 1];
    if (
      previous !== undefined
      && FLAG_VALUE_ARITY.get(previous) === 1
      && argv[i + 1] !== undefined
    ) {
      i += 1;
      continue;
    }

    return argv.slice(0, i);
  }

  return argv;
}

function resolveMcpServeArgs(argv: string[]): string[] | undefined {
  if (argv[0] === "mcp" && argv[1] === "serve") {
    return argv.slice(2);
  }

  return undefined;
}

async function runBody(argv: string[], io: CliIo): Promise<void> {
  const mcpArgs = resolveMcpServeArgs(argv);
  if (mcpArgs !== undefined) {
    try {
      await (await import("./commands/mcp.js")).cmdMcpServe(mcpArgs);
      return;
    } catch (error) {
      if (error instanceof UsageError) {
        io.stderr(`${JSON.stringify({ code: "USAGE", message: error.message })}\n`);
        exitCli(1);
      }
      throw error;
    }
  }
  if (argv.length === 0 || argv[0] === "help") {
    io.log(generateTopLevelHelp(COMMANDS));
    exitCli(0);
  }
  const argvForGlobalMeta = argvPrefixBeforeForwardSeparator(argv);
  if (argvForGlobalMeta.includes("--version")) {
    const pkg = require("../../package.json") as { version?: string };
    io.log(pkg.version ?? "0.1.0");
    if (io.starHints) await maybeShowStarHint("upgrade");
    exitCli(0);
  }

  let global: ReturnType<typeof getGlobalOpts>;
  try {
    global = getGlobalOpts(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.log(JSON.stringify({ code: "USAGE", message: error.message }));
      exitCli(1);
    }
    throw error;
  }
  if (argvForGlobalMeta.includes("--help")) {
    const requestedHelpCommand = global.rest.find(token => !token.startsWith("--"));
    if (requestedHelpCommand && !COMMANDS[requestedHelpCommand] && !Object.values(COMMANDS).some(def => def.synonyms?.includes(requestedHelpCommand))) {
      io.error(didYouMean(requestedHelpCommand, global.rest.slice(1), COMMANDS));
      exitCli(1);
    }
    io.log(resolveHelpFromRegistry(global.rest, COMMANDS));
    exitCli(0);
  }
  const [cmd, ...rest] = global.rest;
  if (cmd === undefined) {
    // All argv tokens were consumed as global flags; no command was given. Exit 0
    // (informational, not a caller error) so agent loops don't treat this as a failure.
    io.log(JSON.stringify({ code: "USAGE", message: "Use --help for available commands." }));
    exitCli(0);
  }
  const out = { format: global.output as "json" | "pretty", verbose: global.verbose };
  const disableAmbientRunId = cmd === "daemon" && rest[0] === "run";
  const logger = (io.createLogger ?? createAndroperatorLogger)({
    logDir: process.env.ANDROPERATOR_LOG_DIR,
    logLevel: global.logLevel ?? process.env.ANDROPERATOR_LOG_LEVEL,
    outputFormat: global.output,
    inheritRunId: !disableAmbientRunId,
  });

  let result: string | undefined;
  let usageParseError = false;

  try {
    if (!cmd) {
      // cmd is "" (explicit empty-string argument). The undefined case is handled
      // by the early guard above; this branch exists only for that edge case.
      result = JSON.stringify({ code: "USAGE", message: "Use --help for available commands." });
    } else {
      const def = COMMANDS[cmd] ?? Object.values(COMMANDS).find((c) => c.synonyms?.includes(cmd));
      if (def) {
        const globalFlags = [
          "--device", "--device-id", "--operator-package", "--receiver-package",
          "--json", "--output", "--format", "--log-level", "--timeout", "--timeout-ms",
          "--verbose", "--help", "--version", "--disable-star-suggestions", "--no-daemon"
        ];
        const flagAliases = typeof def.flagAliases === "function" ? def.flagAliases(rest) : (def.flagAliases ?? []);
        const normalizedRest = normalizeCliFlagAliasesBeforeForwardSeparator(rest, flagAliases, FLAG_VALUE_ARITY);
        const localFlags = expandSupportedFlagsWithAliases(resolveSupportedFlagsFromRegistry(def, rest), flagAliases);
        const knownFlags = new Set([...localFlags, ...globalFlags]);

        let firstUnknownFlag: string | undefined;
        // Don't flag-check after `--` (forwarded args)
        const restBeforeForward = argvPrefixBeforeForwardSeparator(rest);
        const allowsLeadingPositional = COMMANDS_ALLOW_LEADING_POSITIONAL.has(def.name);
        let consumedPositional = false;
        for (let i = 0; i < restBeforeForward.length; i += 1) {
          const arg = restBeforeForward[i];
          if (arg === "--") {
            break;
          }
          if (def.name === "exec" && rest[0] !== "best-effort" && arg === "--goal") {
            firstUnknownFlag = arg;
            break;
          }
          const valueArity = FLAG_VALUE_ARITY.get(arg);
          if (valueArity !== undefined && knownFlags.has(arg)) {
            if (
              valueArity === 1
              && restBeforeForward[i + 1] === "--"
              && restBeforeForward[i + 2] !== undefined
            ) {
              i += 2;
              continue;
            }
            i += valueArity;
            continue;
          }
          if (arg.startsWith("--")) {
            if (!knownFlags.has(arg) && allowsLeadingPositional && !consumedPositional) {
              const nextArg = restBeforeForward[i + 1];
              if (nextArg !== undefined && !nextArg.startsWith("--")) {
                firstUnknownFlag = arg;
                break;
              }
              consumedPositional = true;
              continue;
            }
            if (!knownFlags.has(arg)) {
              firstUnknownFlag = arg;
              break;
            }
            continue;
          }
          consumedPositional = true;
        }

        if (firstUnknownFlag) {
          const { match: bestMatch, score: bestScore } = findClosestFlagMatch(firstUnknownFlag, knownFlags);
          if (bestMatch && bestScore > 0.75) {
            result = JSON.stringify({ code: "USAGE", message: `unrecognized flag '${firstUnknownFlag}'. Did you mean '${bestMatch}'?` });
            usageParseError = true;
          } else {
            result = JSON.stringify({ code: "USAGE", message: `unrecognized flag '${firstUnknownFlag}'` });
            usageParseError = true;
          }
        } else {
          const ctx: HandlerContext = {
            argv,
            rest: normalizedRest,
            format: out.format,
            explicitJsonOutput: global.explicitJsonOutput,
            verbose: out.verbose,
            noDaemon: global.noDaemon,
            logger,
            deviceId: global.deviceId,
            operatorPackage: global.operatorPackage,
            timeoutMs: global.timeoutMs,
          };
          const handlerResult = await def.handler(ctx);
          if (handlerResult !== undefined) {
            result = handlerResult;
          }
        }
      } else {
        result = didYouMean(cmd, rest, COMMANDS);
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      usageParseError = true;
      result = JSON.stringify({ code: "USAGE", message: (error as Error).message });
    } else {
      throw error;
    }
  }

  if (result !== undefined) {
    io.log(result);
  }
  if (!usageParseError && (io.exitCode ?? 0) === 0) {
    // Determine CLI success using the same logic as exit-code selection (single source of truth)
    const cliSucceeded =
      result === undefined || !shouldCliStdoutForceExitCode1(result, usageParseError);
    // Doctor trigger: cmdDoctor sets io.exitCode before returning - relied on here
    if (cmd === "doctor" && (io.exitCode ?? 0) === 0) {
      if (io.starHints) await maybeShowStarHint("doctor");
    }
    // Upgrade trigger: fires once per version after any successful command or --version
    if (cliSucceeded) {
      if (io.starHints) await maybeShowStarHint("upgrade");
    }
  }
  if (typeof result === "string" && shouldCliStdoutForceExitCode1(result, usageParseError)) {
    io.exitCode = 1;
  }
}

class CliExit { constructor(readonly code: number) {} }
function exitCli(code: number): never { throw new CliExit(code); }

export interface CliIo {
  log(value: string): void;
  error(value: string): void;
  stderr(value: string): void;
  exitCode: number;
  starHints: boolean;
  createLogger?: typeof createAndroperatorLogger;
}

/** The same parser and registry run locally or with request-owned output sinks. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try { await runBody(argv, io); }
  catch (error) {
    if (error instanceof CliExit) io.exitCode = error.code;
    else { io.error(JSON.stringify({ code: "UNKNOWN", message: String(error) })); io.exitCode = 1; }
  }
  return io.exitCode;
}

export async function runLocalCli(argv: string[]): Promise<number> {
  return runCli(argv, {
    log: value => console.log(value), error: value => console.error(value),
    stderr: value => { process.stderr.write(value); },
    get exitCode() { return Number(process.exitCode ?? 0); },
    set exitCode(value: number) { process.exitCode = value; },
    starHints: true,
  });
}

/** Check before a daemon accepts any command, using the canonical global parser. */
export function isPersistentCliRequestEligible(argv: string[], deviceId: string | undefined): boolean {
  try {
    const options = getGlobalOpts(argv);
    return options.deviceId === deviceId && !options.noDaemon && PERSISTENT_CLI_COMMANDS.has(options.rest[0]);
  } catch { return false; }
}
