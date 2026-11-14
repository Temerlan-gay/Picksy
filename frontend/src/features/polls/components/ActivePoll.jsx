import { useEffect, useMemo, useState } from 'react';

const optionEmojis = ['🍜', '🎳', '☕', '🌿', '🎲', '🎨', '🍕', '🌅', '⛸️', '🎭'];

function getTimeLeft(deadline) {
  if (!deadline) return 'без срока';
  const remaining = Math.max(0, Date.parse(deadline) - Date.now());
  const hours = String(Math.floor(remaining / 3_600_000)).padStart(2, '0');
  const minutes = String(Math.floor(remaining / 60_000) % 60).padStart(2, '0');
  const seconds = String(Math.floor(remaining / 1000) % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function ActivePoll({ poll, onVote, onCopyLink, onClose, canClose = false }) {
  const existingRatings = useMemo(() => new Map((poll.my_vote?.ratings || []).map(item => [item.option_id, item.score])), [poll]);
  const [ratings, setRatings] = useState(() => Object.fromEntries(existingRatings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState(() => poll.my_vote?.option_ids || []);
  useEffect(() => {
    setRatings(Object.fromEntries((poll.my_vote?.ratings || []).map(item => [item.option_id, item.score])));
    setChoices(poll.my_vote?.option_ids || []);
  }, [poll.id, poll.my_vote]);
  const voted = Boolean(poll.my_vote);
  const closed = poll.closed;
  const totalVotes = poll.vote_count || 0;
  const bestScore = poll.type === 'rating' ? Math.max(0, ...poll.options.map(option => option.score || 0)) : Math.max(0, ...poll.options.map(option => option.count));
  const leaders = totalVotes ? poll.options.filter(option => (poll.type === 'rating' ? option.score : option.count) === bestScore) : [];

  function choose(optionId, score) {
    setRatings(current => ({ ...current, [optionId]: score }));
  }

  async function submit() {
    if (poll.type !== 'rating') {
      if (!choices.length) {
        setError('Выберите хотя бы один вариант.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        await onVote(poll.id, choices);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    const voteRatings = Object.entries(ratings).map(([optionId, score]) => ({ option_id: optionId, score }));
    if (!voteRatings.length) {
      setError('Поставьте оценку хотя бы одному варианту.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onVote(poll.id, voteRatings);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="active-vote" aria-labelledby="active-poll-title">
      <div className="vote-heading">
        <div>
          <div className="section-kicker"><span className="live-dot" /> ВАШ АКТИВНЫЙ ВЫБОР</div>
          <h2 id="active-poll-title">{poll.title}</h2>
          <p className="vote-subtitle">
            {poll.organizer} собирает компанию
            {poll.deadline && <> · голосование закроется {new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(poll.deadline))}</>}
          </p>
        </div>
        <a className="vote-open" href={`/polls/${poll.id}`} aria-label="Открыть голосование">↗</a>
      </div>

      <div className="vote-meta">
        <span className="participants">
          <span className="avatar-stack small" aria-hidden="true">
            <span /><span /><span />
          </span>
          <strong>{poll.vote_count}</strong> {poll.vote_count === 1 ? 'уже выбрал' : 'уже выбрали'}
        </span>
        <span className="timer"><span>◷</span> ещё {getTimeLeft(poll.deadline)}</span>
        <button className="copy-link" onClick={() => onCopyLink(poll.id)}>Скопировать ссылку</button>
      </div>

      {closed && <div className="vote-message result-summary" role="status">
        <strong>{totalVotes === 0 ? 'Голосов пока нет' : leaders.length > 1 ? 'Ничья между вариантами' : `Уже выбрали: ${leaders[0]?.text}`}</strong>
        <span>{totalVotes === 0 ? 'Никто не успел проголосовать, поэтому победитель не назначен.' : leaders.length > 1 ? `Лидируют: ${leaders.map(option => option.text).join(' · ')}` : poll.type === 'rating' ? `Средняя оценка — ${bestScore.toFixed(1)} из 10` : `${bestScore} ${bestScore === 1 ? 'голос' : 'голоса'}`}</span>
      </div>}

      <div className="option-list">
        {poll.options.map((option, index) => (
          <article className={`option-card ${(poll.type === 'rating' ? ratings[option.id] : choices.includes(option.id)) ? 'selected' : ''}`} key={option.id}>
            <div className="option-top">
              <span className="option-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="option-label">
                <strong className="option-name">{option.text}</strong>
                <span className="option-location">{poll.type === 'rating' ? 'Оцените от 1 до 10' : 'Вариант голосования'}</span>
              </div>
              <span className="option-emoji" aria-hidden="true">{optionEmojis[index % optionEmojis.length]}</span>
            </div>
            {poll.type === 'rating' ? (
              <>
                <div className="rating-scale" role="group" aria-label={`Оценка варианта ${option.text}`}>
                  {Array.from({ length: 10 }, (_, scoreIndex) => {
                    const score = scoreIndex + 1;
                    return <button
                      type="button"
                      key={score}
                      className={`score ${ratings[option.id] === score ? 'chosen' : ''}`}
                      onClick={() => choose(option.id, score)}
                      disabled={closed || busy || (voted && !poll.vote_change_allowed)}
                      aria-pressed={ratings[option.id] === score}
                      aria-label={`${score} из 10`}
                    >{score}</button>;
                  })}
                </div>
                <div className="rating-result-summary">
                  <span>{option.count} {option.count === 1 ? 'оценка' : 'оценок'}</span>
                  <strong>{option.score === null ? '—' : `${option.score.toFixed(1)} / 10`}</strong>
                </div>
              </>
            ) : <div className="option-result"><label><input type={poll.type === 'single' ? 'radio' : 'checkbox'} name={`vote-${poll.id}`} checked={choices.includes(option.id)} disabled={closed || busy || (voted && !poll.vote_change_allowed)} onChange={event => setChoices(current => poll.type === 'single' ? [option.id] : event.target.checked ? [...current, option.id] : current.filter(id => id !== option.id))} /> Выбрать · {option.count} голосов</label></div>}
          </article>
        ))}
      </div>

      {error && <p className="vote-message" role="alert">{error}</p>}
      <div className="vote-footer">
        <span className="privacy-note">{closed ? 'Голосование завершено' : 'Голос можно изменить до конца опроса'}</span>
        {!closed && canClose && <button className="copy-link" onClick={() => onClose(poll.id)}>Завершить</button>}
        {!closed && <button className="button-coral" onClick={submit} disabled={busy || (voted && !poll.vote_change_allowed)}>
          {busy ? 'Сохраняем…' : poll.type === 'rating' ? `${voted ? 'Изменить' : 'Отдать'} оценки · ${Object.keys(ratings).length}` : `${voted ? 'Изменить' : 'Отдать'} голос`} <span>→</span>
        </button>}
      </div>
    </section>
  );
}
