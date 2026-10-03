import { EventEmitter } from "node:events";
import type { ResultEnvelope } from "../../../contracts/result.js";
import { FakeProcessRunner } from "./FakeProcessRunner.js";

export function executionRunner(envelope: ResultEnvelope, snapshotXml?: string, png?: Buffer, captureExit = 0): FakeProcessRunner {
  const runner = new FakeProcessRunner();
  const run = runner.run.bind(runner);
  runner.run = (command, args, options) => args.slice(-2).join(" ") === "dumpsys display"
    ? Promise.resolve({ code: 0, stdout: "", stderr: "" }) : run(command, args, options);
  const logcat = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" });
  runner.queueResult({ code: 0, stdout: "package:com.test.operator\n", stderr: "" });
  runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" }, () => {
    setTimeout(() => {
      if (snapshotXml !== undefined) logcat.stdout.emit("data", Buffer.from(`D/TaskScope: [TaskScope] UI Hierarchy [commandId=${envelope.commandId}]: ${snapshotXml}` + "\n"));
      logcat.stdout.emit("data", Buffer.from(`D/Result: [Androperator-Result] ${JSON.stringify(envelope)}\n`));
    }, 1);
  });
  runner.spawn = ((_command, args) => {
    if (args.includes("logcat")) return logcat;
    const capture = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
    setTimeout(() => { if (png) capture.stdout.emit("data", png); capture.emit("close", captureExit); }, 1);
    return capture;
  }) as FakeProcessRunner["spawn"];
  return runner;
}
