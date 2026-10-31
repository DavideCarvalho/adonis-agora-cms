import type Configure from '@adonisjs/core/commands/configure';

/** `node ace add @adonis-agora/cms-admin`: registers the provider that serves the panel. */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods();
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@adonis-agora/cms-admin/cms_admin_provider');
  });
}
