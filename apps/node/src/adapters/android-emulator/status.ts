import { resolveEmulatorPackage, selectedEmulatorBackend } from "./packageSource.js";

try {
  const backend = selectedEmulatorBackend();
  console.log(JSON.stringify(backend === "legacy" ? { backend } : { backend, ...resolveEmulatorPackage() }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
