import {
  CmsApiError,
  ConfirmProvider,
  registerField,
  registerView,
  registerWidget,
  useAdminSchema,
  useConfirm,
  useMessages,
  VIEW_REGISTRY,
} from '@adonis-agora/cms-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readShellConfig } from '../agora-kit/shell-config';
import { ThemeProvider } from '../agora-kit/theme';
import { DashboardPage } from './dashboard.js';
import { parseHash, type Route, href as routeHref } from './hash-route.js';
import { LoginScreen, PanelError, SignInRequired } from './login.js';
import { EditView, GlobalView } from './pages/edit.js';
import { ListView } from './pages/list.js';
import { CmsShell } from './shell.js';
import { BootSkeleton } from './skeletons.js';
import { ToastProvider } from './toast.js';

/** The CMS console's accent (CONSOLE-SHELL-SPEC); `admin.theme.accent` replaces it. */
export const CMS_ACCENT = '#fb923c';
/** The id of the JSON data block the provider writes into `index.html`. */
export const CONFIG_ELEMENT_ID = 'cms-config';
const THEME_KEY = 'agora-cms-theme';

type Navigate = (route: Route, options?: { force?: boolean }) => void;

const EXTENSION_API = { React, registerField, registerView, registerWidget };
let extensionsLoaded = false;

async function loadExtensions(urls: readonly string[]): Promise<void> {
  if (extensionsLoaded) return;
  extensionsLoaded = true;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const module = await import(/* @vite-ignore */ url);
        await module.default?.(EXTENSION_API);
      } catch (error) {
        // A broken extension must not take the panel down with it.
        console.error(`[cms] extension failed: ${url}`, error);
      }
    }),
  );
}

/** The white-label accent when it is a colour the browser understands (a typo keeps orange). */
export function accentOf(value: unknown): string {
  return typeof value === 'string' &&
    value.trim() !== '' &&
    (typeof CSS === 'undefined' || CSS.supports('color', value))
    ? value.trim()
    : CMS_ACCENT;
}

/** The theme stored by panels before the console kit (`cms-theme`), so nobody's choice is lost. */
function legacyTheme(): 'dark' | 'light' {
  try {
    return window.localStorage.getItem('cms-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function App() {
  const schema = useAdminSchema();
  return (
    <ThemeProvider
      storageKey={THEME_KEY}
      accent={accentOf(schema.data?.admin.theme?.accent)}
      defaultTheme={legacyTheme()}
    >
      <ToastProvider>
        <ConfirmProvider>
          <Panel />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function Panel() {
  const t = useMessages();
  const confirm = useConfirm();
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const dirty = useRef(false);
  // Read inside the component: a test or preview may inject the block after import.
  const shell = useMemo(() => readShellConfig(CONFIG_ELEMENT_ID), []);

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const schema = useAdminSchema();

  const go = useCallback((next: Route) => {
    window.location.hash = routeHref(next).replace(/^#/, '');
    setRoute(next);
  }, []);

  const navigate = useCallback<Navigate>(
    (next, options) => {
      if (options?.force || !dirty.current) {
        dirty.current = false;
        go(next);
        return;
      }
      void confirm({
        title: t.discardTitle,
        body: t.discardBody,
        action: t.discard,
        danger: true,
      }).then((answer) => {
        if (!answer) return;
        dirty.current = false;
        go(next);
      });
    },
    [confirm, go, t],
  );

  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  // An app's extensions load before the panel draws, so their views and fields are there at once.
  const extensions = schema.data?.admin.extensions;
  const [extensionsReady, setExtensionsReady] = useState(false);
  useEffect(() => {
    if (!schema.data) return;
    void loadExtensions(extensions ?? []).finally(() => setExtensionsReady(true));
  }, [schema.data, extensions]);

  const title = schema.data?.admin.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  const logoUrl = schema.data?.admin.theme?.logoUrl;
  if (schema.isLoading) return <BootSkeleton />;
  if (schema.error instanceof CmsApiError && schema.error.status === 401)
    return <SignInRequired logoUrl={logoUrl} />;
  if (schema.error)
    return <PanelError message={schema.error.message} onRetry={() => void schema.refetch()} />;
  if (!schema.data || !extensionsReady) return <BootSkeleton />;

  const data = schema.data;
  if (data.admin.auth?.builtin && !data.user)
    return <LoginScreen title={data.admin.title} logoUrl={logoUrl} />;

  const global =
    route.view === 'global' ? data.globals.find((item) => item.slug === route.slug) : undefined;
  const collection = data.collections.find((item) => item.slug === route.slug) ?? null;
  const customView = route.view === 'custom' ? VIEW_REGISTRY.get(route.slug) : undefined;
  // An unknown slug lands on the dashboard, and the sidebar says so.
  const shown: Route =
    customView || global || (collection && route.view !== 'dashboard' && route.view !== 'custom')
      ? route
      : { view: 'dashboard', slug: '' };

  let page: React.ReactNode;
  if (customView) {
    page = (
      <div className="page page-enter">
        <customView.component />
      </div>
    );
  } else if (global) {
    page = (
      <div className="page page-enter">
        <GlobalView key={global.slug} global={global} schema={data} onDirtyChange={onDirtyChange} />
      </div>
    );
  } else if (collection && (route.view === 'list' || route.view === 'global')) {
    page = (
      <div className="page page-enter">
        <ListView
          key={collection.slug}
          collection={collection}
          schema={data}
          onNavigate={navigate}
        />
      </div>
    );
  } else if (collection && (route.view === 'edit' || route.view === 'create')) {
    page = (
      <div className="page page-enter">
        <EditView
          key={`${collection.slug}/${route.view === 'edit' ? route.id : 'new'}`}
          collection={collection}
          schema={data}
          id={route.view === 'edit' ? route.id : undefined}
          onNavigate={navigate}
          onDirtyChange={onDirtyChange}
        />
      </div>
    );
  } else {
    page = <DashboardPage schema={data} onNavigate={navigate} />;
  }

  return (
    <CmsShell schema={data} route={shown} shell={shell} onNavigate={navigate}>
      {page}
    </CmsShell>
  );
}
