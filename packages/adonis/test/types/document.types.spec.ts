import { expectTypeOf, test } from 'vitest';
import type {
  CmsCreateInput,
  CmsDocument,
  CmsGlobal,
  CmsUpload,
  RichTextValue,
} from '../../src/types/document.js';
import { blogConfig } from '../fixtures/blog_config.js';

type Config = typeof blogConfig;
type Post = CmsDocument<Config, 'posts'>;

type Hero = { type: 'hero'; id: string; heading: string; image: CmsUpload | null };
type Gallery = {
  type: 'gallery';
  id: string;
  gallery: Array<{ id: string; caption: string | null; link: string | null }>;
};

test('scalar fields map to their TypeScript type', () => {
  expectTypeOf<Post['title']>().toEqualTypeOf<string>();
  expectTypeOf<Post['slug']>().toEqualTypeOf<string>();
  expectTypeOf<Post['publishedAt']>().toEqualTypeOf<Date | null>();
});

test('select values become literal unions', () => {
  expectTypeOf<Post['status']>().toEqualTypeOf<'draft' | 'published'>();
  expectTypeOf<Post['channels']>().toEqualTypeOf<Array<'web' | 'rss'>>();
});

test('localized fields become a locale map', () => {
  expectTypeOf<Post['body']>().toEqualTypeOf<Record<'pt-BR' | 'en', RichTextValue>>();
});

test('groups become nested objects', () => {
  expectTypeOf<Post['seo']>().toEqualTypeOf<{ title: string | null; description: string | null }>();
});

test('arrays become arrays of objects with an id', () => {
  expectTypeOf<Post['tags']>().toEqualTypeOf<Array<{ id: string; label: string | null }>>();
});

test('blocks become a discriminated union', () => {
  expectTypeOf<Post['layout']>().toEqualTypeOf<Array<Hero | Gallery>>();
});

test('relations and uploads are ids at depth 0', () => {
  expectTypeOf<Post['author']>().toEqualTypeOf<string | null>();
  expectTypeOf<Post['related']>().toEqualTypeOf<string[]>();
  expectTypeOf<Post['cover']>().toEqualTypeOf<CmsUpload | null>();
});

test('documents carry system fields', () => {
  expectTypeOf<Post['id']>().toEqualTypeOf<string>();
  expectTypeOf<Post['createdAt']>().toEqualTypeOf<Date>();
  expectTypeOf<Post['_status']>().toEqualTypeOf<'draft' | 'published'>();
});

test('create input requires required fields and omits generated ones', () => {
  type Input = CmsCreateInput<Config, 'posts'>;
  expectTypeOf<Input['title']>().toEqualTypeOf<string>();
  expectTypeOf<Input>().not.toHaveProperty('id');
  expectTypeOf<Input>().not.toHaveProperty('createdAt');
  expectTypeOf<Input['draft']>().toEqualTypeOf<boolean | undefined>();
});

test('globals use the same machinery', () => {
  type Settings = CmsGlobal<Config, 'site_settings'>;
  expectTypeOf<Settings['siteName']>().toEqualTypeOf<string | null>();
  expectTypeOf<Settings['logo']>().toEqualTypeOf<CmsUpload | null>();
});
