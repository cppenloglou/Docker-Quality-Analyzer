# compose-stack

Small project used to test the **Project Upload** flow with both a
`docker-compose.yml` and a `Dockerfile` inside.

Layout:

```
.
|-- Dockerfile
|-- docker-compose.yml
|-- package.json
|-- server.js
`-- README.md
```

What to expect:

- `input_metadata.dockerfiles` will contain `Dockerfile`.
- `input_metadata.compose_files` will contain `docker-compose.yml`.
- Analysis runs Hadolint, the compose validator and the runnability precheck.
- Because the compose file has no build contexts, no bind mounts and uses
  pinned non-latest images, the runnability precheck passes and the
  **Run Containers** action is enabled from the Results page.
