const $ = (selector, root = document) => root.querySelector(selector);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const userKey = 'decido-user-id';
const userId = read(userKey, null) || (() => { const id = crypto.randomUUID(); save(userKey, id); return id; })();
let profile = read('decido-profile', { name: 'Алекс' });
let polls = read('decido-polls', []);
let toastTimer;

function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function updateProfile() { $('#profile-name').textContent = profile.name; $('#user-avatar').textContent = [...profile.name][0]?.toUpperCase() || 'А'; }
function savePolls() { save('decido-polls', polls); }
function formatDate(value) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function isClosed(poll) { return poll.closed || (poll.deadline && new Date(poll.deadline).getTime() <= Date.now()); }
function pollVotes(poll) { return Object.values(poll.votes || {}); }
function results(poll, options = poll.options) {
  const votes = pollVotes(poll).filter(vote => vote.round === (poll.round || 1));
  return options.map(option => {
    const values = votes.flatMap(vote => Array.isArray(vote.value) ? vote.value.filter(item => item.optionId === option.id).map(item => item.score) : vote.value === option.id ? [1] : []);
    return { ...option, count: values.length, score: values.length ? values.reduce((a,b) => a+b, 0) / values.length : 0 };
  });
}
function winningSet(poll, options = poll.options) {
  const rows = results(poll, options);
  if (!rows.some(row => row.count)) return { rows, leaders: [] };
  const best = poll.type === 'rating' ? Math.max(...rows.map(row => row.score)) : Math.max(...rows.map(row => row.count));
  return { rows, leaders: rows.filter(row => (poll.type === 'rating' ? row.score : row.count) === best) };
}
function renderHome(query = '') {
  const filtered = polls.filter(poll => `${poll.title} ${poll.description} ${poll.options.map(option => option.text).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const open = filtered.filter(poll => !isClosed(poll));
  const recent = filtered.slice(0, 4);
  $('#page-crumb').textContent = query ? 'Поиск' : 'Главная';
  $('#poll-count').textContent = String(polls.filter(poll => !isClosed(poll)).length);
  $('#view-root').innerHTML = `<section class="welcome-row"><div><div class="eyebrow"><span class="eyebrow-dot"></span> ВАШЕ ПРОСТРАНСТВО</div><h1>Привет, ${escapeHTML(profile.name)} <span class="wave">✳</span></h1><p class="welcome-copy">Что решим вместе? Создайте голосование и соберите мнения в одном месте.</p></div><button class="button button-primary create-large" data-action="create">＋ Создать голосование <span>↗</span></button></section>
  <section class="quick-stats"><article class="stat-card"><span class="stat-icon coral">◉</span><div><small>Активные голосования</small><strong>${open.length}</strong></div><span class="stat-foot">сейчас</span></article><article class="stat-card"><span class="stat-icon mint">✓</span><div><small>Создано вами</small><strong>${polls.filter(p => p.ownerId === userId).length}</strong></div><span class="stat-foot">всего</span></article><article class="stat-card"><span class="stat-icon lilac">↗</span><div><small>Всего ответов</small><strong>${polls.reduce((sum,p) => sum + pollVotes(p).length, 0)}</strong></div><span class="stat-foot">в голосованиях</span></article></section>
  <section class="content-section"><div class="section-heading"><div><div class="section-label">СОБИРАЕМ МНЕНИЯ</div><h2>${query ? 'Результаты поиска' : 'Активные голосования'}</h2></div><a href="#polls" class="quiet-link">Все голосования <span>→</span></a></div>${open.length ? `<div class="poll-grid">${open.map(pollCard).join('')}</div>` : `<div class="empty-card"><div class="empty-illustration">◉</div><h3>${query ? 'Ничего не нашлось' : 'Пока нет активных голосований'}</h3><p>${query ? 'Попробуйте изменить поисковый запрос.' : 'Создайте первое голосование и пригласите людей решить вопрос вместе.'}</p>${!query ? '<button class="button button-outline" data-action="create">Создать голосование <span>→</span></button>' : ''}</div>`}</section>
  <section class="content-section recent-section"><div class="section-heading"><div><div class="section-label">ИСТОРИЯ</div><h2>Недавние голосования</h2></div></div>${recent.length ? `<div class="recent-list">${recent.map(poll => `<a class="recent-row" href="#poll/${encodeURIComponent(poll.id)}"><span class="recent-icon">${isClosed(poll) ? '✓' : '◉'}</span><span class="recent-main"><strong>${escapeHTML(poll.title)}</strong><small>${poll.options.length} вариантов · ${pollVotes(poll).length} ответов</small></span><span class="status-pill ${isClosed(poll) ? 'closed' : ''}">${isClosed(poll) ? 'Завершено' : 'Активно'}</span><span class="row-arrow">↗</span></a>`).join('')}</div>` : '<div class="recent-empty">Ваши голосования появятся здесь.</div>'}</section>`;
}
function pollCard(poll) {
  const total = pollVotes(poll).filter(v => v.round === (poll.round || 1)).length;
  const closed = isClosed(poll);
  return `<a class="poll-card" href="#poll/${encodeURIComponent(poll.id)}"><div class="poll-card-top"><span class="status-pill ${closed ? 'closed' : ''}"><i></i>${closed ? 'Завершено' : 'Активно'}</span><span class="card-more">↗</span></div><h3>${escapeHTML(poll.title)}</h3><p>${escapeHTML(poll.description || 'Решение, которое примем вместе.')}</p><div class="option-preview">${poll.options.slice(0,3).map(option => `<span>${escapeHTML(option.text)}</span>`).join('')}${poll.options.length > 3 ? `<span>+${poll.options.length - 3}</span>` : ''}</div><div class="poll-card-bottom"><span class="avatar-stack"><b>${escapeHTML([...poll.organizer][0]?.toUpperCase() || 'А')}</b><small>${escapeHTML(poll.organizer)}</small></span><span class="vote-meta-small">◉ ${total} ${total === 1 ? 'ответ' : 'ответов'}</span></div></a>`;
}
function renderList() {
  $('#page-crumb').textContent = 'Голосования';
  $('#view-root').innerHTML = `<section class="list-header"><div><div class="eyebrow"><span class="eyebrow-dot"></span> ВАШИ РЕШЕНИЯ</div><h1>Голосования</h1><p class="welcome-copy">Все вопросы, которые вы решаете вместе.</p></div><button class="button button-primary" data-action="create">＋ Создать голосование</button></section><div class="list-tabs"><span>Все <b>${polls.length}</b></span><span>Активные <b>${polls.filter(p => !isClosed(p)).length}</b></span><span>Завершённые <b>${polls.filter(isClosed).length}</b></span></div>${polls.length ? `<div class="poll-grid">${polls.map(pollCard).join('')}</div>` : '<div class="empty-card"><div class="empty-illustration">◉</div><h3>Голосований пока нет</h3><p>Создайте вопрос, добавьте варианты и отправьте ссылку участникам.</p><button class="button button-outline" data-action="create">Создать первое голосование <span>→</span></button></div>'}`;
}
function renderDetail(id) {
  const poll = polls.find(item => item.id === id);
  if (!poll) { $('#page-crumb').textContent = 'Голосование'; $('#view-root').innerHTML = '<div class="empty-card"><h3>Голосование не найдено</h3><p>Возможно, ссылка устарела или голосование удалено с этого устройства.</p><a class="button button-outline" href="#polls">К голосованиям</a></div>'; return; }
  const closed = isClosed(poll), voted = Boolean(poll.votes?.[`${userId}:${poll.round || 1}`]), rows = results(poll), { leaders } = winningSet(poll), total = pollVotes(poll).filter(v => v.round === (poll.round || 1)).length;
  const winners = leaders.length === 1 ? leaders[0] : null;
  $('#page-crumb').textContent = poll.title;
  $('#view-root').innerHTML = `<div class="detail-back"><a href="#polls">← Все голосования</a>${poll.ownerId === userId && !closed ? '<button class="text-action" data-action="close-poll">Завершить голосование</button>' : ''}</div><section class="detail-heading"><div class="eyebrow"><span class="eyebrow-dot ${closed ? 'muted-dot' : ''}"></span>${closed ? 'ГОЛОСОВАНИЕ ЗАВЕРШЕНО' : 'АКТИВНОЕ ГОЛОСОВАНИЕ'}</div><h1>${escapeHTML(poll.title)}</h1><p>${escapeHTML(poll.description || '')}</p><div class="detail-meta"><span class="user-avatar mini">${escapeHTML([...poll.organizer][0]?.toUpperCase() || 'А')}</span><span>Создал(а) <strong>${escapeHTML(poll.organizer)}</strong></span><span class="meta-divider">·</span><span>${formatDate(poll.createdAt)}</span><span class="meta-divider">·</span><span>◉ ${total} ${total === 1 ? 'голос' : 'голосов'}</span></div></section>
  ${closed ? `<section class="result-banner"><div class="result-symbol">${winners ? '✳' : '◉'}</div><div><div class="section-label">${total === 0 ? 'ГОЛОСОВ ПОКА НЕТ' : winners ? 'УЖЕ ВЫБРАЛИ' : 'НИЧЬЯ'}</div><h2>${total === 0 ? 'Решение осталось открытым' : winners ? escapeHTML(winners.text) : `${leaders.length} варианта делят первое место`}</h2><p>${total === 0 ? 'В этом голосовании никто не успел проголосовать.' : winners ? `Лидер набрал ${poll.type === 'rating' ? `${winners.score.toFixed(1)} из 10 в среднем` : `${winners.count} ${winners.count === 1 ? 'голос' : 'голоса'}`}.` : 'Организатор может провести короткий дополнительный раунд.'}</p></div></section>` : ''}
  <div class="detail-columns"><section class="panel ballot-panel"><div class="panel-heading"><div><div class="section-label">${closed ? 'ИТОГИ' : voted ? 'ВАШ ОТВЕТ СОХРАНЁН' : 'ВАШЕ МНЕНИЕ'}</div><h2>${closed ? 'Результаты' : poll.type === 'single' ? 'Выберите один вариант' : poll.type === 'multiple' ? 'Выберите подходящие варианты' : 'Оцените варианты от 1 до 10'}</h2></div><span class="type-chip">${poll.type === 'single' ? 'Один вариант' : poll.type === 'multiple' ? 'Несколько' : 'Оценка 1–10'}</span></div><div class="ballot-options">${poll.options.map((option,index) => renderOption(poll, option,index, rows, voted, closed)).join('')}</div>${!closed ? `<button class="button button-primary submit-ballot" data-action="submit-vote" ${voted ? 'disabled' : ''}>${voted ? 'Голос принят' : 'Отправить голос'} <span>→</span></button><p class="ballot-hint">Ваш голос сохранится на этом устройстве. Повторное голосование недоступно.</p>` : ''}</section><aside class="panel invite-panel"><div class="section-label">ПРИГЛАСИТЕ УЧАСТНИКОВ</div><h3>Решение начинается с мнений</h3><p>Скопируйте ссылку и отправьте её участникам голосования.</p><button class="button button-outline full-button" data-action="copy-link">Скопировать ссылку <span>↗</span></button><div class="invite-note"><span>ⓘ</span><span>Ссылка откроется на том же устройстве, где сохранено это голосование.</span></div>${closed && poll.ownerId === userId && leaders.length > 1 ? `<button class="button button-primary full-button tie-button" data-action="tie-round">Провести решающий раунд <span>→</span></button>` : ''}</aside></div>`;
}
function renderOption(poll, option, index, rows, voted, closed) {
  const currentBallot = poll.votes?.[`${userId}:${poll.round || 1}`] || null;
  const value = currentBallot?.value;
  const selected = poll.type === 'multiple' ? Array.isArray(value) && value.some(item => item.optionId === option.id) : value === option.id;
  const row = rows.find(item => item.id === option.id) || { count: 0, score: 0 };
  const max = Math.max(1, ...rows.map(item => poll.type === 'rating' ? item.score : item.count));
  const amount = poll.type === 'rating' ? row.score : row.count;
  const percent = amount ? Math.round(amount / max * 100) : 0;
  const resultMarkup = (voted || closed) ? `<div class="result-line"><span class="result-bar"><i style="width:${percent}%"></i></span><strong>${poll.type === 'rating' ? (row.count ? row.score.toFixed(1) : '—') : `${row.count} ${row.count === 1 ? 'голос' : 'голосов'}`}</strong></div>` : '';
  const control = poll.type === 'rating' ? `<div class="rating-control">${Array.from({ length: 10 }, (_,n) => `<button type="button" class="rate-button ${Array.isArray(value) && value.find(item => item.optionId === option.id)?.score === n + 1 ? 'chosen' : ''}" data-score="${n+1}" data-option="${option.id}" ${voted || closed ? 'disabled' : ''}>${n+1}</button>`).join('')}</div>` : '';
  return `<div class="ballot-option ${selected ? 'selected' : ''}" data-option-row="${option.id}"><div class="ballot-option-main"><span class="option-index">${String(index+1).padStart(2,'0')}</span><span class="option-text">${escapeHTML(option.text)}</span>${!closed && !voted && poll.type !== 'rating' ? `<input class="option-check" type="${poll.type === 'single' ? 'radio' : 'checkbox'}" name="ballot-choice" value="${option.id}" aria-label="${escapeHTML(option.text)}" ${selected ? 'checked' : ''} />` : selected ? '<span class="selected-check">✓</span>' : ''}</div>${control}${resultMarkup}</div>`;
}
function openCreate() {
  $('#modal-content').innerHTML = `<div class="modal-eyebrow">НОВОЕ РЕШЕНИЕ</div><h2 id="modal-title">Создать голосование</h2><p class="modal-intro">Сформулируйте вопрос и добавьте варианты, между которыми выбирают участники.</p><form id="create-form"><label class="form-label" for="poll-title">Вопрос</label><input class="text-input" id="poll-title" maxlength="100" required placeholder="Например, как назовём наш проект?" /><label class="form-label" for="poll-description">Описание <span class="optional">необязательно</span></label><textarea class="text-input text-area" id="poll-description" maxlength="500" placeholder="Добавьте контекст для участников"></textarea><label class="form-label" for="poll-type">Тип голосования</label><select class="text-input" id="poll-type"><option value="single">Один вариант</option><option value="multiple">Несколько вариантов</option><option value="rating">Оценка каждого варианта от 1 до 10</option></select><label class="form-label">Варианты</label><div id="option-fields"><input class="text-input option-input" maxlength="100" required placeholder="Вариант 1" /><input class="text-input option-input" maxlength="100" required placeholder="Вариант 2" /></div><button class="add-option" type="button" id="add-option">＋ Добавить вариант</button><label class="form-label" for="poll-deadline">Срок завершения <span class="optional">необязательно</span></label><input class="text-input" id="poll-deadline" type="datetime-local" /><div class="form-error" id="form-error"></div><button class="button button-primary full-button" type="submit">Создать голосование <span>→</span></button></form>`;
  openModal();
  $('#add-option').addEventListener('click', () => { const fields = $('#option-fields'); if (fields.children.length >= 10) return toast('Можно добавить не больше 10 вариантов.'); const input = document.createElement('input'); input.className = 'text-input option-input'; input.maxLength = 100; input.placeholder = `Вариант ${fields.children.length + 1}`; input.required = true; fields.append(input); input.focus(); });
  $('#create-form').addEventListener('submit', event => {
    event.preventDefault();
    const options = [...$$('.option-input')].map(input => input.value.trim()).filter(Boolean);
    const deadlineValue = $('#poll-deadline').value;
    if (options.length < 2) { $('#form-error').textContent = 'Добавьте как минимум два варианта.'; return; }
    if (new Set(options.map(item => item.toLocaleLowerCase())).size !== options.length) { $('#form-error').textContent = 'Варианты должны отличаться друг от друга.'; return; }
    if (deadlineValue && new Date(deadlineValue).getTime() <= Date.now()) { $('#form-error').textContent = 'Срок должен быть в будущем.'; return; }
    const poll = { id: crypto.randomUUID(), title: $('#poll-title').value.trim(), description: $('#poll-description').value.trim(), type: $('#poll-type').value, options: options.map(text => ({ id: crypto.randomUUID(), text })), organizer: profile.name, ownerId: userId, createdAt: new Date().toISOString(), deadline: deadlineValue ? new Date(deadlineValue).toISOString() : null, votes: {}, round: 1, closed: false };
    polls.unshift(poll); savePolls(); closeModal(); location.hash = `poll/${encodeURIComponent(poll.id)}`; toast('Голосование создано. Скопируйте ссылку для участников.');
  });
}
function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function openModal() { $('#modal-backdrop').classList.remove('hidden'); document.body.style.overflow = 'hidden'; $('#modal-close').focus(); }
function closeModal() { $('#modal-backdrop').classList.add('hidden'); document.body.style.overflow = ''; }
function saveVote(poll) {
  const ballotKey = `${userId}:${poll.round || 1}`;
  if (poll.votes?.[ballotKey]) return toast('Вы уже проголосовали.');
  let value;
  if (poll.type === 'rating') {
    value = $$('.rate-button.chosen').map(button => ({ optionId: button.dataset.option, score: Number(button.dataset.score) }));
    if (!value.length) return toast('Поставьте оценку хотя бы одному варианту.');
  } else {
    value = $$('.option-check:checked').map(input => input.value);
    if (!value.length) return toast('Выберите хотя бы один вариант.');
    if (poll.type === 'single') value = value[0];
  }
  poll.votes ||= {}; poll.votes[ballotKey] = { value, round: poll.round || 1, createdAt: new Date().toISOString() };
  savePolls(); renderDetail(poll.id); toast('Ваш голос сохранён.');
}
async function copyLink(poll) {
  const url = `${location.href.split('#')[0]}#poll/${encodeURIComponent(poll.id)}`;
  try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована.'); }
  catch { const field = document.createElement('textarea'); field.value = url; document.body.append(field); field.select(); document.execCommand('copy'); field.remove(); toast('Ссылка скопирована.'); }
}
function route() {
  updateProfile();
  const path = decodeURIComponent(location.hash.slice(1));
  if (path.startsWith('poll/')) renderDetail(path.slice(5));
  else if (path === 'polls') renderList();
  else renderHome($('#search-input').value.trim());
  $$('.side-link').forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${path.split('/')[0] || 'home'}`));
}
document.addEventListener('click', event => {
  const coming = event.target.closest('[data-coming]'); if (coming) { event.preventDefault(); toast(coming.dataset.coming); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'create') openCreate();
  if (action === 'submit-vote') { const poll = polls.find(item => item.id === decodeURIComponent(location.hash.slice(6))); if (poll) saveVote(poll); }
  if (action === 'copy-link') { const poll = polls.find(item => item.id === decodeURIComponent(location.hash.slice(6))); if (poll) copyLink(poll); }
  if (action === 'close-poll') { const poll = polls.find(item => item.id === decodeURIComponent(location.hash.slice(6))); if (poll?.ownerId === userId) { poll.closed = true; poll.closedAt = new Date().toISOString(); savePolls(); renderDetail(poll.id); } }
  if (action === 'tie-round') { const poll = polls.find(item => item.id === decodeURIComponent(location.hash.slice(6))); if (!poll || poll.ownerId !== userId) return; const { leaders } = winningSet(poll); poll.options = leaders.map(({ id, text }) => ({ id, text })); poll.round = (poll.round || 1) + 1; poll.deadline = null; poll.closed = false; savePolls(); renderDetail(poll.id); toast('Решающий раунд открыт.'); }
  const rate = event.target.closest('.rate-button'); if (rate && !rate.disabled) { const row = rate.closest('.ballot-option'); row.querySelectorAll('.rate-button').forEach(button => button.classList.toggle('chosen', button === rate)); row.classList.add('selected'); }
});
$('#top-create').addEventListener('click', openCreate);
$('#search-input').addEventListener('input', () => { if (!location.hash || location.hash === '#home') renderHome($('#search-input').value.trim()); });
$('#profile-button').addEventListener('click', () => {
  $('#modal-content').innerHTML = `<div class="modal-eyebrow">ВАШ ПРОФИЛЬ</div><h2 id="modal-title">Как к вам обращаться?</h2><p class="modal-intro">Имя будет видно участникам созданных вами голосований.</p><label class="form-label" for="profile-edit">Имя</label><input class="text-input" id="profile-edit" maxlength="40" value="${escapeHTML(profile.name)}" /><button class="button button-primary full-button" id="save-profile">Сохранить <span>✓</span></button>`; openModal();
  $('#save-profile').addEventListener('click', () => { const name = $('#profile-edit').value.trim(); if (!name) return toast('Введите имя.'); profile = { name }; save('decido-profile', profile); closeModal(); route(); toast('Имя обновлено.'); });
});
$('#notifications-button').addEventListener('click', () => toast('Новых уведомлений нет.'));
$('#modal-close').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', event => { if (event.target.id === 'modal-backdrop') closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', route);
route();
