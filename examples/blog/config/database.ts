import env from '#start/env';

export default {
  connection: 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: { filename: env.get('DB_FILE', 'blog.sqlite3') },
      useNullAsDefault: true,
      migrations: { paths: ['database/migrations'] },
    },
  },
};
