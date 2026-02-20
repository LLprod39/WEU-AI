export type I18nKey =
  | 'title'
  | 'play'
  | 'continue'
  | 'best'
  | 'score'
  | 'undo'
  | 'clear_row'
  | 'clear_row_rect'
  | 'clear_row_rewarded'
  | 'watch_ad'
  | 'watch_ad_to_undo'
  | 'no_thanks'
  | 'game_over'
  | 'loading'
  | 'sound_on'
  | 'sound_off'
  | 'pause'
  | 'resume'
  | 'restart'
  | 'exit'
  | 'next_tile';

export type Locale = 'ru' | 'en';

const ru: Record<I18nKey, string> = {
  title: '2048 Drop',
  play: 'Играть',
  continue: 'Продолжить',
  best: 'Рекорд',
  score: 'Очки',
  undo: 'Отмена',
  clear_row: 'Очистить ряд',
  clear_row_rect: 'Очистить ряд (Rect)',
  clear_row_rewarded: 'Очистить ряд (награда)',
  watch_ad: 'Смотреть рекламу',
  watch_ad_to_undo: 'Смотреть рекламу для отмены',
  no_thanks: 'Нет, спасибо',
  game_over: 'Игра окончена',
  loading: 'Загрузка…',
  sound_on: 'Звук вкл',
  sound_off: 'Звук выкл',
  pause: 'Пауза',
  resume: 'Продолжить',
  restart: 'Заново',
  exit: 'Выход',
  next_tile: 'Следующая',
};

const en: Record<I18nKey, string> = {
  title: '2048 Drop',
  play: 'Play',
  continue: 'Continue',
  best: 'Best',
  score: 'Score',
  undo: 'Undo',
  clear_row: 'Clear row',
  clear_row_rect: 'Clear Row (Rect)',
  clear_row_rewarded: 'Clear row (rewarded)',
  watch_ad: 'Watch ad',
  watch_ad_to_undo: 'Watch ad to undo',
  no_thanks: 'No thanks',
  game_over: 'Game over',
  loading: 'Loading…',
  sound_on: 'Sound on',
  sound_off: 'Sound off',
  pause: 'Pause',
  resume: 'Resume',
  restart: 'Restart',
  exit: 'Exit',
  next_tile: 'Next',
};

const dict: Record<Locale, Record<I18nKey, string>> = { ru, en };

let currentLocale: Locale = 'ru';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: I18nKey): string {
  return dict[currentLocale][key] ?? dict.en[key] ?? key;
}
