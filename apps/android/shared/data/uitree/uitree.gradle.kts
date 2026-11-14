plugins {
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.android.library")
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "androperator.uitree"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = libs.versions.composeCompiler.get()
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }
}

dependencies {
    implementation(project(":shared:core:common"))
    api(project(":shared:core:toolkit"))
    api(project(":shared:data:content-model"))
    implementation(project(":shared:data:resources"))
    implementation(project(":shared:data:toolkit"))
    
    implementation(libs.kotlinx.serialization.json)
    
    implementation(libs.androidx.core)
    implementation(libs.compose.material)
    implementation(libs.compose.runtime)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.koin.android)
    implementation(libs.process.phoenix)
    implementation(libs.timber)
}
