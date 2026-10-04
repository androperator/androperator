import type { ConfiguredAvdDetails, RunningEmulatorDetails } from "../../adapters/android-emulator/contracts.js";

export type EmulatorUnsupportedReason =
  | "missing_play_store"
  | "unsupported_api_level"
  | "unsupported_abi"
  | "unsupported_device_profile";

export interface EmulatorCompatibility {
  supported: boolean;
  unsupportedReasons: EmulatorUnsupportedReason[];
}

export interface ConfiguredAvd extends ConfiguredAvdDetails, EmulatorCompatibility {}

export interface RunningEmulator extends RunningEmulatorDetails, EmulatorCompatibility {}

export interface ProvisionedEmulator {
  type: "emulator";
  avdName: string;
  serial: string;
  booted: boolean;
  created: boolean;
  started: boolean;
  reused: boolean;
}
