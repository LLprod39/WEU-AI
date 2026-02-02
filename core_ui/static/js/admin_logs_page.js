/* Admin Logs Page — Smart Event Grouping + Tabs + Live Updates */
(function () {
    var page = document.querySelector('.admin-logs-container');
    if (!page) return;

    var state = {
        items: [],
        raw_events: [],
        grouped_events: [],
        afterId: 0,
        current: null,
        auto: true,
        eventFilter: 'all',
        eventSearch: ''
    };

    // Elements
    var sidebarEl = document.getElementById('adminSidebar');
    var sidebarToggleBtn = document.getElementById('sidebarToggle');
    var listEl = document.getElementById('adminRunsList');
    var emptyEl = document.getElementById('adminRunsEmpty');
    var countEl = document.getElementById('runsCount');
    var searchEl = document.getElementById('adminLogsSearch');
    var typeEl = document.getElementById('adminLogsType');
    var statusEl = document.getElementById('adminLogsStatus');
    var runtimeEl = document.getElementById('adminLogsRuntime');
    var refreshBtn = document.getElementById('adminLogsRefreshBtn');
    var autoBtn = document.getElementById('adminLogsAutoToggle');
    var titleEl = document.getElementById('adminRunTitle');
    var metaEl = document.getElementById('adminRunMeta');
    var timelineEl = document.getElementById('adminEventsTimeline');
    var eventsEmptyEl = document.getElementById('eventsEmpty');
    var eventsSearchEl = document.getElementById('eventsSearchInput');
    var rawEl = document.getElementById('adminRawLogs');
    var promptEl = document.getElementById('adminPromptInput');
    var configEl = document.getElementById('adminConfigInput');
    var scriptEl = document.getElementById('adminWorkflowScript');
    var detailsEl = document.getElementById('adminRunDetails');
    var saveBtn = document.getElementById('adminRunSaveBtn');
    var restartBtn = document.getElementById('adminRunRestartBtn');

    function getCsrfToken() {
        var cookie = document.cookie.split(';').find(function (c) {
            return c.trim().startsWith('csrftoken=');
        });
        return cookie ? cookie.split('=')[1] : '';
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function buildQuery() {
        var params = [];
        var q = (searchEl && searchEl.value) ? searchEl.value.trim() : '';
        var type = typeEl ? typeEl.value : 'all';
        var status = statusEl ? statusEl.value : 'all';
        var runtime = runtimeEl ? runtimeEl.value : 'all';
        if (q) params.push('q=' + encodeURIComponent(q));
        if (type && type !== 'all') params.push('type=' + encodeURIComponent(type));
        if (status && status !== 'all') params.push('status=' + encodeURIComponent(status));
        if (runtime && runtime !== 'all') params.push('runtime=' + encodeURIComponent(runtime));
        return params.length ? ('?' + params.join('&')) : '';
    }

    function getStatusIcon(status) {
        if (status === 'running') return '◐';
        if (status === 'succeeded') return '✓';
        if (status === 'failed') return '✗';
        if (status === 'paused') return '⏸';
        if (status === 'cancelled') return '⊘';
        return '○';
    }

    function fetchList() {
        fetch('/agents/admin/api/runs/' + buildQuery())
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                state.items = data.items || [];
                if (countEl) countEl.textContent = state.items.length;
                renderList();
            })
            .catch(function (e) {
                state.items = [];
                renderList();
                if (emptyEl) {
                    emptyEl.textContent = 'Access denied or error: ' + (e.message || e);
                    emptyEl.classList.remove('hidden');
                }
            });
    }

    function renderList() {
        if (!listEl) return;
        if (!state.items.length) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');
        listEl.innerHTML = state.items.map(function (item) {
            var active = state.current && state.current.type === item.type && state.current.id === item.id;
            var label = item.type === 'workflow' ? ('#W' + item.id) : ('#R' + item.id);
            var subtitle = item.title || '—';
            var meta = [item.runtime, item.user || '—'].filter(Boolean).join(' • ');
            return '<button type="button" class="run-item ' + (active ? 'active' : '') + ' status-' + item.status + '" data-id="' + item.id + '" data-type="' + item.type + '">' +
                '<div class="run-item-header">' +
                    '<span class="run-item-id">' + escapeHtml(label) + '</span>' +
                    '<span class="run-item-status">' + getStatusIcon(item.status) + '</span>' +
                '</div>' +
                '<div class="run-item-title">' + escapeHtml(subtitle) + '</div>' +
                '<div class="run-item-meta">' + escapeHtml(meta) + '</div>' +
            '</button>';
        }).join('');
    }

    function groupEvents(events) {
        if (!events || !events.length) return [];
        var groups = [];
        var currentGroup = null;

        events.forEach(function (ev) {
            var evType = ev.type || 'text';
            var evSubtype = ev.subtype || '';
            var message = ev.message || ev.command || ev.title || '';

            // Группируем последовательные события одного типа (assistant, thinking, cmd_output)
            if (currentGroup && currentGroup.type === evType && evType === 'assistant') {
                currentGroup.messages.push(message);
                currentGroup.message = currentGroup.messages.join('');
                return;
            }
            if (currentGroup && currentGroup.type === evType && evType === 'cmd_output') {
                currentGroup.messages.push(message);
                currentGroup.message = currentGroup.messages.join('\n');
                return;
            }

            // Новая группа
            if (currentGroup) groups.push(currentGroup);
            currentGroup = {
                id: ev.id,
                type: evType,
                subtype: evSubtype,
                title: ev.title || typeToTitle(evType, evSubtype),
                message: message,
                messages: [message],
                ts: ev.ts,
                meta: ev
            };
        });

        if (currentGroup) groups.push(currentGroup);
        return groups;
    }

    function typeToTitle(type, subtype) {
        if (type === 'run' && subtype === 'start') return 'Run Started';
        if (type === 'run' && subtype === 'finish') return 'Run Finished';
        if (type === 'prompt') return 'Input Prompt';
        if (type === 'cmd' && subtype === 'start') return 'Command Execution';
        if (type === 'system') return 'System Init';
        if (type === 'assistant') return 'Assistant Response';
        if (type === 'tool_call' && subtype === 'started') return 'Tool Started';
        if (type === 'tool_call' && subtype === 'completed') return 'Tool Completed';
        if (type === 'cmd_output') return 'Command Output';
        if (type === 'error') return 'Error';
        if (type === 'summary') return 'Step Summary';
        if (type === 'phase') return 'Phase';
        return 'Event';
    }

    function getEventIcon(type) {
        if (type === 'assistant') return '💬';
        if (type === 'tool_call') return '🔧';
        if (type === 'cmd' || type === 'cmd_output') return '🖥️';
        if (type === 'error') return '⚠️';
        if (type === 'system') return '🤖';
        if (type === 'prompt') return '📝';
        if (type === 'phase') return '🔄';
        if (type === 'summary') return '📊';
        return '•';
    }

    function matchesEventFilter(group) {
        if (state.eventFilter === 'all') return true;
        return group.type === state.eventFilter;
    }

    function matchesEventSearch(group) {
        if (!state.eventSearch) return true;
        var text = (group.title + ' ' + group.message).toLowerCase();
        return text.indexOf(state.eventSearch) !== -1;
    }

    function renderTimeline() {
        if (!timelineEl) return;
        state.grouped_events = groupEvents(state.raw_events);
        var filtered = state.grouped_events.filter(function (g) {
            return matchesEventFilter(g) && matchesEventSearch(g);
        });
        if (!filtered.length) {
            timelineEl.innerHTML = '';
            if (eventsEmptyEl) eventsEmptyEl.classList.remove('hidden');
            return;
        }
        if (eventsEmptyEl) eventsEmptyEl.classList.add('hidden');
        timelineEl.innerHTML = filtered.map(function (group) {
            var icon = getEventIcon(group.type);
            var message = escapeHtml(group.message || '').substring(0, 4000);
            var hasMessage = group.message && group.message.trim().length > 0;
            return '<div class="event-card event-' + group.type + '">' +
                '<div class="event-icon">' + icon + '</div>' +
                '<div class="event-content">' +
                    '<div class="event-title">' + escapeHtml(group.title) + '</div>' +
                    (hasMessage ? '<div class="event-message">' + message + '</div>' : '') +
                '</div>' +
            '</div>';
        }).join('');
        // Auto scroll
        if (timelineEl) {
            timelineEl.scrollTop = timelineEl.scrollHeight;
        }
    }

    function mergeEvents(newEvents) {
        if (!newEvents || !newEvents.length) return;
        var existingIds = {};
        state.raw_events.forEach(function (ev) { existingIds[ev.id] = true; });
        newEvents.forEach(function (ev) {
            if (!existingIds[ev.id]) state.raw_events.push(ev);
        });
        state.raw_events.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    }

    function applyDetails(data) {
        if (titleEl) titleEl.textContent = data.title || '—';
        if (metaEl) metaEl.textContent = data.meta || '—';
        if (rawEl) rawEl.textContent = data.logs || '';
        if (detailsEl) detailsEl.textContent = JSON.stringify(data.details || {}, null, 2);
        if (promptEl) promptEl.value = data.prompt || '';
        if (configEl) configEl.value = data.config_json || '';
        if (scriptEl) scriptEl.value = data.script_json || '';

        // Команда и аргументы
        var details = data.details || {};
        var cliCmd = details.cli_command || [];
        var cliCmdFull = details.cli_command_full || [];
        var workspace = details.workspace || '';
        var config = details.config || {};
        var inputPromptFull = details.input_prompt_full || '';
        var runtimeConfig = details.runtime_config || {};
        
        var commandFullEl = document.getElementById('adminCommandFull');
        var promptFullEl = document.getElementById('adminPromptFull');
        var configFullEl = document.getElementById('adminConfigFull');
        var envVarsEl = document.getElementById('adminEnvVars');
        var mcpConfigEl = document.getElementById('adminMcpConfig');
        
        if (commandFullEl) {
            if (data.type === 'workflow') {
                // Для workflow показываем команды всех шагов
                var steps = details.steps || [];
                var commandText = 'WORKFLOW: ' + (details.workflow_name || '—') + '\n';
                commandText += 'Всего шагов: ' + steps.length + '\n';
                commandText += 'Текущий шаг: ' + (details.current_step || 0) + '\n\n';
                commandText += '═'.repeat(60) + '\n\n';
                
                steps.forEach(function (step) {
                    commandText += (step.is_current ? '▶ ' : '  ') + 'ШАГ ' + step.idx + ': ' + step.title + '\n';
                    commandText += '─'.repeat(60) + '\n';
                    if (step.cmd && step.cmd.length) {
                        commandText += 'Команда (' + step.cmd.length + ' аргументов):\n';
                        step.cmd.forEach(function (arg, i) {
                            commandText += '  [' + i + '] ' + arg + '\n';
                        });
                    } else {
                        commandText += '  (команда не сохранена — старый запуск до обновления)\n';
                    }
                    commandText += '\n';
                });
                commandFullEl.textContent = commandText;
            } else {
                // Для AgentRun показываем одну команду
                if (cliCmd.length || cliCmdFull.length) {
                    var useCmd = cliCmdFull.length ? cliCmdFull : cliCmd;
                    var commandText = 'Runtime: ' + (details.runtime || '—') + '\n';
                    commandText += 'Workspace: ' + (workspace || '—') + '\n\n';
                    commandText += 'Runtime Config:\n';
                    commandText += '  Command: ' + (runtimeConfig.command || '—') + '\n';
                    commandText += '  Base Args: ' + JSON.stringify(runtimeConfig.args || []) + '\n';
                    commandText += '  Allowed Args: ' + JSON.stringify(runtimeConfig.allowed_args || []) + '\n';
                    commandText += '  Timeout: ' + (runtimeConfig.timeout_seconds || '—') + ' sec\n\n';
                    commandText += '═'.repeat(60) + '\n';
                    commandText += 'ФИНАЛЬНАЯ КОМАНДА (' + useCmd.length + ' аргументов):\n';
                    commandText += '═'.repeat(60) + '\n\n';
                    useCmd.forEach(function (arg, i) {
                        commandText += '[' + i + '] ' + arg + '\n';
                    });
                    commandFullEl.textContent = commandText;
                } else {
                    commandFullEl.textContent = '❌ Команда не сохранена.\n\nЭто либо internal runtime, либо старый запуск до обновления.\nДля новых запусков команда будет сохраняться автоматически.';
                }
            }
        }
        
        if (promptFullEl) {
            var promptText = '';
            if (data.type === 'workflow') {
                var steps = details.steps || [];
                var currentStepIdx = details.current_step || 0;
                if (currentStepIdx > 0 && currentStepIdx <= steps.length) {
                    var currentStep = steps[currentStepIdx - 1];
                    promptText = '═'.repeat(60) + '\n';
                    promptText += 'ТЕКУЩИЙ ШАГ (' + currentStepIdx + '/' + steps.length + '): ' + currentStep.title + '\n';
                    promptText += '═'.repeat(60) + '\n\n';
                    promptText += currentStep.prompt || 'Нет промпта';
                } else {
                    promptText = 'Workflow не запущен или завершён\n\n';
                    promptText += 'Всего шагов: ' + steps.length + '\n\n';
                    promptText += '═'.repeat(60) + '\n\n';
                    steps.forEach(function (s) {
                        promptText += '📌 Шаг ' + s.idx + ': ' + s.title + '\n';
                        promptText += '─'.repeat(60) + '\n';
                        promptText += (s.prompt || 'Нет промпта').substring(0, 400) + '...\n\n';
                    });
                }
            } else {
                // Для AgentRun показываем полный входной промпт
                promptText = inputPromptFull || data.prompt || '';
                if (!promptText) {
                    promptText = '❌ Промпт отсутствует.\n\nЭто старый запуск до обновления.\nДля новых запусков промпт сохраняется автоматически.';
                }
            }
            promptFullEl.textContent = promptText;
        }
        
        if (configFullEl) {
            var configText = '═'.repeat(60) + '\n';
            configText += 'КОНФИГУРАЦИЯ ЗАПУСКА\n';
            configText += '═'.repeat(60) + '\n\n';
            configText += '📌 Runtime: ' + (details.runtime || '—') + '\n';
            configText += '📌 Workspace: ' + (workspace || '—') + '\n';
            configText += '📌 Status: ' + (details.status || '—') + '\n';
            
            if (data.type === 'workflow') {
                configText += '📌 Workflow: ' + (details.workflow_name || '—') + '\n';
                configText += '📌 Шагов: ' + (details.steps || []).length + '\n';
                configText += '📌 Текущий шаг: ' + (details.current_step || 0) + '\n';
            } else {
                configText += '📌 Profile: ' + (details.profile || '—') + '\n';
            }
            
            configText += '\n' + '─'.repeat(60) + '\n';
            configText += 'Config переданный агенту:\n';
            configText += '─'.repeat(60) + '\n';
            configText += JSON.stringify(config, null, 2) || '{}';
            
            configText += '\n\n' + '─'.repeat(60) + '\n';
            configText += 'Runtime Config (из settings.py):\n';
            configText += '─'.repeat(60) + '\n';
            var rtCfg = details.runtime_config || {};
            configText += 'Command: ' + (rtCfg.command || '—') + '\n';
            configText += 'Base Args: ' + JSON.stringify(rtCfg.args || []) + '\n';
            configText += 'Allowed Args: ' + JSON.stringify(rtCfg.allowed_args || []) + '\n';
            configText += 'Timeout: ' + (rtCfg.timeout_seconds || '—') + ' sec\n';
            
            configFullEl.textContent = configText;
        }
        
        if (envVarsEl) {
            var envText = '═'.repeat(60) + '\n';
            envText += 'ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ\n';
            envText += '═'.repeat(60) + '\n\n';
            
            var envVars = details.env_vars || {};
            if (Object.keys(envVars).length) {
                envText += 'Кастомные ENV из settings.CURSOR_CLI_EXTRA_ENV:\n\n';
                for (var key in envVars) {
                    envText += '  ' + key + ': ' + envVars[key] + '\n';
                }
                envText += '\n';
            }
            
            envText += 'Стандартные ENV (передаются автоматически):\n';
            envText += '  HOME: <домашняя директория пользователя>\n';
            envText += '  PATH: <системный PATH>\n';
            envText += '  USER: <текущий пользователь>\n';
            envText += '  SHELL: <shell пользователя>\n\n';
            
            envText += 'Для runtime "cursor":\n';
            envText += '  CURSOR_API_KEY: *** (из .env)\n';
            envText += '  MCP_CONFIG_PATH: <путь к mcp_config.json>\n\n';
            
            envText += 'Для runtime "claude":\n';
            envText += '  ANTHROPIC_API_KEY: *** (из .env)\n';
            envText += '  MCP_CONFIG_PATH: <путь к mcp_config.json>\n\n';
            
            envText += 'Полный список ENV смотри в логах (вкладка «Консоль»).';
            envVarsEl.textContent = envText;
        }
        
        if (mcpConfigEl) {
            var mcpText = '═'.repeat(60) + '\n';
            mcpText += 'MCP КОНФИГУРАЦИЯ\n';
            mcpText += '═'.repeat(60) + '\n\n';
            mcpText += 'MCP серверы настраиваются через workspace/mcp_config.json\n\n';
            mcpText += 'Для серверных задач (target_server):\n';
            mcpText += '  - Автоматически добавляется weu-servers MCP сервер\n';
            mcpText += '  - Предоставляет: servers_list, server_execute\n';
            mcpText += '  - Использует standalone mcp_server.py\n\n';
            mcpText += 'Для кодовых задач:\n';
            mcpText += '  - MCP серверы из профиля агента (если настроены)\n';
            mcpText += '  - Per-agent изоляция серверов\n\n';
            mcpText += 'Полный путь и содержимое MCP конфига смотри в логах:\n';
            mcpText += '  - Ищите строки "MCP CONFIG PATH"\n';
            mcpText += '  - Ищите строки "MCP CONFIG СОДЕРЖИМОЕ"\n\n';
            mcpText += 'Для новых запусков добавлю сохранение mcp_config в meta.';
            mcpConfigEl.textContent = mcpText;
        }

        if (data.type === 'workflow') {
            scriptEl.removeAttribute('disabled');
            promptEl.setAttribute('disabled', 'disabled');
        } else {
            promptEl.removeAttribute('disabled');
            scriptEl.setAttribute('disabled', 'disabled');
        }
    }

    function fetchStatus() {
        if (!state.current) return;
        var base = state.current.type === 'workflow'
            ? '/agents/admin/api/workflows/run/' + state.current.id + '/status/'
            : '/agents/admin/api/runs/' + state.current.id + '/status/';
        var url = base + (state.afterId ? ('?after_id=' + encodeURIComponent(state.afterId)) : '');
        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                if (typeof data.last_event_id === 'number') {
                    state.afterId = Math.max(state.afterId, data.last_event_id);
                }
                if (data.events && data.events.length) {
                    mergeEvents(data.events);
                }
                renderTimeline();
                applyDetails(data);
            })
            .catch(function (e) {
                if (rawEl) rawEl.textContent = 'Error loading status: ' + (e.message || e);
            });
    }

    function selectRun(runId, runType) {
        state.current = { id: parseInt(runId, 10), type: runType };
        state.raw_events = [];
        state.grouped_events = [];
        state.afterId = 0;
        renderList();
        fetchStatus();
    }

    function saveCurrent() {
        if (!state.current) return;
        var url = state.current.type === 'workflow'
            ? '/agents/admin/api/workflows/run/' + state.current.id + '/update/'
            : '/agents/admin/api/runs/' + state.current.id + '/update/';
        var payload = {};
        if (state.current.type === 'workflow') {
            try {
                payload.script = JSON.parse(scriptEl.value || '{}');
            } catch (e) {
                alert('Invalid script JSON: ' + e.message);
                return;
            }
        } else {
            payload.input_task = (promptEl.value || '').trim();
            try {
                payload.config = configEl.value ? JSON.parse(configEl.value) : {};
            } catch (e) {
                alert('Invalid config JSON: ' + e.message);
                return;
            }
        }
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToast('Saved', 'success');
                    fetchStatus();
                } else {
                    alert(data.error || 'Failed to save');
                }
            })
            .catch(function (e) {
                alert('Error: ' + (e.message || e));
            });
    }

    function restartCurrent() {
        if (!state.current) return;
        if (!confirm('Restart this run?')) return;
        var url = state.current.type === 'workflow'
            ? '/agents/admin/api/workflows/run/' + state.current.id + '/restart/'
            : '/agents/admin/api/runs/' + state.current.id + '/restart/';
        var payload = {};
        if (state.current.type === 'run') {
            payload.input_task = (promptEl.value || '').trim();
            try {
                payload.config = configEl.value ? JSON.parse(configEl.value) : {};
            } catch (e) {
                alert('Invalid config JSON: ' + e.message);
                return;
            }
        }
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToast('Restarted', 'success');
                    fetchList();
                    if (data.run_id) {
                        selectRun(data.run_id, state.current.type);
                    }
                } else {
                    alert(data.error || 'Failed to restart');
                }
            })
            .catch(function (e) {
                alert('Error: ' + (e.message || e));
            });
    }

    function showToast(msg, type) {
        if (window.showToast) {
            window.showToast(msg, type);
        }
    }

    function bindEvents() {
        // Sidebar toggle
        if (sidebarToggleBtn && sidebarEl) {
            sidebarToggleBtn.addEventListener('click', function () {
                sidebarEl.classList.toggle('collapsed');
                var icon = sidebarToggleBtn.querySelector('.toggle-icon');
                if (icon) {
                    icon.textContent = sidebarEl.classList.contains('collapsed') ? '▶' : '◀';
                }
            });
        }
        
        if (listEl) {
            listEl.addEventListener('click', function (e) {
                var btn = e.target.closest('.run-item');
                if (!btn) return;
                selectRun(btn.getAttribute('data-id'), btn.getAttribute('data-type'));
            });
        }
        [searchEl, typeEl, statusEl, runtimeEl].forEach(function (el) {
            if (!el) return;
            el.addEventListener('input', fetchList);
            el.addEventListener('change', fetchList);
        });
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                fetchList();
                fetchStatus();
            });
        }
        if (autoBtn) {
            autoBtn.addEventListener('click', function () {
                state.auto = !state.auto;
                autoBtn.classList.toggle('active', state.auto);
                autoBtn.setAttribute('data-active', state.auto);
            });
        }
        if (saveBtn) saveBtn.addEventListener('click', saveCurrent);
        if (restartBtn) restartBtn.addEventListener('click', restartCurrent);

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var tab = btn.getAttribute('data-tab');
                document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
                document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
                btn.classList.add('active');
                var content = document.querySelector('.tab-content[data-tab="' + tab + '"]');
                if (content) content.classList.add('active');
            });
        });

        // Event filters
        document.querySelectorAll('.filter-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                state.eventFilter = chip.getAttribute('data-filter') || 'all';
                renderTimeline();
            });
        });

        if (eventsSearchEl) {
            eventsSearchEl.addEventListener('input', function () {
                state.eventSearch = (eventsSearchEl.value || '').toLowerCase();
                renderTimeline();
            });
        }

        // Copy buttons
        var copyCommandBtn = document.getElementById('adminCopyCommand');
        var copyPromptFullBtn = document.getElementById('adminCopyPromptFull');
        var copyConfigFullBtn = document.getElementById('adminCopyConfigFull');
        var consoleCopyBtn = document.getElementById('consoleCopyBtn');
        
        if (copyCommandBtn) {
            copyCommandBtn.addEventListener('click', function () {
                var el = document.getElementById('adminCommandFull');
                navigator.clipboard.writeText(el ? el.textContent : '').then(function () {
                    showToast('Команда скопирована', 'success');
                }).catch(function () {});
            });
        }
        if (copyPromptFullBtn) {
            copyPromptFullBtn.addEventListener('click', function () {
                var el = document.getElementById('adminPromptFull');
                navigator.clipboard.writeText(el ? el.textContent : '').then(function () {
                    showToast('Промпт скопирован', 'success');
                }).catch(function () {});
            });
        }
        if (copyConfigFullBtn) {
            copyConfigFullBtn.addEventListener('click', function () {
                var el = document.getElementById('adminConfigFull');
                navigator.clipboard.writeText(el ? el.textContent : '').then(function () {
                    showToast('Config скопирован', 'success');
                }).catch(function () {});
            });
        }
        if (consoleCopyBtn) {
            consoleCopyBtn.addEventListener('click', function () {
                navigator.clipboard.writeText(rawEl.textContent || '').then(function () {
                    showToast('Консоль скопирована', 'success');
                }).catch(function () {});
            });
        }
    }

    bindEvents();
    fetchList();
    setInterval(function () {
        if (!state.auto) return;
        if (state.current) fetchStatus();
        fetchList();
    }, 2000);
})();
