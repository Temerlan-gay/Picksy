import { useEffect, useRef, useState } from 'react';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function AuthPanel({ onSubmit, onGoogleCredential, error }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const googleButton = useRef(null);
  const googleCallback = useRef(onGoogleCredential);
  googleCallback.current = onGoogleCredential;

  useEffect(() => {
    if (!googleClientId || !googleButton.current) return undefined;
    let active = true;
    const renderGoogleButton = () => {
      if (!active || !window.google?.accounts?.id || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: response => googleCallback.current?.(response.credential),
        auto_select: false,
        context: 'signin',
      });
      window.google.accounts.id.renderButton(googleButton.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: 350,
      });
    };

    let script = document.querySelector('script[data-google-identity]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', renderGoogleButton);
    if (window.google?.accounts?.id) renderGoogleButton();
    return () => {
      active = false;
      script.removeEventListener('load', renderGoogleButton);
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(mode, Object.fromEntries(new FormData(event.currentTarget)));
    } catch {
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <a className="brand auth-brand" href="/"><span className="brand-mark">d</span><span>decido<span className="brand-dot">.</span></span></a>
        <div className="eyebrow"><span className="eyebrow-dot" /> РЕШАЕМ ВМЕСТЕ</div>
        <h1>{mode === 'register' ? 'Создайте аккаунт' : 'С возвращением'}</h1>
        <p className="auth-intro">Собирайте друзей и выбирайте планы вместе — без долгих переписок.</p>
        <form onSubmit={submit}>
          {mode === 'register' && <>
            <label htmlFor="display-name">Ваше имя</label>
            <input id="display-name" name="display_name" autoComplete="name" minLength="1" maxLength="50" required placeholder="Как к вам обращаться?" />
          </>}
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength="254" required placeholder="you@example.com" />
          <label htmlFor="password">Пароль</label>
          <input id="password" name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 6 : 1} maxLength="128" required placeholder={mode === 'register' ? 'Не менее 6 символов' : 'Ваш пароль'} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button-dark auth-submit" disabled={busy}>{busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'} <span>→</span></button>
        </form>
        {googleClientId && <>
          <div className="auth-divider"><span>или</span></div>
          <div className="google-button-wrap" ref={googleButton} aria-label="Войти с аккаунтом Google" />
        </>}
        <p className="auth-switch">{mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые в Decido?'} <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Войти' : 'Создать аккаунт'}</button></p>
      </section>
    </main>
  );
}
