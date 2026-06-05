# LifeOS — System Manual

## Project Identity

This is **LifeOS**, a local-first personal dashboard. It uses Astro for the UI and local Markdown/JSON files in `src/content/` for the database.

## The Two Modes

### APP MODE
If asked to build a new feature, view, or "stack" (like a Budget view): create `.astro` pages, React components, and define the data schema.

### DATA MODE
If asked to log a record, save a recipe, or add an entry: **do not write UI code.** Act as the database administrator — create or update the raw Markdown/JSON data files in `src/content/` and do nothing else.

## Execution

- Run `npm run build` after changing structural code.
- Do **not** rebuild when only modifying data files.

## Docker Deployment

LifeOS runs as a Portainer-managed stack on `lifeos.wolfdivided` and `lifeos.localhost` via Traefik.

- **Project compose** (dev + build): `/home/cjay/WebstormProjects/lifeos/docker-compose.yml`
- **Portainer stack compose** (image-only): `/home/cjay/DockerFiles/lifeos/docker-compose.yml`
- **Env file**: `/home/cjay/WebstormProjects/lifeos/.env`

### First-time Portainer stack setup

1. Build the image:
   ```bash
   cd /home/cjay/WebstormProjects/lifeos
   docker build -t lifeos:latest .
   ```
2. In Portainer → Stacks → Add stack → Upload → select `/home/cjay/DockerFiles/lifeos/docker-compose.yml`, name it `lifeos` → Deploy.

### Updating after code changes

**Nothing to do.** The container bind-mounts the repo read-only and runs `nodemon` (see `nodemon.json` + `scripts/build-and-serve.sh`): saving structural code on the host triggers an in-container `astro build` + server restart automatically (~10–30s). Data writes under `src/content/` are ignored by the watcher. A failed build doesn't kill the container — nodemon waits for the next file change and retries (check `docker logs lifeos`).

Dependency changes are also automatic: `npm install <pkg>` on the host updates `package-lock.json`, which the watcher detects and re-runs `npm ci` inside the container.

Rebuild the image only if the `Dockerfile` itself or the Node major version changes:

```bash
cd /home/cjay/WebstormProjects/lifeos
docker build -t lifeos:latest .
docker compose -p lifeos up -d
```

Or after rebuilding, go to Portainer → Stacks → lifeos → Recreate. (A pinned, non-watching production image is still available via `docker build --target runtime`.)
