export const ideaFilters = [
  { id: 'all', label: 'Все идеи', icon: '✳' },
  { id: 'sit', label: 'Посидеть', icon: '☕' },
  { id: 'play', label: 'Поиграть', icon: '🎳' },
  { id: 'walk', label: 'Прогуляться', icon: '🌿' },
  { id: 'culture', label: 'Вдохновиться', icon: '🎨' },
  { id: 'food', label: 'Вкусно поесть', icon: '🍕' }
];

export const ideaKinds = [
  { id: 'sit', title: 'Кофейни', caption: 'Посидеть и поболтать', emoji: '☕', color: 'sand' },
  { id: 'food', title: 'Вкусные места', caption: 'Выбрать, где поужинать', emoji: '🍜', color: 'peach' },
  { id: 'walk', title: 'Прогулки', caption: 'Проветриться и пройтись', emoji: '🌳', color: 'sage' },
  { id: 'play', title: 'Игры и развлечения', caption: 'Поиграть всей компанией', emoji: '🎳', color: 'lilac' },
  { id: 'culture', title: 'Вдохновение', caption: 'Искусство и новые впечатления', emoji: '🖼️', color: 'rose' },
  { id: 'food', title: 'Пиццерии', caption: 'Найти что-то вкусное', emoji: '🍕', color: 'blue' },
  { id: 'walk', title: 'На свежем воздухе', caption: 'Найти маршрут для прогулки', emoji: '🌅', color: 'mint' },
  { id: 'play', title: 'Настольные игры', caption: 'Собраться за одной игрой', emoji: '🎲', color: 'cream' }
];

export function optionsForIdea(kindId) {
  const options = {
    sit: ['Кофейня', 'Кафе', 'Чайная'],
    food: ['Ресторан', 'Пиццерия', 'Рамен-бар'],
    walk: ['Парк', 'Набережная', 'Маршрут по центру'],
    play: ['Боулинг', 'Настольные игры', 'Квест'],
    culture: ['Галерея', 'Музей', 'Кино']
  };
  return options[kindId] || options.sit;
}
