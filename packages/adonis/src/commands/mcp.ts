import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BaseCommand } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import cms from '../../services/main.js';

/**
 * `node ace cms:mcp` — starts the Model Context Protocol server over stdio.
 *
 * The command runs with the app booted, so the CMS service is the same instance the admin and REST
 * use: hooks, access and tenancy apply to every tool call.
 */
export default class CmsMcp extends BaseCommand {
  static override commandName = 'cms:mcp';
  static override description = 'Start the CMS MCP server (stdio) for an AI client';
  static override options: CommandOptions = { startApp: true };

  override async run(): Promise<void> {
    // Optional dependency. It is resolved from the *app* that runs the command, not from this
    // package: the MCP server may live in the app's node_modules (or nowhere at all).
    let starter: { startCmsMcpStdio: (options: { cms: unknown }) => Promise<unknown> };

    try {
      const requireFromApp = createRequire(join(process.cwd(), 'package.json'));
      const resolved = requireFromApp.resolve('@adonis-agora/cms-mcp');
      starter = (await import(pathToFileURL(resolved).href)) as typeof starter;
    } catch {
      this.logger.error('install @adonis-agora/cms-mcp to use `cms:mcp`');
      this.exitCode = 1;
      return;
    }

    this.logger.info('CMS MCP server listening on stdio');
    await starter.startCmsMcpStdio({ cms });
    await new Promise<void>(() => undefined);
  }
}
