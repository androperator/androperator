plugins {
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.android.library")
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "androperator.test"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = libs.versions.composeCompiler.get()
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
        getByName("test") {
            java.srcDirs("src/test/kotlin")
        }
    }
}

dependencies {
    implementation(project(":shared:app:app-adapter"))
    implementation(project(":shared:core:common"))
    implementation(project(":shared:core:devicepackage"))
    implementation(project(":shared:core:toolkit"))
    implementation(project(":shared:data:content"))
    implementation(project(":shared:data:content-model"))
    implementation(project(":shared:data:resources"))
    implementation(project(":shared:data:task"))
    implementation(project(":shared:data:toolkit"))
    implementation(project(":shared:data:trigger"))
    implementation(project(":shared:data:uitree"))
    implementation(project(":shared:data:workflow"))
    implementation(project(":shared:app:di"))
    
    implementation(libs.koin.core)
    implementation(libs.koin.android)
    implementation(libs.koin.test)
    implementation(libs.kotlinx.coroutines.test)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.compose.material3)
    implementation(libs.compose.runtime)
    
    implementation(libs.androidx.arch.core.testing)
    implementation(libs.androidx.test.core)
    implementation(libs.androidx.test.espresso.contrib)
    implementation(libs.androidx.test.espresso.core)
    implementation(libs.androidx.test.espresso.intents)
    implementation(libs.androidx.test.rules)
    implementation(libs.androidx.test.runner)
    implementation(libs.kotlin.test)
    implementation(libs.kotlin.test.junit)
    implementation(libs.robolectric)
    implementation(libs.timber)
    implementation(libs.turbine)
}

tasks.withType<Test> {
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true // Logs stdout/stderr from tests
    }
}
