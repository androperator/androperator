#!/usr/bin/env node
import { tryPersistentCli } from "./persistentCliClient.cjs";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const response = await tryPersistentCli(argv);
  if (response === null) {
    process.exitCode = await (await import("./runner.js")).runLocalCli(argv);
  } else {
    process.stdout.write(response.stdout);
    process.stderr.write(response.stderr);
    process.exitCode = response.exitCode;
    if (response.exitCode === 0 && process.stderr.isTTY === true) await (await import("./starHint.js")).maybeShowStarHint("upgrade");
  }
}
// Avoid top-level await: stdio servers may intentionally finish when stdin closes.
main().catch(error => {
  console.error(JSON.stringify({ code: "UNKNOWN", message: String(error) }));
  process.exitCode = 1;
});
