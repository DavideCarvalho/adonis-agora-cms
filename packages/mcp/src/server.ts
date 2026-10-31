import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type CmsToolOptions, createCmsTools } from './tools.js';

export type CreateCmsMcpServerOptions = CmsToolOptions & {
  /** Server name in the MCP handshake. */
  name?: string;
  version?: string;
};

/**
 * MCP server with the CMS tools.
 *
 * Transport is up to the caller: `startCmsMcpStdio` for a local agent (Claude Code, Cursor, any
 * stdio client), or `connect()` with an HTTP transport when the server lives with the app.
 */
export function createCmsMcpServer(options: CreateCmsMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name ?? 'adonis-cms',
    version: options.version ?? '0.0.0',
  });

  for (const tool of createCmsTools(options)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      },
      async (input: Record<string, unknown>) => {
        try {
          const result = await tool.handler(input);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: describeError(error),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

/** A validation error names its fields: the model needs them to fix the call. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'tool failed';
  const fields = (error as { fields?: Record<string, string> }).fields;
  if (!fields) return error.message;
  const details = Object.entries(fields).map(([field, message]) => `${field}: ${message}`);
  return `${error.message} (${details.join(', ')})`;
}
