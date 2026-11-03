plugins { id("org.springframework.boot") }
dependencies {
    implementation(project(":support"))
    runtimeOnly("org.postgresql:postgresql:42.7.0")
    testImplementation("com.h2database:h2:2.2.0")
}
