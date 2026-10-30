type FlagMetaData = {
  name: string;
  flagName: string;
  type: 'string' | 'boolean' | 'array' | 'number';
  required: boolean;
  description: string;
  alias?: string;
};

type CommandMetaData = {
  commandName: string;
  description: string;
  help: string;
  namespace: string;
  aliases: string[];
  flags: FlagMetaData[];
  args: unknown[];
  options: { startApp: boolean };
  filePath: string;
};

/**
 * Command metadata, mirroring what `@adonisjs/ace` generates for packages.
 *
 * Written by hand because the CMS ships four static commands — no build-time index generation
 * is worth the extra dist step.
 */
const COMMANDS: CommandMetaData[] = [
  {
    commandName: 'cms:diff',
    description: 'Show the schema changes the CMS config would apply',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'json',
        flagName: 'json',
        type: 'boolean',
        required: false,
        description: 'Print the plan as JSON',
        alias: 'j',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to inspect',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'diff.js',
  },
  {
    commandName: 'cms:sync',
    description: 'Apply the CMS schema to the database',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'dryRun',
        flagName: 'dry-run',
        type: 'boolean',
        required: false,
        description: 'Show the plan without applying it',
        alias: 'd',
      },
      {
        name: 'allowDestructive',
        flagName: 'allow-destructive',
        type: 'boolean',
        required: false,
        description: 'Allow dropping tables/columns',
      },
      {
        name: 'force',
        flagName: 'force',
        type: 'boolean',
        required: false,
        description: 'Shorthand for --allow-destructive',
        alias: 'f',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to use',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'sync.js',
  },
  {
    commandName: 'cms:generate',
    description: 'Generate a Lucid migration for the current CMS schema',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection used to detect the engine',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'generate.js',
  },
  {
    commandName: 'cms:status',
    description: 'Show the CMS schema state and document counts',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'json',
        flagName: 'json',
        type: 'boolean',
        required: false,
        description: 'Print status as JSON',
        alias: 'j',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to inspect',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'status.js',
  },
];

export async function getMetaData(): Promise<CommandMetaData[]> {
  return COMMANDS;
}

export async function getCommand(metaData: { commandName: string }): Promise<unknown> {
  const command = COMMANDS.find((item) => item.commandName === metaData.commandName);
  if (!command) return null;

  const module = (await import(new URL(command.filePath, import.meta.url).href)) as {
    default: unknown;
  };
  return module.default;
}
