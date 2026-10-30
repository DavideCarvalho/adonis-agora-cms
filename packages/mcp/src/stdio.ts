import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type CreateCmsMcpServerOptions, createCmsMcpServer } from './server.js';

/**
 * Starts the CMS MCP server over stdio and keeps the process alive.
 *
 * Logs go to stderr on purpose: stdout is the protocol channel.
 */
export async function startCmsMcpStdio(options: CreateCmsMcpServerOptions): Promise<McpServer> {
  const server = createCmsMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}
