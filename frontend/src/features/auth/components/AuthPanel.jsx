import { useState } from 'react';

export function AuthPanel({ onSubmit, error }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);

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
            <label htmlFor="username">Имя пользователя</label>
            <input id="username" name="username" autoComplete="username" minLength="3" maxLength="24" pattern="[A-Za-z0-9_]{3,24}" required placeholder="Ваше имя" />
          </>}
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength="254" required placeholder="you@example.com" />
          <label htmlFor="password">Пароль</label>
          <input id="password" name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength="10" maxLength="128" required placeholder="Не менее 10 символов" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button-dark auth-submit" disabled={busy}>{busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'} <span>→</span></button>
        </form>
        <p className="auth-switch">{mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые в Decido?'} <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Войти' : 'Создать аккаунт'}</button></p>
      </section>
    </main>
  );
}
