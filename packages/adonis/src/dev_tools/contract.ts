/**
 * The dev-tools registration contract, version 1, declared here STRUCTURALLY. The hub is bound at
 * `'agora.devTools'` by `@adonis-agora/agent/mcp_provider` when the app has it, and serves every
 * lib's tools on one MCP endpoint (`/mcp/agora`). The CMS never imports the agent: it stays an
 * optional, undeclared peer. Same shapes as `@adonis-agora/agent/dev-tools`.
 *
 * The CMS has no console `authorize` (the admin is a client of the REST API), so it registers WITHOUT
 * one: the endpoint-level `devTools.authorize` (config/mcp.ts) gates the lib, and every tool then runs
 * as the request's CMS principal, through the collections' `access` rules. That needs a hub that says
 * `supports('endpoint-authorize')`.
 */

/** The container binding the dev-tools hub lives at. */
export const DEV_TOOLS_BINDING = 'agora.devTools';

/** The hub a lib registers its developer tools into. */
export interface DevToolsHub {
  readonly version: 1;
  register(lib: DevToolsLib): void;
  /** Optional capability probe. The CMS needs `'endpoint-authorize'`. */
  supports?(feature: string): boolean;
}

/** One lib's tools. Without `authorize`, the endpoint's `devTools.authorize` decides. */
export interface DevToolsLib {
  lib: string;
  title: string;
  authorize?(ctx: unknown): Promise<unknown>;
  tools: DevTool[];
}

/** One developer tool. */
export interface DevTool {
  name: string;
  kind: 'read' | 'action';
  description: string;
  input: DevToolInputSchema;
  destructive?: boolean;
  available?(): boolean | Promise<boolean>;
  run(input: Record<string, unknown>, call: DevToolCall): Promise<unknown>;
}

/** What a tool's `run` receives besides its input. */
export interface DevToolCall {
  /** The MCP POST's own HTTP context. */
  ctx: unknown;
  caller: DevToolsCaller;
  limits: { maxRows: number; maxBytes: number };
}

/** Who is calling. Never a token value. */
export interface DevToolsCaller {
  id: string;
  via: 'token' | 'session' | 'open';
}

/** One property of a {@link DevToolInputSchema}. */
export interface DevToolInputProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: readonly string[];
  items?: { type: 'string' };
  minimum?: number;
  maximum?: number;
}

/** An object of scalar / enum / array-of-string properties. */
export interface DevToolInputSchema {
  type: 'object';
  properties: Record<string, DevToolInputProperty>;
  required?: string[];
}

/** The slice of the AdonisJS container the registration uses. */
export interface DevToolsContainer {
  hasBinding(binding: string): boolean;
  make(binding: string): Promise<unknown>;
}
