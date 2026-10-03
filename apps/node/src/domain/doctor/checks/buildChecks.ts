
import { type RuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { type DoctorCheckResult } from "../../../contracts/doctor.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { runAdb } from "../../../adapters/android-bridge/adbClient.js";

export async function checkJavaVersion(config: RuntimeConfig): Promise<DoctorCheckResult> {
  try {
    const { stdout, stderr, error } = await config.runner.run("java", ["-version"]);
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          id: "host.java.version",
          status: "fail",
          code: ERROR_CODES.HOST_DEPENDENCY_MISSING,
          summary: "Java not found.",
          detail: "Java JDK 17 or 21 is required to build Android apps.",
        };
      }
      return {
        id: "host.java.version",
        status: "fail",
        code: ERROR_CODES.HOST_DEPENDENCY_MISSING,
        summary: "Failed to check Java version.",
        detail: `Java JDK 17 or 21 is required to build Android apps. Check failed with: ${message}`,
      };
    }
    const versionOutput = (stdout + stderr).toLowerCase();
    if (versionOutput.includes('version "17') || versionOutput.includes('version "21') || versionOutput.includes('openjdk 17') || versionOutput.includes('openjdk 21')) {
      return {
        id: "host.java.version",
        status: "pass",
        summary: "Java 17 or 21 is installed.",
      };
    }
    return {
      id: "host.java.version",
      status: "fail",
      code: ERROR_CODES.HOST_DEPENDENCY_MISSING,
      summary: "Java 17 or 21 is required for Android builds.",
      detail: versionOutput.split("\n")[0],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {
        id: "host.java.version",
        status: "fail",
        code: ERROR_CODES.HOST_DEPENDENCY_MISSING,
        summary: "Java not found.",
        detail: "Java JDK 17 or 21 is required to build Android apps.",
      };
    }
    return {
      id: "host.java.version",
      status: "fail",
      code: ERROR_CODES.HOST_DEPENDENCY_MISSING,
      summary: "Failed to check Java version.",
      detail: `Java JDK 17 or 21 is required to build Android apps. Check failed with: ${message}`,
    };
  }
}

export async function runAndroidBuild(config: RuntimeConfig): Promise<DoctorCheckResult> {
  try {
    // Run from project root.
    const { code, error } = await config.runner.run("./gradlew", [":app:assembleDebug"], { cwd: config.projectRoot });
    if (code !== 0) {
      throw error || new Error(`Gradle exited with code ${code}`);
    }
    return {
      id: "build.android.assemble",
      status: "pass",
      summary: "Android app build successful.",
    };
  } catch (e) {
    return {
      id: "build.android.assemble",
      status: "fail",
      code: ERROR_CODES.ANDROID_BUILD_FAILED,
      summary: "Android app build failed.",
      detail: (e as Error).message,
    };
  }
}

export async function runAndroidInstall(config: RuntimeConfig): Promise<DoctorCheckResult> {
  try {
    const { code, error } = await config.runner.run("./gradlew", [":app:installDebug"], { cwd: config.projectRoot });
    if (code !== 0) {
      throw error || new Error(`Gradle exited with code ${code}`);
    }
    return {
      id: "build.android.install",
      status: "pass",
      summary: "Android app installed successfully.",
    };
  } catch (e) {
    return {
      id: "build.android.install",
      status: "fail",
      code: ERROR_CODES.ANDROID_INSTALL_FAILED,
      summary: "Android app installation failed.",
      detail: (e as Error).message,
    };
  }
}

export async function runAndroidLaunch(config: RuntimeConfig): Promise<DoctorCheckResult> {
  const mainActivity = `${config.operatorPackage}/androperator.activity.MainActivity`;
  const { code, stderr } = await runAdb(config, ["shell", "am", "start", "-n", mainActivity]);

  if (code !== 0) {
    return {
      id: "build.android.launch",
      status: "fail",
      code: ERROR_CODES.ANDROID_APP_LAUNCH_FAILED,
      summary: "Failed to launch Operator app.",
      detail: stderr,
    };
  }

  return {
    id: "build.android.launch",
    status: "pass",
    summary: "Operator app launched successfully.",
  };
}
