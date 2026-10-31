import { Button, CmsApiError, Field, Input, useCms, useMessages } from '@adonis-agora/cms-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';

type Mode = 'login' | 'first' | 'forgot' | 'reset';

const resetTokenOf = (hash: string) => /^#\/reset\/(.+)$/.exec(hash)?.[1];

/** The login screen for `auth.builtin`. An app with its own login never reaches it. */
export function LoginScreen({ title }: { title: string }) {
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
  useEffect(() => firstInput.current?.focus(), [mode]);

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

  return (
    <div className="signin">
      <form className="signin__card" onSubmit={(event) => void submit(event)}>
        <h1 className="page-title">{heading}</h1>
        {mode === 'first' ? <p>{t.firstUserBody}</p> : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}

        {mode !== 'reset' ? (
          <Field label={t.email} htmlFor="cms-email">
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
          <Field label={t.name} htmlFor="cms-name">
            <Input id="cms-name" name="name" autoComplete="name" />
          </Field>
        ) : null}
        {mode !== 'forgot' ? (
          <Field label={mode === 'reset' ? t.newPassword : t.password} htmlFor="cms-password">
            <Input
              id="cms-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'login' ? undefined : 8}
              required
            />
          </Field>
        ) : null}

        <Button tone="accent" size="md" type="submit" disabled={busy} className="signin__submit">
          {mode === 'first'
            ? t.createAccount
            : mode === 'forgot'
              ? t.sendReset
              : mode === 'reset'
                ? t.setPassword
                : t.login}
        </Button>

        {mode === 'login' && status.data?.canReset ? (
          <Button tone="ghost" size="sm" onClick={() => setPicked('forgot')}>
            {t.forgotPassword}
          </Button>
        ) : null}
        {mode === 'forgot' ? (
          <Button tone="ghost" size="sm" onClick={() => setPicked('login')}>
            {t.backToLogin}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
