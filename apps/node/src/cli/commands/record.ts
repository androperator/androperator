import { runExecution } from "../../domain/executions/runExecution.js";
import { buildStartRecordingExecution } from "../../domain/actions/startRecording.js";
import { buildStopRecordingExecution } from "../../domain/actions/stopRecording.js";
import { pullRecording } from "../../domain/recording/pullRecording.js";
import {
  exportRecordingFile,
} from "../../domain/recording/exportRecording.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { OutputOptions } from "../output.js";
import { formatSuccess, formatError } from "../output.js";
import type { Logger } from "../../adapters/logger.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import type { RecordingExportSnapshotMode } from "../../domain/recording/recordingEventTypes.js";

function buildRecordingAlreadyInProgressHint(options: {
  sessionId?: string;
  deviceId?: string;
  operatorPackage?: string;
}): string {
  const deviceArg = options.deviceId ?? "<device_serial>";
  const operatorPackageArg = options.operatorPackage ?? "<package>";
  const sessionIdArg = options.sessionId ?? "<session_id>";
  return `Run 'androperator recording stop --session-id ${sessionIdArg} --device ${deviceArg} --operator-package ${operatorPackageArg}' before starting a new recording.`;
}

function addRecordingAlreadyInProgressHintToEnvelope(
  envelope: {
    stepResults?: Array<{
      data?: import("../../contracts/result.js").StepResultData;
    }>;
    hint?: string;
  },
  options: {
    sessionId?: string;
    deviceId?: string;
    operatorPackage?: string;
  }
): void {
  const activeStep = envelope.stepResults?.find(step => step.data?.error === ERROR_CODES.RECORDING_ALREADY_IN_PROGRESS);
  if (!activeStep?.data) {
    return;
  }
  const hint = buildRecordingAlreadyInProgressHint({
    sessionId: activeStep.data.sessionId,
    deviceId: options.deviceId,
    operatorPackage: options.operatorPackage,
  });
  activeStep.data.hint = hint;
  envelope.hint = hint;
}

export async function cmdRecordStart(options: {
  format: OutputOptions["format"];
  sessionId?: string;
  deviceId?: string;
  operatorPackage?: string;
  logger?: Logger;
}, deps: {
  runExecutionImpl?: typeof runExecution;
} = {}): Promise<string> {
  try {
    const execution = buildStartRecordingExecution(options.sessionId);
    const result = await (deps.runExecutionImpl ?? runExecution)(execution, {
      deviceId: options.deviceId,
      operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
      warn: message => process.stderr.write(message),
      logger: options.logger,
    });
    if (result.ok) {
      addRecordingAlreadyInProgressHintToEnvelope(result.envelope, {
        deviceId: result.deviceId ?? options.deviceId,
        operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
      });
      return formatSuccess(
        {
          envelope: result.envelope,
          deviceId: result.deviceId,
          terminalSource: result.terminalSource,
          isCanonicalTerminal: result.terminalSource === "androperator_result",
        },
        options
      );
    }
    return formatError(result.error, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdRecordStop(options: {
  format: OutputOptions["format"];
  sessionId?: string;
  deviceId?: string;
  operatorPackage?: string;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildStopRecordingExecution(options.sessionId);
    const result = await runExecution(execution, {
      deviceId: options.deviceId,
      operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
      warn: message => process.stderr.write(message),
      logger: options.logger,
    });
    if (result.ok) {
      return formatSuccess(
        {
          envelope: result.envelope,
          deviceId: result.deviceId,
          terminalSource: result.terminalSource,
          isCanonicalTerminal: result.terminalSource === "androperator_result",
        },
        options
      );
    }
    return formatError(result.error, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdRecordPull(options: {
  format: OutputOptions["format"];
  sessionId?: string;
  outputDir: string;
  deviceId?: string;
  operatorPackage?: string;
  logger?: Logger;
}): Promise<string> {
  try {
    const config = getDefaultRuntimeConfig({
      logger: options.logger,
      deviceId: options.deviceId,
      operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
    });

    const { localPath, sessionId } = await pullRecording(config, {
      sessionId: options.sessionId,
      outputDir: options.outputDir,
    });

    return formatSuccess({ ok: true, localPath, sessionId }, options);
  } catch (e) {
    return formatError(e, options);
  }
}


export async function cmdRecordExport(options: {
  format: OutputOptions["format"];
  inputFile: string;
  outputFile?: string;
  snapshotMode?: RecordingExportSnapshotMode;
}): Promise<string> {
  try {
    const result = await exportRecordingFile(
      options.inputFile,
      options.outputFile,
      options.snapshotMode ?? "omit",
    );

    return formatSuccess({
      ok: true,
      outputFile: result.outputFile,
      sessionId: result.exportData.session.sessionId,
      eventCount: result.exportData.counts.totalEvents,
      packageTransitionCount: result.exportData.packageTransitions.length,
      byType: result.exportData.counts.byType,
    }, options);
  } catch (e) {
    return formatError(e, options);
  }
}
