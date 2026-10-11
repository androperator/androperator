#!/usr/bin/env node
// Read metadata from the branch-local compiled registry without invoking handlers.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { COMMANDS } = await import(pathToFileURL(path.join(root, "apps/node/dist/cli/registry.js")));
const metadata = Object.values(COMMANDS).map(command => ({
  name: command.name,
  group: command.group,
  summary: command.summary,
  synonyms: command.synonyms,
  topLevelBlock: command.topLevelBlock,
  documentedFlags: command.documentedFlags,
  subtopics: command.subtopics,
  docsVisibility: command.docsVisibility,
  docsAliasOf: command.docsAliasOf,
}));
process.stdout.write(JSON.stringify(metadata));
