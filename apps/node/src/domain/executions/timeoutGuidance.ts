interface TimeoutGuidanceContext {
  deviceId?: string;
  operatorPackage?: string;
}

interface TimeoutGuidanceDiagnostics {
  broadcastDispatchStatus?: string;
  lastCorrelatedEvents?: readonly string[];
}

function isBroadcastDispatchSent(status?: string): boolean {
  return /^sent($|:)/.test(status ?? "");
}

export function buildResultEnvelopeTimeoutHint(
  diagnostics: TimeoutGuidanceDiagnostics,
  context: TimeoutGuidanceContext
): string | undefined {
  if (!isBroadcastDispatchSent(diagnostics.broadcastDispatchStatus)) {
    return undefined;
  }

  if ((diagnostics.lastCorrelatedEvents?.length ?? 0) > 0) {
    return undefined;
  }

  const doctorArgs = ["androperator", "doctor"];
  if (context.deviceId !== undefined) {
    doctorArgs.push("--device", context.deviceId);
  }
  if (context.operatorPackage !== undefined) {
    doctorArgs.push("--operator-package", context.operatorPackage);
  }

  return [
    "No correlated Android log lines were captured.",
    "This often indicates an APK/CLI version mismatch or an accessibility service issue.",
    `Run '${doctorArgs.join(" ")}' to diagnose.`,
  ].join(" ");
}
