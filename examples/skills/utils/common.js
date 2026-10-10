const {existsSync} = require('node:fs');
const {extname} = require('node:path');
function resolveAndroperatorBin() {
  const command = process.env.ANDROPERATOR_BIN;
  if (typeof command !== 'string' || !command.trim()) throw Error('Explicit ANDROPERATOR_BIN is required');
  if (existsSync(command)) return ['.js', '.cjs', '.mjs'].includes(extname(command)) ? {cmd:process.execPath,args:[command]} : {cmd:command,args:[]};
  const parsed = parseCommandSpec(command);
  if (!parsed) throw Error('Invalid ANDROPERATOR_BIN command');
  return parsed;
}
function resolveOperatorPackage() {
  const value = process.env.ANDROPERATOR_OPERATOR_PACKAGE;
  if (value === undefined) return 'com.androperator.operator';
  if (typeof value !== 'string' || !value.trim()) throw Error('ANDROPERATOR_OPERATOR_PACKAGE must not be blank');
  return value;
}
function parseCommandSpec(commandSpec) {
  const parts = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < commandSpec.length; i += 1) {
    const char = commandSpec[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < commandSpec.length) {
        i += 1;
        current += commandSpec[i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== '') {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return null;
  }

  if (current !== '') {
    parts.push(current);
  }

  if (parts.length === 0) {
    return null;
  }

  return { cmd: parts[0], args: parts.slice(1) };
}


module.exports = {resolveAndroperatorBin,resolveOperatorPackage};
