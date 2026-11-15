plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps these (see .github/workflows/tv-apk.yml); local builds use the defaults.
val tvVersionName = (project.findProperty("tvVersionName") as String?) ?: "1.0.0"
val tvVersionCode = ((project.findProperty("tvVersionCode") as String?) ?: "1").toInt()

android {
    namespace = "com.tanush.stashr.tv"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.tanush.stashr.tv"
        minSdk = 24
        targetSdk = 35
        versionCode = tvVersionCode
        versionName = tvVersionName
                buildConfigField("String", "DEFAULT_SERVER", "\"https://password-manager-server-xxdr.onrender.com\"")
                buildConfigField("String", "DEFAULT_SERVER2", "\"https://password-manager-server-g305.onrender.com\"")
        buildConfigField("String", "DEFAULT_SERVERS", "\"https://password-manager-server-xxdr.onrender.com,https://password-manager-server-g305.onrender.com,https://password-manager-server-10od.onrender.com,https://stashr-home-automation.onrender.com,https://stashr-home-automation-gk9p.onrender.com,https://password-manager-server-8gvj.onrender.com\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        debug {
            applicationIdSuffix = ".dev"   // installs next to the signed app, so trying a build never touches the linked one
        }
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
    val media3 = "1.5.1"
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")   // the player controls of Media3 inflate with an AppCompat theme
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
