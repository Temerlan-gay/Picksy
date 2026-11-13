import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

let app;
let baseUrl;
let temporaryDirectory;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'picksy-test-'));
  app = createApp({ databasePath: join(temporaryDirectory, 'test.sqlite') });
  const address = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (cookie) requestHeaders.set('Cookie', cookie);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

async function register(username) {
  const { response, payload } = await request('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: username,
      username,
      email: `${username}@example.com`,
      password: 'a-secure-test-password'
    }
  });
  assert.equal(response.status, 201);
  return { user: payload.user, cookie: response.headers.get('set-cookie').split(';', 1)[0] };
}

async function createPoll(cookie, { type = 'single', visibility = 'private', options = ['Вариант A', 'Вариант B'] } = {}) {
  return request('/api/polls', {
    method: 'POST',
    cookie,
    body: { title: `Вопрос ${type}`, description: 'Проверка', type, visibility, options }
  });
}

test('registration validates input, rejects duplicate identities, and creates a login session', async () => {
  const invalid = await request('/api/auth/register', {
    method: 'POST',
    body: { displayName: 'Test', username: 't', email: 'bad', password: 'short' }
  });
  assert.equal(invalid.response.status, 400);

  const first = await register('alice');
  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: { displayName: 'Another', username: 'alice2', email: 'alice@example.com', password: 'a-secure-test-password' }
  });
  assert.equal(duplicate.response.status, 409);

  const unauthenticated = await request('/api/auth/me');
  assert.equal(unauthenticated.payload.user, null);
  const authenticated = await request('/api/auth/me', { cookie: first.cookie });
  assert.equal(authenticated.payload.user.id, first.user.id);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { login: 'ALICE', password: 'a-secure-test-password' }
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.user.id, first.user.id);
  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { login: 'alice', password: 'wrong-password-123' }
  });
  assert.equal(badLogin.response.status, 401);
});

test('private poll invites, duplicate vote protection, owner permissions, and close state work', async () => {
  const owner = await register('owner');
  const participant = await register('participant');
  const outsider = await register('outsider');
  const created = await createPoll(owner.cookie);
  assert.equal(created.response.status, 201);
  const poll = created.payload.poll;
  assert.ok(poll.inviteToken);
  assert.equal(poll.options.length, 2);

  const hidden = await request(`/api/polls/${poll.id}`, { cookie: outsider.cookie });
  assert.equal(hidden.response.status, 404);
  const invited = await request(`/api/polls/${poll.id}`, {
    cookie: participant.cookie,
    headers: { 'x-poll-invite': poll.inviteToken }
  });
  assert.equal(invited.response.status, 200);
  assert.equal(invited.payload.poll.voteCount, 0);
  assert.deepEqual(invited.payload.poll.leaders, []);

  const voted = await request(`/api/polls/${poll.id}/vote`, {
    method: 'POST',
    cookie: participant.cookie,
    headers: { 'x-poll-invite': poll.inviteToken },
    body: { optionIds: [poll.options[0].id] }
  });
  assert.equal(voted.response.status, 200);
  assert.equal(voted.payload.poll.voteCount, 1);
  assert.equal(voted.payload.poll.options[0].count, 1);
  assert.deepEqual(voted.payload.poll.leaders, [{ id: poll.options[0].id, text: 'Вариант A', count: 1, score: null }]);

  const duplicate = await request(`/api/polls/${poll.id}/vote`, {
    method: 'POST',
    cookie: participant.cookie,
    headers: { 'x-poll-invite': poll.inviteToken },
    body: { optionIds: [poll.options[1].id] }
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, 'ALREADY_VOTED');

  const forbiddenClose = await request(`/api/polls/${poll.id}/close`, {
    method: 'POST',
    cookie: participant.cookie,
    headers: { 'x-poll-invite': poll.inviteToken },
    body: {}
  });
  assert.equal(forbiddenClose.response.status, 403);

  const closed = await request(`/api/polls/${poll.id}/close`, {
    method: 'POST',
    cookie: owner.cookie,
    body: {}
  });
  assert.equal(closed.response.status, 200);
  assert.equal(closed.payload.poll.closed, true);
  const afterClose = await request(`/api/polls/${poll.id}/vote`, {
    method: 'POST',
    cookie: outsider.cookie,
    headers: { 'x-poll-invite': poll.inviteToken },
    body: { optionIds: [poll.options[1].id] }
  });
  assert.equal(afterClose.response.status, 409);
  assert.equal(afterClose.payload.error.code, 'POLL_CLOSED');
});

test('rating and multiple-choice results are calculated from persisted votes', async () => {
  const owner = await register('host');
  const first = await register('guestone');
  const second = await register('guesttwo');
  const ratingPoll = await createPoll(owner.cookie, { type: 'rating' });
  const rating = ratingPoll.payload.poll;

  for (const [cookie, score] of [[first.cookie, 8], [second.cookie, 6]]) {
    const result = await request(`/api/polls/${rating.id}/vote`, {
      method: 'POST',
      cookie,
      headers: { 'x-poll-invite': rating.inviteToken },
      body: { ratings: [{ optionId: rating.options[0].id, score }] }
    });
    assert.equal(result.response.status, 200);
  }
  const ratingResult = await request(`/api/polls/${rating.id}`, {
    cookie: owner.cookie
  });
  assert.equal(ratingResult.payload.poll.options[0].score, 7);
  assert.equal(ratingResult.payload.poll.options[0].count, 2);
  assert.equal(ratingResult.payload.poll.options[1].score, null);
  assert.deepEqual(ratingResult.payload.poll.leaders, [{ id: rating.options[0].id, text: 'Вариант A', count: 2, score: 7 }]);

  const multiplePoll = await createPoll(owner.cookie, { type: 'multiple' });
  const multiple = multiplePoll.payload.poll;
  const invalidChoice = await request(`/api/polls/${multiple.id}/vote`, {
    method: 'POST',
    cookie: first.cookie,
    headers: { 'x-poll-invite': multiple.inviteToken },
    body: { optionIds: [multiple.options[0].id, multiple.options[0].id] }
  });
  assert.equal(invalidChoice.response.status, 400);

  const multipleVote = await request(`/api/polls/${multiple.id}/vote`, {
    method: 'POST',
    cookie: first.cookie,
    headers: { 'x-poll-invite': multiple.inviteToken },
    body: { optionIds: multiple.options.map(option => option.id) }
  });
  assert.equal(multipleVote.response.status, 200);
  assert.deepEqual(multipleVote.payload.poll.options.map(option => option.count), [1, 1]);
  assert.equal(multipleVote.payload.poll.leaders.length, 2);
});

test('poll creation requires distinct non-empty options and authentication', async () => {
  const unauthorized = await request('/api/polls', {
    method: 'POST',
    body: { title: 'No user', type: 'single', visibility: 'public', options: ['A', 'B'] }
  });
  assert.equal(unauthorized.response.status, 401);

  const owner = await register('creator');
  const invalid = await createPoll(owner.cookie, { options: ['Same', ' same '] });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, 'DUPLICATE_OPTIONS');

  const publicPoll = await createPoll(owner.cookie, { visibility: 'public' });
  const listed = await request('/api/polls', { cookie: owner.cookie });
  assert.ok(listed.payload.polls.some(poll => poll.id === publicPoll.payload.poll.id));
});

test('concurrent attempts cannot create duplicate votes', async () => {
  const owner = await register('raceowner');
  const voter = await register('racevoter');
  const created = await createPoll(owner.cookie);
  const poll = created.payload.poll;
  const voteRequest = () => request(`/api/polls/${poll.id}/vote`, {
    method: 'POST',
    cookie: voter.cookie,
    headers: { 'x-poll-invite': poll.inviteToken },
    body: { optionIds: [poll.options[0].id] }
  });
  const results = await Promise.all([voteRequest(), voteRequest()]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.response.status === 200).payload.poll.voteCount, 1);
});

test('private invite rotation invalidates the previous link and the app serves its frontend', async () => {
  const owner = await register('linkowner');
  const guest = await register('linkguest');
  const created = await createPoll(owner.cookie);
  const poll = created.payload.poll;
  const rotated = await request(`/api/polls/${poll.id}/invitation`, {
    method: 'POST',
    cookie: owner.cookie,
    body: {}
  });
  assert.equal(rotated.response.status, 200);
  assert.notEqual(rotated.payload.inviteToken, poll.inviteToken);

  const oldLink = await request(`/api/polls/${poll.id}`, {
    cookie: guest.cookie,
    headers: { 'x-poll-invite': poll.inviteToken }
  });
  assert.equal(oldLink.response.status, 404);
  const newLink = await request(`/api/polls/${poll.id}`, {
    cookie: guest.cookie,
    headers: { 'x-poll-invite': rotated.payload.inviteToken }
  });
  assert.equal(newLink.response.status, 200);

  const homepage = await fetch(baseUrl);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /Picksy/);
  const backendSource = await fetch(`${baseUrl}/server/index.js`);
  assert.equal(backendSource.status, 404);
});

test('poll discussions validate comments, paginate roots, and allow one-level replies', async () => {
  const owner = await register('commentowner');
  const guest = await register('commentguest');
  const created = await createPoll(owner.cookie);
  const poll = created.payload.poll;
  const invitation = { 'x-poll-invite': poll.inviteToken };

  const empty = await request(`/api/polls/${poll.id}/comments`, {
    method: 'POST',
    cookie: guest.cookie,
    headers: invitation,
    body: { text: '   ' }
  });
  assert.equal(empty.response.status, 400);

  const root = await request(`/api/polls/${poll.id}/comments`, {
    method: 'POST',
    cookie: guest.cookie,
    headers: invitation,
    body: { text: '<script>not executable</script>' }
  });
  assert.equal(root.response.status, 201);
  assert.equal(root.payload.comment.body, '<script>not executable</script>');

  const reply = await request(`/api/polls/${poll.id}/comments`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { text: 'Ответ организатора', parentId: root.payload.comment.id }
  });
  assert.equal(reply.response.status, 201);

  const secondRoot = await request(`/api/polls/${poll.id}/comments`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { text: 'Ещё один вариант?' }
  });
  assert.equal(secondRoot.response.status, 201);

  const firstPage = await request(`/api/polls/${poll.id}/comments?limit=1`, {
    cookie: guest.cookie,
    headers: invitation
  });
  assert.equal(firstPage.response.status, 200);
  assert.equal(firstPage.payload.comments[0].id, secondRoot.payload.comment.id);
  assert.equal(firstPage.payload.hasMore, true);

  const nextPage = await request(`/api/polls/${poll.id}/comments?limit=1&offset=1`, {
    cookie: guest.cookie,
    headers: invitation
  });
  assert.equal(nextPage.payload.comments[0].id, root.payload.comment.id);
  assert.equal(nextPage.payload.comments[0].replies[0].body, 'Ответ организатора');

  const otherPoll = await createPoll(owner.cookie);
  const crossPollReply = await request(`/api/polls/${otherPoll.payload.poll.id}/comments`, {
    method: 'POST',
    cookie: guest.cookie,
    headers: { 'x-poll-invite': otherPoll.payload.poll.inviteToken },
    body: { text: 'Не тот опрос', parentId: root.payload.comment.id }
  });
  assert.equal(crossPollReply.response.status, 400);
});
