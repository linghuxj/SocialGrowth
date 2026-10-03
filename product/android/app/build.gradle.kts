import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseInputs = mapOf(
    "versionCode" to "SG_PRODUCT_ANDROID_VERSION_CODE",
    "versionName" to "SG_PRODUCT_ANDROID_VERSION_NAME",
    "previousVersionCode" to "SG_PRODUCT_ANDROID_PREVIOUS_VERSION_CODE",
    "apiBaseUrl" to "SG_PRODUCT_ANDROID_API_BASE_URL",
    "keystore" to "SG_PRODUCT_ANDROID_SIGNING_KEYSTORE",
    "keyAlias" to "SG_PRODUCT_ANDROID_SIGNING_KEY_ALIAS",
    "storePassword" to "SG_PRODUCT_ANDROID_SIGNING_STORE_PASSWORD",
    "keyPassword" to "SG_PRODUCT_ANDROID_SIGNING_KEY_PASSWORD",
    "certificateSha256" to "SG_PRODUCT_ANDROID_SIGNING_CERT_SHA256",
)

fun releaseValue(name: String): String? = providers.environmentVariable(releaseInputs.getValue(name)).orNull

fun requireReleaseValue(name: String): String = releaseValue(name)?.takeIf(String::isNotBlank)
    ?: error("Missing required Android release input: $name (value omitted)")

fun validateReleaseInputs(): Map<String, String> {
    val versionCode = requireReleaseValue("versionCode").toIntOrNull()
        ?: error("SG_PRODUCT_ANDROID_VERSION_CODE must be a positive integer")
    val previousVersionCode = requireReleaseValue("previousVersionCode").toIntOrNull()
        ?: error("SG_PRODUCT_ANDROID_PREVIOUS_VERSION_CODE must be a positive integer")
    require(versionCode > 0 && previousVersionCode > 0 && versionCode > previousVersionCode) {
        "Android release versionCode must be greater than the explicitly supplied previousVersionCode"
    }
    val versionName = requireReleaseValue("versionName")
    require(Regex("^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$").matches(versionName)) {
        "SG_PRODUCT_ANDROID_VERSION_NAME must be a simple non-empty release label"
    }
    val apiBaseUrl = requireReleaseValue("apiBaseUrl")
    val endpoint = runCatching { URI(apiBaseUrl) }.getOrNull()
    require(endpoint?.scheme.equals("https", ignoreCase = true) && endpoint?.host != null && endpoint.userInfo == null) {
        "SG_PRODUCT_ANDROID_API_BASE_URL must be an absolute HTTPS URL with a hostname"
    }
    val host = endpoint!!.host.lowercase()
    require(apiBaseUrl.none { it.isWhitespace() || it == '"' || it == '\\' } && endpoint.rawFragment == null) {
        "SG_PRODUCT_ANDROID_API_BASE_URL contains unsupported URL characters"
    }
    val reservedPlaceholderHost = listOf(".invalid", ".example", ".example.com", ".example.net", ".example.org", ".localhost", ".test")
        .any(host::endsWith) || host in setOf("example.com", "example.net", "example.org", "localhost", "test")
    require(!reservedPlaceholderHost) {
        "SG_PRODUCT_ANDROID_API_BASE_URL must not use a reserved placeholder or local hostname"
    }
    return mapOf("versionCode" to versionCode.toString(), "versionName" to versionName, "apiBaseUrl" to apiBaseUrl)
}

fun validateReleaseCertificate() {
    val keystorePath = requireReleaseValue("keystore")
    val keyAlias = requireReleaseValue("keyAlias")
    val storePassword = requireReleaseValue("storePassword")
    val keyPassword = requireReleaseValue("keyPassword")
    val expected = requireReleaseValue("certificateSha256").replace(":", "").lowercase()
    require(Regex("^[0-9a-f]{64}$").matches(expected)) {
        "SG_PRODUCT_ANDROID_SIGNING_CERT_SHA256 must be a SHA-256 hex fingerprint"
    }
    val file = file(keystorePath)
    require(file.isFile) { "Configured Android release keystore is unavailable" }
    val keyStore = sequenceOf("PKCS12", "JKS").mapNotNull { type ->
        runCatching {
            KeyStore.getInstance(type).apply { file.inputStream().use { load(it, storePassword.toCharArray()) } }
        }.getOrNull()
    }.firstOrNull() ?: error("Configured Android release keystore could not be opened")
    val certificate = keyStore.getCertificate(keyAlias)
        ?: error("Configured Android release alias has no certificate")
    require(keyStore.isKeyEntry(keyAlias) && keyStore.getKey(keyAlias, keyPassword.toCharArray()) != null) {
        "Configured Android release alias is not a usable signing key"
    }
    val actual = MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
        .joinToString("") { "%02x".format(it) }
    require(actual == expected) { "Configured Android release certificate fingerprint does not match the expected public fingerprint" }
}

val verifyProductAndroidReleaseInputs = tasks.register("verifyProductAndroidReleaseInputs") {
    group = "verification"
    description = "Validates explicit release version, endpoint, and signing certificate inputs without printing their values."
    doLast {
        validateReleaseInputs()
        validateReleaseCertificate()
    }
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
        val verifierTransportChecks = providers.gradleProperty("sgVerifierTransportChecks").orElse("false").get()
        val admissionApiChecks = providers.gradleProperty("sgAdmissionApiChecks").orElse("false").get()
        require(nativeDiscoveryChecks in setOf("true", "false")) { "sgNativeDiscoveryChecks must be true or false" }
        require(verifierTransportChecks in setOf("true", "false") && !(nativeDiscoveryChecks == "true" && verifierTransportChecks == "true"))
        require(admissionApiChecks in setOf("true", "false") && listOf(nativeDiscoveryChecks, verifierTransportChecks, admissionApiChecks).count { it == "true" } <= 1)
        testInstrumentationRunner = when {
            admissionApiChecks == "true" -> "com.socialgrowth.product.AdmissionApiInstrumentation"
            verifierTransportChecks == "true" -> "com.socialgrowth.product.VerifierTransportInstrumentation"
            nativeDiscoveryChecks == "true" -> "com.socialgrowth.product.NativeDiscoveryInstrumentation"
            else -> "com.socialgrowth.product.EnrollmentCryptoInstrumentation"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        getByName("debug") {
            val debugBase = providers.environmentVariable("SG_PRODUCT_ANDROID_DEBUG_API_BASE_URL").orElse("http://127.0.0.1:4320").get()
            require(debugBase == "http://127.0.0.1:4320" || Regex("^https://[a-z0-9-]+\\.tail[a-z0-9]+\\.ts\\.net:8443$").matches(debugBase))
            buildConfigField("String", "API_BASE_URL", "\"$debugBase\"")
            buildConfigField("boolean", "ENDPOINT_DIAGNOSTICS", (debugBase.startsWith("https://")).toString())
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            buildConfigField("boolean", "ENDPOINT_DIAGNOSTICS", "false")
            val releaseApiBaseUrl = releaseValue("apiBaseUrl") ?: "https://release-input-required.invalid"
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            val signingValuesPresent = listOf("keystore", "keyAlias", "storePassword", "keyPassword", "certificateSha256")
                .all { !releaseValue(it).isNullOrBlank() }
            if (signingValuesPresent) {
                signingConfig = signingConfigs.create("productRelease") {
                    storeFile = file(requireReleaseValue("keystore"))
                    this.keyAlias = requireReleaseValue("keyAlias")
                    storePassword = requireReleaseValue("storePassword")
                    keyPassword = requireReleaseValue("keyPassword")
                }
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.outputs.forEach { output ->
            output.versionCode.set(
                providers.environmentVariable("SG_PRODUCT_ANDROID_VERSION_CODE").map(String::toInt).orElse(1),
            )
            output.versionName.set(
                providers.environmentVariable("SG_PRODUCT_ANDROID_VERSION_NAME").orElse("0.0.0"),
            )
        }
    }
}

tasks.configureEach {
    val releaseArtifactTask = name.contains("release", ignoreCase = true) &&
        listOf("package", "assemble", "bundle").any { name.startsWith(it, ignoreCase = true) }
    if (name == "preReleaseBuild" || releaseArtifactTask) {
        dependsOn(verifyProductAndroidReleaseInputs)
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
