export type Route =
  | { view: 'list'; slug: string }
  | { view: 'edit'; slug: string; id: string }
  | { view: 'create'; slug: string };

export function parseHash(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('?')[0]?.split('/').filter(Boolean) ?? [];

  const [view, slug, id] = segments;

  if (view === 'collections' && slug) {
    return id ? { view: 'edit', slug, id } : { view: 'list', slug };
  }
  if (view === 'new' && slug) return { view: 'create', slug };
  return { view: 'list', slug: slug ?? '' };
}

export function href(route: Route): string {
  if (route.view === 'list') return `#/collections/${route.slug}`;
  if (route.view === 'edit') return `#/collections/${route.slug}/${route.id}`;
  return `#/new/${route.slug}`;
}
