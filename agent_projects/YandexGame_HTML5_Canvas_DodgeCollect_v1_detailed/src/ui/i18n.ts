const ru = {
  title: 'Уклоняйся и собирай',
  play: 'Играть',
  sound_on: 'Звук вкл',
  sound_off: 'Звук выкл',
  score: 'Очки',
  best: 'Рекорд',
  lives: 'Жизни',
  pause: 'Пауза',
  resume: 'Продолжить',
  restart: 'Заново',
  exit: 'Выход',
  continue: 'Продолжить',
  watch_ad: 'Смотреть рекламу',
  no_thanks: 'Нет, спасибо',
  loading: 'Загрузка…',
  drag_to_move: 'Перетащите для движения',
} as const;

const en = {
  title: 'Dodge & Collect',
  play: 'Play',
  sound_on: 'Sound on',
  sound_off: 'Sound off',
  score: 'Score',
  best: 'Best',
  lives: 'Lives',
  pause: 'Pause',
  resume: 'Resume',
  restart: 'Restart',
  exit: 'Exit',
  continue: 'Continue',
  watch_ad: 'Watch ad',
  no_thanks: 'No thanks',
  loading: 'Loading…',
  drag_to_move: 'Drag to move',
} as const;

type Key = keyof typeof ru;
type Dict = Readonly<Record<Key, string>>;

const dicts: Record<'ru' | 'en', Dict> = { ru, en };

const locale = (): 'ru' | 'en' =>
  typeof navigator !== 'undefined' && navigator.language?.startsWith('ru')
    ? 'ru'
    : 'en';

export function t(key: Key): string {
  return dicts[locale()][key];
}
