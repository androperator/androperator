import type { RuntimeConfig } from "./runtimeConfig.js";
import { runAdb } from "./adbClient.js";

function singleQuoteForDeviceShell(value: string): string {
  // Device-side shell-safe single-quoted literal: 'foo'"'"'bar'
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildBroadcastShellCommand(config: RuntimeConfig, payloadJson: string): string {
  const action = singleQuoteForDeviceShell(config.actionAgentCommand);
  const operatorPackage = singleQuoteForDeviceShell(config.operatorPackage);
  const payloadKey = singleQuoteForDeviceShell(config.payloadExtraKey);
  const payload = singleQuoteForDeviceShell(payloadJson.replace(/\n/g, ""));

  return `am broadcast -a ${action} -p ${operatorPackage} --es ${payloadKey} ${payload} --receiver-foreground`;
}

/**
 * Dispatch ACTION_AGENT_COMMAND via adb. Payload is passed as a single argv element
 * with device-shell-safe quoting. Device receives JSON string for Intent.getStringExtra(payload).
 */
export async function broadcastAgentCommand(
  config: RuntimeConfig,
  payloadJson: string,
  signal?: AbortSignal
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const shellCommand = buildBroadcastShellCommand(config, payloadJson);
  const redactedShellCommand = buildBroadcastShellCommand(config, "[REDACTED]");
  const result = await runAdb(
    config,
    ["shell", shellCommand],
    { redactedArgs: ["shell", redactedShellCommand], signal }
  );

  return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}
