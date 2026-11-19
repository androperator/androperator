import type { RuntimeConfig } from "./runtimeConfig.js";
import { runAdb } from "./adbClient.js";

function singleQuoteForDeviceShell(value: string): string {
  // Device-side shell-safe single-quoted literal: 'foo'"'"'bar'
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildBroadcastShellCommand(config: RuntimeConfig, payloadJson: string, foregroundReceiver = true): string {
  const action = singleQuoteForDeviceShell(config.actionAgentCommand);
  const operatorPackage = singleQuoteForDeviceShell(config.operatorPackage);
  const payloadKey = singleQuoteForDeviceShell(config.payloadExtraKey);
  const payload = singleQuoteForDeviceShell(payloadJson.replace(/\n/g, ""));

  const user = config.androidUserId === undefined ? "" : ` --user ${singleQuoteForDeviceShell(String(config.androidUserId))}`;
  const priority = foregroundReceiver ? " --receiver-foreground" : "";
  return `am broadcast${user} -a ${action} -p ${operatorPackage} --es ${payloadKey} ${payload}${priority}`;
}

/**
 * Dispatch ACTION_AGENT_COMMAND via adb. Payload is passed as a single argv element
 * with device-shell-safe quoting. Device receives JSON string for Intent.getStringExtra(payload).
 */
export async function broadcastAgentCommand(
  config: RuntimeConfig,
  payloadJson: string,
  signal?: AbortSignal,
  { foregroundReceiver = true, timeoutMs }: { foregroundReceiver?: boolean; timeoutMs?: number } = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const shellCommand = buildBroadcastShellCommand(config, payloadJson, foregroundReceiver);
  const redactedShellCommand = buildBroadcastShellCommand(config, "[REDACTED]", foregroundReceiver);
  const result = await runAdb(
    config,
    ["shell", shellCommand],
    { redactedArgs: ["shell", redactedShellCommand], signal, timeoutMs }
  );

  return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}
