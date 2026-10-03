import { EventEmitter } from "node:events";
import { runExecution } from "../../../domain/executions/runExecution.js";
import type { Execution } from "../../../contracts/execution.js";
import { describe, it } from "node:test";
import assert from "node:assert";
import { checkApkPresence, checkDeviceInteractiveState, runHandshake, runSmokeTest } from "../../../domain/doctor/checks/readinessChecks.js";
import { getDefaultRuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { FakeProcessRunner } from "../fakes/FakeProcessRunner.js";

describe("checkApkPresence", () => {
    it("uses operator download before setup when the release package is missing", async () => {
        const runner = new FakeProcessRunner();
        const config = getDefaultRuntimeConfig({
            runner,
            deviceId: "test-device",
            operatorPackage: "com.androperator.operator",
        });

        runner.queueResult({ code: 0, stdout: "", stderr: "" });
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const result = await checkApkPresence(config);

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
        assert.match(result.detail ?? "", /Package com\.androperator\.operator was not found/);
        assert.strictEqual(result.fix?.docsUrl, "https://docs.androperator.com/setup/");
        assert.deepStrictEqual(result.fix?.steps, [
            { kind: "shell", value: "androperator operator download" },
            { kind: "shell", value: "androperator operator setup --apk ~/.androperator/downloads/operator.apk --device test-device" },
        ]);
    });

    it("keeps debug-package remediation on the local APK path when the debug package is missing", async () => {
        const runner = new FakeProcessRunner();
        const config = getDefaultRuntimeConfig({
            runner,
            deviceId: "test-device",
            operatorPackage: "com.androperator.operator.dev",
        });

        runner.queueResult({ code: 0, stdout: "", stderr: "" });
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const result = await checkApkPresence(config);

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
        assert.deepStrictEqual(result.fix?.steps, [
            {
                kind: "manual",
                value: "If you do not already have a matching local debug APK at ~/.androperator/downloads/operator-debug.apk, rebuild the debug app from the same checkout before rerunning setup.",
            },
            {
                kind: "shell",
                value: "androperator operator setup --apk ~/.androperator/downloads/operator-debug.apk --device test-device --operator-package com.androperator.operator.dev",
            },
        ]);
    });

    it("uses generic local APK guidance for non-debug custom operator packages", async () => {
        const runner = new FakeProcessRunner();
        const config = getDefaultRuntimeConfig({
            runner,
            deviceId: "test-device",
            operatorPackage: "com.androperator.operator.staging",
        });

        runner.queueResult({ code: 0, stdout: "", stderr: "" });
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const result = await checkApkPresence(config);

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
        assert.deepStrictEqual(result.fix?.steps, [
            {
                kind: "manual",
                value: "If you do not already have a matching local APK at ~/.androperator/downloads/operator.apk, build or obtain the APK for com.androperator.operator.staging from the same checkout before rerunning setup.",
            },
            {
                kind: "shell",
                value: "androperator operator setup --apk ~/.androperator/downloads/operator.apk --device test-device --operator-package com.androperator.operator.staging",
            },
        ]);
    });

    it("fails when package queries cannot run", async () => {
        const runner = new FakeProcessRunner();
        const config = getDefaultRuntimeConfig({
            runner,
            deviceId: "test-device",
            operatorPackage: "com.test.operator",
        });

        runner.queueResult({ code: 1, stdout: "", stderr: "cmd: Can't find service: package", error: new Error("shell failed") });

        const result = await checkApkPresence(config);

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
        assert.match(result.detail ?? "", /Can't find service: package/);
    });
});

describe("runHandshake", () => {
    function createConfig(runner = new FakeProcessRunner()) {
        return {
            config: getDefaultRuntimeConfig({
                runner,
                deviceId: "test-device",
                operatorPackage: "com.test.operator",
            }),
            runner,
        };
    }

    it("returns pass when envelope status is success", async () => {
        const { config, runner } = createConfig();
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const mockWait = async () => ({
            ok: true as const,
            envelope: {
                status: "success" as const,
                commandId: "test-cmd",
                taskId: "test-task",
                stepResults: [{
                    id: "h1",
                    actionType: "doctor_ping",
                    success: true,
                    data: {
                        developer_options_enabled: "true",
                        usb_debugging_enabled: "true",
                        screen_on: "true",
                        device_locked: "false",
                        user_unlocked: "true",
                    },
                }],
            },
            terminalSource: "androperator_result" as const,
        });

        const result = await runHandshake(config, mockWait);
        assert.strictEqual(result.status, "pass");
        assert.strictEqual(result.id, "readiness.handshake");
        assert.deepStrictEqual(result.evidence, {
            screenOn: true,
            deviceLocked: false,
            userUnlocked: true,
        });
    });

    it("returns fail when envelope status is error", async () => {
        const { config, runner } = createConfig();
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const mockWait = async () => ({
            ok: true as const,
            envelope: { status: "failed" as const, commandId: "test-cmd", taskId: "test-task", stepResults: [], error: "Boom" },
            terminalSource: "androperator_result" as const,
        });

        const result = await runHandshake(config, mockWait);
        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING);
        assert.match(result.detail!, /Boom/);
        assert.deepStrictEqual(
            result.fix?.steps.filter((step) => step.kind === "shell"),
            [{ kind: "shell", value: "androperator grant-device-permissions --device test-device --operator-package com.test.operator" }],
        );
    });

    it("returns fail on timeout", async () => {
        const { config, runner } = createConfig();
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const mockWait = async () => ({
            ok: false as const,
            timeout: true as const,
            diagnostics: {
                code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
                message: "Timeout details",
                lastCorrelatedEvents: [],
                broadcastDispatchStatus: "sent",
                deviceId: "test-device",
                operatorPackage: "com.test.operator",
            }
        });

        const result = await runHandshake(config, mockWait);
        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.RESULT_ENVELOPE_TIMEOUT);
        assert.match(result.detail ?? "", /Broadcast dispatch: sent/);
        assert.match(result.detail ?? "", /Operator package: com\.test\.operator/);
        assert.match(result.detail ?? "", /APK\/CLI version mismatch/);
        assert.ok(result.fix?.steps.some(step => step.kind === "shell" && step.value.includes("androperator snapshot")));
    });

    it("returns fail on broadcast failure", async () => {
        const { config, runner } = createConfig();
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const mockWait = async () => ({
            ok: false as const,
            broadcastFailed: true as const,
            diagnostics: {
                code: ERROR_CODES.OPERATOR_NOT_INSTALLED,
                message: "Dispatch failed",
                lastCorrelatedEvents: [],
                broadcastDispatchStatus: "failed",
            }
        });

        const result = await runHandshake(config, mockWait);
        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
    });

    it("passes without evidence when handshake interactive state is malformed", async () => {
        const { config, runner } = createConfig();
        runner.queueResult({ code: 0, stdout: "", stderr: "" });

        const mockWait = async () => ({
            ok: true as const,
            envelope: {
                status: "success" as const,
                commandId: "test-cmd",
                taskId: "test-task",
                stepResults: [{
                    id: "h1",
                    actionType: "doctor_ping",
                    success: true,
                    data: {
                        developer_options_enabled: "true",
                        usb_debugging_enabled: "true",
                        device_locked: "false",
                        user_unlocked: "true",
                    },
                }],
            },
            terminalSource: "androperator_result" as const,
        });

        const result = await runHandshake(config, mockWait);
        assert.strictEqual(result.status, "pass");
        assert.strictEqual(result.evidence, undefined);
    });
});

describe("checkDeviceInteractiveState", () => {
    const config = getDefaultRuntimeConfig({
        runner: new FakeProcessRunner(),
        deviceId: "test-device",
        operatorPackage: "com.test.operator",
    });

    it("passes when the foundation probe reports an interactive device", async () => {
        const result = await checkDeviceInteractiveState(
            config,
            async () => ({
                ok: true as const,
                state: {
                    screenOn: true,
                    deviceLocked: false,
                    userUnlocked: true,
                },
            })
        );

        assert.strictEqual(result.status, "pass");
        assert.strictEqual(result.id, "readiness.device.interactive");
        assert.deepStrictEqual(result.evidence, {
            deviceLocked: false,
            screenOn: true,
            userUnlocked: true,
        });
    });

    it("fails with DEVICE_NOT_INTERACTIVE and evidence when the device is not interactive", async () => {
        const result = await checkDeviceInteractiveState(
            config,
            async () => ({
                ok: true as const,
                state: {
                    screenOn: false,
                    deviceLocked: true,
                    userUnlocked: false,
                },
            })
        );

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
        assert.match(result.detail ?? "", /screenOn=false/);
        assert.strictEqual(result.fix?.title, "Recover interactive device state");
        assert.strictEqual(result.deviceGuidance?.screen, "Lock screen / current screen");
        assert.deepStrictEqual(result.evidence, {
            deviceLocked: true,
            screenOn: false,
            userUnlocked: false,
        });
    });

    it("fails when the screen is on but the device is still locked", async () => {
        const result = await checkDeviceInteractiveState(
            config,
            async () => ({
                ok: true as const,
                state: {
                    screenOn: true,
                    deviceLocked: true,
                    userUnlocked: true,
                },
            })
        );

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
        assert.match(result.detail ?? "", /deviceLocked=true/);
        assert.strictEqual(result.fix?.docsUrl, "https://docs.androperator.com/api/devices/");
    });

    it("fails closed when the foundation probe cannot verify state", async () => {
        const result = await checkDeviceInteractiveState(
            config,
            async () => ({
                ok: false as const,
                code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
                message: "doctor_ping returned an invalid boolean for screen_on: missing",
            })
        );

        assert.strictEqual(result.status, "fail");
        assert.strictEqual(result.code, ERROR_CODES.RESULT_ENVELOPE_MALFORMED);
        assert.strictEqual(result.summary, "Could not verify whether the device is interactive.");
    });
});


describe("readiness execution completeness", () => {
    const steps = [
        { id: "s1", actionType: "close_app", success: true, data: {} },
        { id: "s2", actionType: "open_app", success: true, data: {} },
        { id: "s3", actionType: "snapshot_ui", success: true, data: {} },
    ];
    for (const scenario of ["complete", "terminal-failure", "missing-step", "failed-step"] as const) {
        it(`requires all smoke steps and terminal success: ${scenario}`, async () => {
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const stepResults = scenario === "missing-step" ? steps.slice(1)
                : steps.map((step, index) => ({ ...step, success: !(scenario === "failed-step" && index === 0) }));
            const result = await runSmokeTest(config, async () => ({
                ok: true as const,
                deviceId: "test-device",
                envelope: {
                    commandId: "test-command", taskId: "test-task",
                    status: scenario === "terminal-failure" ? "failed" as const : "success" as const,
                    stepResults,
                },
                terminalSource: "androperator_result" as const,
            }));
            assert.equal(result.status, scenario === "complete" ? "pass" : "fail");
        });
    }

    for (const missing of [true, false]) {
        it(`rejects a ${missing ? "missing" : "failed"} handshake step despite terminal success`, async () => {
            const runner = new FakeProcessRunner();
            runner.queueResult({ code: 0, stdout: "", stderr: "" });
            const result = await runHandshake(getDefaultRuntimeConfig({ runner }), async () => ({
                ok: true as const,
                envelope: {
                    commandId: "test-command", taskId: "test-task", status: "success" as const,
                    stepResults: missing ? [] : [{ id: "h1", actionType: "doctor_ping", success: false, data: {} }],
                },
                terminalSource: "androperator_result" as const,
            }));
            assert.equal(result.status, "fail");
            assert.equal(result.code, ERROR_CODES.RESULT_ENVELOPE_MALFORMED);
        });
    }
});


describe("doctor smoke execution pipeline", () => {
    for (const closeSucceeds of [true, false]) {
        it(`requires a successful host close before normalizing runtime rejection: ${closeSucceeds}`, async () => {
            const runner = new FakeProcessRunner();
            const stdout = new EventEmitter();
            const logcatProcess = Object.assign(new EventEmitter(), {
                stdout, stderr: new EventEmitter(), kill() {},
            });
            runner.spawn = () => logcatProcess;
            let execution: Execution;
            let broadcast = false;
            runner.run = async (command, args) => {
                runner.calls.push({ command, args });
                const action = args.join(" ");
                if (action.endsWith("devices")) return { code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" };
                if (action.includes("pm list packages")) return { code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" };
                if (action.includes("am force-stop")) return { code: closeSucceeds ? 0 : 1, stdout: "", stderr: "" };
                assert.ok(action.includes("am broadcast"), action);
                broadcast = true;
                setTimeout(() => stdout.emit("data", Buffer.from(`D/TaskScopeDefault: [TaskScope] UI Hierarchy [commandId=${execution.commandId}]:\nD/TaskScopeDefault: <hierarchy>\nD/TaskScopeDefault: <node package="com.android.settings" />\nD/TaskScopeDefault: </hierarchy>\n[Androperator-Result] ${JSON.stringify({
                    commandId: execution.commandId, taskId: execution.taskId, status: "success", error: null,
                    stepResults: [
                        { id: "s1", actionType: "close_app", success: false, data: { error: "UNSUPPORTED_RUNTIME_CLOSE" } },
                        { id: "s2", actionType: "open_app", success: true, data: {} },
                        { id: "s3", actionType: "snapshot_ui", success: true, data: {} },
                    ],
                })}\n`)), 0);
                return { code: 0, stdout: "Broadcast completed", stderr: "" };
            };
            const config = getDefaultRuntimeConfig({ runner, deviceId: "test-device", operatorPackage: "com.androperator.operator.dev", adbPath: "test-adb" });
            const result = await runSmokeTest(config, (input, options) => {
                execution = input as Execution;
                assert.equal(options?.deviceId, config.deviceId);
                assert.equal(options?.operatorPackage, config.operatorPackage);
                assert.equal(options?.adbPath, config.adbPath);
                assert.equal(options?.runner, runner);
                return runExecution(input, {
                    ...options, logcatBroadcastDelayMs: 0,
                    ensureInteractiveAutomationReadyFn: async () => ({ ok: true, state: {
                        screenOn: true, interactive: true, deviceLocked: false, userUnlocked: true,
                    } }),
                });
            });
            assert.equal(result.status, closeSucceeds ? "pass" : "fail");
            assert.equal(broadcast, closeSucceeds);
            assert.ok(runner.calls.some(call => call.args.join(" ") === "-s test-device shell am force-stop com.android.settings"));
        });
    }
});
