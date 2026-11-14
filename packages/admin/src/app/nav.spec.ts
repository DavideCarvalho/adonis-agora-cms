import type { AdminCollection, AdminSchema } from '@adonis-agora/cms-react';
import { describe, expect, it } from 'vitest';
import { accentOf, CMS_ACCENT } from './App.js';
import { buildNav, mediaSlugs, navIdOf, titleOf } from './nav.js';

const t = { content: 'Content', dashboard: 'Dashboard', globals: 'Globals', views: 'Views' };

function collection(slug: string, extra: Partial<AdminCollection> = {}): AdminCollection {
  return {
    slug,
    kind: 'collection',
    labels: {
      singular: slug[0]?.toUpperCase() + slug.slice(1, -1),
      plural: slug[0]?.toUpperCase() + slug.slice(1),
    },
    versioned: false,
    drafts: false,
    fields: [],
    ...extra,
  };
}

const schema = {
  version: 1,
  admin: { title: 'Blog', path: '/admin' },
  locales: [],
  defaultLocale: 'en',
  tenancy: { strategy: 'single', required: false },
  collections: [
    collection('posts', {
      fields: [
        { type: 'upload', name: 'cover', relationTo: 'assets' },
        {
          type: 'blocks',
          name: 'layout',
          blocks: [
            { slug: 'hero', fields: [{ type: 'upload', name: 'img', relationTo: 'files' }] },
          ],
        },
      ],
    }),
    collection('authors'),
    collection('menus', { admin: { group: 'Navigation' } }),
    collection('redirects', { admin: { group: 'Navigation' } }),
    collection('assets'),
    collection('files'),
    collection('users'),
  ],
  globals: [collection('site', { kind: 'global', labels: { singular: 'Site', plural: 'Sites' } })],
  user: null,
  permissions: {},
} as AdminSchema;

describe('buildNav', () => {
  it('groups collections into content, admin groups, globals, media, settings and views', () => {
    const nav = buildNav(schema, [{ id: 'reports', label: 'Reports' }], t, 'en');
    expect(nav.map((group) => [group.section, group.items.map((item) => item.label)])).toEqual([
      ['Content', ['Dashboard', 'Posts', 'Authors']],
      ['Navigation', ['Menus', 'Redirects']],
      ['Globals', ['Site']],
      ['Media', ['Assets', 'Files']],
      ['Settings', ['Users']],
      ['Views', ['Reports']],
    ]);
    expect(nav[0]?.items[1]).toMatchObject({ id: 'c:posts', kind: 'collection' });
    expect(nav[3]?.items[0]?.kind).toBe('media');
    expect(nav[4]?.items[0]?.kind).toBe('users');
  });

  it('uses the auth collection for settings and translates its own labels', () => {
    const own = {
      ...schema,
      admin: { ...schema.admin, auth: { builtin: true, collection: 'authors' } },
    };
    const nav = buildNav(own, [], t, 'pt-BR');
    expect(nav.find((group) => group.section === 'Configurações')?.items.map((i) => i.id)).toEqual([
      'c:authors',
    ]);
    expect(nav.some((group) => group.section === 'Mídia')).toBe(true);
  });

  it('finds the media collections through nested upload fields', () => {
    expect([...mediaSlugs(schema)].sort()).toEqual(['assets', 'files']);
  });
});

describe('routes', () => {
  it('maps a route to its nav id and topbar title', () => {
    expect(navIdOf({ view: 'dashboard', slug: '' })).toBe('dashboard');
    expect(navIdOf({ view: 'edit', slug: 'posts', id: '1' })).toBe('c:posts');
    expect(navIdOf({ view: 'global', slug: 'site' })).toBe('g:site');
    expect(navIdOf({ view: 'custom', slug: 'reports' })).toBe('v:reports');
    expect(titleOf({ view: 'list', slug: 'posts' }, schema, t)).toBe('Posts');
    expect(titleOf({ view: 'edit', slug: 'posts', id: '1' }, schema, t)).toBe('Post');
    expect(titleOf({ view: 'global', slug: 'site' }, schema, t)).toBe('Site');
    expect(titleOf({ view: 'custom', slug: 'r' }, schema, t, 'Reports')).toBe('Reports');
  });
});

describe('accentOf', () => {
  it('keeps a valid white-label accent and falls back to orange', () => {
    expect(CMS_ACCENT).toBe('#fb923c');
    expect(accentOf(undefined)).toBe(CMS_ACCENT);
    expect(accentOf('  ')).toBe(CMS_ACCENT);
    expect(accentOf('#0ea5e9')).toBe('#0ea5e9');
  });
});
