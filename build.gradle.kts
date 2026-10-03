// import org.jetbrains.kotlin.gradle.tasks.KotlinCompilationTask
import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.dsl.LibraryExtension
import java.io.FileInputStream
import java.util.Properties
import org.gradle.api.tasks.testing.Test
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

// Load local.properties
val localProperties =
    Properties().apply {
        val localPropertiesFile = file("local.properties")
        if (localPropertiesFile.exists()) {
            load(FileInputStream(localPropertiesFile))
        }
    }

extra.apply {
    set("GEMINI_API_KEY", localProperties.getProperty("GEMINI_API_KEY") ?: "")
}

// Top-level build file where you can add configuration options common to all sub-projects/modules.

buildscript {
    extra.apply {
        set("compileSdkVersion", 35)
        set("minSdkVersion", 21)
        set("targetSdkVersion", 35)

        set("librariesPath", "libraries")

        set("composeCompilerVersion", libs.versions.composeCompiler.get())
        set("glideVersion", "4.11.0")
        set("glideWebp", "webpdecoder-2.0.4.11.0.aar")
    }

    repositories {
        flatDir { dirs("./libraries") }
    }
    dependencies {
        classpath(libs.android.gradlePlugin)
        classpath(libs.kotlin.gradlePlugin)
        classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.1.10")
        classpath(libs.compose.compiler.gradlePlugin)

        // Code quality tools
        classpath(libs.ktlint.gradlePlugin)
        classpath(libs.detekt.gradlePlugin)
        classpath(libs.spotless.gradlePlugin)

//        classpath(libs.autonomousapps.dependency.analysis.gradlePlugin)
//        classpath(libs.osacky.doctor.gradlePlugin)
//        classpath(libs.ben.manes.gradle.versions.gradlePlugin)
    }
}

// Disabled for now as it breaks when updating tools: https://issuetracker.google.com/issues/235538823
// apply plugin: "com.osacky.doctor"

plugins {
//    alias(libs.plugins.dependency.analysis)
    alias(libs.plugins.ksp) apply false

    // Code quality plugins
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
    alias(libs.plugins.spotless)
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }

//    tasks.withType<KotlinCompilationTask<*>>().configureEach {
//        compilerOptions {
//            // Treat all Kotlin warnings as errors
//            allWarningsAsErrors.set(true)
//        }
//    }
}

// The clean task is already provided by Gradle

subprojects {
    tasks.withType<KotlinJvmCompile>().configureEach {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    // Apply code quality plugins to all subprojects
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    apply(plugin = "io.gitlab.arturbosch.detekt")
    apply(plugin = "com.diffplug.spotless")

    project.afterEvaluate {
        val project = this@afterEvaluate
        if (project.plugins.hasPlugin("com.android.application") || project.plugins.hasPlugin("com.android.library")) {
            addCommonConfigurationForAndroidModules(project)
        }

        // Configure code quality for each subproject
        extensions.configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
            version.set(
                rootProject.libs.versions.ktlint
                    .get(),
            )
            debug.set(false)
            verbose.set(true)
            android.set(true)
            outputToConsole.set(true)
            outputColorName.set("RED")
            ignoreFailures.set(false)
            enableExperimentalRules.set(true)
            filter {
                exclude("**/generated/**")
                include("**/kotlin/**")
            }
            // Disable comment rules to allow commented-out code without forced spaces
            additionalEditorconfig.set(
                mapOf(
                    "ktlint_standard_comment-spacing" to "disabled",
                    "ktlint_standard_comment-wrapping" to "disabled",
                ),
            )
        }

        extensions.configure<io.gitlab.arturbosch.detekt.extensions.DetektExtension> {
            buildUponDefaultConfig = true
            allRules = false
            config.setFrom("${projectDir}/detekt.yml")
        }

        extensions.configure<com.diffplug.gradle.spotless.SpotlessExtension> {
            kotlin {
                target("**/*.kt")
                targetExclude(
                    "**/build/**/*.kt",
                    "apps/android/shared/app/di/**/*.kt",
                )
                ktlint(
                    rootProject.libs.versions.ktlint
                        .get(),
                ).editorConfigOverride(
                    mapOf(
                        "ktlint_standard_comment-spacing" to "disabled",
                        "ktlint_standard_comment-wrapping" to "disabled",
                    ),
                )
            }
            kotlinGradle {
                target("*.gradle.kts")
                ktlint(
                    rootProject.libs.versions.ktlint
                        .get(),
                ).editorConfigOverride(
                    mapOf(
                        "ktlint_standard_comment-spacing" to "disabled",
                        "ktlint_standard_comment-wrapping" to "disabled",
                    ),
                )
            }
        }
    }
}

subprojects {
    tasks.register("listAllDependencies", DependencyReportTask::class)
}

fun addCommonConfigurationForAndroidModules(project: Project) {
    project.extensions.configure<JavaPluginExtension> {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17

        toolchain {
            languageVersion.set(JavaLanguageVersion.of(17))
        }
    }

    if (project.plugins.hasPlugin("com.android.application")) {
        project.extensions.configure<ApplicationExtension> {
            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }

            compileSdk = project.rootProject.extra["compileSdkVersion"] as Int
            defaultConfig {
                minSdk = project.rootProject.extra["minSdkVersion"] as Int
                targetSdk = project.rootProject.extra["targetSdkVersion"] as Int
                vectorDrawables.useSupportLibrary = true
                testApplicationId = "com.actionlauncher.test"
                testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
                testInstrumentationRunnerArguments["clearPackageData"] = "true"
            }

            packaging {
                resources {
                    excludes.apply {
                        add("META-INF/LICENSE.txt")
                        add("META-INF/NOTICE.txt")
                        add("META-INF/LICENSE")
                        add("META-INF/NOTICE")
                        add("META-INF/AL2.0")
                        add("META-INF/LGPL2.1")
                        add("META-INF/versions/9/previous-compilation-data.bin")
                        add(".readme")
                        add("README.txt")
                    }
                }
            }
        }
    }

    if (project.plugins.hasPlugin("com.android.library")) {
        project.extensions.configure<LibraryExtension> {
            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }

            compileSdk = project.rootProject.extra["compileSdkVersion"] as Int
            defaultConfig {
                minSdk = project.rootProject.extra["minSdkVersion"] as Int
                vectorDrawables.useSupportLibrary = true
                testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
                testInstrumentationRunnerArguments["clearPackageData"] = "true"
            }

            packaging {
                resources {
                    excludes.apply {
                        add("META-INF/LICENSE.txt")
                        add("META-INF/NOTICE.txt")
                        add("META-INF/LICENSE")
                        add("META-INF/NOTICE")
                        add("META-INF/AL2.0")
                        add("META-INF/LGPL2.1")
                        add("META-INF/versions/9/previous-compilation-data.bin")
                        add(".readme")
                        add("README.txt")
                    }
                }
            }
        }
    }
}

// dependencyUpdates.resolutionStrategy {
//    componentSelection { rules ->
//        rules.all { ComponentSelection selection ->
//            boolean rejected = ['alpha', 'beta', 'rc'].any { qualifier ->
//                selection.candidate.version ==~ /(?i).*[.-]${qualifier}[.\d-]*/
//            }
//            if (rejected) {
//                selection.reject('Release candidate')
//            }
//        }
//    }
// }

project.afterEvaluate {
    println(
        "Configuration cache property \"org.gradle.unsafe.configuration-cache\": ${findProperty(
            "org.gradle.unsafe.configuration-cache",
        )}",
    )

    gradle.startParameter.taskRequests.forEach { taskRequest ->
        if (taskRequest.args.contains("--no-configuration-cache")) {
            println("The --no-configuration-cache option was used")
//        } else {
//            println("[config] The --no-configuration-cache option was not used")
        }
        println("Task request args: ${taskRequest.args}")
    }
}

// Run unit tests in every module: ./gradlew testDebugUnitTest or ./gradlew testAll
tasks.register("testAll") {
    group = "verification"
    description = "Runs unit tests in all modules (app + all shared libs). Use testDebugUnitTest for the same. For on-device tests: connectedDebugAndroidTest."

    subprojects.forEach { subproject ->
        // Android tasks are added after evaluation, so we use matching/all to find them
        dependsOn(subproject.tasks.matching { it.name == "testDebugUnitTest" })
    }
}

tasks.register("unitTest") {
    group = "verification"
    description = "Alias for testDebugUnitTest; runs unit tests in all modules."

    subprojects.forEach { subproject ->
        dependsOn(subproject.tasks.matching { it.name == "testDebugUnitTest" })
    }
}

// Code quality configurations
detekt {
    buildUponDefaultConfig = true
    allRules = false
    config.setFrom("$projectDir/detekt.yml")
    baseline = file("$projectDir/detekt-baseline.xml")
}

tasks.withType<io.gitlab.arturbosch.detekt.Detekt>().configureEach {
    jvmTarget = "17"
}
tasks.withType<io.gitlab.arturbosch.detekt.DetektCreateBaselineTask>().configureEach {
    jvmTarget = "17"
}
tasks.withType<Test>().configureEach {
    failOnNoDiscoveredTests = false
}

ktlint {
    version.set(libs.versions.ktlint.get())
    debug.set(false)
    verbose.set(true)
    android.set(true)
    outputToConsole.set(true)
    outputColorName.set("RED")
    ignoreFailures.set(false)
    enableExperimentalRules.set(true)
    filter {
        exclude("**/generated/**")
        include("**/kotlin/**")
    }
    // Disable comment rules to allow commented-out code without forced spaces
    additionalEditorconfig.set(
        mapOf(
            "ktlint_standard_comment-spacing" to "disabled",
            "ktlint_standard_comment-wrapping" to "disabled",
        ),
    )
}

spotless {
    kotlin {
        target("**/*.kt")
        targetExclude(
            "**/build/**/*.kt",
            "apps/android/shared/app/di/**/*.kt",
        )
        ktlint(libs.versions.ktlint.get())
    }
    kotlinGradle {
        target("*.gradle.kts")
        ktlint(libs.versions.ktlint.get())
    }
    format("misc") {
        target("*.gradle", "*.md", ".gitignore")
        trimTrailingWhitespace()
        indentWithSpaces()
        endWithNewline()
    }
}

// Task to run all code quality checks
tasks.register("codeQualityCheck") {
    group = "verification"
    description = "Runs all code quality checks"
    dependsOn("ktlintCheck", "detekt", "spotlessCheck")
}

// Task to apply all code formatting
tasks.register("codeFormat") {
    group = "formatting"
    description = "Applies all code formatting"
    dependsOn("spotlessApply")
}
