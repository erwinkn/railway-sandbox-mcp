# railway-sandbox-mcp

A small MCP bridge that lets ChatGPT drive Railway Sandboxes as an isolated development/execution environment.

## Architecture

Both long-running Railway services are deployed from this GitHub repository through Railway's GitHub integration:

| Railway service | GitHub branch | Railway root directory | Config-as-code file | Purpose |
| --- | --- | --- | --- | --- |
| `sandbox-mcp` | `main` | `/` | `/railway.json` | Node MCP server backed by the Railway Sandbox SDK |
| `tunnel-client` | `main` | `/tunnel-client` | `/tunnel-client/railway.json` | OpenAI Secure MCP Tunnel client |

The `tunnel-client` Dockerfile inherits the official `ghcr.io/openai/tunnel-client:latest` image and only wraps its entrypoint so the upstream health/readiness server binds to Railway's injected `PORT`. Railway owns the deployment lifecycle while OpenAI remains the upstream image provider.

```text
ChatGPT
  |
  v
OpenAI Secure MCP Tunnel
  ^
  | outbound HTTPS
  |
tunnel-client (Railway)
  |
  | Railway private network
  v
sandbox-mcp:8080/mcp (Railway)
  |
  v
Railway Sandbox SDK
  |
  v
Ephemeral isolated Linux sandboxes with outbound Internet
```

Neither Railway service needs a public domain.

## Config as code

Deployment behavior is committed to this repository:

- `/railway.json` defines the MCP service builder, watch paths, start command, health check, and restart policy.
- `/tunnel-client/railway.json` defines the tunnel-client Docker build, watch paths, readiness check, and restart policy.
- `/tunnel-client/Dockerfile` selects the official OpenAI tunnel-client image and adapts its health listener to Railway's injected `PORT`.
- `/.github/workflows/ci.yml` validates the Node service and Railway config files and builds the tunnel-client image on pushes and pull requests.

Railway configuration committed in code overrides equivalent dashboard build/deploy values for each deployment.

### One-time Railway service wiring

Source association, trigger branch, and the custom config-file path are Railway service metadata rather than fields inside `railway.json`, so configure these once in Railway:

#### `sandbox-mcp`

- Source repository: `erwinkn/railway-sandbox-mcp`
- Branch: `main`
- Root directory: `/`
- Config file path: `/railway.json`
- GitHub autodeploy: enabled
- Wait for CI: enabled

#### `tunnel-client`

- Source repository: `erwinkn/railway-sandbox-mcp`
- Branch: `main`
- Root directory: `/tunnel-client`
- Config file path: `/tunnel-client/railway.json`
- GitHub autodeploy: enabled
- Wait for CI: enabled
- No custom start command; inherit the repository Dockerfile entrypoint

The service-specific watch paths mean MCP-only changes do not rebuild the tunnel client, and tunnel-only changes do not rebuild the MCP server.

## Required environment variables

### `sandbox-mcp`

- `RAILWAY_API_TOKEN`: Railway API token with access to the environment where Sandboxes are enabled.
- `RAILWAY_ENVIRONMENT_ID`: injected automatically by Railway.

### `tunnel-client`

- `MCP_SERVER_URL=http://sandbox-mcp.railway.internal:8080/mcp`
- `CONTROL_PLANE_TUNNEL_ID=tunnel_...`
- `CONTROL_PLANE_API_KEY=...`: restricted OpenAI runtime key with Tunnel Read + Use permissions.
- `LOG_LEVEL=info`
- `LOG_FORMAT=json`

`tunnel-client` exposes `/healthz`, `/readyz`, and `/metrics` on Railway's injected port. Railway uses `/readyz` as the deployment health check, so a successful tunnel-client deployment verifies both tunnel startup and downstream MCP readiness.

## Deployment flow

A push to `main` runs GitHub Actions. With Railway's **Wait for CI** enabled, Railway waits for CI to pass, then autodeploys only the services whose watch patterns match the changed files.

## MCP tools

- `sandbox_create`
- `sandbox_list`
- `sandbox_get`
- `sandbox_exec`
- `sandbox_read_file`
- `sandbox_list_files`
- `sandbox_write_file`
- `sandbox_write_files`
- `sandbox_checkpoint`
- `sandbox_destroy`
