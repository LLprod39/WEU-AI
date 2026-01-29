/* Logs page UI for workflow and agent runs */
(function () {
    var page = document.querySelector('.agent-logs-page');
    if (!page) return;

    var runType = (page.getAttribute('data-run-type') || 'workflow').toLowerCase();
    var runId = page.getAttribute('data-run-id');
    var state = {
        events: [],
        lastEventId: 0,
        status: 'queued',
        autoScroll: true,
        filter: 'all',
        search: '',
        fallback: false
    };

    var timelineEl = document.getElementById('logsTimeline');
    var emptyEl = document.getElementById('logsEmptyState');
    var rawEl = document.getElementById('logsRawContent');
    var rawToggle = document.getElementById('logsRawToggle');
    var detailsEl = document.getElementById('logsDetails');
    var statusBadge = document.getElementById('logsStatusBadge');
    var titleEl = document.getElementById('logsPageTitle');
    var metaEl = document.getElementById('logsPageMeta');
    var flowEl = document.getElementById('logsFlow');
    var flowMetaEl = document.getElementById('logsFlowMeta');
    var searchInput = document.getElementById('logsSearchInput');
    var copyAllBtn = document.getElementById('logsCopyAll');
    var autoScrollBtn = document.getElementById('logsAutoScrollToggle');
    var refreshBtn = document.getElementById('logsRefreshBtn');

    function statusClass(status) {
        if (status === 'running') return 'status-running';
        if (status === 'succeeded') return 'status-success';
        if (status === 'failed') return 'status-error';
        if (status === 'paused') return 'status-paused';
        return 'status-queued';
    }

    function statusLabel(status) {
        if (status === 'running') return 'Выполняется';
        if (status === 'succeeded') return 'Завершено';
        if (status === 'failed') return 'Ошибка';
        if (status === 'paused') return 'Пауза';
        return 'Ожидание';
    }

    function iconForType(type) {
        if (type === 'assistant') return '💬';
        if (type === 'tool_call') return '🔧';
        if (type === 'step') return '✅';
        if (type === 'cmd') return '🖥️';
        if (type === 'error') return '⚠️';
        if (type === 'result') return '⏱️';
        if (type === 'workflow') return '🧭';
        if (type === 'phase') return '🧪';
        return '•';
    }

    function eventTitle(ev) {
        if (ev.title) return ev.title;
        if (ev.message) return ev.message.slice(0, 80);
        return 'Событие';
    }

    function formatTs(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts);
            if (!isNaN(d.getTime())) return d.toLocaleTimeString();
        } catch (e) {}
        return '';
    }

    function buildEventText(ev) {
        var parts = [];
        if (ev.title) parts.push(ev.title);
        if (ev.message) parts.push(ev.message);
        if (ev.command) parts.push(ev.command);
        if (ev.step_label) parts.push(ev.step_label);
        if (ev.step_idx) parts.push('step ' + ev.step_idx);
        return parts.join(' ');
    }

    function matchesFilter(ev) {
        if (state.filter === 'all') return true;
        return (ev.type || '') === state.filter;
    }

    function matchesSearch(ev) {
        if (!state.search) return true;
        return buildEventText(ev).toLowerCase().indexOf(state.search) !== -1;
    }

    function renderTimeline() {
        if (!timelineEl) return;
        var filtered = state.events.filter(function (ev) {
            return matchesFilter(ev) && matchesSearch(ev);
        });
        if (!filtered.length) {
            timelineEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');
        timelineEl.innerHTML = filtered.map(function (ev) {
            var ts = formatTs(ev.ts);
            var subtitle = ev.step_label || (ev.step_idx ? ('Шаг ' + ev.step_idx) : '');
            var message = ev.message || ev.command || '';
            var meta = [ts, subtitle].filter(Boolean).join(' • ');
            return '<div class="log-event-card" data-event-id="' + ev.id + '">' +
                '<div class="log-event-header">' +
                    '<div class="log-event-icon">' + iconForType(ev.type) + '</div>' +
                    '<div class="log-event-title">' + (eventTitle(ev) || '') + '</div>' +
                    '<div class="log-event-meta">' + meta + '</div>' +
                '</div>' +
                (message ? '<div class="log-event-message">' + escapeHtml(message) + '</div>' : '') +
                '<div class="log-event-actions">' +
                    '<button type="button" class="log-event-btn" data-action="details">Подробнее</button>' +
                    '<button type="button" class="log-event-btn" data-action="copy">Копировать</button>' +
                '</div>' +
            '</div>';
        }).join('');

        if (state.autoScroll) {
            timelineEl.scrollTop = timelineEl.scrollHeight;
        }
    }

    function renderDetails(ev) {
        if (!detailsEl) return;
        if (!ev) {
            detailsEl.innerHTML = '<div class="text-gray-500 text-sm">Выбери событие в ленте.</div>';
            return;
        }
        var metaLines = [];
        if (ev.type) metaLines.push('Тип: ' + ev.type);
        if (ev.subtype) metaLines.push('Подтип: ' + ev.subtype);
        if (ev.step_label) metaLines.push('Шаг: ' + ev.step_label);
        if (ev.step_idx) metaLines.push('Шаг #: ' + ev.step_idx);
        if (ev.duration_ms) metaLines.push('Длительность: ' + ev.duration_ms + 'ms');
        detailsEl.innerHTML =
            '<div class="log-detail-title">' + escapeHtml(eventTitle(ev)) + '</div>' +
            '<div class="log-detail-meta">' + escapeHtml(metaLines.join(' • ')) + '</div>' +
            (ev.message ? '<div class="log-detail-message">' + escapeHtml(ev.message) + '</div>' : '') +
            '<pre class="log-detail-json">' + escapeHtml(JSON.stringify(ev, null, 2)) + '</pre>';
    }

    function renderFlow(steps, currentStep) {
        if (!flowEl) return;
        if (!steps || !steps.length) {
            flowEl.innerHTML = '<div class="text-gray-500 text-sm">Нет данных по шагам.</div>';
            if (flowMetaEl) flowMetaEl.textContent = '—';
            return;
        }
        if (flowMetaEl) flowMetaEl.textContent = 'Шагов: ' + steps.length;
        flowEl.innerHTML = steps.map(function (step, idx) {
            var status = step.status || 'pending';
            var isActive = (currentStep === step.idx);
            return '<div class="log-flow-step ' + status + (isActive ? ' active' : '') + '" data-step-idx="' + step.idx + '">' +
                '<div class="log-flow-dot"></div>' +
                '<div class="log-flow-content">' +
                    '<div class="log-flow-title">' + escapeHtml(step.title || ('Шаг ' + step.idx)) + '</div>' +
                    '<div class="log-flow-subtitle">' + escapeHtml(step.prompt || '') + '</div>' +
                '</div>' +
                (idx < steps.length - 1 ? '<div class="log-flow-arrow">→</div>' : '') +
            '</div>';
        }).join('');
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function applyStatus(status) {
        state.status = status || 'queued';
        if (statusBadge) {
            statusBadge.className = 'log-status-badge ' + statusClass(state.status);
            statusBadge.textContent = statusLabel(state.status);
        }
    }

    function mergeEvents(newEvents) {
        if (!newEvents || !newEvents.length) return;
        var existingIds = {};
        state.events.forEach(function (ev) { existingIds[ev.id] = true; });
        newEvents.forEach(function (ev) {
            if (!existingIds[ev.id]) state.events.push(ev);
        });
        state.events.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    }

    function parseTextLogs(text) {
        if (!text) return [];
        var lines = text.split('\n');
        var blocks = [];
        var current = [];
        function pushBlock() {
            if (!current.length) return;
            blocks.push(current.slice());
            current = [];
        }
        lines.forEach(function (line) {
            var trimmed = (line || '').trim();
            if (!trimmed) {
                pushBlock();
                return;
            }
            if (trimmed.startsWith('===') || trimmed.startsWith('──') || trimmed.startsWith('---')) {
                pushBlock();
                return;
            }
            if (trimmed.startsWith('💬') || trimmed.startsWith('🖥️') || trimmed.startsWith('✅') || trimmed.startsWith('⚠️') || trimmed.startsWith('❌') || trimmed.startsWith('⏱️') || trimmed.startsWith('📊') || trimmed.startsWith('🤖')) {
                pushBlock();
            }
            current.push(line);
        });
        pushBlock();
        var tail = blocks.slice(-120);
        return tail.map(function (block, idx) {
            var firstLine = (block[0] || '').trim();
            var type = 'text';
            if (firstLine.startsWith('💬')) type = 'assistant';
            else if (firstLine.startsWith('🖥️') || firstLine.startsWith('[CMD]')) type = 'cmd';
            else if (firstLine.startsWith('✅')) type = 'step';
            else if (firstLine.startsWith('⚠️') || firstLine.startsWith('❌')) type = 'error';
            else if (firstLine.startsWith('⏱️')) type = 'result';
            else if (firstLine.startsWith('📊')) type = 'summary';
            else if (firstLine.startsWith('🤖')) type = 'system';
            var title = firstLine || 'Лог';
            if (title.length > 80) title = title.slice(0, 77) + '...';
            return {
                id: -1 * (idx + 1),
                ts: '',
                type: type,
                title: title,
                message: block.join('\n')
            };
        });
    }

    function setRawLog(text) {
        if (!rawEl) return;
        rawEl.textContent = text || '';
    }

    function fetchStatus() {
        if (!runId) return;
        var url = runType === 'workflow'
            ? '/agents/api/workflows/run/' + runId + '/status/'
            : '/agents/api/runs/' + runId + '/status/';
        if (state.lastEventId) url += '?after_id=' + encodeURIComponent(state.lastEventId);
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                applyStatus(data.status);
                if (titleEl) {
                    var label = runType === 'workflow' ? ('Workflow #' + runId) : ('Run #' + runId);
                    titleEl.textContent = label;
                }
                if (metaEl) {
                    var meta = [];
                    if (data.runtime) meta.push('Runtime: ' + data.runtime);
                    if (data.finished_at) meta.push('Финиш: ' + data.finished_at);
                    if (data.current_step_title) meta.push('Текущий шаг: ' + data.current_step_title);
                    metaEl.textContent = meta.join(' • ') || '—';
                }
                if (typeof data.last_event_id === 'number') {
                    state.lastEventId = Math.max(state.lastEventId, data.last_event_id);
                }
                if (data.events && data.events.length) {
                    if (state.fallback) {
                        state.events = [];
                        state.fallback = false;
                    }
                    mergeEvents(data.events);
                } else if (!state.events.length && (data.logs || data.output)) {
                    state.events = parseTextLogs(data.logs || data.output);
                    state.fallback = true;
                }
                if (runType === 'workflow') {
                    renderFlow(data.steps || [], data.current_step || 0);
                }
                setRawLog(data.logs || data.output || '');
                renderTimeline();
            })
            .catch(function (e) {
                console.error('Failed to fetch logs:', e);
            });
    }

    function bindEvents() {
        if (timelineEl) {
            timelineEl.addEventListener('click', function (e) {
                var card = e.target.closest('.log-event-card');
                if (!card) return;
                var id = parseInt(card.getAttribute('data-event-id'), 10);
                var ev = state.events.find(function (item) { return item.id === id; });
                if (e.target && e.target.getAttribute('data-action') === 'copy') {
                    if (ev) navigator.clipboard.writeText(buildEventText(ev)).catch(function () {});
                    return;
                }
                renderDetails(ev);
            });
        }
        document.querySelectorAll('.log-filter-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.log-filter-chip').forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                state.filter = chip.getAttribute('data-filter') || 'all';
                renderTimeline();
            });
        });
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                state.search = (searchInput.value || '').toLowerCase();
                renderTimeline();
            });
        }
        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', function () {
                var text = (rawEl && rawEl.textContent) ? rawEl.textContent : state.events.map(buildEventText).join('\n');
                navigator.clipboard.writeText(text).catch(function () {});
            });
        }
        if (rawToggle && rawEl) {
            rawToggle.addEventListener('click', function () {
                rawEl.classList.toggle('hidden');
                rawToggle.textContent = rawEl.classList.contains('hidden') ? 'Показать' : 'Скрыть';
            });
        }
        if (autoScrollBtn) {
            autoScrollBtn.addEventListener('click', function () {
                state.autoScroll = !state.autoScroll;
                autoScrollBtn.textContent = state.autoScroll ? 'Автоскролл: Вкл' : 'Автоскролл: Выкл';
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                fetchStatus();
            });
        }
    }

    if (!runId) {
        if (titleEl) titleEl.textContent = 'Логи не выбраны';
        if (metaEl) metaEl.textContent = 'Передай run_id в URL, например: ?type=workflow&run_id=123';
        return;
    }

    bindEvents();
    fetchStatus();
    setInterval(fetchStatus, 2000);
})();
