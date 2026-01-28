/**
 * App shell: sidebar collapse/mobile overlay, health indicator, UI settings apply.
 */
(function () {
    'use strict';

    var SIDEBAR_KEY = 'sidebar-collapsed';

    var UISettings = {
        load: function () {
            var saved = localStorage.getItem('ui-settings');
            if (saved) {
                try {
                    var settings = JSON.parse(saved);
                    this.apply(settings);
                    return settings;
                } catch (e) {
                    console.error('Ошибка загрузки настроек:', e);
                }
            }
            return this.getDefaults();
        },
        save: function (settings) {
            localStorage.setItem('ui-settings', JSON.stringify(settings));
        },
        getDefaults: function () {
            return { theme: 'dark', density: 'normal', size: 'normal', animations: true };
        },
        apply: function (settings) {
            var root = document.documentElement;
            var body = document.body;

            if (settings.theme) {
                root.setAttribute('data-theme', settings.theme);
                body.setAttribute('data-theme', settings.theme);
                var themeSelect = document.getElementById('theme-select');
                if (themeSelect) themeSelect.value = settings.theme;
            }
            if (settings.density) {
                root.setAttribute('data-density', settings.density);
                body.setAttribute('data-density', settings.density);
                var densitySelect = document.getElementById('density-select');
                if (densitySelect) densitySelect.value = settings.density;
            }
            if (settings.size) {
                root.setAttribute('data-size', settings.size);
                body.setAttribute('data-size', settings.size);
                var sizeSelect = document.getElementById('size-select');
                if (sizeSelect) sizeSelect.value = settings.size;
            }
            if (settings.animations !== undefined) {
                if (settings.animations) {
                    root.style.setProperty('--animation-speed', '1');
                    body.removeAttribute('data-animations');
                } else {
                    root.style.setProperty('--animation-speed', '0');
                    body.setAttribute('data-animations', 'disabled');
                }
                var animToggle = document.querySelector('.ui-toggle-switch');
                if (animToggle) {
                    if (settings.animations) animToggle.classList.add('active');
                    else animToggle.classList.remove('active');
                }
            }
        },
        getCurrent: function () {
            return {
                theme: document.documentElement.getAttribute('data-theme') || 'dark',
                density: document.documentElement.getAttribute('data-density') || 'normal',
                size: document.documentElement.getAttribute('data-size') || 'normal',
                animations: document.documentElement.style.getPropertyValue('--animation-speed') !== '0'
            };
        }
    };

    function changeTheme(theme) {
        var settings = UISettings.getCurrent();
        settings.theme = theme;
        UISettings.apply(settings);
        UISettings.save(settings);
    }
    function changeDensity(density) {
        var settings = UISettings.getCurrent();
        settings.density = density;
        UISettings.apply(settings);
        UISettings.save(settings);
    }
    function changeSize(size) {
        var settings = UISettings.getCurrent();
        settings.size = size;
        UISettings.apply(settings);
        UISettings.save(settings);
    }
    function toggleAnimations(element) {
        element.classList.toggle('active');
        var settings = UISettings.getCurrent();
        settings.animations = element.classList.contains('active');
        UISettings.apply(settings);
        UISettings.save(settings);
    }
    function toggleUISettings() {
        var panel = document.getElementById('ui-settings-panel');
        var btn = document.getElementById('ui-settings-toggle');
        var isOpen = panel ? panel.classList.toggle('open') : false;
        if (panel) {
            panel.setAttribute('aria-hidden', panel.classList.contains('open') ? 'false' : 'true');
        }
        if (btn) {
            btn.classList.toggle('active');
            btn.setAttribute('aria-expanded', panel && panel.classList.contains('open') ? 'true' : 'false');
        }
    }
    function resetUISettings() {
        if (confirm('Сбросить все настройки интерфейса к значениям по умолчанию?')) {
            localStorage.removeItem('ui-settings');
            var defaults = UISettings.getDefaults();
            UISettings.apply(defaults);
            UISettings.save(defaults);
        }
    }

    function checkHealth() {
        var el = document.getElementById('connection-status');
        if (!el) return;
        if (typeof document.hidden === 'boolean' && document.hidden) return;
        var textSpan = el.querySelector('span:last-child');
        function setStatus(text, cssClass) {
            el.className = 'status-badge ' + cssClass;
            if (textSpan) textSpan.textContent = text;
        }
        if (el.classList.contains('status-offline')) {
            setStatus('Reconnecting...', 'status-reconnecting');
        }
        fetch('/api/health/')
            .then(function (r) {
                if (r.ok) setStatus('Online', 'status-online');
                else setStatus('Offline', 'status-offline');
            })
            .catch(function () { setStatus('Offline', 'status-offline'); });
    }

    function initSidebar() {
        var sidebar = document.getElementById('sidebar');
        var toggleBtn = document.getElementById('sidebar-toggle');

        function saveSidebarState() {
            if (sidebar) {
                try {
                    localStorage.setItem(SIDEBAR_KEY, sidebar.classList.contains('collapsed') ? 'true' : 'false');
                } catch (e) {}
            }
        }
        function restoreSidebarState() {
            if (!sidebar) return;
            try {
                if (localStorage.getItem(SIDEBAR_KEY) === 'true') sidebar.classList.add('collapsed');
            } catch (e) {}
        }

        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('click', function () {
                sidebar.classList.toggle('collapsed');
                var collapsed = sidebar.classList.contains('collapsed');
                toggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
                toggleBtn.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
                saveSidebarState();
            });
        }
        restoreSidebarState();
    }

    function initMobileOverlay() {
        var mobileBtn = document.getElementById('mobile-menu-btn');
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        if (mobileBtn && sidebar) {
            mobileBtn.addEventListener('click', function () {
                sidebar.classList.toggle('mobile-open');
                var open = sidebar.classList.contains('mobile-open');
                if (overlay) overlay.classList.toggle('visible', open);
                mobileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
                mobileBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            });
        }
        if (overlay && sidebar) {
            overlay.addEventListener('click', function () {
                sidebar.classList.remove('mobile-open');
                overlay.classList.remove('visible');
            });
        }
    }

    function initUISettingsClickOutside() {
        document.addEventListener('click', function (e) {
            var panel = document.getElementById('ui-settings-panel');
            var btn = document.getElementById('ui-settings-toggle');
            if (panel && panel.classList.contains('open')) {
                if (!panel.contains(e.target) && (!btn || !btn.contains(e.target))) {
                    panel.classList.remove('open');
                    panel.setAttribute('aria-hidden', 'true');
                    if (btn) {
                        btn.classList.remove('active');
                        btn.setAttribute('aria-expanded', 'false');
                    }
                }
            }
        });
    }

    window.changeTheme = changeTheme;
    window.changeDensity = changeDensity;
    window.changeSize = changeSize;
    window.toggleAnimations = toggleAnimations;
    window.toggleUISettings = toggleUISettings;
    window.resetUISettings = resetUISettings;

    var healthIntervalId = null;
    var HEALTH_POLL_MS = 45000;

    function startHealthPoll() {
        if (healthIntervalId) return;
        var el = document.getElementById('connection-status');
        if (!el) return;
        healthIntervalId = setInterval(checkHealth, HEALTH_POLL_MS);
    }
    function stopHealthPoll() {
        if (healthIntervalId) {
            clearInterval(healthIntervalId);
            healthIntervalId = null;
        }
    }
    function onVisibilityChange() {
        if (document.hidden) stopHealthPoll();
        else { checkHealth(); startHealthPoll(); }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var settings = UISettings.load();
        if (settings) UISettings.apply(settings);
        checkHealth();
        startHealthPoll();
        initSidebar();
        initMobileOverlay();
        initUISettingsClickOutside();
        var headerModel = document.getElementById('header-current-model');
        if (headerModel && (headerModel.textContent === '—' || !headerModel.textContent.trim())) {
            headerModel.textContent = 'Cursor Auto';
        }
        if (typeof document.hidden === 'boolean') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
    });
})();
