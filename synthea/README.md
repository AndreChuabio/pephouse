# Synthea -> Supabase (working recipe)

Generates a synthetic patient cohort and loads it into `synthetic_patients`.

## Generate the cohort
```bash
cd synthea
curl -sL -o synthea-with-dependencies.jar \
  https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar
docker build -t synthea-local .
# Stream the CSV output out as a tar (no bind mount -- macOS bind mounts are flaky here):
docker run --rm synthea-local bash -c \
  'mkdir -p /out && java -cp /app App -p 100 --exporter.csv.export true --exporter.baseDirectory /out Massachusetts >/dev/null 2>&1; tar -C /out -cf - csv' \
  | tar -C . -xf -
# -> ./csv/patients.csv, conditions.csv, observations.csv, ...
```

## Load into Supabase
```bash
python3 ../scripts/load_synthea.py csv      # needs ../backend/.env (SUPABASE_URL + secret key)
```

## Why not `java -jar`?
The fat jar has 71k+ entries -> Zip64 central directory -> the `-jar` launcher
rejects it. Run via classpath against the exploded dir instead: `java -cp /app App`.

## Note
Vanilla Synthea generates a general Massachusetts population. To match a trial's
eligibility (e.g. obese / T2D for GLP-1s), either filter the cohort or add a
Synthea module (see `scripts/build_synthea_module.py`). The precise outcome draw
stays in the Monte Carlo, off `outcome_priors` -- not in Synthea.
