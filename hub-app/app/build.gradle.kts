plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps these (see .github/workflows/hub-apk.yml); local builds use the defaults.
val hubVersionName = (project.findProperty("hubVersionName") as String?) ?: "1.0.0"
val hubVersionCode = ((project.findProperty("hubVersionCode") as String?) ?: "1").toInt()

android {
    namespace = "com.tanush.stashr.hub"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.tanush.stashr.hub"
        minSdk = 26
        targetSdk = 35
        versionCode = hubVersionCode
        versionName = hubVersionName
                buildConfigField("String", "DEFAULT_SERVER", "\"https://password-manager-server-xxdr.onrender.com\"")
                buildConfigField("String", "DEFAULT_SERVER2", "\"https://password-manager-server-g305.onrender.com\"")
        buildConfigField("String", "DEFAULT_SERVERS", "\"https://password-manager-server-xxdr.onrender.com,https://password-manager-server-g305.onrender.com,https://password-manager-server-10od.onrender.com,https://stashr-home-automation.onrender.com,https://stashr-home-automation-gk9p.onrender.com\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    val camerax = "1.4.2"
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-video:$camerax")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
