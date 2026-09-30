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
        val nativeDiscoveryChecks = providers.gradleProperty("sgNativeDiscoveryChecks").orElse("false").get()
        require(nativeDiscoveryChecks in setOf("true", "false")) { "sgNativeDiscoveryChecks must be true or false" }
        testInstrumentationRunner = if (nativeDiscoveryChecks == "true") "com.socialgrowth.product.NativeDiscoveryInstrumentation"
            else "com.socialgrowth.product.EnrollmentCryptoInstrumentation"
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
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.core:core:1.15.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20250517")
}
