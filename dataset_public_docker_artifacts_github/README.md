# Public Docker Artifacts Dataset (GitHub)

A curated dataset of **102 Docker artifacts** collected from publicly available GitHub repositories, assembled as the input corpus for the Phase B empirical evaluation of the Docker Quality Analyzer (see [README-evaluation.md](../README-evaluation.md)).

## Composition

| Dimension | Value |
| --- | --- |
| Total artifacts | 102 |
| Dockerfiles | 49 (`dockerfiles/`) |
| Compose manifests | 53 (`compose/`) |
| Total source lines | 13,082 (per `manifest.csv`) |

The dataset is stratified into two sampling strata, recorded per artifact in the manifest:

| Stratum | Artifacts | Description |
| --- | --- | --- |
| `production` | 46 | Artifacts taken from widely used, production-grade open-source projects (e.g. Apache Airflow, Apache Superset, Grafana, Mastodon, Supabase, Immich, MinIO) |
| `curated-examples` | 56 | Artifacts from Docker's official [`awesome-compose`](https://github.com/docker/awesome-compose) curated example collection |

This stratification allows analysis results to be compared between large real-world configurations and small, didactic reference configurations.

## Directory Layout

```
dataset_public_docker_artifacts_github/
|-- manifest.csv     # provenance and metadata for every artifact
|-- dockerfiles/     # 49 Dockerfile artifacts
`-- compose/         # 53 Compose manifest artifacts
```

## Manifest Schema (`manifest.csv`)

One row per artifact with the following columns:

| Column | Meaning | Example |
| --- | --- | --- |
| `type` | Artifact class: `dockerfile` or `compose` | `dockerfile` |
| `filename` | Flattened filename within this dataset | `apache__airflow.Dockerfile` |
| `source_path` | Original path in the source repository (`{org}/{repo}/{path}`) | `apache/airflow/Dockerfile` |
| `lines` | Line count of the artifact | `2259` |
| `stratum` | Sampling stratum: `production` or `curated-examples` | `production` |

## File-Naming Convention

Source repository paths are flattened into unique filenames using double underscores as separators:

- Dockerfiles: `{org}__{repo}[_{component}].Dockerfile` — e.g. `apache__airflow.Dockerfile`, `awesome-compose__react-express-mysql_backend.Dockerfile`
- Compose manifests: `{org}__{repo}__compose[.variant].yml` or, for awesome-compose entries, `awesome-compose__{example}.yml` — e.g. `appwrite__appwrite__compose.yml`, `paperless-ngx__paperless-ngx__compose.postgres.yml`, `awesome-compose__fastapi.yml`

The mapping back to the exact original location is always available via the `source_path` column of the manifest.

## Intended Use

The dataset serves as a fixed, reproducible input corpus for evaluating the platform's analyzers at scale: each artifact is submitted through the public analysis API by `phase_b_runner.py`, the raw per-artifact results are stored under `phase_b_results/`, and aggregate statistics are derived by `phase_b_aggregate.py`. The full methodology and the headline results are documented in [README-evaluation.md](../README-evaluation.md).

The artifacts are static analysis inputs only; nothing in this dataset is built or executed by the evaluation pipeline.

## Licensing and Attribution

All artifacts originate from third-party public GitHub repositories and remain subject to the licenses of their respective source projects. They are reproduced here solely for research and evaluation purposes, in unmodified form apart from filename flattening. The `source_path` column of `manifest.csv` provides full attribution for every artifact; consult the upstream repository before any reuse beyond this evaluation context.

## Related Documents

- [README-evaluation.md](../README-evaluation.md) — Phase B evaluation methodology and results
- [Root README](../README.md) — platform overview
