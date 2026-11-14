import { useEffect, useRef, useState } from 'react';
import { getPollDiscussion, sendPollMessage } from '../api/pollsApi.js';

function formatMessageTime(value) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function PollDiscussion({ poll, user }) {
  const [discussion, setDiscussion] = useState(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEnd = useRef(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await getPollDiscussion(poll.id);
        if (active) {
          setDiscussion(result);
          setError('');
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [poll.id]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [discussion?.messages.length]);

  async function submit(event) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;
    setSending(true);
    setError('');
    try {
      await sendPollMessage(poll.id, message);
      setBody('');
      setDiscussion(await getPollDiscussion(poll.id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  }

  const isLeader = discussion?.is_leader ?? poll.owner_id === user.id;
  const outOfQuestions = !isLeader && discussion?.questions_remaining === 0;

  return (
    <section className="poll-discussion" aria-labelledby={`discussion-title-${poll.id}`}>
      <div className="discussion-heading">
        <div>
          <div className="section-kicker"><span className="live-dot" /> ОБСУЖДЕНИЕ ВЫБОРА</div>
          <h3 id={`discussion-title-${poll.id}`}>Чат голосования</h3>
        </div>
        <span className="discussion-count">{discussion?.messages.length || 0}</span>
      </div>

      <div className="discussion-messages" role="log" aria-live="polite" aria-label="Сообщения участников">
        {loading && <p className="discussion-empty">Загружаем обсуждение…</p>}
        {!loading && discussion?.messages.length === 0 && <p className="discussion-empty">Задайте вопрос о вариантах, чтобы договориться о плане.</p>}
        {discussion?.messages.map(message => {
          const mine = message.user_id === user.id;
          return <article className={`discussion-message ${mine ? 'mine' : ''} ${message.is_leader ? 'leader-message' : ''}`} key={message.id}>
            <div className="discussion-message-meta">
              <strong>{mine ? 'Вы' : message.display_name}</strong>
              {message.is_leader && <span className="leader-badge">Лидер</span>}
              <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
            </div>
            <p>{message.body}</p>
          </article>;
        })}
        <div ref={messagesEnd} />
      </div>

      <form className="discussion-form" onSubmit={submit}>
        <label className="sr-only" htmlFor={`discussion-input-${poll.id}`}>Ваш вопрос участникам</label>
        <textarea
          id={`discussion-input-${poll.id}`}
          value={body}
          onChange={event => setBody(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder={isLeader ? 'Напишите команде…' : 'Задайте вопрос о вариантах…'}
          disabled={poll.closed || outOfQuestions || sending}
        />
        <div className="discussion-form-footer">
          <span className="discussion-limit">
            {poll.closed
              ? 'Голосование закрыто'
              : isLeader
                ? 'Лидер: без лимита · пауза 3 сек. · до 10 сообщений в минуту'
                : `Осталось вопросов: ${discussion?.questions_remaining ?? '…'} из ${discussion?.question_limit ?? 2}`}
          </span>
          <button className="button-dark discussion-send" type="submit" disabled={poll.closed || outOfQuestions || sending || !body.trim()}>
            {sending ? 'Отправляем…' : 'Отправить'} <span>→</span>
          </button>
        </div>
      </form>
      {outOfQuestions && <p className="discussion-limit-reached">Вы задали два вопроса. Дождитесь ответа лидера голосования.</p>}
      {error && <p className="discussion-error" role="alert">{error}</p>}
    </section>
  );
}
