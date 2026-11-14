import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { beginRoomRound, createRoomInvitation, decideRoomProposal, getRoom, joinRoom, proposeRoomOption, startNextRoomRound, startRoomRound, voteInRoomRound } from '../api/roomsApi.js';

const methodNames = { majority: 'Большинство', unanimity: 'Единогласие', no_objections: 'Без возражений' };

export function CreateDecisionRoomModal({ onClose, onCreate }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const deadlineValue = String(form.get('deadline') || '');
      await onCreate({ question: String(form.get('question')).trim(), method: String(form.get('method')), hide_results: form.get('hide_results') === 'on', deadline: deadlineValue ? new Date(deadlineValue).toISOString() : null });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="room-create-title">
    <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button><div className="section-kicker">НОВОЕ ОБЩЕЕ РЕШЕНИЕ</div><h2 id="room-create-title">Создать комнату</h2>
    <form className="auth-form" onSubmit={submit}><label htmlFor="room-question">Вопрос</label><input id="room-question" name="question" required maxLength="200" placeholder="Куда пойдём в пятницу?" />
      <label htmlFor="room-method">Метод решения</label><select id="room-method" name="method" defaultValue="majority"><option value="majority">Большинство</option><option value="unanimity">Единогласие</option><option value="no_objections">Без возражений</option></select>
      <label htmlFor="room-deadline">Срок голосования <span className="optional">сохраняется как настройка</span></label><input id="room-deadline" name="deadline" type="datetime-local" />
      <label className="room-checkbox"><input type="checkbox" name="hide_results" /> Скрывать содержание голосов до завершения</label>
      {error && <p className="form-error" role="alert">{error}</p>}<button className="button-dark auth-submit" disabled={busy}>{busy ? 'Создаём…' : 'Создать комнату'} <span>→</span></button>
    </form>
  </section></div>;
}

export function DecisionRoomsPage({ rooms, onCreate }) {
  return <section className="poll-list-page"><div className="eyebrow"><span className="eyebrow-dot" /> СОВМЕСТНЫЕ РЕШЕНИЯ</div><h1>Комнаты</h1><p className="welcome-copy">Соберите участников и варианты, затем проголосуйте по общим правилам.</p><button className="button-dark" onClick={onCreate}>＋ Создать комнату</button>
    {rooms.length ? <div className="poll-grid">{rooms.map(room => <Link className="poll-list-card" key={room.id} to={`/rooms/${room.id}`}><div className="section-kicker"><span className="live-dot" /> {room.status === 'gathering' ? 'СБОР' : room.status === 'preparation' ? '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430' : room.status === 'voting' ? 'ГОЛОСОВАНИЕ' : 'ИТОГ ГОТОВ'}</div><h2>{room.question}</h2><p>{methodNames[room.method]} · {room.members.length} участников</p><small>{room.rounds.length} раундов</small></Link>)}</div> : <div className="empty-card"><h2>Комнат пока нет</h2><p>Создайте комнату и пригласите участников по ссылке.</p></div>}</section>;
}

export function DecisionRoomPage({ user, onRefreshRooms, onToast }) {
  const { roomId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') || '';
  const [room, setRoom] = useState(null);
  const [optionText, setOptionText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [evaluations, setEvaluations] = useState({});

  const reload = useCallback(async () => {
    const response = await getRoom(roomId, inviteToken);
    let current = response.room;
    if (!current.is_member && inviteToken) {
      current = (await joinRoom(roomId, inviteToken)).room;
      setSearchParams({}, { replace: true });
    }
    setRoom(current);
    await onRefreshRooms();
  }, [roomId, inviteToken, onRefreshRooms, setSearchParams]);

  useEffect(() => { reload().catch(err => setError(err.message)); }, [reload]);
  useEffect(() => {
    if (!room) return undefined;
    const timer = window.setInterval(() => reload().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [room?.status, reload]);

  async function run(action, success) {
    setBusy(true); setError('');
    try { await action(); await reload(); if (success) onToast(success); return true; }
    catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }

  async function copyInvitation() {
    await run(async () => {
      const { invite_token: token } = await createRoomInvitation(roomId);
      await navigator.clipboard.writeText(`${window.location.origin}/rooms/${roomId}?invite=${encodeURIComponent(token)}`);
    }, 'Ссылка-приглашение скопирована.');
  }

  async function submitBallot(event) {
    event.preventDefault();
    const round = room.active_round;
    const ballot = round.method === 'no_objections'
      ? { evaluations: round.options.map(option => ({ option_id: option.id, objection: evaluations[option.id] === 'objection' })) }
      : { option_id: selected };
    await run(() => voteInRoomRound(room.id, round.id, ballot), 'Голос сохранён.');
  }

  if (!room) return <section className="detail-page"><p>{error || 'Загружаем комнату…'}</p></section>;
  const round = room.active_round;
  const lastRound = room.rounds.at(-1);
  const alreadyVoted = Boolean(round?.my_vote);
  const result = lastRound?.result;
  const resultNames = result?.winner_ids.map(id => lastRound.options.find(option => option.id === id)?.text).filter(Boolean) || [];

  return <section className="detail-page decision-room"><Link to="/rooms" className="all-ideas">← Все комнаты</Link><article className="active-vote">
    <div className="section-kicker"><span className="live-dot" /> {room.status === 'gathering' ? 'СБОР УЧАСТНИКОВ И ВАРИАНТОВ' : room.status === 'preparation' ? 'ПОДГОТОВКА' : room.status === 'voting' ? 'ГОЛОСОВАНИЕ' : `РЕЗУЛЬТАТ · РАУНД ${lastRound.number}`}</div>
    <h1>{room.question}</h1><p className="vote-subtitle">Организатор: {room.owner_name} · Метод: {methodNames[room.method]}{room.deadline && ` · Срок: ${new Date(room.deadline).toLocaleString('ru-RU')}`}</p>
    {room.status === 'gathering' && <>
      <div className="room-toolbar"><strong>Участники · {room.members.length}</strong>{room.is_owner && <button className="copy-link" onClick={copyInvitation} disabled={busy}>Пригласить по ссылке</button>}</div>
      <div className="room-members">{room.members.map(member => <span key={member.user_id}>{member.display_name}{member.is_owner ? ' · организатор' : ''}</span>)}</div>
      <form className="room-proposal-form" onSubmit={event => { event.preventDefault(); if (optionText.trim()) run(() => proposeRoomOption(room.id, optionText.trim()), 'Вариант предложен.').then(ok => { if (ok) setOptionText(''); }); }}>
        <label htmlFor="room-option">Предложить вариант</label><div><input id="room-option" value={optionText} onChange={event => setOptionText(event.target.value)} maxLength="160" placeholder="Например, пиццерия на набережной" /><button className="button-dark" disabled={busy || !optionText.trim()}>Предложить</button></div>
      </form>
      <div className="room-options">{room.proposals.map(proposal => <div className="room-proposal" key={proposal.id}><div><strong>{proposal.text}</strong><small>{proposal.author} · {proposal.status === 'pending' ? 'ожидает решения' : proposal.status === 'accepted' ? 'принят' : 'отклонён'}</small></div>{room.is_owner && proposal.status === 'pending' && <div className="proposal-actions"><button onClick={() => run(() => decideRoomProposal(room.id, proposal.id, 'accepted'))}>Принять</button><button onClick={() => run(() => decideRoomProposal(room.id, proposal.id, 'rejected'))}>Отклонить</button></div>}</div>)}</div>
      {room.is_owner && <button className="button-coral" disabled={busy || room.members.length < 2 || !room.proposals.some(proposal => proposal.status === 'accepted')} onClick={() => run(() => startRoomRound(room.id), 'Состав участников и вариантов зафиксирован.')}>Зафиксировать состав и начать голосование →</button>}
      {room.members.length < 2 && room.is_owner && <p className="privacy-note">Пригласите хотя бы одного участника. Запуск станет доступен после принятия варианта.</p>}
    </>}

    {lastRound?.status === 'preparation' && <section className="room-round"><div className="room-toolbar"><strong>Подготовка · раунд {lastRound.number}</strong><span>Состав и варианты зафиксированы</span></div><div className="room-members">{lastRound.participants.map(participant => <span key={participant.user_id}>{participant.display_name}{participant.is_owner ? ' · организатор' : ''}</span>)}</div><div className="room-options">{lastRound.options.map(option => <div className="room-proposal" key={option.id}><strong>{option.text}</strong></div>)}</div>{room.is_owner && <button className="button-coral" disabled={busy} onClick={() => run(() => beginRoomRound(room.id, lastRound.id), 'Голосование началось.')}>Начать голосование →</button>}</section>}

    {round && <section className="room-round"><div className="room-toolbar"><strong>Раунд {round.number} · Голоса {round.voted_count}/{round.participant_count}</strong><span>{round.hide_results ? 'Ответы скрыты до завершения' : 'Ответы видны участникам'}</span></div>
      <div className="room-members">{round.participants.map(participant => <span key={participant.user_id} className={participant.voted ? 'participant-voted' : ''}>{participant.display_name}{participant.is_owner ? ' · организатор' : ''} · {participant.voted ? 'проголосовал' : 'ожидает'}</span>)}</div>
      {round.status === 'voting' && !alreadyVoted && <form onSubmit={submitBallot} className="room-ballot">
        {round.method === 'no_objections' ? round.options.map(option => <fieldset key={option.id}><legend>{option.text}</legend><label><input type="radio" name={`evaluation-${option.id}`} checked={evaluations[option.id] === 'ok'} onChange={() => setEvaluations(current => ({ ...current, [option.id]: 'ok' }))} /> Подходит</label><label><input type="radio" name={`evaluation-${option.id}`} checked={evaluations[option.id] === 'objection'} onChange={() => setEvaluations(current => ({ ...current, [option.id]: 'objection' }))} /> Есть возражение</label></fieldset>) : round.options.map(option => <label className={`room-choice ${selected === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name="room-choice" checked={selected === option.id} onChange={() => setSelected(option.id)} />{option.text}</label>)}
        <button className="button-coral" disabled={busy || (round.method === 'no_objections' ? round.options.some(option => !evaluations[option.id]) : !selected)}>Отправить голос →</button>
      </form>}
      {round.status === 'voting' && alreadyVoted && <p className="vote-message">Ваш голос записан. Ждём остальных участников.</p>}
      {round.status === 'result' && result && <div className="room-result"><h2>{result.kind === 'winner' ? `Решение: ${resultNames[0]}` : result.kind === 'tie' ? `Ничья: ${resultNames.join(', ')}` : result.kind === 'acceptable' ? `Подходят: ${resultNames.join(', ')}` : 'Согласие не достигнуто'}</h2><p>{result.explanation} Проголосовали {result.voted_count} из {result.participant_count}.</p><ul>{result.options.map(option => <li key={option.id}><strong>{option.text}</strong> — {round.method === 'no_objections' ? `возражений: ${option.objections}` : `голосов: ${option.votes}`}</li>)}</ul></div>}
    </section>}

    {lastRound?.status === 'result' && result && <section className="room-result"><div className="section-kicker">ИТОГ РАУНДА {lastRound.number} · {methodNames[lastRound.method]}</div><h2>{result.kind === 'winner' ? `Решение: ${resultNames[0]}` : result.kind === 'tie' ? `Ничья: ${resultNames.join(', ')}` : result.kind === 'acceptable' ? `Подходят: ${resultNames.join(', ')}` : 'Согласие не достигнуто'}</h2><p>{result.explanation} Проголосовали {result.voted_count} из {result.participant_count}.</p><ul>{result.options.map(option => <li key={option.id}><strong>{option.text}</strong> — {lastRound.method === 'no_objections' ? `возражений: ${option.objections}` : `голосов: ${option.votes}`}</li>)}</ul></section>}
    {room.is_owner && lastRound?.status === 'result' && <button className="button-dark" disabled={busy} onClick={() => run(() => startNextRoomRound(room.id), 'Начат новый раунд. Предыдущий результат сохранён.')}>＋ Открыть новый раунд</button>}
    {room.rounds.length > 1 && <details className="room-history"><summary>История раундов · {room.rounds.length}</summary>{room.rounds.slice(0, -1).reverse().map(item => <article key={item.id}><strong>Раунд {item.number}</strong><span>{item.result?.explanation}</span><small>Голосов: {item.voted_count}/{item.participant_count}</small><ul>{item.result?.options.map(option => <li key={option.id}>{option.text} — {item.method === 'no_objections' ? `возражений: ${option.objections}` : `голосов: ${option.votes}`}</li>)}</ul></article>)}</details>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </article></section>;
}
