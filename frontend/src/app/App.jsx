import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthPanel } from '../features/auth/components/AuthPanel.jsx';
import { getCurrentUser, login, logout, register } from '../features/auth/api/authApi.js';
import { ideaKinds, optionsForIdea } from '../features/ideas/ideasData.js';
import { IdeasSection } from '../features/ideas/components/IdeasSection.jsx';
import { ActivePoll } from '../features/polls/components/ActivePoll.jsx';
import { CreatePollModal } from '../features/polls/components/CreatePollModal.jsx';
import { closePoll, createPoll, listPolls, submitChoices, submitRatings } from '../features/polls/api/pollsApi.js';

function Header({ user, activeCount, onProfile }) {
  const location = useLocation();
  return (
    <header className="topbar">
      <Link className="brand" to="/" aria-label="Decido — главная"><span className="brand-mark">d</span><span>decido<span className="brand-dot">.</span></span></Link>
      <nav className="main-nav" aria-label="Главная навигация">
        <Link className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} to="/">Идеи</Link>
        <Link className={`nav-link ${location.pathname.startsWith('/polls') ? 'active' : ''}`} to="/polls">Голосование <span className="nav-count">{activeCount}</span></Link>
        <Link className={`nav-link ${location.pathname === '/collections' ? 'active' : ''}`} to="/collections">Подборки</Link>
      </nav>
      <button className="profile-button" onClick={onProfile} aria-label={`Аккаунт ${user.display_name}`}>{[...user.display_name][0]?.toUpperCase() || 'P'}</button>
    </header>
  );
}

function Hero({ onCreate, onCollections }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> ХОРОШИЕ ПЛАНЫ НАЧИНАЮТСЯ ВМЕСТЕ</div>
        <h1>Ну что, <span>куда?</span></h1>
        <p>Соберите варианты, киньте друзьям ссылку и выберите план<br className="desktop-break" /> без вечного «мне всё равно».</p>
        <div className="hero-actions">
          <button className="button-dark" onClick={onCreate}>＋ Создать голосование <span>↗</span></button>
          <button className="mood-link" onClick={onCollections}><span>✳</span> Сначала выбрать настроение</button>
        </div>
        <div className="hero-note"><span className="hero-people" aria-hidden="true"><i /><i /><i /></span><span>План выбирает вся компания</span><span className="hero-divider">|</span><span className="hero-check">✓</span><span>решение за минуту</span></div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="sun" /><div className="art-photo photo-one"><span>☕</span></div><div className="art-photo photo-two"><span>🪴</span></div><div className="art-photo photo-three"><span>🎳</span></div>
        <div className="art-ticket"><span>ПЛАН НА ВЕЧЕР</span><strong>найден <span>✳</span></strong><div className="ticket-lines" /></div>
        <div className="art-scribble">пошли!</div><span className="art-star star-one">✳</span><span className="art-star star-two">✦</span><span className="art-caption">куда угодно, но вместе</span>
      </div>
    </section>
  );
}

function IdeasPage({ polls, filter, setFilter, onCreate, onChoose, onVote, onCopy, onCollections }) {
  const activePoll = polls.find(poll => !poll.closed);
  const completedPoll = polls.find(poll => poll.closed);
  return <>
    <Hero onCreate={() => onCreate()} onCollections={() => onCollections()} />
    {activePoll
      ? <ActivePoll poll={activePoll} onVote={onVote} onCopyLink={onCopy} />
      : completedPoll
        ? <section className="active-vote empty-poll"><div className="vote-heading"><div><div className="section-kicker"><span className="live-dot" /> ВАШ АКТИВНЫЙ ВЫБОР</div><h2>Открытых голосований пока нет</h2><p className="vote-subtitle">Последнее решение уже завершено. Создайте новый план для компании.</p></div></div><button className="button-coral" onClick={() => onCreate()}>Создать голосование <span>→</span></button></section>
        : <section className="active-vote empty-poll"><div className="vote-heading"><div><div className="section-kicker"><span className="live-dot" /> ВАШ АКТИВНЫЙ ВЫБОР</div><h2>Пока нет активного голосования</h2><p className="vote-subtitle">Создайте голосование, добавьте варианты и позовите друзей.</p></div></div><button className="button-coral" onClick={() => onCreate()}>Создать голосование <span>→</span></button></section>}
    <IdeasSection filter={filter} onFilter={setFilter} onChoose={onChoose} />
    <CollectionBanner />
  </>;
}

function CollectionBanner() {
  return <section className="collections"><div className="collection-banner">
    <div className="collection-copy"><div className="section-kicker small">СОБРАНО ДЛЯ ВАС</div><h2>Когда хочется<br />просто выбрать</h2><p>Найдите идею для встречи и решите вместе, куда отправиться.</p><Link to="/collections" className="button-light">Собрать подборку <span>↗</span></Link></div>
    <div className="collection-art" aria-hidden="true"><span className="collection-circle circle-a" /><span className="collection-circle circle-b">вечер<br />в городе</span><span className="collection-circle circle-c">✳</span><span className="collection-sticker">планы<br />вместе</span><span className="sticker-spark">✦</span></div>
  </div></section>;
}

function PollsPage({ polls, onCreate }) {
  return <section className="poll-list-page">
    <div className="eyebrow"><span className="eyebrow-dot" /> ВАШИ РЕШЕНИЯ</div><h1>Голосования</h1><p className="welcome-copy">Ваши открытые решения и голосования сообщества.</p>
    <button className="button-dark" onClick={() => onCreate()}>＋ Создать голосование</button>
    {polls.length ? <div className="poll-grid">{polls.map(poll => <Link className="poll-list-card" key={poll.id} to={`/polls/${poll.id}`}><div className="section-kicker"><span className="live-dot" /> {poll.closed ? 'ЗАВЕРШЕНО' : 'АКТИВНО'}</div><h2>{poll.title}</h2><p>{poll.description || 'Решение, которое примем вместе.'}</p><small>{poll.vote_count} голосов · {poll.options.length} вариантов</small></Link>)}</div> : <div className="empty-card"><h2>Голосований пока нет</h2><p>Создайте вопрос, добавьте варианты и поделитесь им с друзьями.</p></div>}
  </section>;
}

function CollectionsPage({ onCreate }) {
  return <section className="collection-page">
    <div className="eyebrow"><span className="eyebrow-dot" /> ИДЕИ ДЛЯ ВАШЕГО ВЕЧЕРА</div><h1>Собрано для вас</h1>
    <p>Выберите направление — Decido добавит его в новый опрос. Конкретный вариант выбираете вы и ваша компания.</p>
    <div className="place-categories">{ideaKinds.slice(0, 5).map(idea => <button key={idea.id + idea.title} onClick={() => onCreate(idea)}>{idea.emoji} {idea.title}</button>)}</div>
    <CollectionBanner />
  </section>;
}

function PollDetailPage({ poll, onVote, onCopy, onClose, user }) {
  if (!poll) return <div className="loading-screen">Загружаем голосование…</div>;
  return <section className="detail-page"><Link to="/polls" className="all-ideas">← Все голосования</Link><ActivePoll poll={poll} onVote={onVote} onCopyLink={onCopy} onClose={onClose} canClose={poll.owner_id === user.id} /></section>;
}

function Footer() {
  return <footer><span className="footer-brand"><span className="brand-mark">d</span> decido</span><span>Решения выбирают вместе.</span><span>Сделано с заботой <b>✳</b></span></footer>;
}

function ProfileDialog({ user, onClose, onLogout }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
      <div className="section-kicker">ВАШ АККАУНТ</div>
      <h2 id="profile-title">{user.display_name}</h2>
      <p className="modal-intro">@{user.username} · {user.email}</p>
      <button className="button-dark auth-submit" onClick={onLogout}>Выйти из аккаунта <span>→</span></button>
    </section>
  </div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const refreshPolls = useCallback(async () => {
    const result = await listPolls();
    setPolls(result.polls);
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then(async authResult => {
        if (!active) return;
        setUser(authResult.user);
        if (!authResult.user) return;
        const result = await listPolls();
        if (!active) return;
        setPolls(result.polls);
      })
      .catch(requestError => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pollCount = useMemo(() => polls.filter(poll => !poll.closed).length, [polls]);

  async function handleAuth(mode, values) {
    setAuthError('');
    try {
      const result = mode === 'register' ? await register(values) : await login(values);
      setUser(result.user);
      await refreshPolls();
    } catch (requestError) {
      setAuthError(requestError.message);
    }
  }

  function showCreate(idea) {
    setModal({ options: idea ? optionsForIdea(idea.id) : [] });
  }

  async function handleCreate(data) {
    await createPoll(data);
    await refreshPolls();
    setModal(null);
    navigate('/');
    setToast('Голосование создано. Позовите друзей выбрать план.');
  }

  async function handleVote(pollId, value) {
    const poll = polls.find(item => item.id === pollId);
    if (poll?.type === 'rating') await submitRatings(pollId, value);
    else await submitChoices(pollId, value);
    await refreshPolls();
    setToast('Оценки сохранены. Их можно изменить до конца опроса.');
  }

  async function handleClosePoll(pollId) {
    try {
      await closePoll(pollId);
      await refreshPolls();
      setToast('Голосование завершено. Результаты сохранены.');
    } catch (requestError) {
      setToast(requestError.message);
    }
  }

  async function handleCopyLink(pollId) {
    const url = `${window.location.origin}/polls/${pollId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const field = document.createElement('textarea');
      field.value = url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) {
        setToast('Не удалось скопировать ссылку. Скопируйте адрес страницы вручную.');
        return;
      }
    }
    setToast('Ссылка скопирована.');
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setPolls([]);
    setProfileOpen(false);
  }

  const currentPoll = location.pathname.startsWith('/polls/')
    ? polls.find(poll => poll.id === location.pathname.split('/')[2])
    : null;

  if (loading) return <div className="loading-screen">Decido загружает ваши решения…</div>;
  if (!user) return <AuthPanel onSubmit={handleAuth} error={authError || error} />;
  if (error) return <main className="shell"><div className="error-screen"><h1>Не удалось загрузить Decido</h1><p>{error}</p><button className="button-dark" onClick={() => window.location.reload()}>Попробовать ещё раз</button></div></main>;

  return <div className="shell">
    <Header user={user} activeCount={pollCount} onProfile={() => setProfileOpen(true)} />
    <Routes>
      <Route path="/" element={<IdeasPage polls={polls} filter={filter} setFilter={setFilter} onCreate={showCreate} onChoose={showCreate} onVote={handleVote} onCopy={handleCopyLink} onCollections={() => navigate('/collections')} />} />
      <Route path="/polls" element={<PollsPage polls={polls} onCreate={showCreate} />} />
      <Route path="/polls/:pollId" element={<PollDetailPage poll={currentPoll} onVote={handleVote} onCopy={handleCopyLink} onClose={handleClosePoll} user={user} />} />
      <Route path="/collections" element={<CollectionsPage onCreate={showCreate} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <Footer />
    {modal && <CreatePollModal onClose={() => setModal(null)} onCreate={handleCreate} initialOptions={modal.options} />}
    {profileOpen && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} onLogout={handleLogout} />}
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
