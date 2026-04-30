# Examples - walk the app like a real user

Drop-in test artifacts for the three workflows of the app.

Start the stack:

```bash
docker compose up --build
```

then open `http://localhost:3000`, register an account, and use the files below.

## Folder layout

```
examples/
|-- dockerfiles/
|   |-- clean.Dockerfile           # expect high score, clean hadolint report
|   |-- issues.Dockerfile          # expect many warnings + security issues
|   `-- python-api.Dockerfile      # mixed best-practice suggestions
|-- compose/
|   |-- runnable.yml               # runnability precheck passes (deploy allowed)
|   `-- blocked.yml                # multiple runnability violations
`-- projects/
    |-- node-hello-dockerfile.zip  # project with a single Dockerfile
    |-- compose-stack.zip          # project with a runnable compose stack
    |-- python-webapp.zip          # project with a blocked compose (build + bind)
    `-- src/                       # un-zipped sources for reference
```

## A. Dockerfile analysis flow

1. On the Landing page, drag-and-drop a file from `examples/dockerfiles/`.
2. Click **Start Analysis**.
3. On the `/analysis` page you should see the live job event stream:
   `user.analysis.started` -> `user.analysis.completed`.
4. The Results page renders issues, resource estimate meta, and a score.

Try:

- `clean.Dockerfile` -> expect grade A / B with few issues.
- `issues.Dockerfile` -> expect grade D / F with hadolint warnings (`DL3007`
  `:latest` tag, `DL3008` pin versions) and security hits (hard-coded secret,
  running as root).
- `python-api.Dockerfile` -> expect a moderate score with a handful of
  best-practice suggestions.

## B. Compose analysis + deploy flow

1. From Landing, upload a file from `examples/compose/`.
2. Click **Start Analysis** and watch the job complete.
3. On the Results page, look at the **Deploy Runnability** card.

Try:

- `runnable.yml` -> runnability is **Runnable**; **Run Containers** is enabled.
  Clicking it takes you to `/execution`. Press **Deploy now** to POST
  `/api/v1/compose/deploy` and watch the live timeline pick up
  `docker.image.pushed`, `container.started`, `container.metrics` events.
  Click **Watch metrics** once a container id appears to open the real
  CPU / memory charts.
- `blocked.yml` -> runnability is **Blocked**. The Results page lists reasons
  (build context, `:latest`, bind mount, `env_file`, unresolved `${API_URL}`,
  `privileged`, `network_mode: host`, external network/volume). The
  **Run Containers** button is disabled for standalone compose.

## C. Project upload flow

1. Go to **Upload Project Archive** from Landing.
2. Select one of the `examples/projects/*.zip` archives.
3. You are forwarded to `/analysis?jobId=...` which attaches to the queued
   project job over WebSocket.

Try:

- `node-hello-dockerfile.zip` -> the decision engine detects the single
  Dockerfile, runs Hadolint and produces results. The Results page lists the
  `Detected files in archive` block.
- `compose-stack.zip` -> both Dockerfile and compose are detected.
  Runnability passes, so **Run Containers** is enabled on the Results page.
- `python-webapp.zip` -> compose is flagged as not runnable (build context +
  bind mount). Project jobs are not hard-blocked from deploy, but the reasons
  are rendered clearly in the Results view.

## D. API keys + direct API

1. Open the top-right **API Keys** link in the nav.
2. Click **Create new key**. Copy the displayed raw key immediately (it is only
   shown once).
3. Use it from a terminal:

```bash
API=http://localhost:3000
KEY=dpa_XXXXXXXXXXXXXXXXXX

curl -s -H "X-Api-Key: $KEY" $API/api/v1/users/me/history | jq .

curl -s -H "X-Api-Key: $KEY" \
    -F "file=@examples/dockerfiles/issues.Dockerfile" \
    $API/api/v1/dockerfile/analyze | jq .
```

## E. Live event stream (optional)

Once a job is running, the WebSocket feed is available at
`ws://localhost:3000/ws/jobs/<job_id>?token=<access_token>` through the nginx
proxy. The UI already subscribes; this is just documentation for scripting.

## Regenerate the zips

The zip archives are tracked to make demos reproducible. If you change the
sources in `examples/projects/src/`, regenerate them with:

```bash
cd examples/projects/src
for dir in node-hello-dockerfile compose-stack python-webapp; do
  ( cd "$dir" && zip -qr "../../${dir}.zip" . )
done
```
