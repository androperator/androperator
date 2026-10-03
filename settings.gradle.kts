pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "androperator"

include(":apps:android")
project(":apps:android").projectDir = file("apps/android")

include(":apps:android:app-conformance")
project(":apps:android:app-conformance").projectDir = file("apps/android/app-conformance")

include(":shared")
project(":shared").projectDir = file("apps/android/shared")

include(":app")
project(":app").projectDir = file("apps/android/app")

include(":shared:app:app-adapter")
project(":shared:app:app-adapter").projectDir = file("apps/android/shared/app/app-adapter")

include(":shared:app")
project(":shared:app").projectDir = file("apps/android/shared/app")

include(":shared:core:common")
project(":shared:core:common").projectDir = file("apps/android/shared/core/common")

include(":shared:core")
project(":shared:core").projectDir = file("apps/android/shared/core")

include(":shared:core:devicepackage")
project(":shared:core:devicepackage").projectDir = file("apps/android/shared/core/devicepackage")

include(":shared:core:toolkit")
project(":shared:core:toolkit").projectDir = file("apps/android/shared/core/toolkit")

include(":shared:data:content")
project(":shared:data:content").projectDir = file("apps/android/shared/data/content")

include(":shared:data:content-model")
project(":shared:data:content-model").projectDir = file("apps/android/shared/data/content-model")

include(":shared:data")
project(":shared:data").projectDir = file("apps/android/shared/data")

include(":shared:data:operator")
project(":shared:data:operator").projectDir = file("apps/android/shared/data/operator")

include(":shared:data:resources")
project(":shared:data:resources").projectDir = file("apps/android/shared/data/resources")

include(":shared:data:task")
project(":shared:data:task").projectDir = file("apps/android/shared/data/task")

include(":shared:data:toolkit")
project(":shared:data:toolkit").projectDir = file("apps/android/shared/data/toolkit")

include(":shared:data:trigger")
project(":shared:data:trigger").projectDir = file("apps/android/shared/data/trigger")

include(":shared:data:uitree")
project(":shared:data:uitree").projectDir = file("apps/android/shared/data/uitree")

include(":shared:data:workflow")
project(":shared:data:workflow").projectDir = file("apps/android/shared/data/workflow")

include(":shared:app:di")
project(":shared:app:di").projectDir = file("apps/android/shared/app/di")

include(":shared:test")
project(":shared:test").projectDir = file("apps/android/shared/test")

include(":notification-media-fixture")
project(":notification-media-fixture").projectDir = file("validation/notifications-media/fixture")

fun renameBuildFileToModuleName(project: ProjectDescriptor) {
    project.buildFileName = "${project.name}.gradle.kts"
    project.children.forEach { child -> renameBuildFileToModuleName(child) }
}

rootProject.children.forEach { subproject: ProjectDescriptor ->
    renameBuildFileToModuleName(subproject)
}
