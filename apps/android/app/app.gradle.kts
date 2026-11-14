plugins {
    id("com.android.application")
}

fun env(name: String, legacyName: String? = null): String? =
    System.getenv(name) ?: legacyName?.let(System::getenv)

data class ParsedVersion(
    val name: String,
    val major: Int,
    val minor: Int,
    val patch: Int,
    val prereleaseLabel: String?,
    val prereleaseNumber: Int?
)

fun parseVersionName(versionName: String): ParsedVersion {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+)(?:\.(\d+))?)?$""")
        .matchEntire(versionName)
        ?: throw GradleException("Unsupported Androperator version format: $versionName")

    return ParsedVersion(
        name = versionName,
        major = match.groupValues[1].toInt(),
        minor = match.groupValues[2].toInt(),
        patch = match.groupValues[3].toInt(),
        prereleaseLabel = match.groupValues[4].ifBlank { null }?.lowercase(),
        prereleaseNumber = match.groupValues[5].ifBlank { null }?.toInt()
    )
}

fun computeVersionCode(version: ParsedVersion): Int {
    val prereleaseNumber = version.prereleaseNumber ?: 0
    if (prereleaseNumber > 99) {
        throw GradleException("Prerelease number must be between 0 and 99: ${version.name}")
    }

    val prereleaseOffset = when (version.prereleaseLabel) {
        null -> 900
        "rc" -> 800 + prereleaseNumber
        "beta" -> 500 + prereleaseNumber
        "alpha" -> 200 + prereleaseNumber
        else -> 100 + prereleaseNumber
    }

    return version.major * 10000000 +
        version.minor * 100000 +
        version.patch * 1000 +
        prereleaseOffset
}

fun readNodePackageVersion(): String {
    val packageJson = rootProject.file("apps/node/package.json")
    val versionLine = Regex(""""version"\s*:\s*"([^"]+)"""")
        .find(packageJson.readText())
        ?.groupValues
        ?.get(1)
        ?: throw GradleException("Unable to read version from ${packageJson.path}")

    return versionLine
}

val baseApplicationId = "com.androperator.operator"

android {
    namespace = "com.androperator.operator"

    val resolvedVersionName = System.getenv("ANDROPERATOR_VERSION_NAME") ?: readNodePackageVersion()
    val resolvedVersion = parseVersionName(resolvedVersionName)

    defaultConfig {
        applicationId = baseApplicationId
        versionCode = System.getenv("ANDROPERATOR_VERSION_CODE")?.toInt() ?: computeVersionCode(resolvedVersion)
        versionName = resolvedVersion.name
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file("../../../.android/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        create("release") {
            // Fall back to using debug keystore if environment variables are not set. Required for CI.
            storeFile = env("ANDROPERATOR_ANDROID_KEYSTORE_PATH")?.let { file(it) }
                ?: env("ANDROID_KEYSTORE_PATH", "KEYSTORE_LOCATION")?.let { file(it) }
                ?: file("../../../.android/debug.keystore")
            storePassword = env("ANDROPERATOR_ANDROID_KEYSTORE_PASSWORD")
                ?: env("ANDROID_KEYSTORE_PASSWORD", "KEYSTORE_PASSWORD")
                ?: "android"
            keyAlias = env("ANDROPERATOR_ANDROID_KEY_ALIAS")
                ?: env("ANDROID_KEY_ALIAS", "ACTION_LAUNCHER_KEY_ALIAS")
                ?: "androiddebugkey"
            keyPassword = env("ANDROPERATOR_ANDROID_KEY_PASSWORD")
                ?: env("ANDROID_KEY_PASSWORD", "ACTION_LAUNCHER_KEY_PASSWORD")
                ?: "android"

            isV1SigningEnabled = true
            isV2SigningEnabled = true
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-d"
        }

        release {
            signingConfig = signingConfigs.getByName("release")

            applicationIdSuffix = ""

            isShrinkResources = true
            isDebuggable = false
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    lint {
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation(libs.kotlin.stdlib.jdk8)

    implementation(libs.koin.android)
    implementation(libs.timber)

    implementation(project(":shared:app:app-adapter"))
    implementation(project(":shared:core:common"))
    implementation(project(":shared:data:operator"))
    
//    implementation(project(":shared:system:device-package"))

    implementation(project(":shared:app:di"))

    testImplementation(libs.koin.test)
    testImplementation(libs.androidx.arch.core.testing)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.robolectric)
    testImplementation(libs.kotlin.reflect)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(libs.androidx.test.espresso.contrib)
    androidTestImplementation(libs.androidx.test.espresso.intents)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.arch.core.testing)
    androidTestImplementation(libs.kotlin.test)
    androidTestImplementation(libs.kotlin.test.junit)
}

tasks.register("runDebug") {
    dependsOn("installDebug")
    group = "run"

    doLast {
        val debugApplicationId = "$baseApplicationId.dev"

        println("Launching $debugApplicationId/androperator.activity.MainActivity")
        val launchResult =
            ProcessBuilder("adb", "shell", "am", "start", "-n", "$debugApplicationId/androperator.activity.MainActivity")
                .inheritIO()
                .start()
                .waitFor()
        check(launchResult == 0) { "adb launch command failed with exit code $launchResult" }

        println("⏱️  Waiting 2 seconds for installation to complete...")
        Thread.sleep(2000)

        println("🔧 Granting permissions for $debugApplicationId...")
        val grantResult =
            ProcessBuilder(
                rootProject.file("scripts/androperator_grant_android_permissions.sh").absolutePath,
                "--package",
                debugApplicationId,
            )
                .inheritIO()
                .start()
                .waitFor()
        check(grantResult == 0) { "permission grant command failed with exit code $grantResult" }
    }
}

// Generate each APK's offline notices from its resolved runtime graph. Unknown versions
// fail the build until scripts/licenses/metadata.json and bundled texts are reviewed.
abstract class GenerateLicenseAssets : Exec() {
    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty
}

androidComponents.onVariants { androidVariant ->
    val variant = androidVariant.name
    val capitalizedVariant = variant.replaceFirstChar { it.uppercase() }
    val generatedAssets = layout.buildDirectory.dir("generated/licenses/$variant")
    val coordinates = providers.provider {
        configurations.getByName("${variant}RuntimeClasspath").incoming.resolutionResult
            .allComponents.mapNotNull { component ->
                (component.id as? org.gradle.api.artifacts.component.ModuleComponentIdentifier)?.let {
                    "${it.group}:${it.module}:${it.version}"
                }
            }.distinct().sorted()
    }
    val generateLicenses = tasks.register<GenerateLicenseAssets>("generate${capitalizedVariant}OpenSourceLicenses") {
        inputs.property("runtimeCoordinates", coordinates)
        inputs.dir(rootProject.file("scripts/licenses"))
        inputs.files(rootProject.fileTree("apps/android") {
            include("**/src/main/**/*.kt")
            exclude("**/build/**")
        })
        outputDirectory.set(generatedAssets)
        val dependencyFile = layout.buildDirectory.file("licenses/$variant/dependencies.txt")
        doFirst {
            dependencyFile.get().asFile.apply {
                parentFile.mkdirs()
                writeText(coordinates.get().joinToString("\n", postfix = "\n"))
            }
        }
        commandLine(
            "python3", rootProject.file("scripts/licenses/generate.py"),
            "--dependencies", dependencyFile.get().asFile,
            "--output", generatedAssets.get().file("open_source_licenses.html").asFile,
            "--source-root", rootProject.file("apps/android"),
        )
    }
    androidVariant.sources.assets?.addGeneratedSourceDirectory(generateLicenses, GenerateLicenseAssets::outputDirectory)
}
