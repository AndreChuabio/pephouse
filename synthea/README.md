# Synthea -> Supabase

## Read this first (Kien)
**Synthea's only job here is to generate the baseline patient cohort — and it's already done.**
`synthetic_patients` has 47 patients (avg age 50, 9 over 90kg, 22 with HbA1c). That's the bodies.

**The drug-effect draw is NOT in Synthea — it's in the Monte Carlo (`/simulate`, off `outcome_priors`).**
So you do **not** need to make custom Synthea modules work. The vanilla Massachusetts run is the recipe,
on purpose. If the modules are giving you grief, skip them — they are not on the critical path. Spend the
time on `/simulate` instead.

## Generate the cohort (already run; here for reproducibility)
```bash
cd synthea
curl -sL -o synthea-with-dependencies.jar \
  https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar
docker build -t synthea-local .
# Stream CSV out as a tar (no bind mount -- macOS bind mounts are flaky here):
docker run --rm synthea-local bash -c \
  'mkdir -p /out && java -cp /app App -p 100 --exporter.csv.export true --exporter.baseDirectory /out Massachusetts >/dev/null 2>&1; tar -C /out -cf - csv' \
  | tar -C . -xf -
python3 ../scripts/load_synthea.py csv      # -> synthetic_patients (needs ../backend/.env)
```

## Why `java -cp /app App`, not `java -jar`?
The fat jar has 71k+ entries -> Zip64 central directory -> the `-jar` launcher rejects it. Run via classpath
against the exploded dir instead.

## Custom modules — OPTIONAL, and how to actually load them (the gap in the old recipe)
The old recipe ran vanilla Massachusetts and silently ignored any modules — that's the inconsistency you spotted.
Fixed: Synthea auto-loads every `.json` under the classpath `modules/` dir, so the Dockerfile now copies
`synthea/peptide-modules/` into `/app/modules/pephouse/`. To use them:
```bash
python3 ../scripts/build_synthea_module.py     # writes Generic Module JSON from outcome_priors
mv ../synthea_modules/*.json peptide-modules/   # (or point the script's OUT_DIR here)
docker build -t synthea-local .                 # bakes them in; they now auto-load
# NOTE: there is NO `--module` flag. `-m <name>` FILTERS which modules run, it does not load them.
# Loading = being present under the classpath modules/ dir, which the COPY above handles.
```
But again: these modules only apply a **coarse** placeholder effect on purpose — the real `N(mean,SD)` draw
lives in the Monte Carlo. So this whole section is a nice-to-have, not a requirement.
