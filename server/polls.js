import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError, requireValue } from './errors.js';
import { currentUser, hashToken } from './auth.js';

const allowedTypes = new Set(['single', 'multiple', 'rating']);

function validatePollInput(body) {
  requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Проверьте данные голосования.');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const type = body.type;
  const visibility = body.visibility;
  const options = Array.isArray(body.options) ? body.options.map(option => typeof option === 'string' ? option.trim() : '') : [];

  requireValue(title.length >= 1 && title.length <= 100, 400, 'INVALID_TITLE', 'Название должно содержать от 1 до 100 символов.');
  requireValue(description.length <= 1000, 400, 'INVALID_DESCRIPTION', 'Описание должно быть не длиннее 1000 символов.');
  requireValue(allowedTypes.has(type), 400, 'INVALID_TYPE', 'Выберите поддерживаемый тип голосования.');
  requireValue(visibility === 'public' || visibility === 'private', 400, 'INVALID_VISIBILITY', 'Выберите доступ по ссылке или публичное голосование.');
  requireValue(options.length >= 2 && options.length <= 10, 400, 'INVALID_OPTIONS', 'Добавьте от 2 до 10 вариантов.');
  requireValue(options.every(option => option.length >= 1 && option.length <= 100), 400, 'INVALID_OPTIONS', 'Варианты не могут быть пустыми и должны быть не длиннее 100 символов.');
  requireValue(new Set(options.map(option => option.toLocaleLowerCase())).size === options.length, 400, 'DUPLICATE_OPTIONS', 'Варианты должны отличаться друг от друга.');

  let deadline = null;
  if (body.deadline !== null && body.deadline !== undefined && body.deadline !== '') {
    const parsed = Date.parse(body.deadline);
    requireValue(Number.isFinite(parsed) && parsed > Date.now(), 400, 'INVALID_DEADLINE', 'Срок завершения должен быть в будущем.');
    deadline = new Date(parsed).toISOString();
  }

  return { title, description, type, visibility, options, deadline };
}

function hasValidInvite(poll, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false;
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(poll.invite_token_hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function pollResults(db, poll) {
  const options = db.prepare('SELECT id, text, position FROM poll_options WHERE poll_id = ? ORDER BY position').all(poll.id);
  const voteCount = db.prepare('SELECT COUNT(*) AS count FROM votes WHERE poll_id = ?').get(poll.id).count;
  const participants = db.prepare('SELECT COUNT(*) AS count FROM poll_participants WHERE poll_id = ?').get(poll.id).count;

  const results = options.map(option => {
    if (poll.type === 'rating') {
      const score = db.prepare(`
        SELECT COUNT(*) AS count, AVG(vote_scores.score) AS average
        FROM vote_scores JOIN votes ON votes.id = vote_scores.vote_id
        WHERE votes.poll_id = ? AND vote_scores.option_id = ?
      `).get(poll.id, option.id);
      return { id: option.id, text: option.text, count: score.count, score: score.average === null ? null : Number(score.average) };
    }
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM vote_choices
      JOIN votes ON votes.id = vote_choices.vote_id
      WHERE votes.poll_id = ? AND vote_choices.option_id = ?
    `).get(poll.id, option.id).count;
    return { id: option.id, text: option.text, count, score: null };
  });

  const measure = poll.type === 'rating' ? 'score' : 'count';
  const comparable = results.map(row => row[measure]).filter(value => value !== null);
  const best = voteCount && comparable.length ? Math.max(...comparable) : null;
  const leaders = best === null ? [] : results.filter(row => row[measure] === best);
  return { options: results, voteCount, participantCount: participants, leaders };
}

function serializePoll(db, poll, userId) {
  const stats = pollResults(db, poll);
  const commentCount = db.prepare('SELECT COUNT(*) AS count FROM poll_comments WHERE poll_id = ?').get(poll.id).count;
  const myVote = userId ? db.prepare('SELECT id, created_at FROM votes WHERE poll_id = ? AND user_id = ?').get(poll.id, userId) : null;
  let vote = null;
  if (myVote) {
    vote = poll.type === 'rating'
      ? { ratings: db.prepare('SELECT option_id AS optionId, score FROM vote_scores WHERE vote_id = ?').all(myVote.id) }
      : { optionIds: db.prepare('SELECT option_id AS optionId FROM vote_choices WHERE vote_id = ?').all(myVote.id).map(row => row.optionId) };
  }

  const { invite_token_hash, ...safePoll } = poll;
  return {
    ...safePoll,
    commentCount,
    closed: Boolean(poll.closed_at) || Boolean(poll.deadline && Date.parse(poll.deadline) <= Date.now()),
    allowVoteChange: Boolean(poll.allow_vote_change),
    ...stats,
    myVote: vote
  };
}

function pollComments(db, pollId, limit, offset) {
  const roots = db.prepare(`
    SELECT comments.id, comments.body, comments.created_at, users.id AS user_id, users.display_name AS author
    FROM poll_comments AS comments
    JOIN users ON users.id = comments.user_id
    WHERE comments.poll_id = ? AND comments.parent_id IS NULL
    ORDER BY comments.created_at DESC, comments.id DESC
    LIMIT ? OFFSET ?
  `).all(pollId, limit, offset);
  if (!roots.length) return { comments: [], hasMore: false };

  const rootIds = roots.map(comment => comment.id);
  const placeholders = rootIds.map(() => '?').join(', ');
  const replies = db.prepare(`
    SELECT comments.id, comments.parent_id, comments.body, comments.created_at,
      users.id AS user_id, users.display_name AS author
    FROM poll_comments AS comments
    JOIN users ON users.id = comments.user_id
    WHERE comments.poll_id = ? AND comments.parent_id IN (${placeholders})
    ORDER BY comments.created_at, comments.id
  `).all(pollId, ...rootIds);
  const replyGroups = new Map(rootIds.map(id => [id, []]));
  for (const reply of replies) {
    replyGroups.get(reply.parent_id).push({
      id: reply.id,
      body: reply.body,
      createdAt: reply.created_at,
      userId: reply.user_id,
      author: reply.author
    });
  }
  const comments = roots.map(comment => ({
    id: comment.id,
    body: comment.body,
    createdAt: comment.created_at,
    userId: comment.user_id,
    author: comment.author,
    replies: replyGroups.get(comment.id)
  }));
  const hasMore = db.prepare(`
    SELECT 1 AS found FROM poll_comments
    WHERE poll_id = ? AND parent_id IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1 OFFSET ?
  `).get(pollId, offset + limit) !== undefined;
  return { comments, hasMore };
}

function pollAccess(db, id, user, inviteToken) {
  const poll = db.prepare(`
    SELECT polls.*, users.display_name AS organizer
    FROM polls JOIN users ON users.id = polls.owner_id
    WHERE polls.id = ?
  `).get(id);
  if (!poll) throw new AppError(404, 'POLL_NOT_FOUND', 'Голосование не найдено.');
  if (poll.visibility === 'private' && poll.owner_id !== user.id && !hasValidInvite(poll, inviteToken)) {
    throw new AppError(404, 'POLL_NOT_FOUND', 'Голосование не найдено.');
  }
  return poll;
}

function createPoll(db, user, body) {
  const input = validatePollInput(body);
  const id = randomUUID();
  const inviteToken = randomBytes(32).toString('base64url');
  const inviteTokenHash = createHash('sha256').update(inviteToken).digest('hex');
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      INSERT INTO polls (id, owner_id, title, description, type, deadline, visibility, invite_token_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.id, input.title, input.description, input.type, input.deadline, input.visibility, inviteTokenHash, now);
    const addOption = db.prepare('INSERT INTO poll_options (id, poll_id, text, position) VALUES (?, ?, ?, ?)');
    input.options.forEach((text, position) => addOption.run(randomUUID(), id, text, position));
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const poll = db.prepare(`
    SELECT polls.*, users.display_name AS organizer
    FROM polls JOIN users ON users.id = polls.owner_id
    WHERE polls.id = ?
  `).get(id);
  return { ...serializePoll(db, poll, user.id), inviteToken: input.visibility === 'private' ? inviteToken : null };
}

function castVote(db, poll, user, body) {
  requireValue(!poll.closed_at && !(poll.deadline && Date.parse(poll.deadline) <= Date.now()), 409, 'POLL_CLOSED', 'Голосование уже завершено.');
  requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Проверьте ваш ответ.');
  const options = db.prepare('SELECT id FROM poll_options WHERE poll_id = ?').all(poll.id);
  const optionIds = new Set(options.map(option => option.id));
  const voteId = randomUUID();
  const now = new Date().toISOString();

  let choices = [];
  let ratings = [];
  if (poll.type === 'rating') {
    requireValue(Array.isArray(body.ratings) && body.ratings.length >= 1 && body.ratings.length <= options.length, 400, 'INVALID_RATINGS', 'Оцените хотя бы один вариант.');
    ratings = body.ratings;
    requireValue(ratings.every(item => item && optionIds.has(item.optionId) && Number.isInteger(item.score) && item.score >= 1 && item.score <= 10), 400, 'INVALID_RATINGS', 'Оценки должны быть целыми числами от 1 до 10 для вариантов этого голосования.');
    requireValue(new Set(ratings.map(item => item.optionId)).size === ratings.length, 400, 'INVALID_RATINGS', 'Каждый вариант можно оценить только один раз.');
  } else {
    requireValue(Array.isArray(body.optionIds) && body.optionIds.length >= 1 && body.optionIds.length <= options.length, 400, 'INVALID_CHOICES', 'Выберите хотя бы один вариант.');
    choices = body.optionIds;
    requireValue(choices.every(id => optionIds.has(id)), 400, 'INVALID_CHOICES', 'Выбран вариант, которого нет в голосовании.');
    requireValue(new Set(choices).size === choices.length, 400, 'INVALID_CHOICES', 'Повторяющиеся варианты недопустимы.');
    requireValue(poll.type !== 'single' || choices.length === 1, 400, 'INVALID_CHOICES', 'В этом голосовании можно выбрать только один вариант.');
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const currentPoll = db.prepare('SELECT closed_at, deadline FROM polls WHERE id = ?').get(poll.id);
    requireValue(currentPoll && !currentPoll.closed_at && !(currentPoll.deadline && Date.parse(currentPoll.deadline) <= Date.now()), 409, 'POLL_CLOSED', 'Голосование завершилось до отправки вашего ответа.');
    db.prepare('INSERT INTO votes (id, poll_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(voteId, poll.id, user.id, now);
    db.prepare('INSERT OR IGNORE INTO poll_participants (poll_id, user_id, joined_at) VALUES (?, ?, ?)').run(poll.id, user.id, now);
    if (poll.type === 'rating') {
      const insert = db.prepare('INSERT INTO vote_scores (vote_id, option_id, score) VALUES (?, ?, ?)');
      ratings.forEach(item => insert.run(voteId, item.optionId, item.score));
    } else {
      const insert = db.prepare('INSERT INTO vote_choices (vote_id, option_id) VALUES (?, ?)');
      choices.forEach(id => insert.run(voteId, id));
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    if (error.errcode === 2067 || error.errcode === 1555 || error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') {
      throw new AppError(409, 'ALREADY_VOTED', 'Вы уже проголосовали.');
    }
    throw error;
  }
}

export function handlePolls(db, request, url, body) {
  if (!url.pathname.startsWith('/api/polls')) return null;
  const user = currentUser(db, request);
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Войдите, чтобы продолжить.');

  if (request.method === 'POST' && url.pathname === '/api/polls') {
    return { status: 201, body: { poll: createPoll(db, user, body) } };
  }

  if (request.method === 'GET' && url.pathname === '/api/polls') {
    const polls = db.prepare(`
      SELECT polls.*, users.display_name AS organizer
      FROM polls JOIN users ON users.id = polls.owner_id
      WHERE polls.visibility = 'public' OR polls.owner_id = ?
      ORDER BY polls.created_at DESC
      LIMIT 100
    `).all(user.id);
    return { polls: polls.map(poll => serializePoll(db, poll, user.id)) };
  }

  const match = url.pathname.match(/^\/api\/polls\/([0-9a-f-]{36})(?:\/(vote|close|invitation|comments))?$/i);
  if (!match) throw new AppError(404, 'NOT_FOUND', 'Страница не найдена.');
  const [, id, action] = match;
  const inviteToken = request.headers['x-poll-invite'];
  const poll = pollAccess(db, id, user, inviteToken);

  if (request.method === 'GET' && !action) return { poll: serializePoll(db, poll, user.id) };

  if (request.method === 'POST' && action === 'vote') {
    castVote(db, poll, user, body);
    const updated = db.prepare(`
      SELECT polls.*, users.display_name AS organizer
      FROM polls JOIN users ON users.id = polls.owner_id
      WHERE polls.id = ?
    `).get(poll.id);
    return { poll: serializePoll(db, updated, user.id) };
  }

  if (request.method === 'POST' && action === 'close') {
    requireValue(poll.owner_id === user.id, 403, 'OWNER_REQUIRED', 'Завершить голосование может только организатор.');
    if (!poll.closed_at) db.prepare('UPDATE polls SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(new Date().toISOString(), poll.id);
    const updated = db.prepare(`
      SELECT polls.*, users.display_name AS organizer
      FROM polls JOIN users ON users.id = polls.owner_id
      WHERE polls.id = ?
    `).get(poll.id);
    return { poll: serializePoll(db, updated, user.id) };
  }

  if (request.method === 'POST' && action === 'invitation') {
    requireValue(poll.owner_id === user.id, 403, 'OWNER_REQUIRED', 'Создать ссылку-приглашение может только организатор.');
    requireValue(poll.visibility === 'private', 409, 'PUBLIC_POLL', 'Публичному голосованию не нужна ссылка-приглашение.');
    const inviteToken = randomBytes(32).toString('base64url');
    db.prepare('UPDATE polls SET invite_token_hash = ? WHERE id = ?')
      .run(createHash('sha256').update(inviteToken).digest('hex'), poll.id);
    return { inviteToken };
  }

  if (request.method === 'GET' && action === 'comments') {
    const rawLimit = url.searchParams.get('limit');
    const rawOffset = url.searchParams.get('offset');
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 50, 400, 'INVALID_PAGINATION', 'Размер страницы должен быть от 1 до 50.');
    requireValue(Number.isInteger(offset) && offset >= 0, 400, 'INVALID_PAGINATION', 'Некорректный номер страницы.');
    return pollComments(db, poll.id, limit, offset);
  }

  if (request.method === 'POST' && action === 'comments') {
    requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Проверьте текст сообщения.');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    requireValue(text.length >= 1 && text.length <= 2000, 400, 'INVALID_COMMENT', 'Комментарий должен содержать от 1 до 2000 символов.');
    const parentId = body.parentId ?? null;
    requireValue(parentId === null || (typeof parentId === 'string' && /^[0-9a-f-]{36}$/i.test(parentId)), 400, 'INVALID_PARENT', 'Некорректный ответ на комментарий.');
    if (parentId !== null) {
      const parent = db.prepare('SELECT id FROM poll_comments WHERE id = ? AND poll_id = ? AND parent_id IS NULL').get(parentId, poll.id);
      requireValue(parent, 400, 'INVALID_PARENT', 'Ответить можно только на комментарий из этого голосования.');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO poll_comments (id, poll_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, poll.id, user.id, parentId, text, createdAt);
    return {
      status: 201,
      body: {
        comment: {
          id,
          parentId,
          body: text,
          createdAt,
          userId: user.id,
          author: user.displayName,
          replies: []
        }
      }
    };
  }

  throw new AppError(404, 'NOT_FOUND', 'Страница не найдена.');
}
