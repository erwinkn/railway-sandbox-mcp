import { createServer } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Sandbox } from "railway";
import * as z from "zod/v4";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const MCP_PATH = "/mcp";
const MAX_CAPTURED_CHARS = 100_000;
const MAX_BATCH_FILE_BYTES = 5 * 1024 * 1024;

function jsonResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function requireSandboxCredentials() {
  if (!process.env.RAILWAY_API_TOKEN) {
    throw new Error(
      "RAILWAY_API_TOKEN is not configured on the MCP service. Create a Railway API token and add it as a service variable.",
    );
  }
  if (!process.env.RAILWAY_ENVIRONMENT_ID) {
    throw new Error("RAILWAY_ENVIRONMENT_ID is unavailable in this Railway deployment.");
  }
}

function safeTool(fn) {
  return async (args) => {
    try {
      requireSandboxCredentials();
      return await fn(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

function clip(text) {
  if (text.length <= MAX_CAPTURED_CHARS) {
    return { text, clipped: false };
  }

  const half = Math.floor(MAX_CAPTURED_CHARS / 2);
  return {
    text: `${text.slice(0, half)}\n\n... [output clipped by MCP bridge] ...\n\n${text.slice(-half)}`,
    clipped: true,
  };
}

function sandboxSummary(sandbox) {
  return {
    id: sandbox.id,
    status: sandbox.status,
    region: sandbox.region,
    networkIsolation: sandbox.networkIsolation,
  };
}

async function connectSandbox(id) {
  return Sandbox.connect(id);
}

function buildServer() {
  const server = new McpServer({
    name: "railway-sandbox-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "sandbox_create",
    {
      title: "Create sandbox",
      description:
        "Create an isolated Railway Linux sandbox with outbound Internet access. The sandbox is not attached to the Railway private network and receives no service secrets.",
      inputSchema: z.object({
        idleTimeoutMinutes: z.number().int().min(1).max(120).default(30),
        region: z.string().min(1).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safeTool(async ({ idleTimeoutMinutes, region }) => {
      const sandbox = await Sandbox.create({
        idleTimeoutMinutes,
        networkIsolation: "ISOLATED",
        ...(region ? { region } : {}),
      });
      return jsonResult(sandboxSummary(sandbox));
    }),
  );

  server.registerTool(
    "sandbox_list",
    {
      title: "List sandboxes",
      description: "List Railway sandboxes in this service's Railway environment.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async () => {
      const sandboxes = await Sandbox.list();
      return jsonResult(sandboxes.map(sandboxSummary));
    }),
  );

  server.registerTool(
    "sandbox_get",
    {
      title: "Get sandbox",
      description: "Reconnect to a sandbox by id and return its current status.",
      inputSchema: z.object({ sandboxId: z.string().min(1) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId }) => {
      const sandbox = await connectSandbox(sandboxId);
      await sandbox.refresh();
      return jsonResult(sandboxSummary(sandbox));
    }),
  );

  server.registerTool(
    "sandbox_exec",
    {
      title: "Execute sandbox command",
      description:
        "Run an arbitrary shell command in an isolated Railway sandbox. Use this for package installation, builds, tests, compilers, scripts, git operations against accessible repositories, and other development commands.",
      inputSchema: z.object({
        sandboxId: z.string().min(1),
        command: z.string().min(1),
        cwd: z.string().min(1).optional(),
        timeoutSec: z.number().int().min(1).max(900).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safeTool(async ({ sandboxId, command, cwd, timeoutSec }) => {
      const sandbox = await connectSandbox(sandboxId);
      const result = await sandbox.exec(command, {
        ...(cwd ? { cwd } : {}),
        ...(timeoutSec ? { timeoutSec } : {}),
      });
      const stdout = clip(result.stdout ?? "");
      const stderr = clip(result.stderr ?? "");
      return jsonResult({
        exitCode: result.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        truncatedByRailway: result.truncated,
        clippedByBridge: stdout.clipped || stderr.clipped,
        timedOut: result.timedOut,
      });
    }),
  );

  server.registerTool(
    "sandbox_read_file",
    {
      title: "Read sandbox file",
      description: "Read a UTF-8 text file from a Railway sandbox.",
      inputSchema: z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
        offset: z.number().int().min(0).optional(),
        length: z.number().int().min(1).max(1_000_000).optional(),
        fromEnd: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId, path, offset, length, fromEnd }) => {
      const sandbox = await connectSandbox(sandboxId);
      const text = await sandbox.files.read(path, {
        ...(offset !== undefined ? { offset } : {}),
        ...(length !== undefined ? { length } : {}),
        ...(fromEnd !== undefined ? { fromEnd } : {}),
      });
      const clipped = clip(text);
      return jsonResult({ path, content: clipped.text, clippedByBridge: clipped.clipped });
    }),
  );

  server.registerTool(
    "sandbox_list_files",
    {
      title: "List sandbox files",
      description: "List files and directories at a path inside a Railway sandbox.",
      inputSchema: z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1).default("/"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId, path }) => {
      const sandbox = await connectSandbox(sandboxId);
      const entries = await sandbox.files.list(path);
      return jsonResult(
        entries.map((entry) => ({
          name: entry.name,
          size: entry.size,
          isDir: entry.isDir,
          modTime: entry.modTime,
        })),
      );
    }),
  );

  server.registerTool(
    "sandbox_write_file",
    {
      title: "Write sandbox file",
      description: "Create or overwrite one UTF-8 text file in a Railway sandbox.",
      inputSchema: z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        mode: z.number().int().min(0).max(0o777).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId, path, content, mode }) => {
      const sandbox = await connectSandbox(sandboxId);
      await sandbox.files.write(path, content, mode === undefined ? undefined : { mode });
      return jsonResult({ path, bytes: Buffer.byteLength(content, "utf8") });
    }),
  );

  server.registerTool(
    "sandbox_write_files",
    {
      title: "Write sandbox files",
      description:
        "Create or overwrite multiple UTF-8 text files in one call. Useful for materializing a repository or test fixture fetched through another connector.",
      inputSchema: z.object({
        sandboxId: z.string().min(1),
        files: z
          .array(
            z.object({
              path: z.string().min(1),
              content: z.string(),
              mode: z.number().int().min(0).max(0o777).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId, files }) => {
      const totalBytes = files.reduce(
        (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
        0,
      );
      if (totalBytes > MAX_BATCH_FILE_BYTES) {
        throw new Error(
          `Batch is ${totalBytes} bytes; maximum is ${MAX_BATCH_FILE_BYTES} bytes per call.`,
        );
      }

      const sandbox = await connectSandbox(sandboxId);
      for (const file of files) {
        await sandbox.files.write(
          file.path,
          file.content,
          file.mode === undefined ? undefined : { mode: file.mode },
        );
      }
      return jsonResult({ filesWritten: files.length, totalBytes });
    }),
  );

  server.registerTool(
    "sandbox_checkpoint",
    {
      title: "Checkpoint sandbox",
      description:
        "Capture the sandbox filesystem as a named Railway checkpoint for fast reuse in later sandboxes.",
      inputSchema: z.object({
        sandboxId: z.string().min(1),
        name: z.string().min(1).max(100),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId, name }) => {
      const sandbox = await connectSandbox(sandboxId);
      await sandbox.checkpoint(name);
      return jsonResult({ sandboxId, checkpoint: name });
    }),
  );

  server.registerTool(
    "sandbox_destroy",
    {
      title: "Destroy sandbox",
      description: "Destroy a Railway sandbox and stop its resource billing.",
      inputSchema: z.object({ sandboxId: z.string().min(1) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safeTool(async ({ sandboxId }) => {
      const sandbox = await connectSandbox(sandboxId);
      await sandbox.destroy();
      return jsonResult({ sandboxId, destroyed: true });
    }),
  );

  return server;
}

const mcpHandler = createMcpHandler(buildServer);
const nodeHandler = toNodeHandler(mcpHandler, {
  onerror(error) {
    console.error("MCP adapter error", error);
  },
});

const httpServer = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        sandboxCredentialsConfigured: Boolean(process.env.RAILWAY_API_TOKEN),
      }),
    );
    return;
  }

  if (requestUrl.pathname !== MCP_PATH) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  void nodeHandler(req, res);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`railway-sandbox-mcp listening on port ${PORT}`);
  console.log(`MCP endpoint: ${MCP_PATH}`);
  console.log(`Railway sandbox credentials configured: ${Boolean(process.env.RAILWAY_API_TOKEN)}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  httpServer.close();
  await mcpHandler.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
