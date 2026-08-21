# railway-sandbox-mcp

A small MCP bridge that lets ChatGPT drive Railway Sandboxes as an isolated development/execution environment.

## Architecture

- `sandbox-mcp`: this Node service, reachable only over Railway private networking at `/mcp`.
- `tunnel-client`: the official `ghcr.io/openai/tunnel-client` image, which connects outbound to OpenAI and forwards MCP traffic to this service.
- Railway Sandboxes: ephemeral isolated Linux VMs with outbound Internet access used for builds, tests, package installation, scripts, and other development commands.

## Required environment variables

The MCP service requires:

- `RAILWAY_API_TOKEN`: Railway API token with access to the environment where Sandboxes are enabled.
- `RAILWAY_ENVIRONMENT_ID`: injected automatically by Railway.

The tunnel-client service requires the variables documented by OpenAI's secure MCP tunnel guide, including the tunnel ID and runtime API key, plus:

- `MCP_SERVER_URL=http://sandbox-mcp.railway.internal:8080/mcp`

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
