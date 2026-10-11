import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { PNG } from "pngjs";
import type { ProcessRunner } from "../../../adapters/android-bridge/processRunner.js";
import { bundledCaptureHelper } from "../../../domain/observe/captureHelper.js";

/** Exercise canonical execution, helper protocol and real fallback decoding without ADB. */
export async function scaledCaptureRunner(fallback = false) {
  const { sha256 } = await bundledCaptureHelper();
  const calls: string[][] = [];
  let logcat: any;
  let captures = 0;
  const png = (width: number) => {
    const image = new PNG({ width, height: width });
    image.data.fill(128);
    return PNG.sync.write(image);
  };
  const child = () => Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    kill(this: EventEmitter) { this.emit("close", 1); }, ref() {}, unref() {},
  });
  const runner: ProcessRunner = {
    async run(_command, args) {
      calls.push(args);
      const command = args.join(" ");
      let stdout = "";
      if (args.includes("devices")) stdout = "List of devices attached\ntest-device\tdevice\n";
      else if (command.includes("pm list packages")) stdout = "package:com.test.operator\n";
      else if (command.includes("am broadcast")) {
        const execution = JSON.parse(command.match(/\{.*\}/)![0]);
        const envelope = { commandId: execution.commandId, taskId: execution.taskId, error: null,
          status: execution.actions.some((a: any) => a.type === "take_screenshot") ? "failed" : "success",
          stepResults: execution.actions.map((action: any) => ({ id: action.id, actionType: action.type,
            success: action.type !== "take_screenshot",
            data: action.type === "doctor_ping" ? { screen_on: "true", device_locked: "false", user_unlocked: "true" }
              : action.type === "take_screenshot" ? { error: "UNSUPPORTED_RUNTIME_SCREENSHOT" } : { preserved: "yes" } })) };
        const reader = logcat;
        setImmediate(() => reader.stdout.write(`[Androperator-Result] ${JSON.stringify(envelope)}\n`));
      } else if (args.includes("push") && fallback) return { code: 1, stdout: "", stderr: "injected deployment failure" };
      else if (args.includes("sha256sum")) stdout = sha256;
      else if (!command.includes("dumpsys display") && !command.includes("mkdir") && !args.includes("push") && !args.includes("rm")) {
        throw new Error(`Unexpected command in capture fixture: ${command}`);
      }
      return { code: 0, stdout, stderr: "" };
    },
    async runShell() { throw new Error("Unexpected host shell"); },
    spawn(_command, args) {
      calls.push(args);
      if (args.includes("logcat")) { logcat = child(); return logcat; }
      const process = child();
      if (args.includes("screencap")) {
        captures++;
        setImmediate(() => { process.stdout.write(png(8)); process.emit("close", 0); });
        return process;
      }
      const session = args.at(-1)!.match(/CaptureHelper ([a-f0-9-]+)/)![1];
      let sequence = 0;
      const stdin = new Writable({ write(chunk, _encoding, done) {
        captures++;
        const [request, value] = chunk.toString().trim().split(" ");
        const scale = Number(value), buffer = png(8 * scale / 100);
        const header = { protocol: 1, session, request, status: "ok", length: buffer.length,
          sourceWidth: 8, sourceHeight: 8, physicalId: "123", rotation: 0,
          protectedContent: "absent", scale, sequence: ++sequence, captureNanos: String(sequence) };
        setImmediate(() => process.stdout.write(Buffer.concat([Buffer.from(JSON.stringify(header) + "\n"), buffer])));
        done();
      } });
      setImmediate(() => process.stdout.write(JSON.stringify({ protocol: 1, session, status: "ready" }) + "\n"));
      return Object.assign(process, { stdin });
    },
  };
  return { runner, calls, captures: () => captures };
}
