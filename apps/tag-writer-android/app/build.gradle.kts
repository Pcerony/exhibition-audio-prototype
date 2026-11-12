import java.util.Properties
import org.gradle.api.tasks.Sync
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
val local = Properties().apply { rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }
fun config(name: String): String = (local.getProperty(name) ?: System.getenv(name) ?: "").replace("\\", "\\\\").replace("\"", "\\\"")
val mapAssets = layout.buildDirectory.dir("generated/mapAssets")
val copyPlacementMap by tasks.registering(Sync::class) {
    from(rootProject.file("../../src/domain/map-piece-geometry-v13.json"))
    into(mapAssets)
}
android {
    sourceSets.getByName("main").assets.srcDir(mapAssets)
    namespace = "space.heisei.voicewriter"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "space.heisei.voicewriter"; minSdk = 26; targetSdk = 36
        versionCode = 17; versionName = "3.7.0"
        buildConfigField("String", "SUPABASE_URL", "\"${config("SUPABASE_URL")}\"")
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"${config("SUPABASE_PUBLISHABLE_KEY")}\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
tasks.named("preBuild") { dependsOn(copyPlacementMap) }
dependencies { implementation("androidx.core:core:1.16.0"); testImplementation("junit:junit:4.13.2"); testImplementation("org.json:json:20240303") }
