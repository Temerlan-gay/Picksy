const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const appShell = $('.app-shell');
const authRoot = $('#auth-root');
const inviteStorageKey = 'picksy-invite-tokens';

let currentUser = null;
let polls = [];
let toastTimer;
let routeVersion = 0;
let pollFilter = 'all';
let inviteTokens = readInviteTokens();

function readInviteTokens() {
  try {
    const stored = JSON.parse(localStorage.getItem(inviteStorageKey) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function rememberInvite(id, token) {
  inviteTokens[id] = token;
  try {
    localStorage.setItem(inviteStorageKey, JSON.stringify(inviteTokens));
    return true;
  } catch {
    return false;
  }
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Не удалось связаться с сервером.');
    error.status = response.status;
    error.code = payload.error?.code;
    if (response.status === 401 && currentUser) {
      currentUser = null;
      showAuth('login', 'Сессия завершилась. Войдите снова.');
    }
    throw error;
  }
  return payload;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function showAuth(mode = 'login', message = '') {
  appShell.hidden = true;
  authRoot.hidden = false;
  authRoot.innerHTML = `
    <section class="auth-card">
      <a class="brand auth-brand" href="#home" aria-label="Picksy"><span class="brand-mark">p</span><span>picksy<span class="brand-dot">.</span></span></a>
      <div class="auth-eyebrow">РЕШАЕМ ВМЕСТЕ</div>
      <h1>${mode === 'register' ? 'Создайте аккаунт' : 'С возвращением'}</h1>
      <p class="auth-intro">${mode === 'register' ? 'Собирайте людей и помогайте принимать решения вместе.' : 'Войдите, чтобы продолжить голосование и увидеть свои решения.'}</p>
      ${message ? `<div class="auth-notice" role="status">${escapeHTML(message)}</div>` : ''}
      <form id="auth-form">
        ${mode === 'register' ? `
          <label class="form-label" for="auth-name">Ваше имя</label>
          <input class="text-input" id="auth-name" name="displayName" autocomplete="name" maxlength="50" required placeholder="Как к вам обращаться?" />
          <label class="form-label" for="auth-username">Имя пользователя</label>
          <input class="text-input" id="auth-username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required placeholder="например, alex_1" />
          <small class="auth-hint">3–24 символа: латиница, цифры и _</small>
          <label class="form-label" for="auth-email">Email</label>
          <input class="text-input" id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com" />
        ` : `
          <label class="form-label" for="auth-login">Email или имя пользователя</label>
          <input class="text-input" id="auth-login" name="login" autocomplete="username" required placeholder="you@example.com" />
        `}
        <label class="form-label" for="auth-password">Пароль</label>
        <input class="text-input" id="auth-password" name="password" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" required placeholder="Не менее 10 символов" />
        <div class="auth-error" id="auth-error" role="alert"></div>
        <button class="button button-primary full-button auth-submit" type="submit">${mode === 'register' ? 'Создать аккаунт' : 'Войти'} <span>→</span></button>
      </form>
      <p class="auth-switch">${mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые в Picksy?'} <button type="button" class="auth-switch-button" data-auth-mode="${mode === 'register' ? 'login' : 'register'}">${mode === 'register' ? 'Войти' : 'Создать аккаунт'}</button></p>
      <div class="auth-security">Пароль хранится в защищённом виде и никогда не показывается другим участникам.</div>
    </section>`;

  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $('.auth-submit', form);
    const errorBox = $('#auth-error', form);
    const values = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    submit.innerHTML = '<span class="button-spinner"></span> Подождите';
    errorBox.textContent = '';
    try {
      const result = await api(`/api/auth/${mode}`, { method: 'POST', body: values });
      currentUser = result.user;
      authRoot.hidden = true;
      appShell.hidden = false;
      updateProfile();
      await route();
      toast(mode === 'register' ? 'Аккаунт создан. Добро пожаловать!' : 'Вы вошли в Picksy.');
    } catch (error) {
      errorBox.textContent = error.message;
      submit.disabled = false;
      submit.textContent = mode === 'register' ? 'Создать аккаунт →' : 'Войти →';
    }
  });
}

function updateProfile() {
  if (!currentUser) return;
  $('#profile-name').textContent = currentUser.displayName;
  $('#profile-username').textContent = `@${currentUser.username}`;
  $('#user-avatar').textContent = [...currentUser.displayName][0]?.toUpperCase() || 'P';
}

function pageTitle(name) {
  $('#page-crumb').textContent = name;
}

function pollCard(poll) {
  const closed = poll.closed;
  const voteCount = poll.voteCount;
  return `<a class="poll-card" href="#poll/${encodeURIComponent(poll.id)}">
    <div class="poll-card-top"><span class="status-pill ${closed ? 'closed' : ''}"><i></i>${closed ? 'Завершено' : 'Активно'}</span><span class="card-more">↗</span></div>
    <h3>${escapeHTML(poll.title)}</h3><p>${escapeHTML(poll.description || 'Решение, которое примем вместе.')}</p>
    <div class="option-preview">${poll.options.slice(0, 3).map(option => `<span>${escapeHTML(option.text)}</span>`).join('')}${poll.options.length > 3 ? `<span>+${poll.options.length - 3}</span>` : ''}</div>
    <div class="poll-card-bottom"><span class="avatar-stack"><b>${escapeHTML([...poll.organizer][0]?.toUpperCase() || 'P')}</b><small>${escapeHTML(poll.organizer)}</small></span><span class="vote-meta-small">◉ ${voteCount} ${voteCount === 1 ? 'голос' : 'голосов'}</span></div>
  </a>`;
}

function renderHome(query = '') {
  const filtered = polls.filter(poll => `${poll.title} ${poll.description} ${poll.options.map(option => option.text).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const open = filtered.filter(poll => !poll.closed);
  const recent = filtered.slice(0, 4);
  pageTitle(query ? 'Поиск' : 'Главная');
  $('#poll-count').textContent = String(polls.filter(poll => !poll.closed).length);
  $('#view-root').innerHTML = `<section class="welcome-row"><div><div class="eyebrow"><span class="eyebrow-dot"></span> ВАШЕ ПРОСТРАНСТВО</div><h1>Привет, ${escapeHTML(currentUser.displayName)} <span class="wave">✳</span></h1><p class="welcome-copy">Что решим вместе? Создайте голосование и соберите мнения в одном месте.</p></div><button class="button button-primary create-large" data-action="create">＋ Создать голосование <span>↗</span></button></section>
    <section class="quick-stats"><article class="stat-card"><span class="stat-icon coral">◉</span><div><small>Активные голосования</small><strong>${open.length}</strong></div><span class="stat-foot">сейчас</span></article><article class="stat-card"><span class="stat-icon mint">✓</span><div><small>Создано вами</small><strong>${polls.filter(poll => poll.owner_id === currentUser.id).length}</strong></div><span class="stat-foot">всего</span></article><article class="stat-card"><span class="stat-icon lilac">↗</span><div><small>Всего голосов</small><strong>${polls.reduce((sum, poll) => sum + poll.voteCount, 0)}</strong></div><span class="stat-foot">в голосованиях</span></article></section>
    <section class="content-section"><div class="section-heading"><div><div class="section-label">СОБИРАЕМ МНЕНИЯ</div><h2>${query ? 'Результаты поиска' : 'Активные голосования'}</h2></div><a href="#polls" class="quiet-link">Все голосования <span>→</span></a></div>${open.length ? `<div class="poll-grid">${open.map(pollCard).join('')}</div>` : `<div class="empty-card"><div class="empty-illustration">◉</div><h3>${query ? 'Ничего не нашлось' : 'Пока нет активных голосований'}</h3><p>${query ? 'Попробуйте изменить поисковый запрос.' : 'Создайте первое голосование и пригласите людей решить вопрос вместе.'}</p>${!query ? '<button class="button button-outline" data-action="create">Создать голосование <span>→</span></button>' : ''}</div>`}</section>
    <section class="content-section recent-section"><div class="section-heading"><div><div class="section-label">ИСТОРИЯ</div><h2>Недавние голосования</h2></div></div>${recent.length ? `<div class="recent-list">${recent.map(poll => `<a class="recent-row" href="#poll/${encodeURIComponent(poll.id)}"><span class="recent-icon">${poll.closed ? '✓' : '◉'}</span><span class="recent-main"><strong>${escapeHTML(poll.title)}</strong><small>${poll.options.length} вариантов · ${poll.voteCount} голосов</small></span><span class="status-pill ${poll.closed ? 'closed' : ''}">${poll.closed ? 'Завершено' : 'Активно'}</span><span class="row-arrow">↗</span></a>`).join('')}</div>` : '<div class="recent-empty">Ваши голосования появятся здесь.</div>'}</section>`;
}

function renderList() {
  pageTitle('Голосования');
  $('#poll-count').textContent = String(polls.filter(poll => !poll.closed).length);
  const filtered = polls.filter(poll => pollFilter === 'all' || (pollFilter === 'active' ? !poll.closed : poll.closed));
  $('#view-root').innerHTML = `<section class="list-header"><div><div class="eyebrow"><span class="eyebrow-dot"></span> ВАШИ РЕШЕНИЯ</div><h1>Голосования</h1><p class="welcome-copy">Ваши голосования и открытые решения сообщества.</p></div><button class="button button-primary" data-action="create">＋ Создать голосование</button></section>
    <div class="list-tabs" role="tablist" aria-label="Фильтр голосований"><button type="button" data-filter="all" aria-selected="${pollFilter === 'all'}">Все <b>${polls.length}</b></button><button type="button" data-filter="active" aria-selected="${pollFilter === 'active'}">Активные <b>${polls.filter(poll => !poll.closed).length}</b></button><button type="button" data-filter="closed" aria-selected="${pollFilter === 'closed'}">Завершённые <b>${polls.filter(poll => poll.closed).length}</b></button></div>
    ${filtered.length ? `<div class="poll-grid">${filtered.map(pollCard).join('')}</div>` : `<div class="empty-card"><div class="empty-illustration">◉</div><h3>${polls.length ? 'Здесь пока пусто' : 'Голосований пока нет'}</h3><p>${polls.length ? 'Для этого фильтра пока нет голосований.' : 'Создайте вопрос, добавьте варианты и отправьте ссылку участникам.'}</p>${!polls.length ? '<button class="button button-outline" data-action="create">Создать первое голосование <span>→</span></button>' : ''}</div>`}`;
}

function renderLoading() {
  $('#view-root').innerHTML = '<div class="skeleton-page" aria-label="Загрузка"><div class="skeleton skeleton-heading"></div><div class="skeleton skeleton-copy"></div><div class="skeleton-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div></div>';
}

function renderDetail(poll) {
  const rows = poll.options;
  const voteCount = poll.voteCount;
  const leaders = poll.leaders;
  const winner = leaders.length === 1 ? leaders[0] : null;
  const mine = poll.myVote;
  const inviteToken = new URLSearchParams(location.hash.split('?')[1] || '').get('invite') || inviteTokens[poll.id] || '';
  const closed = poll.closed;
  $('#view-root').dataset.invite = inviteToken;
  pageTitle(poll.title);
  $('#view-root').innerHTML = `<div class="detail-back"><a href="#polls">← Все голосования</a>${poll.owner_id === currentUser.id && !closed ? '<button class="text-action" data-action="close-poll">Завершить голосование</button>' : ''}</div>
    <section class="detail-heading"><div class="eyebrow"><span class="eyebrow-dot ${closed ? 'muted-dot' : ''}"></span>${closed ? 'ГОЛОСОВАНИЕ ЗАВЕРШЕНО' : 'АКТИВНОЕ ГОЛОСОВАНИЕ'}</div><h1>${escapeHTML(poll.title)}</h1><p>${escapeHTML(poll.description || '')}</p>
    <div class="detail-meta"><span class="user-avatar mini">${escapeHTML([...poll.organizer][0]?.toUpperCase() || 'P')}</span><span>Создал(а) <strong>${escapeHTML(poll.organizer)}</strong></span><span class="meta-divider">·</span><span>${formatDate(poll.created_at)}</span><span class="meta-divider">·</span><span>◉ ${voteCount} ${voteCount === 1 ? 'голос' : 'голосов'}</span>${poll.deadline ? `<span class="meta-divider">·</span><span>до ${formatDate(poll.deadline)}</span>` : ''}</div></section>
    ${closed ? `<section class="result-banner"><div class="result-symbol">${winner ? '✳' : '◉'}</div><div><div class="section-label">${voteCount === 0 ? 'ГОЛОСОВ ПОКА НЕТ' : winner ? 'УЖЕ ВЫБРАЛИ' : 'НИЧЬЯ'}</div><h2>${voteCount === 0 ? 'Решение осталось открытым' : winner ? escapeHTML(winner.text) : `${leaders.length} ${leaders.length === 1 ? 'вариант делит' : 'варианта делят'} первое место`}</h2><p>${voteCount === 0 ? 'В этом голосовании никто не успел проголосовать.' : winner ? `Лидер: ${poll.type === 'rating' ? `${winner.score.toFixed(1)} из 10 в среднем` : `${winner.count} ${winner.count === 1 ? 'голос' : 'голоса'}`}.` : 'Все лидирующие варианты показаны ниже.'}</p><button class="text-action result-share" data-action="copy-link">Поделиться итогом ↗</button></div></section>` : ''}
    <div class="poll-tabs" role="tablist" aria-label="Раздел голосования"><button type="button" class="poll-tab active" role="tab" aria-selected="true" data-poll-tab="voting">Голосование</button><button type="button" class="poll-tab" role="tab" aria-selected="false" data-poll-tab="discussion">Обсуждение</button></div>
    <div class="poll-tab-panel" role="tabpanel" data-poll-panel="voting"><div class="detail-columns"><section class="panel ballot-panel"><div class="panel-heading"><div><div class="section-label">${closed ? 'ИТОГИ' : mine ? 'ВАШ ОТВЕТ СОХРАНЁН' : 'ВАШЕ МНЕНИЕ'}</div><h2>${closed ? 'Результаты' : poll.type === 'single' ? 'Выберите один вариант' : poll.type === 'multiple' ? 'Выберите подходящие варианты' : 'Оцените варианты от 1 до 10'}</h2></div><span class="type-chip">${poll.type === 'single' ? 'Один вариант' : poll.type === 'multiple' ? 'Несколько' : 'Оценка 1–10'}</span></div>
    <div class="ballot-options">${rows.map((option, index) => renderOption(poll, option, index, mine, closed)).join('')}</div>
    ${!closed && !mine ? '<button class="button button-primary submit-ballot" data-action="submit-vote">Отправить голос <span>→</span></button><p class="ballot-hint">Голос сохраняется на сервере. Изменить его после отправки нельзя.</p>' : ''}
    </section><aside class="panel invite-panel"><div class="section-label">ПРИГЛАСИТЕ УЧАСТНИКОВ</div><h3>Решение начинается с мнений</h3><p>${poll.visibility === 'private' ? 'Доступ к голосованию есть только у людей с этой ссылкой.' : 'Любой участник с аккаунтом Picksy может открыть публичное голосование.'}</p><button class="button button-outline full-button" data-action="copy-link">${closed ? 'Поделиться итогом' : 'Скопировать ссылку'} <span>↗</span></button>
    <div class="invite-note"><span>ⓘ</span><span>${poll.visibility === 'private' ? 'Не публикуйте приватную ссылку в открытом доступе.' : 'Для участия нужно войти в Picksy.'}</span></div></aside></div></div>
    <section class="poll-tab-panel discussion-panel-wrap" role="tabpanel" data-poll-panel="discussion" hidden><section class="panel discussion-panel"><div class="discussion-heading"><div><div class="section-label">ОБСУЖДЕНИЕ ВАРИАНТОВ</div><h2>Что думаете?</h2></div><span class="discussion-count">${poll.commentCount}</span></div>
    <div id="poll-comments" class="comment-list" aria-live="polite"><div class="comment-loading">Загружаем обсуждение…</div></div>
    <form id="comment-form" class="comment-form"><div id="replying-to" class="replying-to" hidden></div><label class="sr-only" for="comment-text">Ваш комментарий</label><textarea class="text-input text-area" id="comment-text" name="text" maxlength="2000" required placeholder="Поделитесь мнением или предложите вариант…"></textarea><div class="comment-form-bottom"><span>До 2000 символов · ответы доступны в один уровень</span><button class="button button-primary" type="submit">Отправить <span>→</span></button></div><div id="comment-error" class="form-error" role="alert"></div></form></section></section>`;

  const urlToken = new URLSearchParams(location.hash.split('?')[1] || '').get('invite');
  if (urlToken && poll.visibility === 'private') rememberInvite(poll.id, urlToken);
  if (inviteToken && poll.visibility === 'private') $('#view-root').dataset.invite = inviteToken;
}

function renderOption(poll, option, index, mine, closed) {
  const value = poll.myVote;
  const selectedIds = value?.optionIds || [];
  const rating = value?.ratings?.find(item => item.optionId === option.id)?.score;
  const selected = selectedIds.includes(option.id) || rating !== undefined;
  const measure = poll.type === 'rating' ? option.score : option.count;
  const max = Math.max(1, ...poll.options.map(item => poll.type === 'rating' ? item.score || 0 : item.count));
  const percent = measure ? Math.round(measure / max * 100) : 0;
  const resultMarkup = (mine || closed) ? `<div class="result-line"><span class="result-bar"><i style="width:${percent}%"></i></span><strong>${poll.type === 'rating' ? (option.score === null ? '—' : `${option.score.toFixed(1)} / 10`) : `${option.count} ${option.count === 1 ? 'голос' : 'голосов'}`}</strong></div>` : '';
  const control = poll.type === 'rating' ? `<div class="rating-control">${Array.from({ length: 10 }, (_, number) => `<button type="button" class="rate-button ${rating === number + 1 ? 'chosen' : ''}" data-score="${number + 1}" data-option="${option.id}" ${mine || closed ? 'disabled' : ''}>${number + 1}</button>`).join('')}</div>` : '';
  const checked = selectedIds.includes(option.id);
  return `<div class="ballot-option ${selected ? 'selected' : ''}" data-option-row="${option.id}"><div class="ballot-option-main"><span class="option-index">${String(index + 1).padStart(2, '0')}</span><span class="option-text">${escapeHTML(option.text)}</span>${!closed && !mine && poll.type !== 'rating' ? `<input class="option-check" type="${poll.type === 'single' ? 'radio' : 'checkbox'}" name="ballot-choice" value="${option.id}" aria-label="${escapeHTML(option.text)}" ${checked ? 'checked' : ''} />` : selected ? '<span class="selected-check">✓</span>' : ''}</div>${control}${resultMarkup}</div>`;
}

function renderComment(comment, isReply = false) {
  return `<article class="comment ${isReply ? 'comment-reply' : ''}"><span class="comment-avatar">${escapeHTML([...comment.author][0]?.toUpperCase() || 'P')}</span><div class="comment-content"><div class="comment-meta"><strong>${escapeHTML(comment.author)}</strong><time datetime="${escapeHTML(comment.createdAt)}">${formatDate(comment.createdAt)}</time></div><p>${escapeHTML(comment.body)}</p>${!isReply ? `<button class="comment-reply-button" type="button" data-action="reply-comment" data-comment-id="${comment.id}" data-comment-author="${escapeHTML(comment.author)}">Ответить</button>` : ''}</div></article>${!isReply && comment.replies.length ? `<div class="comment-replies">${comment.replies.map(reply => renderComment(reply, true)).join('')}</div>` : ''}`;
}

async function loadComments(pollId, offset = 0) {
  const container = $('#poll-comments');
  if (!container) return;
  const inviteToken = $('#view-root').dataset.invite;
  const headers = inviteToken ? { 'x-poll-invite': inviteToken } : {};
  const existing = $('#load-more-comments');
  if (existing) existing.remove();
  if (!offset) container.innerHTML = '<div class="comment-loading">Загружаем обсуждение…</div>';
  try {
    const result = await api(`/api/polls/${encodeURIComponent(pollId)}/comments?limit=20&offset=${offset}`, { headers });
    const currentPollId = decodeURIComponent(location.hash.slice(1).split('?')[0].slice(5));
    if (currentPollId !== pollId || !container.isConnected) return;
    if (!offset) container.innerHTML = '';
    const html = result.comments.map(comment => renderComment(comment)).join('');
    if (html) container.insertAdjacentHTML('beforeend', html);
    if (!html && !offset) container.innerHTML = '<div class="comments-empty"><span>✳</span><strong>Начните обсуждение</strong><p>Задайте вопрос или поделитесь тем, что важно при выборе.</p></div>';
    container.dataset.offset = String(offset + result.comments.length);
    if (result.hasMore) container.insertAdjacentHTML('beforeend', '<button id="load-more-comments" class="load-more-comments" type="button" data-action="load-more-comments">Показать ещё ответы</button>');
  } catch (error) {
    if (!container.isConnected) return;
    const message = escapeHTML(error.message);
    if (!offset) container.innerHTML = `<div class="comments-error"><p>${message}</p><button class="button button-outline" type="button" data-action="load-comments">Повторить</button></div>`;
    else container.insertAdjacentHTML('beforeend', `<div class="comments-error"><p>${message}</p><button class="button button-outline" type="button" data-action="load-more-comments">Повторить</button></div>`);
  }
}

function renderSectionComingSoon(section) {
  const content = {
    questions: ['Обсуждения', 'Обсуждения и публикации появятся в следующем этапе. Сейчас Picksy уже помогает создать голосование, пригласить участников и выбрать вариант.'],
    messages: ['Сообщения', 'Личные и групповые чаты пока не подключены. Мы не показываем фиктивные переписки — сначала делаем надёжными голосования и приглашения.'],
    groups: ['Группы', 'Группы появятся после завершения основного сценария голосования. Пока участников можно пригласить по ссылке на конкретное решение.']
  }[section];
  pageTitle(content[0]);
  $('#view-root').innerHTML = `<section class="coming-page"><div class="coming-icon">${section === 'groups' ? '♧' : section === 'messages' ? '▱' : '▤'}</div><div class="eyebrow">СЛЕДУЮЩИЙ ЭТАП</div><h1>${content[0]}</h1><p>${content[1]}</p><a class="button button-outline" href="#polls">Перейти к голосованиям <span>→</span></a></section>`;
}

async function route() {
  if (!currentUser) return;
  const version = ++routeVersion;
  const hash = location.hash.slice(1);
  const [path, query] = hash.split('?');
  const routeName = path.split('/')[0] || 'home';
  $$('.side-link').forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${routeName}`));
  renderLoading();

  try {
    const result = await api('/api/polls');
    if (version !== routeVersion) return;
    polls = result.polls;
    updateProfile();
    if (path.startsWith('poll/')) {
      const id = decodeURIComponent(path.slice(5));
      const inviteToken = new URLSearchParams(query || '').get('invite') || inviteTokens[id] || '';
      const headers = inviteToken ? { 'x-poll-invite': inviteToken } : {};
      const detail = await api(`/api/polls/${encodeURIComponent(id)}`, { headers });
      if (version !== routeVersion) return;
      renderDetail(detail.poll);
      if (!polls.some(poll => poll.id === detail.poll.id)) polls.unshift(detail.poll);
    } else if (path === 'polls') {
      renderList();
    } else if (['questions', 'messages', 'groups'].includes(path)) {
      renderSectionComingSoon(path);
    } else {
      renderHome($('#search-input').value.trim());
    }
  } catch (error) {
    if (version !== routeVersion) return;
    pageTitle('Не удалось загрузить');
    $('#view-root').innerHTML = `<div class="empty-card error-card"><div class="empty-illustration">!</div><h3>Не удалось загрузить данные</h3><p>${escapeHTML(error.message)}</p><button class="button button-outline" data-action="retry">Попробовать снова</button></div>`;
  }
}

function openModal() {
  $('#modal-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('#modal-close').focus();
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

function openCreate() {
  $('#modal-content').innerHTML = `<div class="modal-eyebrow">НОВОЕ РЕШЕНИЕ</div><h2 id="modal-title">Создать голосование</h2><p class="modal-intro">Сформулируйте вопрос и добавьте варианты, между которыми выбирают участники.</p>
    <form id="create-form"><label class="form-label" for="poll-title">Вопрос</label><input class="text-input" id="poll-title" maxlength="100" required placeholder="Например, куда пойдём в субботу?" />
    <label class="form-label" for="poll-description">Описание <span class="optional">необязательно</span></label><textarea class="text-input text-area" id="poll-description" maxlength="1000" placeholder="Добавьте контекст для участников"></textarea>
    <label class="form-label" for="poll-type">Тип голосования</label><select class="text-input" id="poll-type"><option value="single">Один вариант</option><option value="multiple">Несколько вариантов</option><option value="rating">Оценка каждого варианта от 1 до 10</option></select>
    <label class="form-label">Варианты <span class="optional">от 2 до 10</span></label><div id="option-fields"><input class="text-input option-input" maxlength="100" required placeholder="Вариант 1" /><input class="text-input option-input" maxlength="100" required placeholder="Вариант 2" /></div>
    <button class="add-option" type="button" id="add-option">＋ Добавить вариант</button>
    <label class="form-label" for="poll-deadline">Срок завершения <span class="optional">необязательно</span></label><input class="text-input" id="poll-deadline" type="datetime-local" />
    <label class="form-label" for="poll-visibility">Доступ</label><select class="text-input" id="poll-visibility"><option value="private">Приватный — только по ссылке</option><option value="public">Публичный — видно участникам Picksy</option></select>
    <div class="form-error" id="form-error" role="alert"></div><button class="button button-primary full-button" type="submit">Создать голосование <span>→</span></button></form>`;
  openModal();
  $('#add-option').addEventListener('click', () => {
    const fields = $('#option-fields');
    if (fields.children.length >= 10) return toast('Можно добавить не больше 10 вариантов.');
    const input = document.createElement('input');
    input.className = 'text-input option-input';
    input.maxLength = 100;
    input.placeholder = `Вариант ${fields.children.length + 1}`;
    input.required = true;
    fields.append(input);
    input.focus();
  });
  $('#create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $('button[type="submit"]', form);
    const errorBox = $('#form-error');
    const options = $$('.option-input', form).map(input => input.value.trim()).filter(Boolean);
    const deadlineValue = $('#poll-deadline').value;
    if (options.length < 2) {
      errorBox.textContent = 'Добавьте как минимум два варианта.';
      return;
    }
    if (new Set(options.map(item => item.toLocaleLowerCase())).size !== options.length) {
      errorBox.textContent = 'Варианты должны отличаться друг от друга.';
      return;
    }
    if (deadlineValue && new Date(deadlineValue).getTime() <= Date.now()) {
      errorBox.textContent = 'Срок должен быть в будущем.';
      return;
    }
    const body = {
      title: $('#poll-title').value.trim(),
      description: $('#poll-description').value.trim(),
      type: $('#poll-type').value,
      options,
      deadline: deadlineValue ? new Date(deadlineValue).toISOString() : null,
      visibility: $('#poll-visibility').value
    };
    submit.disabled = true;
    submit.textContent = 'Создаём…';
    errorBox.textContent = '';
    try {
      const result = await api('/api/polls', { method: 'POST', body });
      const poll = result.poll;
      const invite = poll.inviteToken;
      if (invite) rememberInvite(poll.id, invite);
      closeModal();
      location.hash = `poll/${encodeURIComponent(poll.id)}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;
      toast('Голосование создано. Скопируйте ссылку и отправьте участникам.');
    } catch (error) {
      errorBox.textContent = error.message;
      submit.disabled = false;
      submit.innerHTML = 'Создать голосование <span>→</span>';
    }
  });
}

async function submitVote() {
  const detail = $('#view-root');
  const pollId = decodeURIComponent(location.hash.slice(1).split('?')[0].slice(5));
  const inviteToken = detail.dataset.invite;
  const headers = inviteToken ? { 'x-poll-invite': inviteToken } : {};
  const selectedScores = $$('.rate-button.chosen', detail).map(button => ({ optionId: button.dataset.option, score: Number(button.dataset.score) }));
  const selectedOptions = $$('.option-check:checked', detail).map(input => input.value);
  const poll = polls.find(item => item.id === pollId);
  const body = poll?.type === 'rating' ? { ratings: selectedScores } : { optionIds: selectedOptions };
  if (poll?.type === 'rating' && !selectedScores.length) return toast('Поставьте оценку хотя бы одному варианту.');
  if (poll?.type !== 'rating' && !selectedOptions.length) return toast('Выберите хотя бы один вариант.');
  const button = $('[data-action="submit-vote"]');
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  try {
    await api(`/api/polls/${encodeURIComponent(pollId)}/vote`, { method: 'POST', headers, body });
    await route();
    toast('Ваш голос сохранён.');
  } catch (error) {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = 'Отправить голос <span>→</span>';
    }
    toast(error.message);
    if (error.status === 409) await route();
  }
}

async function copyLink() {
  const rawHash = location.hash.slice(1);
  const [path] = rawHash.split('?');
  const pollId = decodeURIComponent(path.slice(5));
  const poll = polls.find(item => item.id === pollId);
  if (!poll) return toast('Не удалось определить голосование.');
  let token = new URLSearchParams(rawHash.split('?')[1] || '').get('invite') || inviteTokens[pollId] || '';
  if (poll.visibility === 'private' && !token) {
    try {
      const result = await api(`/api/polls/${encodeURIComponent(pollId)}/invitation`, { method: 'POST', body: {} });
      token = result.inviteToken;
      rememberInvite(pollId, token);
      history.replaceState(null, '', `#poll/${encodeURIComponent(pollId)}?invite=${encodeURIComponent(token)}`);
      toast('Создана новая ссылка. Предыдущая ссылка больше не действует.');
    } catch (error) {
      return toast(error.message);
    }
  }
  const url = `${location.href.split('#')[0]}#poll/${encodeURIComponent(pollId)}${token && poll.visibility === 'private' ? `?invite=${encodeURIComponent(token)}` : ''}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована.');
  } catch {
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.className = 'copy-fallback';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (copied) toast('Ссылка скопирована.');
    else toast('Скопируйте ссылку из адресной строки браузера.');
  }
}

document.addEventListener('click', async event => {
  const authMode = event.target.closest('[data-auth-mode]')?.dataset.authMode;
  if (authMode) return showAuth(authMode);
  const pollTab = event.target.closest('[data-poll-tab]')?.dataset.pollTab;
  if (pollTab) {
    $$('[data-poll-tab]').forEach(button => {
      const active = button.dataset.pollTab === pollTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-poll-panel]').forEach(panel => {
      panel.hidden = panel.dataset.pollPanel !== pollTab;
    });
    if (pollTab === 'discussion') {
      const pollId = decodeURIComponent(location.hash.slice(1).split('?')[0].slice(5));
      loadComments(pollId);
    }
    return;
  }
  const filter = event.target.closest('[data-filter]')?.dataset.filter;
  if (filter) {
    pollFilter = filter;
    renderList();
    return;
  }
  const rateButton = event.target.closest('.rate-button');
  if (rateButton && !rateButton.disabled) {
    const row = rateButton.closest('.ballot-option');
    row.querySelectorAll('.rate-button').forEach(button => button.classList.toggle('chosen', button === rateButton));
    row.classList.add('selected');
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'create') return openCreate();
  if (action === 'retry') return route();
  if (action === 'submit-vote') return submitVote();
  if (action === 'copy-link') return copyLink();
  if (action === 'reply-comment') {
    const form = $('#comment-form');
    const replyTarget = $('#replying-to');
    if (!form || !replyTarget) return;
    const commentId = event.target.closest('[data-comment-id]').dataset.commentId;
    const author = event.target.closest('[data-comment-author]').dataset.commentAuthor;
    form.dataset.parentId = commentId;
    replyTarget.innerHTML = `Ответ для <strong>${escapeHTML(author)}</strong><button type="button" class="reply-cancel" data-action="cancel-reply" aria-label="Отменить ответ">×</button>`;
    replyTarget.hidden = false;
    $('#comment-text').focus();
    return;
  }
  if (action === 'cancel-reply') {
    const form = $('#comment-form');
    delete form.dataset.parentId;
    $('#replying-to').hidden = true;
    $('#replying-to').textContent = '';
    return;
  }
  if (action === 'load-comments' || action === 'load-more-comments') {
    const pollId = decodeURIComponent(location.hash.slice(1).split('?')[0].slice(5));
    const offset = action === 'load-more-comments' ? Number($('#poll-comments').dataset.offset || 0) : 0;
    return loadComments(pollId, offset);
  }
  if (action === 'close-poll') {
    const pollId = decodeURIComponent(location.hash.slice(1).split('?')[0].slice(5));
    if (!window.confirm('Завершить голосование? После этого участники не смогут отправить голос.')) return;
    const button = event.target.closest('[data-action]');
    button.disabled = true;
    try {
      const invite = $('#view-root').dataset.invite;
      const headers = invite ? { 'x-poll-invite': invite } : {};
      await api(`/api/polls/${encodeURIComponent(pollId)}/close`, { method: 'POST', headers, body: {} });
      await route();
      toast('Голосование завершено.');
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }
});

document.addEventListener('submit', async event => {
  if (event.target.id !== 'comment-form') return;
  event.preventDefault();
  const form = event.target;
  const button = $('button[type="submit"]', form);
  const errorBox = $('#comment-error');
  const pollId = decodeURIComponent(location.hash.slice(1).split('?')[0].slice(5));
  const inviteToken = $('#view-root').dataset.invite;
  const headers = inviteToken ? { 'x-poll-invite': inviteToken } : {};
  const text = $('#comment-text').value.trim();
  if (!text) {
    errorBox.textContent = 'Комментарий не может быть пустым.';
    return;
  }
  button.disabled = true;
  errorBox.textContent = '';
  try {
    await api(`/api/polls/${encodeURIComponent(pollId)}/comments`, {
      method: 'POST',
      headers,
      body: { text, parentId: form.dataset.parentId || null }
    });
    if (!form.isConnected) return;
    $('#comment-text').value = '';
    delete form.dataset.parentId;
    $('#replying-to').hidden = true;
    $('#replying-to').textContent = '';
    const count = $('.discussion-count');
    count.textContent = String(Number(count.textContent) + 1);
    await loadComments(pollId);
    toast('Комментарий опубликован.');
  } catch (error) {
    if (form.isConnected) errorBox.textContent = error.message;
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

$('#top-create').addEventListener('click', openCreate);
$('#search-input').addEventListener('input', () => {
  if (!location.hash || location.hash === '#home') renderHome($('#search-input').value.trim());
});
$('#profile-button').addEventListener('click', () => {
  $('#modal-content').innerHTML = `<div class="modal-eyebrow">ВАШ АККАУНТ</div><h2 id="modal-title">${escapeHTML(currentUser.displayName)}</h2><p class="modal-intro">@${escapeHTML(currentUser.username)} · ${escapeHTML(currentUser.email)}</p><button class="button button-outline full-button" id="logout-button">Выйти из аккаунта <span>↗</span></button>`;
  openModal();
  $('#logout-button').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
      currentUser = null;
      closeModal();
      showAuth('login', 'Вы вышли из аккаунта.');
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });
});
$('#modal-close').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', event => {
  if (event.target.id === 'modal-backdrop') closeModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
});
window.addEventListener('hashchange', route);

async function bootstrap() {
  try {
    const result = await api('/api/auth/me');
    if (!result.user) return showAuth('login');
    currentUser = result.user;
    authRoot.hidden = true;
    appShell.hidden = false;
    await route();
  } catch (error) {
    appShell.hidden = true;
    authRoot.hidden = false;
    authRoot.innerHTML = `<section class="auth-card connection-card"><a class="brand auth-brand" href="#home"><span class="brand-mark">p</span><span>picksy<span class="brand-dot">.</span></span></a><div class="auth-eyebrow">СВЯЗЬ С СЕРВЕРОМ</div><h1>Picksy сейчас недоступен</h1><p class="auth-intro">${escapeHTML(error.message)} Убедитесь, что сервер запущен, и попробуйте ещё раз.</p><button class="button button-primary full-button" id="retry-connection">Повторить подключение <span>↻</span></button><div class="auth-security">Для локального запуска выполните <code>npm start</code> в папке проекта.</div></section>`;
    $('#retry-connection').addEventListener('click', bootstrap);
  }
}

bootstrap();
