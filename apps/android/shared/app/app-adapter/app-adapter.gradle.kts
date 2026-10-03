plugins {
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.android.library")
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "androperator.app.adapter"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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
    implementation(project(":shared:core:common"))
    implementation(project(":shared:core:devicepackage"))
    implementation(project(":shared:data:content"))
    implementation(project(":shared:data:content-model"))
    implementation(project(":shared:data:operator"))
    implementation(project(":shared:data:resources"))
    implementation(project(":shared:data:task"))
    implementation(project(":shared:data:toolkit"))
    implementation(project(":shared:data:trigger"))
    implementation(project(":shared:data:uitree"))
    implementation(project(":shared:data:workflow"))
    
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.koin.core)
    implementation(libs.koin.android)
    implementation(libs.compose.material3)
    implementation(libs.compose.runtime)
    implementation(libs.compose.ui)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel)
    
    testImplementation(libs.koin.test)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.androidx.arch.core.testing)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.robolectric)
}
