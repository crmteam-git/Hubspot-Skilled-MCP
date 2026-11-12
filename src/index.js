#!/usr/bin/env node
// HubSpot Skilled MCP server — entry point (stdio transport).
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { registerCrmTools } from "./tools/crm.js";
import { isReadOnly } from "./hubspot.js";

// Load .env from the project root regardless of the client's working directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env"), quiet: true });

const server = new McpServer({
  name: process.env.MCP_SERVER_NAME || "hubspot-skilled-mcp",
  version: "1.0.0",
});

registerWorkflowTools(server);
registerCrmTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the MCP channel — log to stderr only.
console.error(`HubSpot Skilled MCP running on stdio${isReadOnly() ? " (read-only)" : ""}`);
