import { Ignitor } from '@adonisjs/core';

const APP_ROOT = new URL('./', import.meta.url);
const IMPORTER = (filePath) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href);
  }
  return import(filePath);
};

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .ace()
  .handle(process.argv.splice(2));
