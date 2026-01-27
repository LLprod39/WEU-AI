/**
 * Guided onboarding tour: overlay, highlight, steps.
 * Progress stored in localStorage (onboarding_tour_completed, onboarding_tour_step).
 * No heavy dependencies.
 */
(function () {
    'use strict';

    var STORAGE_KEY_DONE = 'onboarding_tour_completed';
    var STORAGE_KEY_STEP = 'onboarding_tour_step';

    var steps = [
        {
            id: 'sidebar',
            selector: '#sidebar',
            title: 'Боковая панель',
            body: 'Здесь навигация: Chat, Orchestrator, Agents, Tasks, Knowledge Base, Servers, Passwords и Settings. Сворачивание — по кнопке со стрелкой.'
        },
        {
            id: 'chat-input',
            selector: '#tour-chat-input-area',
            title: 'Чат: ввод и модель',
            body: 'Поле ввода сообщений, выбор провайдера (Gemini/Grok) и модели. Включение RAG подключает базу знаний к ответам. Ctrl+Enter — отправить.'
        },
        {
            id: 'rag',
            selector: 'a[href*="knowledge"]',
            title: 'RAG — база знаний',
            body: 'Knowledge Base хранит документы для контекста ответов. Загружайте файлы или вставляйте текст — при включённом RAG в чате ответы опираются на эту базу.'
        },
        {
            id: 'workflow',
            selector: 'a[href*="orchestrator"], a[href*="agents"]',
            title: 'Agents и Workflow',
            body: 'Orchestrator — инструменты и цепочка ReAct (анализ → действие → ответ). Agents — готовые агенты и запуск воркфлоу.'
        },
        {
            id: 'tasks-discuss',
            selector: 'a[href*="tasks"]',
            title: 'Задачи и «Обсудить»',
            body: 'В списке задач у каждой карточки есть кнопка «Обсудить» (иконка чата) — она открывает чат с контекстом этой задачи, чтобы обсудить или спланировать выполнение.'
        },
        {
            id: 'settings-keys',
            selector: 'a[href*="settings"]',
            title: 'Настройки и API-ключи',
            body: 'В Settings настраиваются провайдер по умолчанию, модели для чата и RAG. API-ключи задаются в .env в корне проекта — не храните их в браузере.'
        }
    ];

    var overlay = null;
    var spotlight = null;
    var tooltipEl = null;
    var currentIndex = 0;

    function getStoredStep() {
        try {
            var s = localStorage.getItem(STORAGE_KEY_STEP);
            return s !== null ? parseInt(s, 10) : 0;
        } catch (e) {
            return 0;
        }
    }

    function setStoredStep(index) {
        try {
            localStorage.setItem(STORAGE_KEY_STEP, String(index));
        } catch (e) {}
    }

    function isCompleted() {
        try {
            return localStorage.getItem(STORAGE_KEY_DONE) === '1';
        } catch (e) {
            return false;
        }
    }

    function setCompleted() {
        try {
            localStorage.setItem(STORAGE_KEY_DONE, '1');
            setStoredStep(steps.length);
        } catch (e) {}
    }

    function createEl(tag, className, html) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (html) el.innerHTML = html;
        return el;
    }

    function ensureOverlay() {
        if (overlay) return;
        overlay = createEl('div', 'onboarding-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);

        spotlight = createEl('div', 'onboarding-spotlight', '');
        overlay.appendChild(spotlight);

        var wrap = createEl('div', 'onboarding-tooltip-wrap', '');
        tooltipEl = createEl('div', 'onboarding-tooltip', '');
        wrap.appendChild(tooltipEl);

        tooltipEl.innerHTML =
            '<div class="onboarding-tooltip-title"></div>' +
            '<div class="onboarding-tooltip-body"></div>' +
            '<div class="onboarding-tooltip-nav">' +
            '<button type="button" class="onboarding-btn onboarding-btn-ghost" data-action="prev" aria-label="Назад"><span class="material-icons-round">chevron_left</span></button>' +
            '<span class="onboarding-progress"></span>' +
            '<button type="button" class="onboarding-btn onboarding-btn-ghost" data-action="next" aria-label="Далее"><span class="material-icons-round">chevron_right</span></button>' +
            '<button type="button" class="onboarding-btn onboarding-btn-ghost onboarding-skip" aria-label="Пропустить тур">Пропустить</button>' +
            '</div>';

        var nav = tooltipEl.querySelector('.onboarding-tooltip-nav');

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) stop();
        });
        nav.addEventListener('click', function (e) {
            var act = e.target.closest('[data-action]');
            if (act && act.dataset.action === 'prev') prev();
            else if (act && act.dataset.action === 'next') next();
            else if (e.target.closest && e.target.closest('.onboarding-skip')) stop();
        });
        document.addEventListener('keydown', function (e) {
            if (!overlay || !overlay.classList.contains('onboarding-visible')) return;
            if (e.key === 'Escape') stop();
            if (e.key === 'ArrowRight') next();
            if (e.key === 'ArrowLeft') prev();
        });
        overlay.appendChild(wrap);
    }

    function positionSpotlight(rect) {
        if (!spotlight) return;
        if (!rect || rect.width === 0) {
            spotlight.style.display = 'none';
            return;
        }
        spotlight.style.display = 'block';
        spotlight.style.left = rect.left + 'px';
        spotlight.style.top = rect.top + 'px';
        spotlight.style.width = rect.width + 'px';
        spotlight.style.height = rect.height + 'px';
    }

    function positionTooltip(rect, tooltipRect) {
        if (!tooltipEl || !tooltipEl.parentElement) return;
        var wrap = tooltipEl.parentElement;
        var padding = 16;
        var docW = document.documentElement.clientWidth;
        var docH = document.documentElement.clientHeight;
        var tw = 320;
        var th = wrap.offsetHeight || 180;
        var x = padding;
        var y = docH - th - padding;
        if (rect && rect.width > 0) {
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height;
            x = Math.max(padding, Math.min(cx - tw / 2, docW - tw - padding));
            if (cy + th + padding <= docH) {
                y = cy + 12;
            } else if (rect.top - th - 12 >= 0) {
                y = rect.top - th - 12;
            }
        }
        wrap.style.left = x + 'px';
        wrap.style.top = y + 'px';
        wrap.style.width = tw + 'px';
    }

    function getRect(selector) {
        if (!selector) return null;
        var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function resolveSelector(step) {
        var sel = step.selector;
        if (typeof sel !== 'string') return null;
        if (sel.indexOf(',') !== -1) {
            var parts = sel.split(',').map(function (s) {
                return s.trim();
            });
            for (var i = 0; i < parts.length; i++) {
                var el = document.querySelector(parts[i]);
                if (el) return parts[i];
            }
            return null;
        }
        return document.querySelector(sel) ? sel : null;
    }

    function showStep(index) {
        if (index < 0 || index >= steps.length) {
            stop();
            return;
        }
        currentIndex = index;
        setStoredStep(index);
        var step = steps[index];
        var resolved = resolveSelector(step);
        var rect = resolved ? getRect(resolved) : null;

        ensureOverlay();
        overlay.classList.add('onboarding-visible');
        overlay.setAttribute('aria-hidden', 'false');

        positionSpotlight(rect);
        tooltipEl.querySelector('.onboarding-tooltip-title').textContent = step.title;
        tooltipEl.querySelector('.onboarding-tooltip-body').textContent = step.body;
        tooltipEl.querySelector('.onboarding-progress').textContent =
            (index + 1) + ' / ' + steps.length;

        var prevBtn = tooltipEl.querySelector('[data-action="prev"]');
        var nextBtn = tooltipEl.querySelector('[data-action="next"]');
        if (prevBtn) {
            prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
        }
        if (nextBtn) {
            nextBtn.textContent = '';
            var span = document.createElement('span');
            span.className = 'material-icons-round';
            span.textContent = index === steps.length - 1 ? 'check' : 'chevron_right';
            nextBtn.appendChild(span);
            if (index === steps.length - 1) {
                nextBtn.setAttribute('aria-label', 'Завершить');
            } else {
                nextBtn.setAttribute('aria-label', 'Далее');
            }
        }
        positionTooltip(rect);
    }

    function next() {
        if (currentIndex >= steps.length - 1) {
            setCompleted();
            stop();
            return;
        }
        showStep(currentIndex + 1);
    }

    function prev() {
        if (currentIndex > 0) showStep(currentIndex - 1);
    }

    function stop() {
        if (overlay) {
            overlay.classList.remove('onboarding-visible');
            overlay.setAttribute('aria-hidden', 'true');
        }
        currentIndex = 0;
        // Пометить тур как пройденный при любом закрытии (Пропустить, Escape, клик вне),
        // чтобы не показывать его снова при следующей загрузке страницы.
        setCompleted();
    }

    function start(fromStart) {
        currentIndex = fromStart ? 0 : Math.min(getStoredStep(), steps.length - 1);
        if (currentIndex >= steps.length) currentIndex = 0;
        ensureOverlay();
        tooltipEl = overlay.querySelector('.onboarding-tooltip');
        showStep(currentIndex);
    }

    function shouldShowAfterLogin() {
        return !isCompleted();
    }

    window.OnboardingTour = {
        start: start,
        stop: stop,
        shouldShowAfterLogin: shouldShowAfterLogin,
        isCompleted: isCompleted
    };
})();
