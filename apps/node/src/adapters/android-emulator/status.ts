import { resolveEmulatorPackage } from "./packageSource.js";

try {
  console.log(JSON.stringify({ backend: "package", ...resolveEmulatorPackage() }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
