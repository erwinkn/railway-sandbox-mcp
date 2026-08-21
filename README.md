# railway-sandbox-mcp

A small MCP bridge that lets ChatGPT drive Railway Sandboxes as an isolated development/execution environment.

## Architecture

Both long-running Railway services are deployed from this GitHub repository through Railway's GitHub integration:

| Railway service | GitHub branch | Railway root directory | Purpose |
| --- | --- | --- | --- |
| `sandbox-mcp` | `main` | `/` | Node MCP server backed by the Railway Sandbox SDK |
| `tunnel-client` | `main` | `/tunnel-client` | OpenAI Secure MCP Tunnel client, built from `tunnel-client/Dockerfile` |

The `tunnel-client` Dockerfile inherits the official `ghcr.io/openai/tunnel-client:latest` image. Railway therefore owns the deployment lifecycle while OpenAI remains the upstream image provider.

Traffic flow:

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

Neither Railway service needs a public domain. The MCP server is reachable only through Railway private networking; the tunnel client makes the outbound connection to OpenAI.

## Railway deployment

Configure both services with the GitHub source `erwinkn/railway-sandbox-mcp` and branch `main`.

### `sandbox-mcp`

- Root directory: `/`
- Start command: `npm start`
- Optional health check: `/health`
- Private hostname used by the tunnel: `sandbox-mcp.railway.internal:8080`

### `tunnel-client`

- Root directory: `/tunnel-client`
- Railway should detect `Dockerfile` automatically.
- Do not configure a custom start command; inherit the official image entrypoint.

With GitHub autodeploy enabled, pushes to `main` rebuild the corresponding Railway service.

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
- `HEALTH_LISTEN_ADDR=0.0.0.0:8080`

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
