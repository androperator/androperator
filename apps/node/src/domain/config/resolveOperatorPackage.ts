export const DEFAULT_OPERATOR_PACKAGE = "com.androperator.operator";

export function resolveOperatorPackageForRequest(provided: string | undefined): string {
  if (provided !== undefined) {
    return provided;
  }

  const env = process.env.ANDROPERATOR_OPERATOR_PACKAGE;
  if (env !== undefined && env.trim().length > 0) {
    return env;
  }

  return DEFAULT_OPERATOR_PACKAGE;
}
