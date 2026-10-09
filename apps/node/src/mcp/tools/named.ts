import { SYSTEM_KEYS } from "../../contracts/keys.js";
import { dragParamsSchema } from "../../contracts/drag.js";
import { buildDragExecution } from "../../domain/actions/drag.js";
import { swipeParamsSchema } from "../../contracts/swipe.js";
import { buildSwipeExecution } from "../../domain/actions/swipe.js";
import { z } from "zod";
import { buildQueryExecution } from "../../domain/actions/query.js";
import { queryParamsSchema } from "../../domain/executions/validateExecution.js";
import { nodeMatcherJsonSchema } from "../schemas.js";
import type { Logger } from "../../adapters/logger.js";
import { buildClickExecution } from "../../domain/actions/click.js";
import { buildOpenAppExecution } from "../../domain/actions/openApp.js";
import { buildOpenUriExecution } from "../../domain/actions/openUri.js";
import { buildTypeTextExecution } from "../../domain/actions/typeText.js";
import { buildReadExecution } from "../../domain/actions/read.js";
import { buildPressKeyExecution } from "../../domain/actions/pressKey.js";
import { buildWaitExecution } from "../../domain/actions/wait.js";
import { buildScrollExecution } from "../../domain/actions/scroll.js";
import { buildScrollUntilExecution } from "../../domain/actions/scrollUntil.js";
import { buildMcpErrorResult } from "../errors.js";
import { buildReadSuccessResult, extractStepDataValue, parseReadAllResult } from "../results.js";
import { nonWhitespaceStringJsonSchema, selectorJsonSchema } from "../schemas.js";
import { createSessionDefaults, type SessionDefaults } from "../session.js";
import { mcpSelectorSchema } from "../selectors.js";
import type { McpToolDefinition } from "./index.js";
import {
  applyMcpExecutionMetadata,
  buildCommonExecutionSchema,
  buildExecutionSuccessPayload,
  buildSuccessResult,
  executionToolOptionsSchema,
  mapOptionalSelector,
  mapRequiredSelector,
  mergeWithSessionDefaults,
  parseToolArguments,
  runExecutionTool,
} from "./common.js";

const swipePointJsonSchema = {
  type: "object",
  properties: {
    x: { type: "integer", minimum: 0, maximum: 2147483647 },
    y: { type: "integer", minimum: 0, maximum: 2147483647 },
  },
  required: ["x", "y"],
  additionalProperties: false,
};

const swipeArgsSchema = swipeParamsSchema.innerType().extend(executionToolOptionsSchema.shape).strict().refine(
  value => value.start.x !== value.end.x || value.start.y !== value.end.y, "swipe start and end must differ");

const dragArgsSchema = dragParamsSchema.innerType().extend(executionToolOptionsSchema.shape).strict().refine(
  value => value.start.x !== value.end.x || value.start.y !== value.end.y, "drag start and end must differ");

const queryArgsSchema = executionToolOptionsSchema.merge(queryParamsSchema).strict();

const coordinateSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
}).strict();

const openArgsSchema = executionToolOptionsSchema.extend({
  appId: z.string().trim().min(1).optional(),
  uri: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  const hasAppId = value.appId !== undefined;
  const hasUri = value.uri !== undefined;
  if (hasAppId === hasUri) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "open requires exactly one of appId or uri",
      path: ["appId"],
    });
  }
});

const clickArgsSchema = executionToolOptionsSchema.extend({
  selector: mcpSelectorSchema.optional(),
  coordinate: coordinateSchema.optional(),
  clickType: z.enum(["default", "long_click", "focus"]).optional(),
  strict: z.boolean().optional(),
  container: mcpSelectorSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.coordinate !== undefined && (value.strict === true || value.container !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "coordinate click cannot use strict or container", path: ["coordinate"] });
  }
  const hasSelector = value.selector !== undefined;
  const hasCoordinate = value.coordinate !== undefined;
  if (hasSelector === hasCoordinate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "click requires exactly one of selector or coordinate",
      path: ["selector"],
    });
  }
});

const typeArgsSchema = executionToolOptionsSchema.extend({
  selector: mcpSelectorSchema,
  text: z.string().min(1),
  submit: z.boolean().optional(),
  clear: z.boolean().optional(),
  strict: z.boolean().optional(),
  container: mcpSelectorSchema.optional(),
}).strict();

const readArgsSchema = executionToolOptionsSchema.extend({
  selector: mcpSelectorSchema,
  all: z.boolean().optional(),
  container: mcpSelectorSchema.optional(),
  validator: z.literal("regex").optional(),
  validatorPattern: z.string().trim().min(1).optional(),
  strict: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.validator === "regex" && value.validatorPattern === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "validatorPattern is required when validator is \"regex\"",
      path: ["validatorPattern"],
    });
  }
});

const pressArgsSchema = executionToolOptionsSchema.extend({
  key: z.enum(SYSTEM_KEYS),
}).strict();

const waitArgsSchema = executionToolOptionsSchema.extend({
  selector: mcpSelectorSchema,
  strict: z.boolean().optional(),
  container: mcpSelectorSchema.optional(),
}).strict();

const scrollArgsSchema = executionToolOptionsSchema.extend({
  direction: z.enum(["down", "up", "left", "right"]),
  container: mcpSelectorSchema.optional(),
  strict: z.boolean().optional(),
}).strict();

const scrollUntilArgsSchema = executionToolOptionsSchema.extend({
  selector: mcpSelectorSchema,
  direction: z.enum(["down", "up", "left", "right"]),
  container: mcpSelectorSchema.optional(),
  clickAfter: z.boolean().optional(),
  strict: z.boolean().optional(),
}).strict();

const coordinateJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 },
  },
  required: ["x", "y"],
};

export function getNamedMcpTools(
  logger?: Logger,
  session: SessionDefaults = createSessionDefaults(),
): McpToolDefinition[] {
  return [
    {
      name: "query_ui",
      description: "Inspect fresh UI nodes, including blank labels and state. Omit matcher for all eligible nodes. Paths are observation-local, never action handles; visibility is not an occlusion guarantee. Does not wait for navigation; use wait for the destination before querying.",
      inputSchema: buildCommonExecutionSchema({
        matcher: nodeMatcherJsonSchema,
        visibility: { type: "string", enum: ["on_screen", "all"], default: "on_screen" },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
      }),
      handler: async (args) => {
        const opts = mergeWithSessionDefaults(parseToolArguments(queryArgsSchema, args), session);
        const execution = applyMcpExecutionMetadata(buildQueryExecution({
          matcher: opts.matcher, visibility: opts.visibility, limit: opts.limit,
        }), "query_ui", opts.timeoutMs);
        return await runExecutionTool(execution, opts, logger, result => {
          const extracted = extractStepDataValue(result.envelope, {
            actionType: "query_ui", dataKey: "query", errorKey: "error",
          });
          if (!extracted.ok) return buildMcpErrorResult({
            code: extracted.error, message: extracted.message, envelope: result.envelope,
            deviceId: result.deviceId, terminalSource: result.terminalSource,
          });
          return buildSuccessResult({ ...buildExecutionSuccessPayload(result), query: JSON.parse(extracted.value) });
        });
      },
    },
    {
      name: "open",
      description: "Open an Android application by package id or launch a URI.",
      inputSchema: {
        ...buildCommonExecutionSchema({
          appId: nonWhitespaceStringJsonSchema,
          uri: nonWhitespaceStringJsonSchema,
        }),
        oneOf: [
          { required: ["appId"], not: { required: ["uri"] } },
          { required: ["uri"], not: { required: ["appId"] } },
        ],
      },
      handler: async (args) => {
        const parsed = parseToolArguments(openArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const execution = applyMcpExecutionMetadata(opts.appId !== undefined
          ? buildOpenAppExecution(opts.appId)
          : buildOpenUriExecution(opts.uri!), "open", opts.timeoutMs);

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "swipe",
      description: "Swipe in a straight line between screen pixels, then release. Duration is required. Completion does not prove an app-specific effect.",
      inputSchema: buildCommonExecutionSchema({
        start: swipePointJsonSchema,
        end: swipePointJsonSchema,
        durationMs: { type: "integer", minimum: 1, maximum: 10000 },
      }, ["start", "end", "durationMs"]),
      handler: async (args) => {
        const opts = mergeWithSessionDefaults(parseToolArguments(swipeArgsSchema, args), session);
        const execution = applyMcpExecutionMetadata(buildSwipeExecution({ start: opts.start, end: opts.end, durationMs: opts.durationMs }), "swipe", opts.timeoutMs);
        return await runExecutionTool(execution, opts, logger, result => buildSuccessResult(buildExecutionSuccessPayload(result)));
      },
    },
    {
      name: "drag",
      description: "Hold at the start, move in a straight line without lifting, then release. Requires Android API 26. Both durations are required. Completion does not prove a successful drop.",
      inputSchema: buildCommonExecutionSchema({
        start: swipePointJsonSchema,
        end: swipePointJsonSchema,
        holdDurationMs: { type: "integer", minimum: 1, maximum: 10000 },
        moveDurationMs: { type: "integer", minimum: 1, maximum: 10000 },
      }, ["start", "end", "holdDurationMs", "moveDurationMs"]),
      handler: async (args) => {
        const opts = mergeWithSessionDefaults(parseToolArguments(dragArgsSchema, args), session);
        const execution = applyMcpExecutionMetadata(buildDragExecution({ start: opts.start, end: opts.end, holdDurationMs: opts.holdDurationMs, moveDurationMs: opts.moveDurationMs }), "drag", opts.timeoutMs);
        return await runExecutionTool(execution, opts, logger, result => buildSuccessResult(buildExecutionSuccessPayload(result)));
      },
    },
    {
      name: "click",
      description: "Click a matching node or absolute screen coordinate.",
      inputSchema: {
        ...buildCommonExecutionSchema({
          selector: selectorJsonSchema,
          strict: { type: "boolean" },
          container: selectorJsonSchema,
          coordinate: coordinateJsonSchema,
          clickType: { type: "string", enum: ["default", "long_click", "focus"] },
        }),
        oneOf: [
          { required: ["selector"], not: { required: ["coordinate"] } },
          { required: ["coordinate"], not: { anyOf: [
            { required: ["selector"] }, { required: ["container"] },
            { required: ["strict"], properties: { strict: { const: true } } },
          ] } },
        ],
      },
      handler: async (args) => {
        const parsed = parseToolArguments(clickArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const matcher = opts.selector !== undefined ? mapRequiredSelector(opts.selector, "selector") : undefined;

        const execution = applyMcpExecutionMetadata(
          buildClickExecution(matcher, opts.clickType ?? "default", opts.coordinate, opts.strict, mapOptionalSelector(opts.container, "container")),
          "click",
          opts.timeoutMs,
        );

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "type",
      description: "Type text into a matching field, optionally clearing first or submitting after. Step data reports text_entry, submission, and submit_method separately; accepted submission does not verify navigation. Observe the destination before declaring success.",
      inputSchema: buildCommonExecutionSchema({
        selector: selectorJsonSchema,
        strict: { type: "boolean" },
        container: selectorJsonSchema,
        text: { type: "string", minLength: 1 },
        submit: { type: "boolean" },
        clear: { type: "boolean" },
      }, ["selector", "text"]),
      handler: async (args) => {
        const parsed = parseToolArguments(typeArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const selector = mapRequiredSelector(opts.selector, "selector");

        const execution = applyMcpExecutionMetadata(buildTypeTextExecution({
          selector,
          text: opts.text,
          submit: opts.submit,
          clear: opts.clear,
          strict: opts.strict,
          container: mapOptionalSelector(opts.container, "container"),
        }), "type", opts.timeoutMs);

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "read",
      description: "Read text from a matching node, optionally returning all matches. Supports regex validation via validator and validatorPattern.",
      inputSchema: buildCommonExecutionSchema({
        selector: selectorJsonSchema,
        strict: { type: "boolean" },
        all: { type: "boolean" },
        container: selectorJsonSchema,
        validator: { type: "string", enum: ["regex"] },
        validatorPattern: nonWhitespaceStringJsonSchema,
      }, ["selector"]),
      handler: async (args) => {
        const parsed = parseToolArguments(readArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const selector = mapRequiredSelector(opts.selector, "selector");

        const container = mapOptionalSelector(opts.container, "container");

        const execution = applyMcpExecutionMetadata(
          buildReadExecution({
            selector,
            readAll: opts.all,
            strict: opts.strict,
            container,
            validator: opts.validator,
            validatorPattern: opts.validatorPattern,
          }),
          "read",
          opts.timeoutMs,
        );

        return await runExecutionTool(execution, opts, logger, (result) => {
          const extracted = extractStepDataValue(result.envelope, {
            actionType: "read_text",
            dataKey: "text",
            errorKey: "error",
          });
          if (!extracted.ok) {
            return buildMcpErrorResult({
              code: extracted.error,
              message: extracted.message,
              envelope: result.envelope,
              deviceId: result.deviceId,
              terminalSource: result.terminalSource,
            });
          }

          if (opts.all) {
            const parsedReadAll = parseReadAllResult(extracted.value);
            if (!parsedReadAll.ok) {
              return buildMcpErrorResult({
                code: parsedReadAll.code,
                message: parsedReadAll.message,
                envelope: result.envelope,
                deviceId: result.deviceId,
                terminalSource: result.terminalSource,
              });
            }
            return buildReadSuccessResult(parsedReadAll.values, extracted.step.data?.selection_warning);
          }

          return buildReadSuccessResult(extracted.value, extracted.step.data?.selection_warning);
        });
      },
    },
    {
      name: "press",
      description: "Press an Android navigation key, TV remote button, or Automotive rotary input. Automotive rotation is one detent and requires AAOS car_service. TV icon buttons match the emulator remote: profile sends notification; settings and tv launch activities.",
      inputSchema: buildCommonExecutionSchema({
        key: { type: "string", enum: [...SYSTEM_KEYS] },
      }, ["key"]),
      handler: async (args) => {
        const parsed = parseToolArguments(pressArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const execution = applyMcpExecutionMetadata(
          buildPressKeyExecution(opts.key),
          "press",
          opts.timeoutMs,
        );

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "wait",
      description: "Wait until a matching node appears.",
      inputSchema: buildCommonExecutionSchema({
        selector: selectorJsonSchema,
        strict: { type: "boolean" },
        container: selectorJsonSchema,
      }, ["selector"]),
      handler: async (args) => {
        const parsed = parseToolArguments(waitArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const selector = mapRequiredSelector(opts.selector, "selector");
        const waitExecution = buildWaitExecution(selector, opts.timeoutMs, opts.strict, mapOptionalSelector(opts.container, "container"));

        const execution = applyMcpExecutionMetadata(
          waitExecution,
          "wait",
          waitExecution.timeoutMs,
        );

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "scroll",
      description: "Perform one scroll in a freshly resolved container. Strict mode requires unique selection.",
      inputSchema: buildCommonExecutionSchema({
        direction: { type: "string", enum: ["down", "up", "left", "right"] },
        container: selectorJsonSchema,
        strict: { type: "boolean" },
      }, ["direction"]),
      handler: async (args) => {
        const opts = mergeWithSessionDefaults(parseToolArguments(scrollArgsSchema, args), session);
        const execution = applyMcpExecutionMetadata(buildScrollExecution(
          opts.direction, opts.timeoutMs, mapOptionalSelector(opts.container, "container"), opts.strict,
        ), "scroll", opts.timeoutMs);
        return runExecutionTool(execution, opts, logger, result => buildSuccessResult(buildExecutionSuccessPayload(result)));
      },
    },
    {
      name: "scroll_until",
      description: "Scroll in the given direction until a matching node is visible, optionally clicking it afterward.",
      inputSchema: buildCommonExecutionSchema({
        selector: selectorJsonSchema,
        strict: { type: "boolean" },
        direction: { type: "string", enum: ["down", "up", "left", "right"] },
        container: selectorJsonSchema,
        clickAfter: { type: "boolean" },
      }, ["selector", "direction"]),
      handler: async (args) => {
        const parsed = parseToolArguments(scrollUntilArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const selector = mapRequiredSelector(opts.selector, "selector");

        const container = mapOptionalSelector(opts.container, "container");

        const execution = applyMcpExecutionMetadata(buildScrollUntilExecution(
          opts.direction,
          selector,
          container,
          opts.clickAfter ?? false,
          opts.timeoutMs ?? 30_000,
          opts.strict,
        ), "scroll_until", opts.timeoutMs ?? 30_000);

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "scroll_and_click",
      description: "Scroll in the given direction until a matching node is visible, optionally clicking it afterward.",
      inputSchema: buildCommonExecutionSchema({
        selector: selectorJsonSchema,
        strict: { type: "boolean" },
        direction: { type: "string", enum: ["down", "up", "left", "right"] },
        container: selectorJsonSchema,
        clickAfter: { type: "boolean" },
      }, ["selector", "direction"]),
      handler: async (args) => {
        const parsed = parseToolArguments(scrollUntilArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        const selector = mapRequiredSelector(opts.selector, "selector");

        const container = mapOptionalSelector(opts.container, "container");

        const execution = applyMcpExecutionMetadata(buildScrollUntilExecution(
          opts.direction,
          selector,
          container,
          opts.clickAfter ?? true,
          opts.timeoutMs ?? 30_000,
          opts.strict,
        ), "scroll_and_click", opts.timeoutMs ?? 30_000);

        return await runExecutionTool(execution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
  ];
}
