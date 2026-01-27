# Доступность (A11Y) — web_rA

Описание реализованных мер доступности и способов тестирования.

---

## 1. Реализовано

### 1.1 Фокус и видимость фокуса (focus-visible)

- Глобальные стили `:focus-visible` для `button`, `a`, `input`, `select`, `textarea`, `[role="button"]`: обводка 2px цветом primary, offset 2px.
- Фокус при навигации с клавиатуры (Tab) отображается только при клавиатурном фокусе, не при клике мышью.

**Файлы:** `core_ui/static/css/style.css` (секция после `* { box-sizing }`).

### 1.2 Иконки-кнопки и aria-label

- **Sidebar:** кнопка «Collapse/Expand sidebar» — `aria-label` и `title` обновляются при переключении (Collapse/Expand).
- **Header:** кнопка мобильного меню — `aria-label="Open menu"` / «Close menu», `aria-expanded`, `aria-controls="sidebar"`.
- **Header:** ссылка Help — `aria-label="Help: articles and repeat tour"`.
- **Header:** Feedback — `aria-label="Feedback"`.
- **Header:** Status — `aria-label="System status"`.
- **Header:** бейдж модели — `aria-label="Текущая модель, перейти в настройки"`, `role="button"`, `tabindex="0"`.
- **UI Settings:** кнопка открытия панели — `aria-label="Open UI settings"`, `aria-expanded`, `aria-controls="ui-settings-panel"`.
- **UI Settings:** кнопка закрытия — `aria-label="Close UI settings panel"`.
- **Help panel:** кнопка закрытия — `aria-label="Закрыть справку"`.
- **Чат:** кнопка вложения — `aria-label="Attach file"`.
- **Чат:** кнопка отправки — `aria-label="Send message"`.
- **Модалки Agents:** кнопки закрытия с `aria-label="Close"` или «Close Task Builder».

Декоративные иконки помечены `aria-hidden="true"`.

### 1.3 Роль и ARIA для модалок и drawer

- **UI Settings panel:** `role="dialog"`, `aria-label="UI Settings"`, `aria-modal="true"`, `aria-hidden` переключается при открытии/закрытии.
- **Help panel (drawer):** `role="dialog"`, `aria-modal="true"`, `aria-label="Справка: статьи и повтор тура"`, `aria-hidden` переключается при открытии.
- **Модалки Agent Hub:** у каждой обёртки: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="<id заголовка>"`, `aria-hidden`. При open/close в JS выставляется `aria-hidden="false"` / `"true"`.
  - Workflow Logs, Agent Logs, Workflow Script, Import, Profile, Assist, Workflow (AI), Task Builder.
- **Модалка Knowledge Base (Add document):** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="kb-modal-title"`, `aria-hidden`; переключение в `rag_ui.js`.
- **Shortcuts Help (чат):** уже имеет `role="dialog"`, `aria-label="Справка по горячим клавишам"`.

Ловушек фокуса нет: фокус не ограничивается внутри модалки, таб-навигация идёт по странице как обычно.

### 1.4 Skip to main content

- В начале `<body>` добавлена ссылка `<a href="#main-content" class="skip-to-content">Skip to main content</a>`.
- Стили «skip-to-content»: визуально скрыта (`left: -9999px`), при `:focus` показывается у левого края экрана (кнопка primary с белой обводкой).
- У основного контента задан `id="main-content"` и `tabindex="-1"` для программного перехода по якорю.

**Файлы:** `core_ui/templates/base.html`, `core_ui/static/css/style.css`.

### 1.5 Контраст ключевых элементов

- **Primary (#6366f1):** используется для кнопок и акцентов; на белом фоне даёт контраст ~4.5:1 (WCAG AA для текста).
- **Кнопки .btn-primary:** белый текст на градиенте primary — контраст соблюдён.
- **Бейджи (.status-badge, .task-priority-badge, .tool-badge):** текст на затемнённом фоне (например, `#4ade80`, `#f87171` на rgba-фоне) подобран с учётом читаемости.
- В `style.css` для primary и бейджей добавлены комментарии о расчёте контраста.

### 1.6 Таб-навигация: sidebar → header → content

- Порядок фокуса совпадает с порядком в DOM: **skip-link → sidebar → overlay (не в фокус-порядке) → main (header, затем контент)**.
- Ловушек фокуса нет: в модалках и drawer не используется «focus trap», Tab/Shift+Tab ведут по всем фокусируемым элементам страницы.
- Sidebar при мобильном меню открыт/скрыт через классы, overlay — только визуальный фон, в таб-цепочку не входит.

---

## 2. Как тестировать

### 2.1 Клавиатурная навигация

1. **Tab / Shift+Tab**  
   - Убедиться, что порядок фокуса: сначала «Skip to main content», затем пункты сайдбара, затем элементы шапки, затем контент.  
   - Ни одна модалка не «запирает» фокус внутри себя.

2. **Skip to main content**  
   - Сфокусировать страницу (например, Tab с самого начала).  
   - Первый фокус — на ссылке «Skip to main content»; она визуально появляется.  
   - Enter — переход к `#main-content` и фокус на main.

3. **Sidebar / Header**  
   - Закрытие/открытие сайдбара, мобильного меню, UI Settings, Help — с клавиатуры (Tab до кнопки, Enter/Space).  
   - У кнопок сайдбара и хедера есть видимый focus-visible (обводка primary).

### 2.2 Экранные читалки (NVDA / JAWS / VoiceOver)

- **Модалки:** при открытии диалога объявляется роль (dialog) и название (через aria-labelledby или aria-label).
- **Иконки-кнопки:** объявляется aria-label (например, «Attach file», «Send message», «Close»), а не «button» без контекста.
- **Help / UI Settings:** при открытии панели доступны заголовок и кнопка закрытия с понятным именем.

### 2.3 Контраст (инструменты)

- **DevTools / расширения:** например, «axe DevTools», «WAVE» или «Lighthouse» (Accessibility).  
- Проверить контраст текста и кнопок primary, бейджей статуса и приоритета на типичных фонах (dark/light тема).  
- Ориентир: не ниже 4.5:1 для обычного текста, 3:1 для крупного текста и UI-компонентов (WCAG AA).

### 2.4 Уменьшение движения (prefers-reduced-motion)

- В `style.css` задано правило для `prefers-reduced-motion: reduce`: анимации и переходы сводятся к минимуму.  
- Проверка: в системе включить «Reduce motion» и убедиться, что интерфейс не полагается на анимации для понимания действий.

### 2.5 Ручная проверка переключателей ARIA

- **UI Settings:** при открытии/закрытии панели у кнопки «Настройки» меняются `aria-expanded` и у панели — `aria-hidden`.  
- **Модалки Agent Hub и Knowledge Base:** при open/close у контейнера модалки переключается `aria-hidden`.  
- **Help panel:** при открытии/закрытии переключается `aria-hidden` у панели.

---

## 3. Файлы, затронутые A11Y

| Область              | Файлы |
|----------------------|--------|
| Базовая разметка     | `core_ui/templates/base.html` |
| Стили фокуса и skip  | `core_ui/static/css/style.css` |
| Сайдбар и UI Settings| `core_ui/static/js/app_shell.js` |
| Чат                  | `core_ui/templates/chat.html` |
| Модалки Agents       | `agent_hub/templates/agent_hub/agents.html`, `core_ui/static/js/agent_hub.js` |
| Knowledge Base       | `core_ui/templates/knowledge_base.html`, `core_ui/static/js/rag_ui.js` |

---

*Документ обновлён при внедрении требований по доступности (skip-to-content, focus-visible, aria-label, role/aria для модалок и drawer, контраст, таб-порядок без ловушек фокуса).*
