import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { catalog, version, protocolVersion } from "./catalog.mjs";
import { validate } from "./shared/validate.js";
import { BridgeClient, BridgeError } from "./bridge-client.js";
import { waitForPreview, prunePreviews } from "./preview.js";

const bridge = new BridgeClient(
  process.env.AE_MCP_BRIDGE_DIR || "",
  Number(process.env.AE_MCP_TIMEOUT_MS || 30000)
);
const server = new Server(
  { name: "after-effects-mcp", version },
  { capabilities: { tools: {} } }
);
const reconciliation = {
  description:
    "Read a retained result by request UUID after an uncertain outcome. Does not re-execute anything.",
  inputSchema: {
    type: "object",
    properties: { requestId: { type: "string", minLength: 36, maxLength: 36 } },
    required: ["requestId"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
};
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...Object.entries(catalog).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema as any,
      annotations: t.annotations
    })),
    {
      name: "get-request-result",
      ...reconciliation,
      inputSchema: reconciliation.inputSchema as any
    }
  ]
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const spec =
      params.name === "get-request-result"
        ? reconciliation
        : catalog[params.name as keyof typeof catalog];
    if (!spec)
      throw new BridgeError("UNKNOWN_TOOL", `Unsupported tool: ${params.name}`);
    try {
      validate(spec.inputSchema, params.arguments || {}, "arguments");
    } catch (e) {
      throw new BridgeError("INVALID_ARGUMENTS", String(e));
    }
    if (params.name === "capture-composition-frame")
      prunePreviews(bridge.directory);
    const response =
      params.name === "get-request-result"
        ? bridge.result(String(params.arguments?.requestId))
        : await bridge.call((spec as any).operation, params.arguments || {});
    if (params.name === "bridge-status" && response.status === "success")
      response.data = {
        ...response.data,
        serverVersion: version,
        protocolVersion,
        bridgeDirectory: bridge.directory
      };
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; mimeType: string; data: string }
    > = [{ type: "text", text: JSON.stringify(response) }];
    if (
      response.status === "success" &&
      response.operation === "captureCompositionFrame"
    ) {
      try {
        content.push(await waitForPreview(bridge.directory, response));
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...response,
                status: "error",
                data: response.data,
                error: {
                  code: "PREVIEW_UNAVAILABLE",
                  message: String(e),
                  mayHaveChanged: false
                }
              })
            }
          ],
          isError: true
        };
      }
    }
    return {
      content,
      isError:
        response.status === "error" || response.status === "outcome_unknown"
    };
  } catch (e) {
    const error =
      e instanceof BridgeError
        ? e
        : new BridgeError("INTERNAL_ERROR", String(e));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: error.mayHaveChanged ? "outcome_unknown" : "error",
            requestId: error.requestId,
            error: {
              code: error.code,
              message: error.message,
              mayHaveChanged: error.mayHaveChanged
            },
            bridgeDirectory: bridge.directory
          })
        }
      ],
      isError: true
    };
  }
});
async function shutdown() {
  await bridge.close();
  await server.close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.stdin.once("end", () => void shutdown());
await bridge.start();
console.error(
  `AE MCP ${version}; protocol ${protocolVersion}; directory ${bridge.directory}`
);
await server.connect(new StdioServerTransport());
