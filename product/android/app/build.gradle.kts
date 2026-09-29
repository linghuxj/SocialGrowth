plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.socialgrowth.product"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.socialgrowth.product"
        minSdk = 27
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        getByName("debug") {
            buildConfigField("String", "API_BASE_URL", "\"http://127.0.0.1:4320\"")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            val releaseApiBaseUrl = providers.environmentVariable("SG_PRODUCT_ANDROID_API_BASE_URL")
                .orElse("https://api.invalid.socialgrowth.example")
                .get()
            require(releaseApiBaseUrl.startsWith("https://")) {
                "SG_PRODUCT_ANDROID_API_BASE_URL must use HTTPS for release builds"
            }
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20250517")
}
