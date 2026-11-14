import { useState } from 'react';

const defaultPlaces = [
  { text: 'Рамен-бар «Тёплый»', subtitle: 'Вокзальная · ₽₽' },
  { text: 'Боулинг «Страйк»', subtitle: 'Север · ₽₽₽' },
  { text: 'Кофейня «Сова»', subtitle: 'Центр · ₽₽' },
];

function localDateTimeMinimum() {
  const now = new Date(Date.now() + 60_000);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function CreatePollModal({ onClose, onCreate, initialOptions = [] }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [optionCount, setOptionCount] = useState(Math.max(2, Math.min(10, initialOptions.length || defaultPlaces.length)));

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const optionTexts = [...data.getAll('option')];
    const optionSubtitles = [...data.getAll('option-subtitle')];
    const options = optionTexts
      .map((text, index) => ({ text: text.trim(), subtitle: optionSubtitles[index]?.trim() || '' }))
      .filter(option => option.text);
    if (options.length < 2) {
      setError('Добавьте как минимум два непустых варианта.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onCreate({
        title: String(data.get('title')).trim(),
        description: String(data.get('description')).trim(),
        type: data.get('type'),
        visibility: 'public',
        options,
        deadline: data.get('deadline') ? new Date(String(data.get('deadline'))).toISOString() : null
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const options = initialOptions.length >= 2 ? initialOptions : defaultPlaces;
  return (
    <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="section-kicker">НОВОЕ РЕШЕНИЕ</div>
        <h2 id="modal-title">Куда пойдём?</h2>
          <p className="modal-intro">Выберите формат и добавьте три места, где недавно были. Примеры можно заменить на свои.</p>
        <form onSubmit={submit}>
          <label htmlFor="poll-title">Вопрос</label>
          <input id="poll-title" name="title" required maxLength="100" placeholder="Например, куда пойдём в пятницу?" />
          <label htmlFor="poll-description">Описание <span className="optional">необязательно</span></label>
          <textarea id="poll-description" name="description" maxLength="1000" placeholder="Добавьте детали встречи" />
          <label htmlFor="poll-type">Формат голосования</label>
          <select id="poll-type" name="type" defaultValue="rating">
            <option value="single">Выбрать один вариант</option>
            <option value="multiple">Выбрать несколько вариантов</option>
            <option value="rating">Оценить каждый вариант от 1 до 10</option>
          </select>
          <fieldset>
            <legend>Места <span className="optional">от 2 до 10</span></legend>
            {Array.from({ length: optionCount }, (_, index) => <div className="place-option-fields" key={index}>
              <input name="option" defaultValue={typeof options[index] === 'string' ? options[index] : options[index]?.text || ''} required maxLength="100" placeholder={`Место ${index + 1}`} />
              <input name="option-subtitle" defaultValue={typeof options[index] === 'string' ? '' : options[index]?.subtitle || ''} maxLength="160" placeholder="Район · средний чек (необязательно)" />
            </div>)}
            {optionCount < 10 && <button className="add-option" type="button" onClick={() => setOptionCount(count => count + 1)}>＋ Добавить вариант</button>}
          </fieldset>
          <label htmlFor="poll-deadline">Срок завершения <span className="optional">необязательно</span></label>
          <input id="poll-deadline" name="deadline" type="datetime-local" min={localDateTimeMinimum()} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button-dark auth-submit" disabled={busy}>{busy ? 'Создаём…' : 'Создать голосование'} <span>→</span></button>
        </form>
      </section>
    </div>
  );
}
