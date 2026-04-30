# python-webapp

Small Flask project used to test the **Project Upload** flow with a
`docker-compose.yml` that exercises the runnability blockers.

Layout:

```
.
|-- Dockerfile
|-- docker-compose.yml
|-- requirements.txt
|-- app/
|   |-- __init__.py
|   `-- main.py
`-- README.md
```

What to expect:

- The compose file uses a `build` context, a bind mount (`./app:/usr/src/app/app`)
  and a dev-style image, so the runnability rules flag several blockers.
- Because this is a **project** job, the Run Containers gate is not hard-blocked,
  but the reasons surface in the Results view so you can see exactly which rules
  failed.
