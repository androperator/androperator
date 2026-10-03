plugins {
    id("com.android.application")
}

android {
    namespace = "androperator.fixture.media"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.androperator.fixture.media"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1"
    }
    sourceSets.getByName("main").java.srcDir("../android")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
