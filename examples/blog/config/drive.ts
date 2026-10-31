import app from '@adonisjs/core/services/app';
import { defineConfig, services } from '@adonisjs/drive';

export default defineConfig({
  default: process.env.DRIVE_DISK === 's3' ? 's3' : 'fs',
  services: {
    fs: services.fs({
      location: app.makePath('storage/uploads'),
      serveFiles: true,
      routeBasePath: '/files',
      visibility: 'public',
    }),
    // Private on purpose: the panel must get there through a signed URL.
    s3: services.s3({
      credentials: {
        accessKeyId: process.env.S3_KEY ?? 'local',
        secretAccessKey: process.env.S3_SECRET ?? 'local',
      },
      region: 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'cms',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      visibility: 'private',
    }),
  },
});
