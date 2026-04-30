# node-hello-dockerfile

Minimal Node.js Hello-World used to test the **Project Upload** flow with a
single Dockerfile.

Layout:

```
.
|-- Dockerfile
|-- package.json
|-- server.js
`-- README.md
```

What to expect:

- The backend decision engine detects `Dockerfile` in `input_metadata.dockerfiles`.
- Hadolint runs and produces a clean or near-clean report.
- Security and resource-estimate plugins add their meta blocks.
