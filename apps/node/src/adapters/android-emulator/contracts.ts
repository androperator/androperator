import type { RuntimeConfig } from "../android-bridge/runtimeConfig.js";
import type { AndroidSdkTool } from "../android-sdk/hostToolClient.js";

/** SDK facts only. Compatibility and provisioning decisions belong to the consumer. */
export interface ConfiguredAvdDetails {
  name: string;
  exists: boolean;
  running: boolean;
  apiLevel: number | null;
  abi: string | null;
  playStore: boolean;
  deviceProfile: string | null;
  systemImage: string | null;
}

export interface RunningEmulatorDetails {
  type: "emulator";
  avdName: string;
  serial: string;
  booted: boolean;
}

export interface HostToolAvailability {
  tool: AndroidSdkTool;
  available: boolean;
}

/** Consumer policy must be explicit before invoking a backend. */
export interface CreateAvdOptions {
  name: string;
  systemImage: string;
  deviceProfile: string;
  dataPartitionSize: string;
  replace: boolean;
  acceptLicenses: boolean;
}

/**
 * Consumer-owned migration boundary, not a new public CLI or package API.
 * Preserve structured errors and the supplied runner/ADB diagnostics.
 * Launch confirms spawn only; registration and boot are separate awaited steps.
 */
export interface EmulatorBackend {
  getAvdRoot(): string;
  inspectConfiguredAvd(name: string, runningNames?: Set<string>): Promise<ConfiguredAvdDetails>;
  listConfiguredAvds(config: RuntimeConfig, runningNames?: Set<string>): Promise<ConfiguredAvdDetails[]>;
  getRunningEmulatorAvdName(config: RuntimeConfig, serial: string): Promise<string>;
  isEmulatorBooted(config: RuntimeConfig, serial: string): Promise<boolean>;
  listRunningEmulators(config: RuntimeConfig): Promise<RunningEmulatorDetails[]>;
  checkRequiredEmulatorTools(config: RuntimeConfig): Promise<HostToolAvailability[]>;
  assertRequiredEmulatorTools(config: RuntimeConfig): Promise<void>;
  normalizeEmulatorDataPartitionSize(size: string): string;
  validateAvdName(name: string): void;
  setAvdDataPartitionSize(name: string, size: string): Promise<void>;
  isSystemImageInstalled(config: RuntimeConfig, systemImage: string): Promise<boolean>;
  acceptAndroidSdkLicenses(config: RuntimeConfig): Promise<void>;
  ensureSystemImageInstalled(config: RuntimeConfig, systemImage: string, options: { acceptLicenses: boolean }): Promise<void>;
  createAvd(config: RuntimeConfig, options: CreateAvdOptions): Promise<void>;
  startAvd(config: RuntimeConfig, name: string, extraArgs?: string[]): Promise<void>;
  waitForEmulatorRegistration(config: RuntimeConfig, name: string, timeoutMs?: number): Promise<string>;
  waitForBootCompletion(config: RuntimeConfig, serial: string, timeoutMs?: number): Promise<void>;
  stopAvd(config: RuntimeConfig, name: string): Promise<void>;
  deleteAvd(config: RuntimeConfig, name: string): Promise<void>;
}
