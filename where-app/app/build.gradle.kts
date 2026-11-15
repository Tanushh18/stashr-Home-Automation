plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")   // reads app/google-services.json (Firebase push: the server can ask this phone for its location)
}

// CI stamps these (see .github/workflows/where-apk.yml); local builds use the defaults.
val whereVersionName = (project.findProperty("whereVersionName") as String?) ?: "1.0.0"
val whereVersionCode = ((project.findProperty("whereVersionCode") as String?) ?: "1").toInt()

android {
    namespace = "com.tanush.stashr.where"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.tanush.stashr.where"
        minSdk = 26
        targetSdk = 35
        versionCode = whereVersionCode
        versionName = whereVersionName
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
    implementation("androidx.core:core-ktx:1.15.0")
    // Pinned to the versions the Hub app uses, so both resolve the same libraries.
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
