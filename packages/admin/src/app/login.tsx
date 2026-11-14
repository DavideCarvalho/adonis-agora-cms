import { CmsApiError, useCms, useMessages } from '@adonis-agora/cms-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { AlertIcon } from '../agora-kit/icons';
import { Button } from '../agora-kit/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../agora-kit/ui/card';
import { Input } from '../agora-kit/ui/input';
import { Skeleton } from '../agora-kit/ui/skeleton';
import { CmsMark } from './icons.js';

type Mode = 'login' | 'first' | 'forgot' | 'reset';

const resetTokenOf = (hash: string) => /^#\/reset\/(.+)$/.exec(hash)?.[1];

/** A centered card on the console background: login, sign-in link, boot error. */
export function CenteredCard({
  title,
  description,
  logoUrl,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  logoUrl?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <main className="relative grid min-h-svh place-items-center px-4 py-10">
      <div className="agora-glow" aria-hidden />
      <Card className="agora-surface relative z-[1] w-full max-w-[380px]">
        <CardHeader className="gap-3">
          <div className="grid size-[34px] place-items-center rounded-md border border-brand-border bg-brand-soft text-brand [&_svg]:size-[18px]">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="size-[18px] object-contain" />
            ) : (
              <CmsMark />
            )}
          </div>
          <CardTitle>
            <h1 className="text-lg font-semibold text-fg">{title}</h1>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent className="flex flex-col gap-3.5">{children}</CardContent> : null}
      </Card>
    </main>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-dim">
        {label}
      </label>
      {children}
    </div>
  );
}

/** The login screen for `auth.builtin`. An app with its own login never reaches it. */
export function LoginScreen({ title, logoUrl }: { title: string; logoUrl?: string | undefined }) {
  const t = useMessages();
  const { client } = useCms();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['cms', 'auth-status'], queryFn: () => client.authStatus() });
  const [picked, setPicked] = useState<Mode | null>(null);
  const [token] = useState(() => resetTokenOf(window.location.hash));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode: Mode = token ? 'reset' : status.data?.needsFirstUser ? 'first' : (picked ?? 'login');
  const heading =
    mode === 'first'
      ? t.firstUserTitle
      : mode === 'forgot'
        ? t.forgotPassword
        : mode === 'reset'
          ? t.newPassword
          : title;

  const firstInput = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus follows the visible form
  useEffect(() => firstInput.current?.focus(), [mode, status.isPending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setError(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await client.auth('forgot', data);
        setNotice(t.resetSent);
        return;
      }
      await client.auth(
        mode === 'first' ? 'first-user' : mode === 'reset' ? 'reset' : 'login',
        mode === 'reset' ? { ...data, token } : data,
      );
      if (mode === 'reset') window.location.hash = '';
      await queryClient.invalidateQueries({ queryKey: ['cms', 'schema'] });
    } catch (cause) {
      setError(cause instanceof CmsApiError ? cause.message : t.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  if (status.isPending && !token) {
    return (
      <CenteredCard title={title} logoUrl={logoUrl}>
        <div className="flex flex-col gap-3.5" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard
      title={heading}
      logoUrl={logoUrl}
      description={mode === 'first' ? t.firstUserBody : undefined}
    >
      <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12.5px] text-bad [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0"
          >
            <AlertIcon />
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="rounded-md border border-good/30 bg-good/10 px-3 py-2 text-[12.5px] text-good"
          >
            {notice}
          </p>
        ) : null}

        {mode !== 'reset' ? (
          <Field id="cms-email" label={t.email}>
            <Input
              ref={firstInput}
              id="cms-email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </Field>
        ) : null}
        {mode === 'first' ? (
          <Field id="cms-name" label={t.name}>
            <Input id="cms-name" name="name" autoComplete="name" />
          </Field>
        ) : null}
        {mode !== 'forgot' ? (
          <Field id="cms-password" label={mode === 'reset' ? t.newPassword : t.password}>
            <Input
              ref={mode === 'reset' ? firstInput : undefined}
              id="cms-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'login' ? undefined : 8}
              required
            />
          </Field>
        ) : null}

        <Button type="submit" disabled={busy} className="mt-1 w-full">
          {mode === 'first'
            ? t.createAccount
            : mode === 'forgot'
              ? t.sendReset
              : mode === 'reset'
                ? t.setPassword
                : t.login}
        </Button>

        {mode === 'login' && status.data?.canReset ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked('forgot')}>
            {t.forgotPassword}
          </Button>
        ) : null}
        {mode === 'forgot' ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked('login')}>
            {t.backToLogin}
          </Button>
        ) : null}
      </form>
    </CenteredCard>
  );
}

/** Shown when the API answers 401: the host app owns the login, the panel only links to it. */
export function SignInRequired({ logoUrl }: { logoUrl?: string | undefined }) {
  const t = useMessages();
  const loginUrl = import.meta.env.VITE_CMS_LOGIN_URL ?? '/login';
  return (
    <CenteredCard title={t.signInTitle} description={t.signInBody} logoUrl={logoUrl}>
      <Button className="w-full" nativeButton={false} render={<a href={loginUrl} />}>
        {t.signIn}
      </Button>
    </CenteredCard>
  );
}

/** The schema could not be loaded at all: say why, offer a retry. */
export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useMessages();
  return (
    <CenteredCard title={t.loadFailed} description={message}>
      <Button variant="outline" className="w-full" onClick={onRetry}>
        {t.retry}
      </Button>
    </CenteredCard>
  );
}
