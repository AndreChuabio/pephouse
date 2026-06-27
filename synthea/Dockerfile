# Working Synthea-in-Docker recipe. Two macOS gotchas are baked around:
#  1. The fat jar has 71k+ entries => Zip64 => `java -jar` fails ("invalid or
#     corrupt jarfile"). Fix: unzip it and run via classpath (Main-Class: App).
#  2. macOS Docker bind mounts of the jar are flaky. Fix: COPY the jar into the
#     image (below) and stream output out as a tar instead of bind-mounting.
FROM eclipse-temurin:17-jdk
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*
COPY synthea-with-dependencies.jar /synthea_fat.jar
RUN mkdir -p /app && cd /app && unzip -q /synthea_fat.jar && test -f App.class
# OPTIONAL: anything in ./peptide-modules/ auto-loads as a Generic Module from the classpath
# modules/ dir at runtime -- NO flag needed (the `-m` CLI flag is a name FILTER, not a loader).
# Empty by default => vanilla cohort. This is the path Kien's screenshot was missing.
COPY peptide-modules/ /app/modules/pephouse/
WORKDIR /app
