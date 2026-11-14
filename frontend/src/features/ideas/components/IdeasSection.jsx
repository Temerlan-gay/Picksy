import { ideaFilters, ideaKinds } from '../ideasData.js';

export function IdeasSection({ filter, onFilter, onChoose }) {
  const visibleIdeas = filter === 'all' ? ideaKinds : ideaKinds.filter(idea => idea.id === filter);
  return (
    <section className="ideas-section">
      <div className="ideas-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> ИДЕИ ДЛЯ ВАШЕГО ВЕЧЕРА</div>
          <h2>Есть настроение?</h2>
          <p>Не нужно придумывать с нуля — начните с идеи и решите вместе.</p>
        </div>
        <a href="/collections" className="all-ideas">Все идеи <span>↗</span></a>
      </div>
      <div className="filter-row" role="tablist" aria-label="Настроение">
        {ideaFilters.map(item => <button
          key={item.id}
          className={`filter ${filter === item.id ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={filter === item.id}
          onClick={() => onFilter(item.id)}
        ><span>{item.icon}</span> {item.label}</button>)}
      </div>
      <div className="card-grid">
        {visibleIdeas.map((idea, index) => <button
          type="button"
          className="place-card"
          key={`${idea.title}-${index}`}
          onClick={() => onChoose(idea)}
        >
          <span className={`place-image place-image-${idea.color}`}>
            <span className="place-badge">ИДЕЯ</span>
            <span className="place-save" aria-hidden="true">♡</span>
            <span className="place-emoji" aria-hidden="true">{idea.emoji}</span>
          </span>
          <span className="place-info">
            <span className="place-title-line"><strong className="place-title">{idea.title}</strong><span className="place-stars">✳</span></span>
            <span className="place-desc">{idea.caption}</span>
            <span className="place-meta">＋ Начать голосование <b>↗</b></span>
          </span>
        </button>)}
      </div>
    </section>
  );
}
