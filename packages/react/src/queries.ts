import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCms } from './context.js';
import type { AdminDocument, ListQuery } from './types.js';

/** Query keys in one place: invalidation is always precise, never `invalidateQueries()`. */
export const cmsKeys = {
  all: ['cms'] as const,
  schema: () => [...cmsKeys.all, 'schema'] as const,
  list: (slug: string, query: ListQuery) => [...cmsKeys.all, 'list', slug, query] as const,
  doc: (slug: string, id: string, query: ListQuery) =>
    [...cmsKeys.all, 'doc', slug, id, query] as const,
  versions: (slug: string, id: string) => [...cmsKeys.all, 'versions', slug, id] as const,
  global: (slug: string) => [...cmsKeys.all, 'global', slug] as const,
};

export function useAdminSchema() {
  const { client } = useCms();
  return useQuery({
    queryKey: cmsKeys.schema(),
    queryFn: () => client.schema(),
    staleTime: 60_000,
  });
}

export function useDocuments(slug: string, query: ListQuery) {
  const { client } = useCms();
  return useQuery({
    queryKey: cmsKeys.list(slug, query),
    queryFn: () => client.list(slug, query),
    placeholderData: (previous) => previous,
  });
}

export function useDocument(slug: string, id: string | undefined, query: ListQuery = {}) {
  const { client } = useCms();
  return useQuery({
    queryKey: cmsKeys.doc(slug, id ?? '', query),
    queryFn: () => client.find(slug, id as string, query),
    enabled: Boolean(id),
  });
}

export function useCreateDocument(slug: string) {
  const { client } = useCms();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AdminDocument) => client.create(slug, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'list', slug] });
    },
  });
}

export function useUpdateDocument(slug: string, id: string) {
  const { client } = useCms();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AdminDocument) => client.update(slug, id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'doc', slug, id] });
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'list', slug] });
      void queryClient.invalidateQueries({ queryKey: cmsKeys.versions(slug, id) });
    },
  });
}

export function useDeleteDocument(slug: string) {
  const { client } = useCms();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.delete(slug, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'list', slug] });
    },
  });
}

export function usePublishDocument(slug: string, id: string) {
  const { client } = useCms();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (action: 'publish' | 'unpublish') =>
      action === 'publish' ? client.publish(slug, id) : client.unpublish(slug, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'doc', slug, id] });
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'list', slug] });
    },
  });
}

export function useVersions(slug: string, id: string) {
  const { client } = useCms();
  return useQuery({
    queryKey: cmsKeys.versions(slug, id),
    queryFn: () => client.versions(slug, id),
    enabled: Boolean(id),
  });
}

export function useRestoreVersion(slug: string, id: string) {
  const { client } = useCms();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (version: number) => client.restoreVersion(slug, id, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'doc', slug, id] });
      void queryClient.invalidateQueries({ queryKey: cmsKeys.versions(slug, id) });
    },
  });
}
