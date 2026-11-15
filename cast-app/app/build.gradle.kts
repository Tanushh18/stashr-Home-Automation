plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps these (see .github/workflows/cast-apk.yml); local builds use the defaults.
val castVersionName = (project.findProperty("castVersionName") as String?) ?: "1.0.0"
val castVersionCode = ((project.findProperty("castVersionCode") as String?) ?: "1").toInt()

android {
    namespace = "com.tanush.stashr.cast"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.tanush.stashr.cast"
        minSdk = 26
        targetSdk = 35
        versionCode = castVersionCode
        versionName = castVersionName
                buildConfigField("String", "DEFAULT_SERVER", "\"https://password-manager-server-xxdr.onrender.com\"")
                buildConfigField("String", "DEFAULT_SERVER2", "\"https://password-manager-server-g305.onrender.com\"")
        buildConfigField("String", "DEFAULT_SERVERS", "\"https://password-manager-server-xxdr.onrender.com,https://password-manager-server-g305.onrender.com,https://password-manager-server-10od.onrender.com,https://stashr-home-automation.onrender.com,https://stashr-home-automation-gk9p.onrender.com,https://password-manager-server-8gvj.onrender.com\"")
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
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
