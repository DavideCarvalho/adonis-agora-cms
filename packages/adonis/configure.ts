import type Configure from '@adonisjs/core/commands/configure';
import { stubsRoot } from './stubs/main.js';

/**
 * `node ace configure @adonis-agora/cms` — auto-wires the package:
 *
 * 1. registers the CMS provider in `adonisrc.ts`;
 * 2. registers the `cms:*` commands;
 * 3. publishes `config/cms.ts` and `app/services/cms.ts` (the typed service handle);
 * 4. publishes a Lucid migration that creates the schema (delete it if you use the managed mode).
 *
 * Requires `@adonisjs/lucid` (`node ace add @adonisjs/lucid`) to be installed and configured.
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods();

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@adonis-agora/cms/cms_provider');
    rcFile.addCommand('@adonis-agora/cms/commands');
  });

  const stubs = stubsRoot();
  await codemods.makeUsingStub(stubs, 'config/cms.stub', {});
  await codemods.makeUsingStub(stubs, 'services/cms.stub', {});
  await codemods.makeUsingStub(stubs, 'database/migrations/create_cms_tables.stub', {});
}
