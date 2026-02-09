/**
 * Agent Hub — логика страницы Agents: профили, workflows, запуски, логи, Task Builder, импорт/экспорт.
 * Ожидает в DOM: #preset-data, #workflows-data, #projects-data (json_script из шаблона).
 * Использует: showToast (toast.js), getCookie — если нет глобала, определяет локально.
 */
(function () {
    'use strict';

    window.__AGENT_HUB_VERSION__ = 'hub-v6';

    var presetData = [];
    var workflowsData = [];
    var projectsData = [];
    var serversData = [];
    var webhooksData = [];
    var webhookEditingId = null;
    var webhookAgents = [];
    var customAgents = [];
    var selectedAgentId = null;
    var editingProfileId = null;
    var workflowLogsInterval = null;
    var agentLogsInterval = null;
    var statusUpdateInterval = null;
    var taskBuilderTasks = [];
    var draggedTask = null;

    function initData() {
        var e = document.getElementById('preset-data');
        if (e) presetData = JSON.parse(e.textContent || '[]');
        e = document.getElementById('workflows-data');
        if (e) workflowsData = JSON.parse(e.textContent || '[]');
        e = document.getElementById('projects-data');
        if (e) projectsData = JSON.parse(e.textContent || '[]');
        e = document.getElementById('servers-data');
        if (e) serversData = JSON.parse(e.textContent || '[]');
    }
    initData();


    function setupProjectSelectors() {
        var q = document.getElementById('quick-project'), qn = document.getElementById('quick-project-name');
        if (q && qn) {
            q.addEventListener('change', function () { qn.style.display = q.value === '__new__' ? 'block' : 'none'; });
            qn.style.display = q.value === '__new__' ? 'block' : 'none';
        }
        var wp = document.getElementById('workflow-project'), wpn = document.getElementById('workflow-project-name');
        if (wp && wpn) {
            wp.addEventListener('change', function () { wpn.parentElement.style.display = wp.value === '__new__' ? 'block' : 'none'; });
        }
    }

    function toggleModelFields() {
        var r = document.getElementById('profile-runtime') && document.getElementById('profile-runtime').value;
        var mc = document.getElementById('profile-model-container');
        var sc = document.getElementById('profile-specific-model-container');
        var ci = document.getElementById('cursor-model-info');
        if (!mc) return;
        // Теперь модель поддерживается и для cursor
        mc.classList.remove('hidden');
        if (sc) sc.classList.remove('hidden');
        if (ci) {
            if (r === 'cursor') {
                ci.classList.remove('hidden');
            } else {
                ci.classList.add('hidden');
            }
        }
    }

    function clearProfileQuestions() {
        var box = document.getElementById('profile-questions');
        var ql = document.getElementById('profile-questions-list');
        var al = document.getElementById('profile-assumptions-list');
        if (ql) ql.innerHTML = '';
        if (al) al.innerHTML = '';
        if (box) box.classList.add('hidden');
    }

    function renderProfileQuestions(questions, assumptions) {
        var box = document.getElementById('profile-questions');
        var ql = document.getElementById('profile-questions-list');
        var al = document.getElementById('profile-assumptions-list');
        if (!box || !ql || !al) return;
        var qs = Array.isArray(questions) ? questions.filter(Boolean) : [];
        var as = Array.isArray(assumptions) ? assumptions.filter(Boolean) : [];
        if (qs.length === 0 && as.length === 0) {
            clearProfileQuestions();
            return;
        }
        ql.innerHTML = qs.map(function (q) { return '<li>' + q + '</li>'; }).join('');
        al.innerHTML = as.map(function (a) { return '<li>' + a + '</li>'; }).join('');
        box.classList.remove('hidden');
    }

    window.openProfileModal = function () {
        editingProfileId = null;
        var t = document.getElementById('profileModalTitle');
        if (t) t.textContent = 'Новый профиль';
        var f = document.getElementById('profileForm');
        if (f) f.reset();
        var j = document.getElementById('profile-config-json');
        if (j) j.value = '';
        var lp = document.getElementById('profile-loop-include-previous');
        if (lp) lp.checked = true;
        clearProfileQuestions();
        var m = document.getElementById('profileModal');
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        toggleModelFields();
        var pr = document.getElementById('profile-runtime');
        if (pr) pr.addEventListener('change', toggleModelFields);
    };

    window.closeProfileModal = function () {
        var m = document.getElementById('profileModal');
        if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
    };

    // AI Assistant и Workflow Modal удалены - используйте Task Builder

    window.openWorkflowLogs = function (runId) {
        var m = document.getElementById('workflowLogsModal');
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        var openLink = document.getElementById('workflowLogsOpenPage');
        if (openLink) openLink.href = '/agents/logs/?type=workflow&run_id=' + runId;
        if (workflowLogsInterval) clearInterval(workflowLogsInterval);
        fetchWorkflowLogs(runId);
        workflowLogsInterval = setInterval(function () { fetchWorkflowLogs(runId); }, 2000);
    };

    window.closeWorkflowLogs = function () {
        var m = document.getElementById('workflowLogsModal');
        if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
        if (workflowLogsInterval) { clearInterval(workflowLogsInterval); workflowLogsInterval = null; }
    };

    function fetchWorkflowLogs(runId) {
        fetch('/agents/api/workflows/run/' + runId + '/status/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var content = document.getElementById('workflowLogsContent');
                var meta = document.getElementById('workflowLogsMeta');
                var stepsList = document.getElementById('workflowStepsList');
                var actionsContainer = document.getElementById('workflowLogsActions');
                var retryInfo = document.getElementById('workflowLogsRetryInfo');
                if (content) { content.textContent = data.logs || 'Логи пока пусты...'; content.scrollTop = content.scrollHeight; }
                var icon = '⏳', cls = 'text-gray-400', statusText = 'Ожидание';
                if (data.status === 'running') { icon = '🔄'; cls = 'text-primary'; statusText = 'Выполняется'; }
                else if (data.status === 'succeeded') { icon = '✅'; cls = 'text-green-400'; statusText = 'Завершено'; }
                else if (data.status === 'failed') { icon = '❌'; cls = 'text-red-400'; statusText = 'Ошибка'; }
                else if (data.status === 'paused') { icon = '⏸️'; cls = 'text-yellow-400'; statusText = 'Пауза'; }
                var total = data.total_steps || 0, cur = data.current_step || 0, title = data.current_step_title || 'Ожидание...';
                if (meta) meta.innerHTML = '<span class="' + cls + '">' + icon + ' ' + statusText + '</span><span class="mx-2">•</span><span>Шаг ' + cur + ' из ' + total + '</span><span class="mx-2">•</span><span class="text-gray-300">' + (title || '') + '</span>';
                if (retryInfo) {
                    if (data.status === 'running' && data.retry_count > 0)
                        retryInfo.textContent = 'Попытка ' + (data.retry_count + 1) + ' из ' + (data.max_retries + 1);
                    else retryInfo.textContent = '';
                }
                if (stepsList && data.steps && data.steps.length) {
                    var workflowStatus = data.status;
                    stepsList.innerHTML = data.steps.map(function (step) {
                        var stepIcon = '⏳', stepBg = 'bg-white/5 hover:bg-white/10', stepBorder = 'border-white/10';
                        if (step.status === 'completed') { stepIcon = '✅'; stepBg = 'bg-green-500/10 hover:bg-green-500/20'; stepBorder = 'border-green-500/30'; }
                        else if (step.status === 'running') { stepIcon = '🔄'; stepBg = 'bg-primary/10'; stepBorder = 'border-primary/30'; }
                        else if (step.status === 'failed') { stepIcon = '❌'; stepBg = 'bg-red-500/10 hover:bg-red-500/20'; stepBorder = 'border-red-500/30'; }
                        else if (step.status === 'skipped') { stepIcon = '⏭️'; stepBg = 'bg-yellow-500/10 hover:bg-yellow-500/20'; stepBorder = 'border-yellow-500/30'; }
                        var retryBadge = (step.retries > 0) ? '<span class="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">' + step.retries + ' retry</span>' : '';
                        var err = step.error ? ('<div class="text-[10px] text-red-400 mt-1">' + step.error + '</div>') : '';
                        var canAct = workflowStatus === 'failed' || workflowStatus === 'paused';
                        var isClick = canAct && step.status !== 'running';
                        var clickAttr = isClick ? ('onclick="toggleStepActions(this, ' + runId + ', ' + step.idx + ', \'' + (step.status || '') + '\')"') : '';
                        return '<div class="step-card p-2 rounded-lg ' + stepBg + ' border ' + stepBorder + ' ' + (isClick ? 'cursor-pointer' : '') + ' transition-all" data-step-idx="' + step.idx + '" data-step-status="' + (step.status || '') + '" ' + clickAttr + '>' +
                            '<div class="flex items-center gap-2"><span class="text-sm">' + stepIcon + '</span><span class="flex-1 text-xs text-white font-medium truncate">' + (step.title || '') + '</span><span class="text-[10px] text-gray-500">#' + step.idx + '</span>' + (isClick ? '<span class="text-gray-500 text-xs">▼</span>' : '') + '</div>' +
                            '<div class="mt-1 flex items-center gap-2"><span class="text-[10px] text-gray-400 truncate flex-1">' + (step.prompt || '').substring(0, 80) + '</span>' + retryBadge + '</div>' + err +
                            '<div class="step-actions hidden mt-2 pt-2 border-t border-white/10 flex gap-2 flex-wrap"></div></div>';
                    }).join('');
                }
                if (actionsContainer) {
                    if (data.status === 'failed' || data.status === 'paused') {
                        actionsContainer.innerHTML = '<button type="button" onclick="retryCurrentStep(' + runId + ')" class="px-3 py-1.5 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg">🔄 Повторить шаг</button>' +
                            '<button type="button" onclick="skipCurrentStep(' + runId + ')" class="px-3 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg">⏭️ Пропустить</button>' +
                            '<button type="button" onclick="continueFromStep(' + runId + ', ' + cur + ')" class="px-3 py-1.5 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg">▶️ Продолжить</button>';
                    } else if (data.status === 'running') {
                        actionsContainer.innerHTML = '<button type="button" onclick="stopWorkflow(' + runId + ')" class="px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg">⏹️ Остановить</button>';
                    } else actionsContainer.innerHTML = '';
                }
                if (data.status !== 'running' && data.status !== 'queued' && workflowLogsInterval) {
                    clearInterval(workflowLogsInterval);
                    workflowLogsInterval = null;
                }
            })
            .catch(function (e) { console.error('Failed to fetch logs:', e); });
    }

    window.retryCurrentStep = function (runId) {
        if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Повтор шага...');
        fetch('/agents/api/workflows/run/' + runId + '/retry/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
                if (data.success) { if (workflowLogsInterval) clearInterval(workflowLogsInterval); workflowLogsInterval = setInterval(function () { fetchWorkflowLogs(runId); }, 2000); fetchWorkflowLogs(runId); }
                else if (window.showToast) window.showToast(data.error || 'Ошибка', 'error');
            })
            .catch(function (e) { if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e && e.message || e), 'error'); });
    };
    window.skipCurrentStep = function (runId) {
        if (!confirm('Пропустить текущий шаг и перейти к следующему?')) return;
        if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Пропуск шага...');
        fetch('/agents/api/workflows/run/' + runId + '/skip/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
                if (data.success) { if (workflowLogsInterval) clearInterval(workflowLogsInterval); workflowLogsInterval = setInterval(function () { fetchWorkflowLogs(runId); }, 2000); fetchWorkflowLogs(runId); }
                else if (window.showToast) window.showToast(data.error || 'Ошибка', 'error');
            })
            .catch(function (e) { if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e && e.message || e), 'error'); });
    };
    window.continueFromStep = function (runId, fromStep) {
        var step = prompt('Продолжить с шага:', String(fromStep));
        if (step != null && step !== '') continueFromStepDirect(runId, parseInt(step, 10));
    };
    window.continueFromStepDirect = function (runId, stepIdx) {
        if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Продолжение...');
        fetch('/agents/api/workflows/run/' + runId + '/continue/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' },
            body: JSON.stringify({ from_step: stepIdx })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
                if (data.success) { if (workflowLogsInterval) clearInterval(workflowLogsInterval); workflowLogsInterval = setInterval(function () { fetchWorkflowLogs(runId); }, 2000); fetchWorkflowLogs(runId); }
                else if (window.showToast) window.showToast(data.error || 'Ошибка', 'error');
            })
            .catch(function (e) { if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e && e.message || e), 'error'); });
    };
    window.toggleStepActions = function (element, runId, stepIdx, stepStatus) {
        document.querySelectorAll('.step-card .step-actions').forEach(function (el) {
            if (el.parentElement !== element) { el.classList.add('hidden'); el.innerHTML = ''; }
        });
        var actionsDiv = element.querySelector('.step-actions');
        if (!actionsDiv) return;
        if (!actionsDiv.classList.contains('hidden')) { actionsDiv.classList.add('hidden'); actionsDiv.innerHTML = ''; return; }
        var buttons = [];
        if (stepStatus === 'failed' || stepStatus === 'completed' || stepStatus === 'skipped') {
            buttons.push('<button type="button" onclick="event.stopPropagation(); retryStep(' + runId + ', ' + stepIdx + ')" class="px-2 py-1 text-[10px] bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded">🔄 Повторить</button>');
        }
        if (stepStatus === 'pending' || stepStatus === 'failed') {
            buttons.push('<button type="button" onclick="event.stopPropagation(); skipStep(' + runId + ', ' + stepIdx + ')" class="px-2 py-1 text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded">⏭️ Пропустить</button>');
        }
        buttons.push('<button type="button" onclick="event.stopPropagation(); continueFromStepDirect(' + runId + ', ' + stepIdx + ')" class="px-2 py-1 text-[10px] bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded">▶️ Продолжить отсюда</button>');
        actionsDiv.innerHTML = buttons.join('');
        actionsDiv.classList.remove('hidden');
    };
    window.retryStep = function (runId, stepIdx) {
        if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Повтор шага ' + stepIdx + '...');
        fetch('/agents/api/workflows/run/' + runId + '/continue/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' },
            body: JSON.stringify({ from_step: stepIdx })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
                if (data.success) { if (workflowLogsInterval) clearInterval(workflowLogsInterval); workflowLogsInterval = setInterval(function () { fetchWorkflowLogs(runId); }, 2000); fetchWorkflowLogs(runId); }
                else if (window.showToast) window.showToast(data.error || 'Ошибка', 'error');
            })
            .catch(function (e) { if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e && e.message || e), 'error'); });
    };
    window.skipStep = function (runId, stepIdx) {
        if (!confirm('Пропустить шаг ' + stepIdx + '?')) return;
        if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Пропуск шага ' + stepIdx + '...');
        fetch('/agents/api/workflows/run/' + runId + '/skip-step/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' },
            body: JSON.stringify({ step_idx: stepIdx })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
                if (data.success) { if (workflowLogsInterval) clearInterval(workflowLogsInterval); workflowLogsInterval = setInterval(function () { fetchWorkflowLogs(runId); }, 2000); fetchWorkflowLogs(runId); }
                else if (window.showToast) window.showToast(data.error || 'Ошибка', 'error');
            })
            .catch(function (e) { if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e && e.message || e), 'error'); });
    };

    window.openAgentLogs = function (runId) {
        var m = document.getElementById('agentLogsModal');
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        var openLink = document.getElementById('agentLogsOpenPage');
        if (openLink) openLink.href = '/agents/logs/?type=run&run_id=' + runId;
        if (agentLogsInterval) clearInterval(agentLogsInterval);
        fetchAgentLogs(runId);
        agentLogsInterval = setInterval(function () { fetchAgentLogs(runId); }, 2000);
    };

    window.closeAgentLogs = function () {
        var m = document.getElementById('agentLogsModal');
        if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
        if (agentLogsInterval) { clearInterval(agentLogsInterval); agentLogsInterval = null; }
    };

    function fetchAgentLogs(runId) {
        fetch('/agents/api/runs/' + runId + '/status/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var content = document.getElementById('agentLogsContent');
                var meta = document.getElementById('agentLogsMeta');
                if (content) content.textContent = data.logs || data.output || '';
                if (meta) meta.textContent = 'Статус: ' + (data.status || '-') + ' • Рантайм: ' + (data.runtime || '-');
            });
    }

    window.saveProfile = function (e) {
        e.preventDefault();
        var btn = document.getElementById('btn-save-profile');
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        var runtime = document.getElementById('profile-runtime').value;
        var config = {
            use_rag: document.getElementById('profile-use-rag').checked,
            use_ralph_loop: document.getElementById('profile-use-ralph-loop').checked,
            loop_include_previous: document.getElementById('profile-loop-include-previous').checked,
            max_iterations: parseInt(document.getElementById('profile-max-iterations').value || '10', 10),
            completion_promise: (document.getElementById('profile-completion-promise') || {}).value || '',
            ralph_backend: (document.getElementById('profile-ralph-backend') || {}).value || null
        };
        // Теперь модель поддерживается и для cursor
        config.model = document.getElementById('profile-model').value;
        config.specific_model = (document.getElementById('profile-specific-model') || {}).value || null;
        var raw = (document.getElementById('profile-config-json') || {}).value.trim();
        if (raw) {
            try { Object.assign(config, JSON.parse(raw)); } catch (err) {
                if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
                if (window.showToast) window.showToast('Неверный JSON в конфиге', 'error');
                return;
            }
        }
        var payload = {
            name: document.getElementById('profile-name').value,
            description: (document.getElementById('profile-description') || {}).value || '',
            agent_type: document.getElementById('profile-agent-type').value,
            runtime: runtime,
            mode: document.getElementById('profile-mode').value,
            is_default: document.getElementById('profile-is-default').checked,
            config: config
        };
        var url = editingProfileId ? '/agents/api/profiles/' + editingProfileId + '/update/' : '/agents/api/profiles/create/';
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) location.reload();
                else if (window.showToast) window.showToast(data.error || 'Не удалось сохранить', 'error');
            })
            .catch(function (err) { if (window.showToast) window.showToast('Ошибка: ' + (err.message || err), 'error'); })
            .finally(function () {
                if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
            });
    };

    window.runProfile = function (profileId, ev) {
        var task = prompt('Введите задачу:');
        if (!task) return;
        var btn = ev && ev.target;
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        fetch('/agents/api/run/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify({ profile_id: profileId, task: task })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { if (window.showToast) window.showToast('Запуск начат.', 'success'); location.reload(); }
                else if (window.showToast) window.showToast(data.error || 'Запуск не удался', 'error');
            })
            .finally(function () { if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; } });
    };

    window.editProfile = function (profileId) {
        fetch('/agents/api/profiles/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var profile = (data.profiles || []).find(function (p) { return p.id === profileId; });
                if (!profile) return;
                editingProfileId = profileId;
                var t = document.getElementById('profileModalTitle');
                if (t) t.textContent = 'Редактирование профиля';
                var id = function (x) { return document.getElementById(x); };
                id('profile-name').value = profile.name || '';
                id('profile-description').value = profile.description || '';
                id('profile-agent-type').value = profile.agent_type || '';
                id('profile-runtime').value = profile.runtime || '';
                id('profile-mode').value = profile.mode || '';
                id('profile-is-default').checked = profile.is_default || false;
                var c = profile.config || {};
                id('profile-model').value = c.model || 'gpt-5';
                (id('profile-specific-model') || {}).value = c.specific_model || '';
                id('profile-use-rag').checked = c.use_rag !== false;
                id('profile-use-ralph-loop').checked = !!c.use_ralph_loop;
                id('profile-loop-include-previous').checked = c.loop_include_previous !== false;
                id('profile-max-iterations').value = c.max_iterations || 10;
                (id('profile-completion-promise') || {}).value = c.completion_promise || '';
                (id('profile-ralph-backend') || {}).value = c.ralph_backend || '';
                id('profile-config-json').value = JSON.stringify(c, null, 2);
                clearProfileQuestions();
                document.getElementById('profileModal').classList.remove('hidden');
                toggleModelFields();
            });
    };

    // generateConfig и generateWorkflow удалены - используйте Task Builder с AI Анализ

    window.runWorkflow = function (workflowId, ev) {
        var btn = ev && ev.target;
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        showLoadingOverlay('Запуск workflow...');
        fetch('/agents/api/workflows/run/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify({ workflow_id: workflowId })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (data.success && data.run_id) {
                    openWorkflowLogs(data.run_id);
                    setTimeout(function () { location.reload(); }, 500);
                } else if (window.showToast) window.showToast(data.error || 'Не удалось запустить workflow', 'error');
            })
            .catch(function (err) { hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (err.message || err), 'error'); })
            .finally(function () { if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; } });
    };

    var _currentScriptWorkflowId = null;
    window.openWorkflowScript = function (workflowId) {
        var w = workflowsData.find(function (x) { return x.id === workflowId; });
        if (!w) return;
        _currentScriptWorkflowId = workflowId;
        var modal = document.getElementById('workflowScriptModal');
        var jsonBox = document.getElementById('workflowScriptJson');
        var ralphBox = document.getElementById('workflowScriptRalph');
        if (jsonBox) jsonBox.textContent = JSON.stringify(w.script || {}, null, 2);
        var ralph = (w.script || {}).ralph_yml || null;
        if (ralphBox) ralphBox.textContent = ralph ? JSON.stringify(ralph, null, 2) : 'Ralph script отсутствует';
        if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); }
    };

    window.closeWorkflowScript = function () {
        var m = document.getElementById('workflowScriptModal');
        if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
        _currentScriptWorkflowId = null;
    };

    window.exportWorkflow = function (workflowId) {
        var id = workflowId != null ? workflowId : _currentScriptWorkflowId;
        var w = workflowsData.find(function (x) { return x.id == id; });
        if (!w || !w.script) { if (window.showToast) window.showToast('Нет данных для экспорта', 'error'); return; }
        var steps = (w.script.steps || w.script.tasks || []).map(function (s) {
            return { title: s.title, prompt: s.prompt, completion_promise: s.completion_promise || 'STEP_DONE', verify_prompt: s.verify_prompt || null, verify_promise: s.verify_promise || 'PASS', max_iterations: s.max_iterations || 5 };
        });
        var obj = { name: w.name || w.script.name || 'workflow', runtime: (w.script.runtime || w.runtime || 'ralph'), description: w.description || w.script.description || '', steps: steps };
        var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (obj.name || 'workflow').replace(/\s+/g, '_') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        if (window.showToast) window.showToast('Экспорт сохранён', 'success');
    };

    window.stopWorkflow = function (runId) {
        fetch('/agents/api/workflows/run/' + runId + '/stop/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { if (window.showToast) window.showToast('Остановлено', 'success'); location.reload(); }
                else if (window.showToast) window.showToast(data.error || 'Не удалось остановить', 'error');
            });
    };

    window.deleteWorkflowRun = function (runId) {
        if (!confirm('Удалить запуск workflow?')) return;
        fetch('/agents/api/workflows/run/' + runId + '/delete/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) location.reload();
                else if (window.showToast) window.showToast(data.error || 'Не удалось удалить', 'error');
            });
    };

    window.stopAgentRun = function (runId) {
        fetch('/agents/api/runs/' + runId + '/stop/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { if (window.showToast) window.showToast('Остановлено', 'success'); location.reload(); }
                else if (window.showToast) window.showToast(data.error || 'Не удалось остановить', 'error');
            });
    };

    window.deleteAgentRun = function (runId) {
        if (!confirm('Удалить запуск агента?')) return;
        fetch('/agents/api/runs/' + runId + '/delete/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) location.reload();
                else if (window.showToast) window.showToast(data.error || 'Не удалось удалить', 'error');
            });
    };

    window.deleteWorkflow = function (workflowId) {
        if (!confirm('Удалить workflow и его скрипт?')) return;
        fetch('/agents/api/workflows/' + workflowId + '/delete/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) location.reload();
                else if (window.showToast) window.showToast(data.error || 'Не удалось удалить', 'error');
            });
    };

    window.restartWorkflow = function (runId) {
        fetch('/agents/api/workflows/run/' + runId + '/restart/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { if (window.showToast) window.showToast('Перезапущено', 'success'); location.reload(); }
                else if (window.showToast) window.showToast(data.error || 'Не удалось перезапустить', 'error');
            });
    };

    function getQuickProjectPayload() {
        var q = document.getElementById('quick-project');
        var qn = document.getElementById('quick-project-name');
        var v = q ? q.value : '__new__';
        var n = (qn && qn.value) ? qn.value.trim() : '';
        if (v === '__new__') return { create_new_project: true, new_project_name: n };
        return { project_path: v };
    }

    // autoGenerateWorkflow удалена - используется единый autoCreateAll

    window.autoCreateAll = function () {
        var task = (document.getElementById('quick-task') || {}).value.trim();
        if (!task) { if (window.showToast) window.showToast('Опишите задачу', 'info'); return; }
        var btn = document.getElementById('btn-auto-create-all');
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        showLoadingOverlay('Создание workflow (model=auto)...');
        var runtime = document.getElementById('quick-runtime').value;
        // model=auto всегда
        var pl = Object.assign({ task: task, action: 'workflow', runtime: runtime, run_workflow: true, model: 'auto' }, getQuickProjectPayload());
        fetch('/agents/api/assist-auto/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) }, body: JSON.stringify(pl) })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (data.success) {
                    if (data.run_id) { openWorkflowLogs(data.run_id); setTimeout(function () { location.reload(); }, 500); }
                    else { if (window.showToast) window.showToast('Workflow создан и запущен', 'success'); location.reload(); }
                } else if (window.showToast) window.showToast(data.error || 'Не удалось создать workflow', 'error');
            })
            .catch(function (e) { hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e.message || e), 'error'); })
            .finally(function () { if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; } });
    };

    function renderMcpServers(servers, sources) {
        var list = document.getElementById('mcp-servers-list');
        var src = document.getElementById('mcp-sources');
        if (src) src.textContent = (sources && sources.length) ? ('Config: ' + sources.join(' • ')) : 'Config: not found';
        if (!list) return;
        if (!servers || servers.length === 0) {
            list.innerHTML = '<div class="text-gray-500 text-sm">Нет MCP серверов</div>';
            return;
        }
        list.innerHTML = servers.map(function (s) {
            var statusClass = 'text-gray-400';
            if (s.status === 'connected') statusClass = 'text-green-400';
            else if (s.status === 'error') statusClass = 'text-red-400';
            else if (s.status === 'disconnected') statusClass = 'text-yellow-400';
            var btn = s.status === 'connected'
                ? '<button onclick="disconnectMcpServer(\'' + s.name + '\')" class="text-xs text-red-300">Disconnect</button>'
                : '<button onclick="connectMcpServer(\'' + s.name + '\')" class="text-xs text-primary">Connect</button>';
            var toolsBtn = '<button onclick="openMcpTools(\'' + s.name + '\')" class="text-xs text-gray-300">Tools</button>';
            var err = s.error ? ('<div class="text-[10px] text-red-400 mt-1">' + s.error + '</div>') : '';
            return '<div class="bg-bg-surface/60 rounded-xl border border-white/5 p-3">' +
                '<div class="flex items-center justify-between">' +
                '<div>' +
                '<div class="text-sm text-white">' + s.name + '</div>' +
                '<div class="text-[10px] text-gray-500">' + (s.description || '') + '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2">' +
                '<span class="text-[10px] ' + statusClass + '">' + (s.status || 'unknown') + '</span>' +
                toolsBtn + btn +
                '</div>' +
                '</div>' + err +
                '</div>';
        }).join('');
    }

    window.refreshMcpServers = function () {
        fetch('/agents/api/mcp/servers/')
            .then(function (r) { return r.json(); })
            .then(function (data) { renderMcpServers(data.servers || [], data.sources || []); })
            .catch(function () {
                var list = document.getElementById('mcp-servers-list');
                if (list) list.innerHTML = '<div class="text-gray-500 text-sm">Ошибка загрузки MCP</div>';
            });
    };

    window.connectMcpServer = function (name) {
        fetch('/agents/api/mcp/servers/connect/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify({ name: name })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { if (window.showToast) window.showToast('MCP подключен', 'success'); refreshMcpServers(); }
                else if (window.showToast) window.showToast(data.error || 'Не удалось подключиться', 'error');
            });
    };

    window.disconnectMcpServer = function (name) {
        fetch('/agents/api/mcp/servers/disconnect/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify({ name: name })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { if (window.showToast) window.showToast('MCP отключен', 'success'); refreshMcpServers(); }
                else if (window.showToast) window.showToast('Не удалось отключить', 'error');
            });
    };

    window.openMcpTools = function (name) {
        var modal = document.getElementById('mcpToolsModal');
        var list = document.getElementById('mcpToolsList');
        var meta = document.getElementById('mcpToolsMeta');
        if (list) list.innerHTML = 'Загрузка...';
        if (meta) meta.textContent = name;
        if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); }
        fetch('/agents/api/mcp/servers/tools/?name=' + encodeURIComponent(name))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var tools = data.tools || [];
                if (!list) return;
                if (tools.length === 0) { list.textContent = 'Нет доступных инструментов'; return; }
                list.innerHTML = tools.map(function (t) {
                    var params = (t.parameters || []).map(function (p) { return p.name + (p.required ? '*' : ''); }).join(', ');
                    return '<div class="border border-white/10 rounded-lg p-2">' +
                        '<div class="text-sm text-white">' + t.name + '</div>' +
                        '<div class="text-[10px] text-gray-400">' + (t.description || '') + '</div>' +
                        (params ? '<div class="text-[10px] text-gray-500 mt-1">Params: ' + params + '</div>' : '') +
                        '</div>';
                }).join('');
            });
    };

    window.closeMcpTools = function () {
        var modal = document.getElementById('mcpToolsModal');
        if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }
    };

    window.usePreset = function (name) {
        var p = presetData.find(function (x) { return x.name === name; });
        if (!p) return;
        openProfileModal();
        document.getElementById('profile-name').value = p.name || '';
        document.getElementById('profile-description').value = p.description || '';
        document.getElementById('profile-agent-type').value = p.agent_type || 'react';
        document.getElementById('profile-runtime').value = p.runtime || 'ralph';
        document.getElementById('profile-config-json').value = JSON.stringify(p.config || {}, null, 2);
    };

    var STATUS_POLL_MS = 5000;

    function startStatusUpdates() {
        if (statusUpdateInterval) return;
        var cards = document.querySelectorAll('.workflow-run-card[data-status="running"]');
        if (cards.length === 0) return;
        statusUpdateInterval = setInterval(updateAllStatuses, STATUS_POLL_MS);
        updateAllStatuses();
    }

    function updateAllStatuses() {
        var cards = document.querySelectorAll('.workflow-run-card[data-status="running"]');
        var banner = document.getElementById('active-runs-banner');
        var info = document.getElementById('active-runs-info');
        if (cards.length === 0) {
            if (statusUpdateInterval) {
                clearInterval(statusUpdateInterval);
                statusUpdateInterval = null;
            }
            if (banner) banner.classList.add('hidden');
            return;
        }
        if (banner) banner.classList.remove('hidden');
        if (info) info.textContent = cards.length + ' активных процессов';
        cards.forEach(function (card) {
            var runId = card.getAttribute('data-run-id');
            if (!runId) return;
            fetch('/agents/api/workflows/run/' + runId + '/status/').then(function (r) { return r.json(); }).then(function (data) {
                if (data.status !== 'running') { location.reload(); return; }
                var stepInfo = card.querySelector('.text-gray-400.mb-1 span:first-child');
                var bar = card.querySelector('.h-2 > div');
                var stage = card.querySelector('.text-gray-300');
                var total = data.total_steps || 0, cur = data.current_step || 0, pct = total > 0 ? Math.round((cur / total) * 100) : 0;
                if (stepInfo) stepInfo.textContent = 'Шаг ' + cur + ' из ' + total;
                if (bar) bar.style.width = pct + '%';
                if (stage && data.current_step_title) stage.innerHTML = '<span class="text-gray-500">Текущая стадия:</span> ' + data.current_step_title;
            }).catch(function () {});
        });
    }

    window.scrollToActiveRuns = function () {
        var list = document.getElementById('workflow-runs-list');
        if (!list) return;
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
        var first = list.querySelector('.workflow-run-card[data-status="running"]');
        if (first) openWorkflowLogs(parseInt(first.getAttribute('data-run-id'), 10));
    };

    function showLoadingOverlay(message) {
        var el = document.getElementById('loading-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'loading-overlay';
            el.className = 'fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center';
            el.innerHTML = '<div class="glass-card rounded-2xl p-6 flex flex-col items-center gap-4"><svg class="w-10 h-10 text-primary spinner" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span id="loading-message" class="text-white">' + (message || 'Загрузка...') + '</span></div>';
            document.body.appendChild(el);
        } else {
            el.classList.remove('hidden');
            var msg = document.getElementById('loading-message');
            if (msg) msg.textContent = message || 'Загрузка...';
        }
    }

    function hideLoadingOverlay() {
        var el = document.getElementById('loading-overlay');
        if (el) el.classList.add('hidden');
    }

    /* ----- Import workflow ----- */
    window.openImportModal = function () {
        var m = document.getElementById('importModal');
        if (m && m.parentElement !== document.body) document.body.appendChild(m);
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        var f = document.getElementById('importForm');
        if (f) f.reset();
        var p = document.getElementById('import-preview');
        var fi = document.getElementById('import-file-info');
        if (p) p.classList.add('hidden');
        if (fi) fi.classList.add('hidden');
        setupImportProjectSelector();
        var fileIn = document.getElementById('import-file');
        if (fileIn) {
            fileIn.onchange = previewImportFile;
        }
    };

    window.closeImportModal = function () {
        var m = document.getElementById('importModal');
        if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
    };

    function setupImportProjectSelector() {
        var sel = document.getElementById('import-project');
        var cnt = document.getElementById('import-new-project-container');
        if (!sel || !cnt) return;
        function up() { cnt.style.display = sel.value === '__new__' ? 'block' : 'none'; }
        sel.addEventListener('change', up);
        up();
    }

    function previewImportFile(ev) {
        var file = ev.target.files[0];
        var infoEl = document.getElementById('import-file-info');
        var prevEl = document.getElementById('import-preview');
        var contentEl = document.getElementById('import-preview-content');
        if (!file) {
            if (prevEl) prevEl.classList.add('hidden');
            if (infoEl) infoEl.classList.add('hidden');
            return;
        }
        if (infoEl) { infoEl.textContent = '📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)'; infoEl.classList.remove('hidden'); }
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var data = JSON.parse(reader.result);
                var name = data.name || file.name.replace('.json', '');
                var steps = data.steps || [];
                var runtime = data.runtime || 'ralph';
                var desc = data.description || '';
                var html = '<div class="mb-2"><strong class="text-white">Название:</strong> ' + name + '</div><div class="mb-2"><strong class="text-white">Runtime:</strong> ' + runtime + '</div>' + (desc ? '<div class="mb-2"><strong class="text-white">Описание:</strong> ' + desc + '</div>' : '') + '<div class="mb-2"><strong class="text-white">Шагов:</strong> ' + steps.length + '</div>';
                if (steps.length) {
                    html += '<div class="mt-3 border-t border-white/10 pt-3"><strong class="text-white">Шаги:</strong></div><ol class="list-decimal list-inside mt-2 space-y-1 text-xs">';
                    steps.forEach(function (s, i) { html += '<li class="text-gray-300">' + (s.title || 'Step ' + (i + 1)) + (s.verify_prompt ? ' <span class="text-green-400 ml-1">с тестом</span>' : '') + '</li>'; });
                    html += '</ol>';
                }
                if (contentEl) contentEl.innerHTML = html;
                if (prevEl) prevEl.classList.remove('hidden');
            } catch (e) {
                if (contentEl) contentEl.innerHTML = '<span class="text-red-400">Ошибка парсинга JSON: ' + e.message + '</span>';
                if (prevEl) prevEl.classList.remove('hidden');
            }
        };
        reader.readAsText(file);
    }

    window.submitImport = function (ev) {
        ev.preventDefault();
        var fileIn = document.getElementById('import-file');
        var file = fileIn && fileIn.files[0];
        if (!file) { if (window.showToast) window.showToast('Выберите файл', 'error'); return; }
        var proj = document.getElementById('import-project').value;
        var newName = (document.getElementById('import-new-project-name') || {}).value.trim();
        showLoadingOverlay('Импорт workflow...');
        var fd = new FormData();
        fd.append('file', file);
        fd.append('project_path', proj);
        if (proj === '__new__' && newName) fd.append('new_project_name', newName);
        fetch('/agents/api/workflows/import/', { method: 'POST', headers: { 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) }, body: fd })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (data.success) {
                    closeImportModal();
                    if (window.showToast) window.showToast('Workflow "' + (data.name || '') + '" импортирован (' + (data.steps_count || 0) + ' шагов)', 'success');
                    location.reload();
                } else if (window.showToast) window.showToast(data.error || 'Ошибка импорта', 'error');
            })
            .catch(function (e) { hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e.message || e), 'error'); });
    };

    /* ----- Edit workflow (open Task Builder with data) ----- */
    window.editWorkflow = function (workflowId) {
        showLoadingOverlay('Загрузка workflow...');
        fetch('/agents/api/workflows/' + workflowId + '/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (!data.success) { if (window.showToast) window.showToast(data.error || 'Не удалось загрузить workflow', 'error'); return; }
                var w = data.workflow || {};
                taskBuilderTasks = (w.steps || []).map(function (s) {
                    return { title: s.title || '', prompt: s.prompt || '', completion_promise: s.completion_promise || 'STEP_DONE', verify_prompt: s.verify_prompt || '', verify_promise: s.verify_promise || 'PASS', max_iterations: s.max_iterations || 5 };
                });
                var modal = document.getElementById('taskBuilderModal');
                if (modal && modal.parentElement !== document.body) document.body.appendChild(modal);
                modal.classList.remove('hidden');
                modal.setAttribute('aria-hidden', 'false');
                modal.dataset.editingWorkflowId = workflowId;
                document.getElementById('tb-workflow-name').value = w.name || '';
                document.getElementById('tb-project-description').value = w.description || '';
                document.getElementById('tb-runtime').value = w.runtime || 'ralph';
                var ps = document.getElementById('tb-project');
                if (w.project_path) {
                    var opt = [].slice.call(ps.options).find(function (o) { return o.value === w.project_path; });
                    if (opt) ps.value = w.project_path;
                    else {
                        var o = document.createElement('option');
                        o.value = w.project_path;
                        o.textContent = '📂 ' + w.project_path;
                        ps.appendChild(o);
                        ps.value = w.project_path;
                    }
                }
                document.getElementById('tb-new-project-name').value = '';
                // Установка целевого сервера
                var ts = document.getElementById('tb-target-server');
                if (ts) {
                    ts.value = w.target_server_id ? String(w.target_server_id) : '';
                }
                setupTbProjectSelector();
                updateTasksUI();
            })
            .catch(function (e) { hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e.message || e), 'error'); });
    };

    /* ----- Task Builder ----- */
    window.openTaskBuilder = function () {
        closeWorkflowModal();
        taskBuilderTasks = [];
        var m = document.getElementById('taskBuilderModal');
        if (m && m.parentElement !== document.body) document.body.appendChild(m);
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        delete m.dataset.editingWorkflowId;
        var rt = document.getElementById('workflow-runtime');
        var pr = document.getElementById('workflow-project');
        var pn = document.getElementById('workflow-project-name');
        var t = document.getElementById('workflow-task');
        document.getElementById('tb-workflow-name').value = '';
        document.getElementById('tb-runtime').value = rt ? rt.value : 'ralph';
        document.getElementById('tb-project').value = pr ? pr.value : '__new__';
        document.getElementById('tb-new-project-name').value = pn ? pn.value : '';
        document.getElementById('tb-project-description').value = t ? t.value : '';
        var ts = document.getElementById('tb-target-server');
        if (ts) ts.value = '';
        setupTbProjectSelector();
        updateTasksUI();
    };

    window.closeTaskBuilder = function () {
        var m = document.getElementById('taskBuilderModal');
        if (m) { delete m.dataset.editingWorkflowId; m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
    };

    window.openTaskBuilderDirect = function () {
        taskBuilderTasks = [];
        var m = document.getElementById('taskBuilderModal');
        if (m && m.parentElement !== document.body) document.body.appendChild(m);
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        delete m.dataset.editingWorkflowId;
        document.getElementById('tb-workflow-name').value = '';
        document.getElementById('tb-project-description').value = '';
        document.getElementById('tb-runtime').value = 'ralph';
        document.getElementById('tb-project').value = '__new__';
        document.getElementById('tb-new-project-name').value = '';
        var ts = document.getElementById('tb-target-server');
        if (ts) ts.value = '';
        setupTbProjectSelector();
        updateTasksUI();
    };

    function setupTbProjectSelector() {
        var sel = document.getElementById('tb-project');
        var cnt = document.getElementById('tb-new-project-container');
        if (!sel || !cnt) return;
        function up() { cnt.style.display = sel.value === '__new__' ? 'block' : 'none'; }
        sel.removeEventListener('change', up);
        sel.addEventListener('change', up);
        up();
    }

    function updateTasksUI() {
        var container = document.getElementById('tb-tasks-container');
        var emptyEl = document.getElementById('tb-empty-state');
        if (!container) return;
        var toRemove = [];
        for (var i = 0; i < container.children.length; i++) {
            var c = container.children[i];
            if (c.id !== 'tb-empty-state') toRemove.push(c);
        }
        for (var j = 0; j < toRemove.length; j++) toRemove[j].remove();
        if (taskBuilderTasks.length === 0) {
            if (emptyEl) emptyEl.classList.remove('hidden');
        } else {
            if (emptyEl) emptyEl.classList.add('hidden');
            var frag = document.createDocumentFragment();
            for (var k = 0; k < taskBuilderTasks.length; k++) {
                var node = createTaskCard(taskBuilderTasks[k], k);
                if (node && node.nodeType === 1) frag.appendChild(node);
            }
            container.appendChild(frag);
        }
        updateTaskStats();
    }

    // Проверяет разрешён ли выбор моделей (из localStorage или API)
    function isModelSelectionAllowed() {
        var stored = localStorage.getItem('weu_allow_model_selection');
        // Если нет в localStorage - пробуем получить из API при следующем запросе
        if (stored === null) {
            // Асинхронно загружаем настройку
            fetch('/api/settings/', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.config && data.config.allow_model_selection !== undefined) {
                        localStorage.setItem('weu_allow_model_selection', data.config.allow_model_selection ? '1' : '0');
                    }
                })
                .catch(function() {});
            return false; // По умолчанию запрещено
        }
        return stored === '1';
    }
    
    function createTaskCard(task, index) {
        var tpl = document.getElementById('task-card-template');
        if (!tpl || !tpl.content) return document.createElement('div');
        var card = tpl.content.cloneNode(true).querySelector('.task-card');
        if (!card) return document.createElement('div');
        card.dataset.index = index;
        card.querySelector('.task-number').textContent = index + 1;
        card.querySelector('.task-title').value = task.title || '';
        card.querySelector('.task-prompt').value = task.prompt || '';
        card.querySelector('.task-verify').value = task.verify_prompt || '';
        card.querySelector('.task-promise').value = task.completion_promise || 'STEP_DONE';
        card.querySelector('.task-verify-promise').value = task.verify_promise || 'PASS';
        if (task.verify_prompt) {
            var tc = card.querySelector('.test-content');
            var tb = card.querySelector('.toggle-test-btn');
            if (tc) tc.classList.remove('hidden');
            if (tb) { tb.querySelector('.test-icon').textContent = '▼'; if (tb.childNodes[1]) tb.childNodes[1].textContent = ' Скрыть тест'; }
        }
        
        // Показываем выбор модели если разрешено в настройках
        var modelSection = card.querySelector('.task-model-section');
        var modelSelect = card.querySelector('.task-model');
        if (modelSection && modelSelect && isModelSelectionAllowed()) {
            modelSection.classList.remove('hidden');
            // Заполняем список моделей
            loadAvailableModels(function(models) {
                modelSelect.innerHTML = models.map(function(m) {
                    var selected = (m.id === (task.model || 'auto')) ? ' selected' : '';
                    return '<option value="' + m.id + '"' + selected + '>' + m.name + '</option>';
                }).join('');
            });
            modelSelect.addEventListener('change', function(e) {
                taskBuilderTasks[index].model = e.target.value;
            });
        }
        
        card.querySelector('.task-title').addEventListener('input', function (e) { taskBuilderTasks[index].title = e.target.value; });
        card.querySelector('.task-prompt').addEventListener('input', function (e) { taskBuilderTasks[index].prompt = e.target.value; });
        card.querySelector('.task-verify').addEventListener('input', function (e) { taskBuilderTasks[index].verify_prompt = e.target.value; updateTaskStats(); });
        card.querySelector('.task-promise').addEventListener('input', function (e) { taskBuilderTasks[index].completion_promise = e.target.value; });
        card.querySelector('.task-verify-promise').addEventListener('input', function (e) { taskBuilderTasks[index].verify_promise = e.target.value; });
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('drop', handleDrop);
        return card;
    }

    window.toggleTestSection = function (btn) {
        var section = btn.closest('.task-test-section');
        var content = section && section.querySelector('.test-content');
        var icon = btn.querySelector('.test-icon');
        if (!content) return;
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            if (icon) icon.textContent = '▼';
            btn.innerHTML = '<span class="test-icon">▼</span> Скрыть тест';
        } else {
            content.classList.add('hidden');
            if (icon) icon.textContent = '▶';
            btn.innerHTML = '<span class="test-icon">▶</span> Добавить тест';
        }
    };

    window.addNewTask = function () {
        taskBuilderTasks.push({ title: '', prompt: '', completion_promise: 'STEP_DONE', verify_prompt: '', verify_promise: 'PASS', max_iterations: 5 });
        updateTasksUI();
        setTimeout(function () {
            var cards = document.querySelectorAll('.task-card');
            var last = cards[cards.length - 1];
            if (last) { last.querySelector('.task-title').focus(); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }, 100);
    };

    window.deleteTask = function (btn) {
        var card = btn.closest('.task-card');
        var idx = parseInt(card.dataset.index, 10);
        taskBuilderTasks.splice(idx, 1);
        updateTasksUI();
    };

    window.clearAllTasks = function () {
        if (taskBuilderTasks.length === 0) return;
        if (!confirm('Удалить все задачи?')) return;
        taskBuilderTasks = [];
        updateTasksUI();
    };

    function updateTaskStats() {
        var c = document.getElementById('tb-tasks-count');
        var t = document.getElementById('tb-tests-count');
        if (c) c.textContent = taskBuilderTasks.length;
        if (t) t.textContent = taskBuilderTasks.filter(function (x) { return x.verify_prompt && x.verify_prompt.trim(); }).length;
    }

    function handleDragStart(e) {
        draggedTask = this;
        this.classList.add('opacity-50', 'border-primary');
        e.dataTransfer.effectAllowed = 'move';
    }
    function handleDragEnd() {
        this.classList.remove('opacity-50', 'border-primary');
        document.querySelectorAll('.task-card').forEach(function (c) { c.classList.remove('border-t-2', 'border-t-primary'); });
        draggedTask = null;
    }
    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var card = this.closest('.task-card');
        if (card && card !== draggedTask) card.classList.add('border-t-2', 'border-t-primary');
    }
    function handleDrop(e) {
        e.preventDefault();
        var card = this.closest('.task-card');
        if (!card || card === draggedTask) return;
        var from = parseInt(draggedTask.dataset.index, 10);
        var to = parseInt(card.dataset.index, 10);
        var moved = taskBuilderTasks.splice(from, 1)[0];
        taskBuilderTasks.splice(to, 0, moved);
        updateTasksUI();
    }

    window.aiGenerateTasks = function () {
        var desc = (document.getElementById('tb-project-description') || {}).value.trim();
        if (!desc) { if (window.showToast) window.showToast('Введите описание проекта для AI генерации', 'info'); document.getElementById('tb-project-description').focus(); return; }
        showLoadingOverlay('AI генерирует задачи...');
        fetch('/agents/api/tasks/generate/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify({ description: desc })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (data.success && data.tasks) {
                    data.tasks.forEach(function (t) {
                        taskBuilderTasks.push({ title: t.title || '', prompt: t.prompt || '', completion_promise: t.completion_promise || 'STEP_DONE', verify_prompt: t.verify_prompt || '', verify_promise: t.verify_promise || 'PASS', max_iterations: t.max_iterations || 5 });
                    });
                    updateTasksUI();
                } else if (window.showToast) window.showToast(data.error || 'Не удалось сгенерировать задачи', 'error');
            })
            .catch(function (e) { hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e.message || e), 'error'); });
    };

    function doSaveTaskBuilder(run, editingId) {
        var name = (document.getElementById('tb-workflow-name') || {}).value.trim() || 'New Workflow';
        var runtime = document.getElementById('tb-runtime').value;
        var projectSelect = document.getElementById('tb-project').value;
        var newName = (document.getElementById('tb-new-project-name') || {}).value.trim();
        var targetServerSelect = document.getElementById('tb-target-server');
        var targetServerId = targetServerSelect ? (targetServerSelect.value || null) : null;
        // Получаем модель workflow
        var workflowModelSelect = document.getElementById('tb-workflow-model');
        var workflowModel = workflowModelSelect ? (workflowModelSelect.value || 'auto') : 'auto';
        
        var valid = taskBuilderTasks.filter(function (t) { return t.title && t.prompt; });
        if (valid.length === 0) { if (window.showToast) window.showToast('Добавьте хотя бы одну задачу с названием и описанием', 'info'); return; }
        var btn = document.getElementById(run ? 'btn-save-run-workflow' : 'btn-save-workflow');
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        showLoadingOverlay('Сохранение workflow...');
        var allowModels = isModelSelectionAllowed();
        var payload = {
            name: name,
            runtime: runtime,
            model: 'auto',  // Workflow-level модель всегда auto
            steps: valid.map(function (t) {
                var step = { 
                    title: t.title, 
                    prompt: t.prompt, 
                    completion_promise: t.completion_promise || 'STEP_DONE', 
                    verify_prompt: t.verify_prompt || null, 
                    verify_promise: t.verify_prompt ? (t.verify_promise || 'PASS') : null, 
                    max_iterations: t.max_iterations || 5 
                };
                // Добавляем модель шага если разрешено и выбрана не auto
                if (allowModels && t.model && t.model !== 'auto') {
                    step.model = t.model;
                }
                return step;
            }),
            run_after_save: run,
            target_server_id: targetServerId ? parseInt(targetServerId, 10) : null
        };
        if (projectSelect === '__new__') { payload.create_new_project = true; payload.new_project_name = newName; } else payload.project_path = projectSelect;

        var url = editingId ? ('/agents/api/workflows/' + editingId + '/update/') : '/agents/api/workflows/create-manual/';
        var body = editingId ? { name: payload.name, runtime: payload.runtime, model: payload.model, steps: payload.steps, project_path: projectSelect === '__new__' ? '__new__' : projectSelect, new_project_name: newName, target_server_id: payload.target_server_id } : payload;

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (data.success) {
                    if (window.showToast) window.showToast('Workflow сохранён' + (data.workflow_id ? ' (ID: ' + data.workflow_id + ')' : ''), 'success');
                    var m = document.getElementById('taskBuilderModal');
                    if (m) delete m.dataset.editingWorkflowId;
                    closeTaskBuilder();
                    if (data.run_id) { 
                        openWorkflowLogs(data.run_id); 
                        setTimeout(function () { location.reload(); }, 1000); 
                    } else if (editingId && run) {
                        fetch('/agents/api/workflows/run/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) }, body: JSON.stringify({ workflow_id: parseInt(editingId, 10) }) })
                            .then(function (rr) { return rr.json(); })
                            .then(function (rd) {
                                if (rd.success && rd.run_id) { openWorkflowLogs(rd.run_id); setTimeout(function () { location.reload(); }, 1000); }
                                else setTimeout(function () { location.reload(); }, 500);
                            });
                    } else {
                        setTimeout(function () { location.reload(); }, 500);
                    }
                } else if (window.showToast) window.showToast(data.error || 'Не удалось сохранить workflow', 'error');
            })
            .catch(function (e) { hideLoadingOverlay(); if (window.showToast) window.showToast('Ошибка: ' + (e.message || e), 'error'); })
            .finally(function () { if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; } });
    }

    window.saveTaskBuilderWorkflow = function (run) {
        run = run === true;
        var m = document.getElementById('taskBuilderModal');
        var editingId = m && m.dataset.editingWorkflowId;
        if (editingId) doSaveTaskBuilder(run, editingId);
        else doSaveTaskBuilder(run, null);
    };

    window.saveAndRunTaskBuilderWorkflow = function () {
        saveTaskBuilderWorkflow(true);
    };

    function moveModalsToBody() {
        ['aiAnalysisModal', 'taskBuilderModal', 'workflowLogsModal', 'agentLogsModal', 'workflowScriptModal', 'profileModal', 'importModal', 'mcpToolsModal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.parentElement !== document.body) document.body.appendChild(el);
        });
    }

    /* ----- Model Selection ----- */
    var modelsCache = null;
    var modelsRecommendations = {};

    window.loadAvailableModels = function (callback) {
        if (modelsCache) {
            if (callback) callback(modelsCache);
            return;
        }
        fetch('/agents/api/models/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                modelsCache = data.models || [];
                modelsRecommendations = data.recommendations || {};
                if (callback) callback(modelsCache);
            })
            .catch(function (e) {
                console.error('Failed to load models:', e);
                // Fallback to default models
                modelsCache = [
                    { id: 'auto', name: 'Auto', description: 'Автоматический выбор' },
                    { id: 'gpt-5', name: 'GPT-5', description: 'Быстрая модель' },
                    { id: 'sonnet-4', name: 'Claude Sonnet 4', description: 'Сбалансированная модель' },
                    { id: 'sonnet-4-thinking', name: 'Claude Sonnet 4 Thinking', description: 'Для сложных задач' }
                ];
                if (callback) callback(modelsCache);
            });
    };

    window.populateModelSelector = function (selectId, selectedValue) {
        var select = document.getElementById(selectId);
        if (!select) return;
        loadAvailableModels(function (models) {
            select.innerHTML = models.map(function (m) {
                var selected = (m.id === selectedValue) ? ' selected' : '';
                return '<option value="' + m.id + '"' + selected + '>' + m.name + '</option>';
            }).join('');
        });
    };

    window.getModelRecommendation = function (complexity) {
        return modelsRecommendations[complexity] || 'auto';
    };

    /* ----- Smart Analysis ----- */
    window.smartAnalyzeTask = function (taskText, callback) {
        if (!taskText || !taskText.trim()) {
            if (callback) callback(null, 'Введите описание задачи');
            return;
        }
        showLoadingOverlay('Анализ задачи...');
        fetch('/agents/api/smart-analyze/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) },
            body: JSON.stringify({ task: taskText, use_llm: true })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                hideLoadingOverlay();
                if (data.error) {
                    if (callback) callback(null, data.error);
                } else {
                    if (callback) callback(data, null);
                }
            })
            .catch(function (e) {
                hideLoadingOverlay();
                if (callback) callback(null, e.message || 'Ошибка анализа');
            });
    };

    window.showSmartAnalysisResult = function (result, containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        
        var html = '<div class="smart-analysis-result bg-bg-surface/60 rounded-xl border border-white/10 p-4 space-y-3">';
        
        // Рекомендованная модель
        html += '<div class="flex items-center justify-between">';
        html += '<span class="text-gray-400 text-sm">Рекомендованная модель:</span>';
        html += '<span class="text-primary font-medium">' + (result.recommended_model || 'auto') + '</span>';
        html += '</div>';
        
        // Сложность
        var complexityColors = { simple: 'text-green-400', standard: 'text-yellow-400', complex: 'text-red-400', debug: 'text-purple-400' };
        var complexityLabels = { simple: 'Простая', standard: 'Стандартная', complex: 'Сложная', debug: 'Дебаг' };
        html += '<div class="flex items-center justify-between">';
        html += '<span class="text-gray-400 text-sm">Сложность:</span>';
        html += '<span class="' + (complexityColors[result.complexity] || 'text-gray-300') + '">' + (complexityLabels[result.complexity] || result.complexity) + '</span>';
        html += '</div>';
        
        // Тип задачи
        html += '<div class="flex items-center justify-between">';
        html += '<span class="text-gray-400 text-sm">Тип задачи:</span>';
        html += '<span class="text-gray-300">' + (result.task_type || 'unknown') + '</span>';
        html += '</div>';
        
        // Наводящие вопросы
        if (result.questions && result.questions.length > 0) {
            html += '<div class="border-t border-white/10 pt-3 mt-3">';
            html += '<div class="text-sm text-yellow-400 mb-2">Уточняющие вопросы:</div>';
            html += '<ul class="list-disc list-inside space-y-1">';
            result.questions.forEach(function (q) {
                html += '<li class="text-gray-300 text-sm">' + q + '</li>';
            });
            html += '</ul></div>';
        }
        
        // Предупреждения
        if (result.warnings && result.warnings.length > 0) {
            html += '<div class="border-t border-white/10 pt-3 mt-3">';
            html += '<div class="text-sm text-orange-400 mb-2">Предупреждения:</div>';
            result.warnings.forEach(function (w) {
                html += '<div class="text-orange-300 text-xs">' + w + '</div>';
            });
            html += '</div>';
        }
        
        // Подзадачи
        if (result.subtasks && result.subtasks.length > 0) {
            html += '<div class="border-t border-white/10 pt-3 mt-3">';
            html += '<div class="text-sm text-primary mb-2">Предложенные шаги (' + result.subtasks.length + '):</div>';
            html += '<div class="space-y-2">';
            result.subtasks.forEach(function (st, i) {
                html += '<div class="bg-white/5 rounded-lg p-2">';
                html += '<div class="flex items-center justify-between">';
                html += '<span class="text-white text-sm">' + (i + 1) + '. ' + st.title + '</span>';
                html += '<span class="text-xs text-gray-500">' + st.recommended_model + '</span>';
                html += '</div>';
                if (st.reasoning) {
                    html += '<div class="text-xs text-gray-400 mt-1">' + st.reasoning + '</div>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        }
        
        html += '</div>';
        container.innerHTML = html;
        container.classList.remove('hidden');
    };

    window.applySmartAnalysisToTaskBuilder = function (result) {
        if (!result || !result.subtasks || result.subtasks.length === 0) {
            if (window.showToast) window.showToast('Нет подзадач для применения', 'info');
            return;
        }
        
        // Очищаем текущие задачи или добавляем к ним
        if (taskBuilderTasks.length > 0) {
            if (!confirm('Добавить ' + result.subtasks.length + ' задач к существующим? (Отмена = заменить все)')) {
                taskBuilderTasks = [];
            }
        }
        
        result.subtasks.forEach(function (st) {
            taskBuilderTasks.push({
                title: st.title || '',
                prompt: st.prompt || '',
                completion_promise: st.completion_promise || 'STEP_DONE',
                verify_prompt: st.verify_prompt || '',
                verify_promise: st.verify_promise || 'PASS',
                max_iterations: st.max_iterations || 5,
                model: st.recommended_model || 'auto'
            });
        });
        
        updateTasksUI();
        
        // Устанавливаем рекомендованную модель для workflow
        var workflowModelSelect = document.getElementById('tb-workflow-model');
        if (workflowModelSelect && result.recommended_model) {
            workflowModelSelect.value = result.recommended_model;
        }
        
        if (window.showToast) window.showToast('Добавлено ' + result.subtasks.length + ' задач', 'success');
    };

    // Модель на уровне шага убрана - всегда используется auto

    /* ----- AI Analysis Wizard ----- */
    var wizardState = {
        originalTask: '',
        questions: [],
        answers: {},  // { questionIndex: answer }
        lastResult: null
    };
    
    window.openAiAnalysisModal = function () {
        var modal = document.getElementById('aiAnalysisModal');
        if (!modal) return;
        
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }
        
        // Сохраняем текст ДО сброса
        var tbDesc = document.getElementById('tb-project-description');
        var savedText = (tbDesc && tbDesc.value.trim()) ? tbDesc.value.trim() : '';
        
        // Закрываем Task Builder
        var taskBuilderModal = document.getElementById('taskBuilderModal');
        if (taskBuilderModal && !taskBuilderModal.classList.contains('hidden')) {
            taskBuilderModal.classList.add('hidden');
            taskBuilderModal.setAttribute('aria-hidden', 'true');
        }
        
        // Сбрасываем wizard
        resetWizard();
        
        // Восстанавливаем текст ПОСЛЕ сброса
        var analysisInput = document.getElementById('ai-analysis-task');
        if (analysisInput && savedText) {
            analysisInput.value = savedText;
        }
        
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        
        if (analysisInput) {
            setTimeout(function() { analysisInput.focus(); }, 100);
        }
    };
    
    window.closeAiAnalysisModal = function () {
        var modal = document.getElementById('aiAnalysisModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
    };
    
    function resetWizard() {
        wizardState = {
            originalTask: '',
            questions: [],
            answers: {},
            lastResult: null
        };
        
        showWizardStep('input');
        updateWizardProgress(0, 'Шаг 1: Задача');
        updateWizardStatus('Cursor CLI --mode=plan');
        
        var taskInput = document.getElementById('ai-analysis-task');
        if (taskInput) taskInput.value = '';
        
        var questionsEl = document.getElementById('ai-all-questions');
        if (questionsEl) questionsEl.innerHTML = '';
    }
    
    function showWizardStep(step) {
        var steps = ['input', 'questions', 'loading', 'result'];
        steps.forEach(function(s) {
            var el = document.getElementById('ai-step-' + s);
            if (el) el.classList.toggle('hidden', s !== step);
        });
        
        // Buttons
        var startBtn = document.getElementById('btn-wizard-start');
        var submitBtn = document.getElementById('btn-wizard-submit');
        var applyBtn = document.getElementById('btn-wizard-apply');
        
        if (startBtn) startBtn.classList.toggle('hidden', step !== 'input');
        if (submitBtn) submitBtn.classList.toggle('hidden', step !== 'questions');
        if (applyBtn) applyBtn.classList.toggle('hidden', step !== 'result');
    }
    
    function updateWizardProgress(percent, stepText) {
        var bar = document.getElementById('ai-wizard-progress');
        var stepEl = document.getElementById('ai-wizard-step');
        if (bar) bar.style.width = percent + '%';
        if (stepEl) stepEl.textContent = stepText;
    }
    
    function updateWizardStatus(text) {
        var el = document.getElementById('ai-wizard-status');
        if (el) el.textContent = text;
    }
    
    // Step 1: Start analysis
    window.wizardStart = function() {
        var taskInput = document.getElementById('ai-analysis-task');
        var taskText = taskInput ? taskInput.value.trim() : '';
        
        if (!taskText) {
            if (window.showToast) window.showToast('Введите описание задачи', 'info');
            if (taskInput) taskInput.focus();
            return;
        }
        
        wizardState.originalTask = taskText;
        
        showWizardStep('loading');
        updateWizardProgress(30, 'Анализ...');
        updateWizardStatus('AI анализирует задачу...');
        
        var loadingText = document.getElementById('ai-loading-text');
        var loadingHint = document.getElementById('ai-loading-hint');
        if (loadingText) loadingText.textContent = 'Анализируем задачу...';
        if (loadingHint) loadingHint.textContent = 'AI определяет что нужно уточнить';
        
        smartAnalyzeTask(taskText, function(result, error) {
            if (error) {
                showWizardStep('input');
                updateWizardProgress(0, 'Шаг 1: Задача');
                if (window.showToast) window.showToast(error, 'error');
                return;
            }
            
            wizardState.lastResult = result;
            
            // Если есть subtasks - задача понятна, сразу показываем результат
            if (result.subtasks && result.subtasks.length > 0) {
                showFinalResult();
                return;
            }
            
            // Если Cursor задал вопросы - показываем их
            wizardState.questions = result.questions || [];
            if (wizardState.questions.length > 0) {
                showAllQuestions();
            } else {
                // Нет ни subtasks ни questions - показываем warning
                if (result.warnings && result.warnings.length > 0) {
                    if (window.showToast) window.showToast(result.warnings[0], 'warning');
                } else {
                    if (window.showToast) window.showToast('AI не смог проанализировать задачу. Уточните описание.', 'warning');
                }
                showWizardStep('input');
                updateWizardProgress(0, 'Шаг 1: Задача');
            }
        });
    };
    
    // Show ALL questions at once
    function showAllQuestions() {
        var questionsEl = document.getElementById('ai-all-questions');
        if (!questionsEl) return;
        
        updateWizardProgress(50, 'Шаг 2: Вопросы (' + wizardState.questions.length + ')');
        updateWizardStatus('Ответьте на вопросы');
        
        var html = wizardState.questions.map(function(question, index) {
            var options = generateAnswerOptions(question);
            
            return '<div class="bg-bg-base border border-white/10 rounded-xl p-4" data-question-index="' + index + '">' +
                '<div class="flex items-start gap-3 mb-3">' +
                    '<div class="w-7 h-7 rounded-lg bg-accent/20 text-accent text-sm font-bold flex items-center justify-center flex-shrink-0">' + (index + 1) + '</div>' +
                    '<p class="text-sm text-white font-medium">' + question + '</p>' +
                '</div>' +
                '<div class="space-y-2 ml-10">' +
                    '<div class="grid grid-cols-2 gap-2">' +
                        options.map(function(opt, i) {
                            return '<button type="button" onclick="selectQuestionOption(' + index + ', ' + i + ', this)" ' +
                                'class="question-option text-left px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-300 hover:border-accent/50 hover:bg-accent/10 transition-all">' +
                                opt +
                            '</button>';
                        }).join('') +
                    '</div>' +
                    '<input type="text" class="question-answer w-full bg-bg-surface border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-accent/50" ' +
                        'placeholder="Или напишите свой ответ..." data-question="' + index + '" ' +
                        'onchange="updateQuestionAnswer(' + index + ', this.value)">' +
                '</div>' +
            '</div>';
        }).join('');
        
        questionsEl.innerHTML = html;
        showWizardStep('questions');
    }
    
    function generateAnswerOptions(question) {
        var q = question.toLowerCase();
        
        if (q.includes('авторизаци') || q.includes('аутентификаци') || q.includes('auth')) {
            return ['JWT токены', 'Session (cookies)', 'OAuth 2.0', 'Без авторизации'];
        }
        if (q.includes('база данных') || q.includes('бд') || q.includes('хранени') || q.includes('database')) {
            return ['PostgreSQL', 'SQLite', 'MySQL', 'MongoDB'];
        }
        if (q.includes('фреймворк') || q.includes('технологи') || q.includes('framework')) {
            return ['Django', 'FastAPI', 'Flask', 'Node.js'];
        }
        if (q.includes('тест') || q.includes('test')) {
            return ['Unit-тесты', 'Интеграционные', 'Минимум', 'Без тестов'];
        }
        if (q.includes('документаци') || q.includes('doc')) {
            return ['OpenAPI/Swagger', 'README', 'Комментарии', 'Без документации'];
        }
        if (q.includes('docker') || q.includes('контейнер') || q.includes('деплой') || q.includes('deploy')) {
            return ['Docker', 'Docker Compose', 'Kubernetes', 'Без контейнеров'];
        }
        if (q.includes('frontend') || q.includes('фронтенд') || q.includes('ui')) {
            return ['React', 'Vue.js', 'Vanilla JS', 'Без frontend'];
        }
        
        return ['Да', 'Нет', 'По умолчанию', 'На усмотрение AI'];
    }
    
    window.selectQuestionOption = function(questionIndex, optionIndex, btn) {
        // Снимаем выделение с других опций этого вопроса
        var container = btn.closest('[data-question-index]');
        if (container) {
            container.querySelectorAll('.question-option').forEach(function(b) {
                b.classList.remove('border-accent', 'bg-accent/20', 'text-white');
            });
        }
        
        // Выделяем выбранную
        btn.classList.add('border-accent', 'bg-accent/20', 'text-white');
        
        // Устанавливаем значение в input
        var input = container.querySelector('.question-answer');
        if (input) {
            input.value = btn.textContent.trim();
            wizardState.answers[questionIndex] = btn.textContent.trim();
        }
    };
    
    window.updateQuestionAnswer = function(questionIndex, value) {
        wizardState.answers[questionIndex] = value.trim();
        
        // Снимаем выделение с кнопок если ввели свой ответ
        var container = document.querySelector('[data-question-index="' + questionIndex + '"]');
        if (container && value.trim()) {
            container.querySelectorAll('.question-option').forEach(function(b) {
                b.classList.remove('border-accent', 'bg-accent/20', 'text-white');
            });
        }
    };
    
    // Submit all answers and build workflow
    window.wizardSubmitAnswers = function() {
        // Собираем ответы (не обязательно все)
        wizardState.questions.forEach(function(q, i) {
            var input = document.querySelector('.question-answer[data-question="' + i + '"]');
            if (input && input.value.trim()) {
                wizardState.answers[i] = input.value.trim();
            }
        });
        
        // Проверяем что хотя бы что-то ответили
        var hasAnyAnswer = Object.keys(wizardState.answers).length > 0;
        if (!hasAnyAnswer) {
            if (window.showToast) window.showToast('Ответьте хотя бы на один вопрос', 'info');
            return;
        }
        
        // Формируем полный контекст с ответами
        var fullContext = wizardState.originalTask + '\n\n--- Уточнения ---';
        wizardState.questions.forEach(function(q, i) {
            if (wizardState.answers[i]) {
                fullContext += '\n\n' + q + '\nОтвет: ' + wizardState.answers[i];
            }
        });
        
        showWizardStep('loading');
        updateWizardProgress(70, 'Создание...');
        updateWizardStatus('AI создаёт workflow...');
        
        var loadingText = document.getElementById('ai-loading-text');
        var loadingHint = document.getElementById('ai-loading-hint');
        if (loadingText) loadingText.textContent = 'Создаём workflow...';
        if (loadingHint) loadingHint.textContent = 'AI генерирует шаги на основе ваших ответов';
        
        // Повторный анализ с ответами
        smartAnalyzeTask(fullContext, function(result, error) {
            if (error) {
                showWizardStep('questions');
                updateWizardProgress(50, 'Вопросы');
                if (window.showToast) window.showToast(error, 'error');
                return;
            }
            
            wizardState.lastResult = result;
            
            // Если есть subtasks - показываем результат
            if (result.subtasks && result.subtasks.length > 0) {
                showFinalResult();
            } 
            // Если опять вопросы (редко) - показываем
            else if (result.questions && result.questions.length > 0) {
                wizardState.questions = result.questions;
                wizardState.answers = {};
                showAllQuestions();
            } 
            // Нет ни того ни другого - ошибка
            else {
                if (window.showToast) window.showToast('AI не смог создать план. Уточните задачу.', 'warning');
                showWizardStep('input');
                updateWizardProgress(0, 'Шаг 1: Задача');
            }
        });
    };
    
    function showFinalResult() {
        var result = wizardState.lastResult;
        if (!result) return;
        
        updateWizardProgress(100, 'Готово!');
        updateWizardStatus('Workflow создан');
        
        var complexityLabels = { simple: 'Простая', standard: 'Обычная', complex: 'Сложная', debug: 'Отладка' };
        
        var stepsEl = document.getElementById('ai-final-steps');
        var complexityEl = document.getElementById('ai-final-complexity');
        var modelEl = document.getElementById('ai-final-model');
        
        if (stepsEl) stepsEl.textContent = (result.subtasks || []).length;
        if (complexityEl) complexityEl.textContent = complexityLabels[result.complexity] || result.complexity;
        if (modelEl) modelEl.textContent = result.recommended_model || 'auto';
        
        var listEl = document.getElementById('ai-final-steps-list');
        if (listEl && result.subtasks) {
            listEl.innerHTML = result.subtasks.map(function(st, i) {
                return '<div class="flex items-center gap-3 p-2 bg-white/5 rounded-lg">' +
                    '<div class="w-6 h-6 rounded bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">' + (i + 1) + '</div>' +
                    '<div class="flex-1 min-w-0">' +
                        '<p class="text-sm text-white truncate">' + (st.title || 'Шаг ' + (i+1)) + '</p>' +
                    '</div>' +
                '</div>';
            }).join('');
        }
        
        showWizardStep('result');
    }
    
    // Apply and create workflow
    window.wizardApply = function() {
        if (!wizardState.lastResult) {
            if (window.showToast) window.showToast('Нет результатов', 'info');
            return;
        }
        
        closeAiAnalysisModal();
        
        // Open Task Builder
        var taskBuilderModal = document.getElementById('taskBuilderModal');
        if (taskBuilderModal) {
            taskBuilderModal.classList.remove('hidden');
            taskBuilderModal.setAttribute('aria-hidden', 'false');
        }
        
        // Clear existing tasks
        taskBuilderTasks = [];
        
        // Apply results
        applySmartAnalysisToTaskBuilder(wizardState.lastResult);
        
        // Set description with answers
        var tbDesc = document.getElementById('tb-project-description');
        if (tbDesc) {
            var desc = wizardState.originalTask;
            if (Object.keys(wizardState.answers).length > 0) {
                desc += '\n\n--- Уточнения ---';
                wizardState.questions.forEach(function(q, i) {
                    if (wizardState.answers[i]) {
                        desc += '\n• ' + q + ': ' + wizardState.answers[i];
                    }
                });
            }
            tbDesc.value = desc;
        }
        
        // Set name
        var tbName = document.getElementById('tb-workflow-name');
        if (tbName && !tbName.value.trim() && wizardState.lastResult.subtasks && wizardState.lastResult.subtasks.length > 0) {
            tbName.value = wizardState.lastResult.subtasks[0].title.substring(0, 50);
        }
        
        if (window.showToast) {
            window.showToast('Создано ' + (wizardState.lastResult.subtasks || []).length + ' шагов', 'success');
        }
    };
    
    /* ----- Legacy functions for compatibility ----- */
    var lastAnalysisResult = null;
    
    window.quickSmartAnalyze = function () {
        openAiAnalysisModal();
    };
    
    window.runAiAnalysis = function() { wizardStart(); };
    window.applyAiAnalysis = function() { wizardApply(); };
    
    /* ----- Quick Smart Analyze (legacy fallback) ----- */
    window.quickSmartAnalyze = function () {
        // Открываем модальное окно вместо inline анализа
        openAiAnalysisModal();
    };

    function showToastSafe(text, type) {
        if (window.showToast) {
            window.showToast(text, type || 'info');
        } else {
            alert(text);
        }
    }

    function activateHubTab(name) {
        var tabs = document.querySelectorAll('[data-hub-tab]');
        var panels = document.querySelectorAll('[data-hub-panel]');
        if (!tabs.length) return;
        tabs.forEach(function (btn) {
            var isActive = btn.getAttribute('data-hub-tab') === name;
            if (isActive) btn.classList.add('active'); else btn.classList.remove('active');
        });
        panels.forEach(function (panel) {
            var isActive = panel.getAttribute('data-hub-panel') === name;
            if (isActive) panel.classList.add('active'); else panel.classList.remove('active');
        });
        localStorage.setItem('agentHubTab', name);
    }
    window.activateHubTab = activateHubTab;

    function initHubTabs() {
        var tabs = document.querySelectorAll('[data-hub-tab]');
        if (!tabs.length) return;
        var active = localStorage.getItem('agentHubTab') || tabs[0].getAttribute('data-hub-tab');
        tabs.forEach(function (btn) {
            btn.addEventListener('click', function () {
                activateHubTab(btn.getAttribute('data-hub-tab'));
            });
        });
        activateHubTab(active);
    }

    function updateHubStats() {
        var agentsStat = document.getElementById('stat-agents');
        var webhooksStat = document.getElementById('stat-webhooks');
        var workflowsStat = document.getElementById('stat-workflows');
        var runsStat = document.getElementById('stat-runs');
        if (agentsStat) agentsStat.textContent = String(customAgents.length || 0);
        if (webhooksStat) webhooksStat.textContent = String(webhooksData.length || 0);
        if (workflowsStat && workflowsData) workflowsStat.textContent = String(workflowsData.length || 0);
        if (runsStat) {
            var wfRuns = document.querySelectorAll('.workflow-run-card').length || 0;
            var agentRuns = document.querySelectorAll('.agent-run-row').length || 0;
            runsStat.textContent = String(wfRuns + agentRuns);
        }
    }

    var AGENT_TOOLS = [
        {id: 'ssh_execute', name: 'SSH Execute'},
        {id: 'ssh_connect', name: 'SSH Connect'},
        {id: 'ssh_disconnect', name: 'SSH Disconnect'},
        {id: 'servers_list', name: 'Servers List'},
        {id: 'server_execute', name: 'Server Execute'},
        {id: 'read_file', name: 'Read File'},
        {id: 'write_file', name: 'Write File'},
        {id: 'list_directory', name: 'List Directory'},
        {id: 'create_directory', name: 'Create Directory'},
        {id: 'delete_file', name: 'Delete File'},
        {id: 'web_search', name: 'Web Search'},
        {id: 'fetch_webpage', name: 'Fetch Webpage'}
    ];

    function renderAgentTools(selected) {
        var container = document.getElementById('agent-editor-tools');
        if (!container) return;
        var selectedSet = new Set((selected || []).map(String));
        container.innerHTML = AGENT_TOOLS.map(function (tool) {
            var checked = selectedSet.has(String(tool.id)) ? 'checked' : '';
            return (
                '<label class="hub-tool">' +
                '<input type="checkbox" value="' + tool.id + '" ' + checked + ' />' +
                '<span>' + tool.name + '</span>' +
                '</label>'
            );
        }).join('');
    }

    function populateAgentServers(selected) {
        var select = document.getElementById('agent-editor-allowed-servers');
        if (!select) return;
        var selectedSet = new Set((selected || []).map(String));
        select.innerHTML = serversData.map(function (srv) {
            var isSelected = selectedSet.has(String(srv.id)) ? 'selected' : '';
            return '<option value="' + srv.id + '" ' + isSelected + '>' + srv.name + ' (' + srv.host + ')</option>';
        }).join('');
        renderAgentServerPicker();
    }

    function getServerGroups() {
        var groups = {};
        serversData.forEach(function (srv) {
            var gid = srv.group_id || 'ungrouped';
            if (!groups[gid]) {
                groups[gid] = {
                    id: srv.group_id,
                    name: srv.group_name || 'Без группы',
                    color: srv.group_color || ''
                };
            }
        });
        return Object.values(groups);
    }

    function getSelectedServerIds() {
        var select = document.getElementById('agent-editor-allowed-servers');
        if (!select) return [];
        return Array.from(select.selectedOptions || []).map(function (o) { return parseInt(o.value, 10); });
    }

    function setServerSelection(ids) {
        var select = document.getElementById('agent-editor-allowed-servers');
        if (!select) return;
        var idSet = new Set((ids || []).map(String));
        Array.from(select.options).forEach(function (opt) {
            opt.selected = idSet.has(String(opt.value));
        });
    }

    function renderAgentServerPicker() {
        var list = document.getElementById('agent-server-list');
        var chips = document.getElementById('agent-server-groups');
        var search = document.getElementById('agent-server-search');
        if (!list || !chips) return;

        var query = (search && search.value || '').trim().toLowerCase();
        var selectedIds = new Set(getSelectedServerIds().map(String));
        var grouped = {};

        serversData.forEach(function (srv) {
            var gid = srv.group_id || 'ungrouped';
            if (!grouped[gid]) grouped[gid] = [];
            grouped[gid].push(srv);
        });

        var groupList = getServerGroups();
        chips.innerHTML = groupList.map(function (g) {
            var gid = g.id || 'ungrouped';
            var servers = grouped[gid] || [];
            var allSelected = servers.length > 0 && servers.every(function (s) { return selectedIds.has(String(s.id)); });
            var cls = allSelected ? 'server-group-chip active' : 'server-group-chip';
            return '<button type="button" class="' + cls + '" data-group-id="' + gid + '">' + (g.name || 'Без группы') + '</button>';
        }).join('');

        chips.querySelectorAll('.server-group-chip').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var gid = btn.getAttribute('data-group-id');
                var servers = grouped[gid] || [];
                var allSelected = servers.length > 0 && servers.every(function (s) { return selectedIds.has(String(s.id)); });
                servers.forEach(function (srv) {
                    if (allSelected) {
                        selectedIds.delete(String(srv.id));
                    } else {
                        selectedIds.add(String(srv.id));
                    }
                });
                setServerSelection(Array.from(selectedIds).map(function (v) { return parseInt(v, 10); }));
                renderAgentServerPicker();
            });
        });

        list.innerHTML = serversData
            .filter(function (srv) {
                if (!query) return true;
                var hay = (srv.name + ' ' + srv.host + ' ' + (srv.group_name || '')).toLowerCase();
                return hay.indexOf(query) !== -1;
            })
            .map(function (srv) {
                var checked = selectedIds.has(String(srv.id)) ? 'checked' : '';
                var groupLabel = srv.group_name ? ('<div class="server-group-label">' + srv.group_name + '</div>') : '';
                return (
                    '<label class="server-item" data-id="' + srv.id + '">' +
                        '<span class="server-check"><input type="checkbox" ' + checked + '></span>' +
                        '<span class="server-meta">' +
                            '<span class="server-name">' + srv.name + '</span>' +
                            '<span class="server-host">' + srv.host + '</span>' +
                            groupLabel +
                        '</span>' +
                    '</label>'
                );
            }).join('');

        list.querySelectorAll('.server-item input[type=\"checkbox\"]').forEach(function (cb) {
            cb.addEventListener('change', function (e) {
                var id = cb.closest('.server-item').getAttribute('data-id');
                if (cb.checked) selectedIds.add(String(id)); else selectedIds.delete(String(id));
                setServerSelection(Array.from(selectedIds).map(function (v) { return parseInt(v, 10); }));
                renderAgentServerPicker();
            });
        });
    }

    function populateAgentSkills(selected) {
        var select = document.getElementById('agent-editor-skills');
        if (!select) return;
        var selectedSet = new Set((selected || []).map(String));
        select.innerHTML = (window._skillOptions || []).map(function (skill) {
            var isSelected = selectedSet.has(String(skill.id)) ? 'selected' : '';
            return '<option value="' + skill.id + '" ' + isSelected + '>' + skill.name + ' (v' + skill.version + ')</option>';
        }).join('');
    }

    function loadSkillOptions() {
        return fetch('/skills/api/options/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                window._skillOptions = data.skills || [];
                populateAgentSkills();
                populateWebhookSkills();
            })
            .catch(function () { window._skillOptions = []; });
    }

    function loadCustomAgents() {
        var list = document.getElementById('custom-agents-list');
        if (list) list.innerHTML = '<div class="hub-empty">Загрузка агентов...</div>';
        fetch('/agents/api/custom-agents/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                customAgents = data.agents || [];
                renderCustomAgents();
                if (!selectedAgentId && customAgents.length) {
                    selectAgent(customAgents[0].id);
                }
                updateHubStats();
            })
            .catch(function () {
                if (list) list.innerHTML = '<div class="hub-empty">Ошибка загрузки агентов</div>';
            });
    }

    function renderCustomAgents() {
        var list = document.getElementById('custom-agents-list');
        if (!list) return;
        if (!customAgents.length) {
            list.innerHTML = '<div class="hub-empty">Нет агентов. Создай первого.</div>';
            return;
        }

        var search = (document.getElementById('agent-search') || {}).value || '';
        var searchLower = search.trim().toLowerCase();
        var rows = customAgents.filter(function (agent) {
            if (!searchLower) return true;
            return (agent.name || '').toLowerCase().includes(searchLower) || (agent.description || '').toLowerCase().includes(searchLower);
        });

        if (!rows.length) {
            list.innerHTML = '<div class="hub-empty">Ничего не найдено.</div>';
            return;
        }

        list.innerHTML = rows.map(function (agent) {
            return (
                '<div class="hub-row">' +
                '<div>' +
                '<div class="hub-row__title">' + agent.name + '</div>' +
                '<div class="hub-row__meta">' + (agent.description || 'Нет описания') + '</div>' +
                '<div class="hub-row__meta">model: ' + agent.model + ' • runtime: ' + agent.runtime + '</div>' +
                '</div>' +
                '<div class="hub-row__actions">' +
                '<button class="hub-btn hub-btn-ghost" onclick="selectAgent(' + agent.id + ')">Select</button>' +
                '<button class="hub-btn hub-btn-ghost" onclick="openAgentRun(' + agent.id + ')">Run</button>' +
                '<button class="hub-btn hub-btn-ghost" onclick="openAgentEditor(' + agent.id + ')">Edit</button>' +
                '<button class="hub-btn hub-btn-ghost" onclick="exportAgent(' + agent.id + ')">Export</button>' +
                '<button class="hub-btn hub-btn-ghost" onclick="deleteAgent(' + agent.id + ')">Disable</button>' +
                '</div>' +
                '</div>'
            );
        }).join('');
    }

    function selectAgent(agentId) {
        selectedAgentId = agentId;
        var agent = customAgents.find(function (a) { return a.id === agentId; });
        var preview = document.getElementById('selected-agent-preview');
        if (!preview) return;
        if (!agent) {
            preview.innerHTML = '<div class="hub-empty">Агент не найден.</div>';
            return;
        }
        preview.innerHTML = (
            '<div class="hub-row">' +
            '<div>' +
            '<div class="hub-row__title">' + agent.name + '</div>' +
            '<div class="hub-row__meta">' + (agent.description || 'Нет описания') + '</div>' +
            '<div class="hub-row__meta">Skills: ' + (agent.skill_names || []).join(', ') + '</div>' +
            '</div>' +
            '<div class="hub-row__actions">' +
            '<button class="hub-btn hub-btn-ghost" onclick="openAgentRun(' + agent.id + ')">Run</button>' +
            '</div>' +
            '</div>'
        );
    }
    window.selectAgent = selectAgent;

    function openAgentEditor(agentId) {
        var modal = document.getElementById('agentEditorModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.getElementById('agent-editor-form').reset();
        renderAgentTools([]);
        populateAgentServers([]);
        populateAgentSkills([]);
        document.getElementById('agent-editor-id').value = '';
        document.getElementById('agent-editor-title').textContent = agentId ? 'Редактировать агента' : 'Новый агент';
        document.getElementById('agent-editor-all-servers').checked = true;
        document.getElementById('agent-editor-allowed-servers').disabled = true;

        if (agentId) {
            fetch('/agents/api/custom-agents/' + agentId + '/')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data.success) return;
                    var agent = data.agent || {};
                    document.getElementById('agent-editor-id').value = agent.id || '';
                    document.getElementById('agent-editor-name').value = agent.name || '';
                    document.getElementById('agent-editor-description').value = agent.description || '';
                    document.getElementById('agent-editor-system-prompt').value = agent.system_prompt || '';
                    document.getElementById('agent-editor-instructions').value = agent.instructions || '';
                    document.getElementById('agent-editor-knowledge-base').value = agent.knowledge_base || '';
                    document.getElementById('agent-editor-runtime').value = agent.runtime || 'claude';
                    document.getElementById('agent-editor-model').value = agent.model || 'claude-4.5-sonnet';
                    document.getElementById('agent-editor-orchestrator').value = agent.orchestrator_mode || 'ralph_internal';
                    document.getElementById('agent-editor-max-iterations').value = agent.max_iterations || 10;
                    document.getElementById('agent-editor-temperature').value = agent.temperature || 0.7;
                    document.getElementById('agent-editor-completion-promise').value = agent.completion_promise || 'COMPLETE';
                    document.getElementById('agent-editor-mcp-auto').checked = !!agent.mcp_auto_approve;

                    renderAgentTools(agent.allowed_tools || []);
                    populateAgentSkills(agent.skill_ids || []);
                    var allowedServers = agent.allowed_servers;
                    if (allowedServers === null || allowedServers === 'all' || typeof allowedServers === 'undefined') {
                        document.getElementById('agent-editor-all-servers').checked = true;
                        document.getElementById('agent-editor-allowed-servers').disabled = true;
                    } else {
                        document.getElementById('agent-editor-all-servers').checked = false;
                        document.getElementById('agent-editor-allowed-servers').disabled = false;
                        populateAgentServers(allowedServers || []);
                    }
                });
        }
    }
    window.openAgentEditor = openAgentEditor;

    window.applyAssistConfig = function () {
        var taskEl = document.getElementById('agent-assist-task');
        var task = (taskEl && taskEl.value) ? taskEl.value.trim() : '';
        if (!task) {
            if (window.showToast) window.showToast('Опишите задачу для AI', 'info');
            return;
        }
        var btn = document.getElementById('btn-agent-assist');
        if (btn) { btn.disabled = true; btn.textContent = 'Генерация...'; }
        fetch('/agents/api/assist-config/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' },
            body: JSON.stringify({ task: task })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    if (window.showToast) window.showToast(data.error || 'Ошибка генерации', 'error');
                    return;
                }
                var cfg = data.config || {};
                var questions = data.questions || [];
                var assumptions = data.assumptions || [];
                var nameEl = document.getElementById('agent-editor-name');
                var descEl = document.getElementById('agent-editor-description');
                var kbEl = document.getElementById('agent-editor-knowledge-base');
                var runtimeEl = document.getElementById('agent-editor-runtime');
                var maxIterEl = document.getElementById('agent-editor-max-iterations');
                if (nameEl) nameEl.value = cfg.name || '';
                if (descEl) descEl.value = cfg.description || '';
                var runtime = (cfg.runtime || '').toLowerCase();
                if (runtimeEl) {
                    if (runtime === 'ralph') runtimeEl.value = 'internal';
                    else if (runtime === 'cursor') runtimeEl.value = 'cursor';
                    else if (runtime === 'claude') runtimeEl.value = 'claude';
                    else runtimeEl.value = runtime || 'cursor';
                }
                var config = cfg.config || {};
                if (maxIterEl && config.max_iterations != null) maxIterEl.value = config.max_iterations;
                var parts = [];
                if (questions.length) parts.push('Уточняющие вопросы: ' + questions.join('; '));
                if (assumptions.length) parts.push('Предположения: ' + assumptions.join('; '));
                if (kbEl && parts.length) kbEl.value = parts.join('\n\n');
                if (window.showToast) window.showToast('Настройки подставлены. Проверьте и сохраните.', 'success');
            })
            .catch(function (e) {
                if (window.showToast) window.showToast('Ошибка: ' + (e.message || e), 'error');
            })
            .finally(function () {
                if (btn) { btn.disabled = false; btn.textContent = 'Предложить настройки'; }
            });
    };

    function closeAgentEditor() {
        var modal = document.getElementById('agentEditorModal');
        if (modal) modal.classList.add('hidden');
    }
    window.closeAgentEditor = closeAgentEditor;

    function saveAgent() {
        var agentId = document.getElementById('agent-editor-id').value;
        var allServers = document.getElementById('agent-editor-all-servers').checked;
        var allowedServers = allServers ? 'all' : Array.from(document.getElementById('agent-editor-allowed-servers').selectedOptions).map(function (o) { return parseInt(o.value, 10); });
        var tools = Array.from(document.querySelectorAll('#agent-editor-tools input[type=\"checkbox\"]:checked')).map(function (el) { return el.value; });
        var skills = Array.from(document.getElementById('agent-editor-skills').selectedOptions).map(function (o) { return parseInt(o.value, 10); });

        var payload = {
            name: document.getElementById('agent-editor-name').value,
            description: document.getElementById('agent-editor-description').value,
            system_prompt: document.getElementById('agent-editor-system-prompt').value,
            instructions: document.getElementById('agent-editor-instructions').value,
            knowledge_base: document.getElementById('agent-editor-knowledge-base').value,
            runtime: document.getElementById('agent-editor-runtime').value,
            model: document.getElementById('agent-editor-model').value,
            orchestrator_mode: document.getElementById('agent-editor-orchestrator').value,
            max_iterations: parseInt(document.getElementById('agent-editor-max-iterations').value || '10', 10),
            temperature: parseFloat(document.getElementById('agent-editor-temperature').value || '0.7'),
            completion_promise: document.getElementById('agent-editor-completion-promise').value || 'COMPLETE',
            mcp_auto_approve: document.getElementById('agent-editor-mcp-auto').checked,
            allowed_tools: tools,
            allowed_servers: allowedServers,
            skill_ids: skills
        };

        var url = agentId ? '/agents/api/custom-agents/' + agentId + '/' : '/agents/api/custom-agents/';
        var method = agentId ? 'PUT' : 'POST';

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToastSafe('Agent saved', 'success');
                    closeAgentEditor();
                    loadCustomAgents();
                } else {
                    showToastSafe(data.error || 'Failed to save agent', 'error');
                }
            })
            .catch(function (e) { showToastSafe('Error: ' + (e && e.message || e), 'error'); });
    }
    window.saveAgent = saveAgent;

    function deleteAgent(agentId) {
        if (!confirm('Disable this agent?')) return;
        fetch('/agents/api/custom-agents/' + agentId + '/', { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToastSafe('Agent disabled', 'success');
                    loadCustomAgents();
                } else {
                    showToastSafe(data.error || 'Failed to disable agent', 'error');
                }
            })
            .catch(function (e) { showToastSafe('Error: ' + (e && e.message || e), 'error'); });
    }
    window.deleteAgent = deleteAgent;

    function exportAgent(agentId) {
        fetch('/agents/api/custom-agents/' + agentId + '/export/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var blob = new Blob([JSON.stringify(data.config, null, 2)], {type: 'application/json'});
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = (data.config.name || 'agent').replace(/\\s+/g, '_') + '.agent.json';
                a.click();
                URL.revokeObjectURL(url);
            });
    }
    window.exportAgent = exportAgent;

    function openAgentRun(agentId) {
        var modal = document.getElementById('agentRunModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        var resolvedId = agentId || selectedAgentId;
        if (resolvedId) selectedAgentId = resolvedId;
        var agent = customAgents.find(function (a) { return a.id === resolvedId; });
        document.getElementById('agent-run-id').value = resolvedId || '';
        document.getElementById('agent-run-name').textContent = agent ? ('Agent: ' + agent.name) : 'Agent';
        document.getElementById('agent-run-task').value = '';
        document.getElementById('agent-run-auto').checked = true;
    }
    window.openAgentRun = openAgentRun;

    function closeAgentRun() {
        var modal = document.getElementById('agentRunModal');
        if (modal) modal.classList.add('hidden');
    }
    window.closeAgentRun = closeAgentRun;

    function submitAgentRun() {
        var agentId = document.getElementById('agent-run-id').value;
        var task = document.getElementById('agent-run-task').value;
        if (!agentId || !task.trim()) {
            showToastSafe('Agent and task are required', 'error');
            return;
        }
        var payload = {
            agent_id: parseInt(agentId, 10),
            task: task,
            server_id: document.getElementById('agent-run-server').value || null,
            project_path: document.getElementById('agent-run-project').value || '',
            runtime: document.getElementById('agent-run-runtime').value || '',
            auto_execute: document.getElementById('agent-run-auto').checked
        };
        fetch('/agents/api/custom-agents/run/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToastSafe('Agent run started', 'success');
                    closeAgentRun();
                } else {
                    showToastSafe(data.error || 'Failed to start run', 'error');
                }
            })
            .catch(function (e) { showToastSafe('Error: ' + (e && e.message || e), 'error'); });
    }
    window.submitAgentRun = submitAgentRun;

    function buildWebhookUrl(secret) {
        return window.location.origin.replace(/\/$/, '') + '/agents/api/webhooks/receive/' + secret + '/';
    }

    var WEBHOOK_PRESETS = {
        generic: {
            source: 'generic',
            server_field: '',
            event_id_field: 'event_id',
            event_name_field: '',
            event_name: 'Webhook Event',
            title_template: '{{webhook_name}}: {{event_name}}',
            description_template: '{{payload_json}}'
        },
        zabbix: {
            source: 'zabbix',
            server_field: 'host.name',
            event_id_field: 'event.id',
            event_name_field: 'trigger.name',
            event_name: 'Zabbix Event',
            title_template: 'Zabbix: {{trigger.name}} on {{host.name}}',
            description_template: 'Severity: {{trigger.severity}}\\nHost: {{host.name}}\\n\\n{{payload_json}}'
        },
        email: {
            source: 'email',
            server_field: '',
            event_id_field: 'message_id',
            event_name_field: 'subject',
            event_name: 'Email',
            title_template: 'Email: {{subject}}',
            description_template: 'From: {{from}}\\nTo: {{to}}\\n\\n{{text}}'
        },
        slack: {
            source: 'slack',
            server_field: '',
            event_id_field: 'event_id',
            event_name_field: 'event.type',
            event_name: 'Slack Event',
            title_template: 'Slack: {{event.type}}',
            description_template: '{{event.text}}\\n\\n{{payload_json}}'
        },
        jira: {
            source: 'jira',
            server_field: '',
            event_id_field: 'issue.id',
            event_name_field: 'webhookEvent',
            event_name: 'Jira Event',
            title_template: 'Jira: {{webhookEvent}}',
            description_template: '{{issue.key}} — {{issue.fields.summary}}\\n\\n{{payload_json}}'
        },
        github: {
            source: 'github',
            server_field: '',
            event_id_field: 'id',
            event_name_field: 'action',
            event_name: 'GitHub Event',
            title_template: 'GitHub: {{repository.full_name}} / {{event_name}}',
            description_template: '{{sender.login}}\\n\\n{{payload_json}}'
        },
        pagerduty: {
            source: 'pagerduty',
            server_field: '',
            event_id_field: 'event.id',
            event_name_field: 'event.event_type',
            event_name: 'PagerDuty Event',
            title_template: 'PagerDuty: {{event.event_type}}',
            description_template: '{{payload_json}}'
        }
    };

    function applyWebhookPreset(preset, options) {
        var def = WEBHOOK_PRESETS[preset];
        if (!def) return;
        var presetEl = document.getElementById('webhook-source-preset');
        var sourceEl = document.getElementById('webhook-source');
        var serverFieldEl = document.getElementById('webhook-server-field');
        var eventIdFieldEl = document.getElementById('webhook-event-id-field');
        var eventNameFieldEl = document.getElementById('webhook-event-name-field');
        var eventNameEl = document.getElementById('webhook-event-name');
        var titleTplEl = document.getElementById('webhook-title-template');
        var descTplEl = document.getElementById('webhook-description-template');

        if (options && options.setPreset && presetEl) presetEl.value = preset;
        if (sourceEl && def.source !== undefined) sourceEl.value = def.source;
        if (serverFieldEl && def.server_field !== undefined) serverFieldEl.value = def.server_field;
        if (eventIdFieldEl && def.event_id_field !== undefined) eventIdFieldEl.value = def.event_id_field;
        if (eventNameFieldEl && def.event_name_field !== undefined) eventNameFieldEl.value = def.event_name_field;
        if (eventNameEl && def.event_name !== undefined) eventNameEl.value = def.event_name;
        if (titleTplEl && def.title_template !== undefined) titleTplEl.value = def.title_template;
        if (descTplEl && def.description_template !== undefined) descTplEl.value = def.description_template;
    }

    function resetWebhookForm() {
        webhookEditingId = null;
        var nameEl = document.getElementById('webhook-name');
        var presetEl = document.getElementById('webhook-source-preset');
        var sourceEl = document.getElementById('webhook-source');
        var customAgentEl = document.getElementById('webhook-custom-agent');
        var agentTypeEl = document.getElementById('webhook-agent-type');
        var execModeEl = document.getElementById('webhook-execution-mode');
        var templateEl = document.getElementById('webhook-workflow-template');
        var targetServerEl = document.getElementById('webhook-target-server');
        var runtimeEl = document.getElementById('webhook-runtime');
        var serverFieldEl = document.getElementById('webhook-server-field');
        var eventIdFieldEl = document.getElementById('webhook-event-id-field');
        var eventNameFieldEl = document.getElementById('webhook-event-name-field');
        var eventNameEl = document.getElementById('webhook-event-name');
        var titleTplEl = document.getElementById('webhook-title-template');
        var descTplEl = document.getElementById('webhook-description-template');
        var verifyTplEl = document.getElementById('webhook-verify-prompt');
        var skillIdsEl = document.getElementById('webhook-skill-ids');
        var autoExecEl = document.getElementById('webhook-auto-execute');

        if (nameEl) nameEl.value = '';
        if (sourceEl) sourceEl.value = '';
        if (customAgentEl) customAgentEl.value = '';
        if (agentTypeEl) agentTypeEl.value = 'react';
        if (execModeEl) execModeEl.value = 'task';
        if (templateEl) templateEl.value = '';
        if (targetServerEl) targetServerEl.value = '';
        if (runtimeEl) runtimeEl.value = '';
        if (serverFieldEl) serverFieldEl.value = '';
        if (eventIdFieldEl) eventIdFieldEl.value = '';
        if (eventNameFieldEl) eventNameFieldEl.value = '';
        if (eventNameEl) eventNameEl.value = '';
        if (titleTplEl) titleTplEl.value = '';
        if (descTplEl) descTplEl.value = '';
        if (verifyTplEl) verifyTplEl.value = '';
        if (skillIdsEl) skillIdsEl.selectedIndex = -1;
        if (autoExecEl) autoExecEl.checked = true;
        applyWebhookPreset('generic', { setPreset: true });
        updateWebhookWorkflowFields();
    }

    function populateWebhookAgents() {
        var select = document.getElementById('webhook-custom-agent');
        if (!select) return;
        var current = select.value || '';
        var options = '<option value="">— not set —</option>';
        webhookAgents.forEach(function (agent) {
            options += '<option value="' + agent.id + '">' + agent.name + '</option>';
        });
        select.innerHTML = options;
        if (current) select.value = current;
    }

    function populateWebhookServers() {
        var select = document.getElementById('webhook-target-server');
        if (!select) return;
        var current = select.value || '';
        var options = '<option value="">auto by payload</option>';
        serversData.forEach(function (srv) {
            options += '<option value="' + srv.id + '">' + srv.name + ' (' + srv.host + ')</option>';
        });
        select.innerHTML = options;
        if (current) select.value = current;
    }

    function populateWebhookSkills() {
        var select = document.getElementById('webhook-skill-ids');
        if (!select) return;
        var current = Array.from(select.selectedOptions || []).map(function (o) { return String(o.value); });
        select.innerHTML = (window._skillOptions || []).map(function (skill) {
            var selected = current.includes(String(skill.id)) ? 'selected' : '';
            return '<option value="' + skill.id + '" ' + selected + '>' + skill.name + ' (v' + skill.version + ')</option>';
        }).join('');
    }

    function toggleWebhookForm(forceShow) {
        var form = document.getElementById('webhook-form');
        if (!form) return;
        var shouldShow = typeof forceShow === 'boolean' ? forceShow : form.classList.contains('hidden');
        if (shouldShow) {
            form.classList.remove('hidden');
            if (!webhookEditingId) resetWebhookForm();
        } else {
            form.classList.add('hidden');
        }
    }
    window.toggleWebhookForm = toggleWebhookForm;

    function openWebhookForm() {
        if (typeof activateHubTab === 'function') activateHubTab('automation');
        toggleWebhookForm(true);
        var form = document.getElementById('webhook-form');
        if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.openWebhookForm = openWebhookForm;

    function updateWebhookWorkflowFields() {
        var modeEl = document.getElementById('webhook-execution-mode');
        var extra = document.getElementById('webhook-workflow-extra');
        if (!modeEl || !extra) return;
        var isWorkflow = modeEl.value === 'workflow';
        if (isWorkflow) {
            extra.classList.remove('hidden');
        } else {
            extra.classList.add('hidden');
        }
    }

    function cancelWebhookForm() {
        toggleWebhookForm(false);
        resetWebhookForm();
    }
    window.cancelWebhookForm = cancelWebhookForm;

    function loadWebhookAgents() {
        fetch('/agents/api/custom-agents/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                webhookAgents = data.agents || [];
                populateWebhookAgents();
            })
            .catch(function () { webhookAgents = []; populateWebhookAgents(); });
    }

    function renderWebhooks(list) {
        var container = document.getElementById('webhooks-list');
        if (!container) return;
        if (!list || list.length === 0) {
            container.innerHTML = '<div class="text-gray-500 text-sm">No webhooks yet</div>';
            return;
        }
        container.innerHTML = list.map(function (hook) {
            var url = buildWebhookUrl(hook.secret);
            var statusClass = hook.is_active ? 'text-green-400' : 'text-gray-500';
            var statusText = hook.is_active ? 'active' : 'disabled';
            var autoText = hook.auto_execute ? 'auto' : 'manual';
            var modeText = hook.execution_mode || 'task';
            var templateText = (hook.config && hook.config.workflow_template) || '';
            var serverField = (hook.config && hook.config.server_field) || '';
            var titleTemplate = (hook.config && hook.config.title_template) || '';
            return (
                '<div class="bg-bg-surface/60 rounded-xl border border-white/5 p-3">' +
                    '<div class="flex items-center justify-between gap-2">' +
                        '<div>' +
                            '<div class="text-sm text-white">' + hook.name + '</div>' +
                            '<div class="text-[10px] text-gray-400">' + (hook.description || '') + '</div>' +
                        '</div>' +
                        '<div class="text-[10px] ' + statusClass + '">' + statusText + '</div>' +
                    '</div>' +
                    '<div class="text-[10px] text-gray-400 mt-2">source: ' + (hook.source || 'generic') + ' • ' + modeText + ' • ' + autoText + (templateText ? ' • ' + templateText : '') + '</div>' +
                    (serverField ? '<div class="text-[10px] text-gray-500 mt-1">server_field: ' + serverField + '</div>' : '') +
                    (titleTemplate ? '<div class="text-[10px] text-gray-500 mt-1">title: ' + titleTemplate + '</div>' : '') +
                    '<div class="mt-2 flex items-center gap-2 flex-wrap">' +
                        '<input class="w-full bg-bg-base border border-white/10 rounded-lg px-2 py-1 text-[10px] text-gray-300" readonly value="' + url + '">' +
                        '<button type="button" class="px-2 py-1 text-[10px] bg-white/10 text-gray-200 rounded webhook-copy" data-secret="' + hook.secret + '">Copy</button>' +
                        '<button type="button" onclick="editWebhook(' + hook.id + ')" class="px-2 py-1 text-[10px] bg-primary/20 text-primary rounded">Edit</button>' +
                        '<button type="button" onclick="deleteWebhook(' + hook.id + ')" class="px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded">Disable</button>' +
                    '</div>' +
                '</div>'
            );
        }).join('');
        attachWebhookCopyButtons();
    }

    function attachWebhookCopyButtons() {
        document.querySelectorAll('.webhook-copy').forEach(function (btn) {
            btn.onclick = function () {
                var secret = btn.getAttribute('data-secret') || '';
                if (secret) copyWebhookUrl(secret);
            };
        });
    }

    function loadWebhooks() {
        var container = document.getElementById('webhooks-list');
        if (container) container.innerHTML = '<div class="text-gray-500 text-sm">Загрузка...</div>';
        fetch('/agents/api/webhooks/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                webhooksData = data.webhooks || [];
                renderWebhooks(webhooksData);
                updateHubStats();
            })
            .catch(function (e) {
                console.error('Failed to load webhooks', e);
                if (container) container.innerHTML = '<div class="text-red-400 text-sm">Ошибка загрузки</div>';
            });
    }
    window.loadWebhooks = loadWebhooks;

    function copyWebhookUrl(secret) {
        var url = buildWebhookUrl(secret);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () {
                showToastSafe('Webhook URL copied', 'success');
            }).catch(function () {
                prompt('Webhook URL', url);
            });
        } else {
            prompt('Webhook URL', url);
        }
    }
    window.copyWebhookUrl = copyWebhookUrl;

    function getWebhookFormData() {
        var payload = {
            name: (document.getElementById('webhook-name') || {}).value || '',
            description: '',
            source: (document.getElementById('webhook-source') || {}).value || 'generic',
            custom_agent_id: (document.getElementById('webhook-custom-agent') || {}).value || '',
            agent_type: (document.getElementById('webhook-agent-type') || {}).value || 'react',
            execution_mode: (document.getElementById('webhook-execution-mode') || {}).value || 'task',
            auto_execute: !!((document.getElementById('webhook-auto-execute') || {}).checked),
            config: {}
        };

        var targetServer = (document.getElementById('webhook-target-server') || {}).value || '';
        var workflowTemplate = (document.getElementById('webhook-workflow-template') || {}).value || '';
        var runtime = (document.getElementById('webhook-runtime') || {}).value || '';
        var serverField = (document.getElementById('webhook-server-field') || {}).value || '';
        var eventIdField = (document.getElementById('webhook-event-id-field') || {}).value || '';
        var eventNameField = (document.getElementById('webhook-event-name-field') || {}).value || '';
        var eventName = (document.getElementById('webhook-event-name') || {}).value || '';
        var titleTpl = (document.getElementById('webhook-title-template') || {}).value || '';
        var descTpl = (document.getElementById('webhook-description-template') || {}).value || '';
        var verifyTpl = (document.getElementById('webhook-verify-prompt') || {}).value || '';
        var skillIds = Array.from((document.getElementById('webhook-skill-ids') || {}).selectedOptions || []).map(function (o) { return parseInt(o.value, 10); }).filter(Boolean);

        if (targetServer) payload.config.target_server_id = parseInt(targetServer, 10);
        if (workflowTemplate) payload.config.workflow_template = workflowTemplate;
        if (runtime) payload.config.runtime = runtime;
        if (serverField) payload.config.server_field = serverField;
        if (eventIdField) payload.config.event_id_field = eventIdField;
        if (eventNameField) payload.config.event_name_field = eventNameField;
        if (eventName) payload.config.event_name = eventName;
        if (titleTpl) payload.config.title_template = titleTpl;
        if (descTpl) payload.config.description_template = descTpl;
        if (verifyTpl) payload.config.verify_prompt = verifyTpl;
        if (skillIds.length) payload.config.skill_ids = skillIds;
        if (payload.custom_agent_id === '') payload.custom_agent_id = null;

        return payload;
    }

    function saveWebhook() {
        var payload = getWebhookFormData();
        if (!payload.name) {
            showToastSafe('Name is required', 'error');
            return;
        }

        var url = webhookEditingId ? '/agents/api/webhooks/' + webhookEditingId + '/' : '/agents/api/webhooks/';
        var method = webhookEditingId ? 'PUT' : 'POST';

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToastSafe('Webhook saved', 'success');
                    cancelWebhookForm();
                    loadWebhooks();
                } else {
                    showToastSafe(data.error || 'Failed to save webhook', 'error');
                }
            })
            .catch(function (e) {
                showToastSafe('Error: ' + (e && e.message || e), 'error');
            });
    }
    window.saveWebhook = saveWebhook;

    function editWebhook(id) {
        var hook = (webhooksData || []).filter(function (h) { return h.id === id; })[0];
        if (!hook) return;
        webhookEditingId = id;
        toggleWebhookForm(true);
        populateWebhookAgents();
        populateWebhookServers();

        var nameEl = document.getElementById('webhook-name');
        var presetEl = document.getElementById('webhook-source-preset');
        var sourceEl = document.getElementById('webhook-source');
        var customAgentEl = document.getElementById('webhook-custom-agent');
        var agentTypeEl = document.getElementById('webhook-agent-type');
        var execModeEl = document.getElementById('webhook-execution-mode');
        var templateEl = document.getElementById('webhook-workflow-template');
        var targetServerEl = document.getElementById('webhook-target-server');
        var runtimeEl = document.getElementById('webhook-runtime');
        var serverFieldEl = document.getElementById('webhook-server-field');
        var eventIdFieldEl = document.getElementById('webhook-event-id-field');
        var eventNameFieldEl = document.getElementById('webhook-event-name-field');
        var eventNameEl = document.getElementById('webhook-event-name');
        var titleTplEl = document.getElementById('webhook-title-template');
        var descTplEl = document.getElementById('webhook-description-template');
        var verifyTplEl = document.getElementById('webhook-verify-prompt');
        var skillIdsEl = document.getElementById('webhook-skill-ids');
        var autoExecEl = document.getElementById('webhook-auto-execute');

        if (nameEl) nameEl.value = hook.name || '';
        if (sourceEl) sourceEl.value = hook.source || '';
        if (presetEl) {
            var srcKey = (hook.source || '').toLowerCase();
            presetEl.value = WEBHOOK_PRESETS[srcKey] ? (srcKey || 'generic') : 'custom';
        }
        if (customAgentEl) customAgentEl.value = hook.custom_agent_id || '';
        if (agentTypeEl) agentTypeEl.value = hook.agent_type || 'react';
        if (execModeEl) execModeEl.value = hook.execution_mode || 'task';
        if (autoExecEl) autoExecEl.checked = !!hook.auto_execute;

        var cfg = hook.config || {};
        if (targetServerEl) targetServerEl.value = cfg.target_server_id || '';
        if (templateEl) templateEl.value = cfg.workflow_template || '';
        if (runtimeEl) runtimeEl.value = cfg.runtime || '';
        if (serverFieldEl) serverFieldEl.value = cfg.server_field || '';
        if (eventIdFieldEl) eventIdFieldEl.value = cfg.event_id_field || '';
        if (eventNameFieldEl) eventNameFieldEl.value = cfg.event_name_field || '';
        if (eventNameEl) eventNameEl.value = cfg.event_name || '';
        if (titleTplEl) titleTplEl.value = cfg.title_template || '';
        if (descTplEl) descTplEl.value = cfg.description_template || '';
        if (verifyTplEl) verifyTplEl.value = cfg.verify_prompt || '';
        if (skillIdsEl && cfg.skill_ids && Array.isArray(cfg.skill_ids)) {
            Array.from(skillIdsEl.options).forEach(function (opt) {
                opt.selected = cfg.skill_ids.includes(parseInt(opt.value, 10));
            });
        }
        updateWebhookWorkflowFields();
    }
    window.editWebhook = editWebhook;

    function deleteWebhook(id) {
        if (!confirm('Disable this webhook?')) return;
        fetch('/agents/api/webhooks/' + id + '/', { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToastSafe('Webhook disabled', 'success');
                    loadWebhooks();
                } else {
                    showToastSafe(data.error || 'Failed to disable', 'error');
                }
            })
            .catch(function (e) { showToastSafe('Error: ' + (e && e.message || e), 'error'); });
    }
    window.deleteWebhook = deleteWebhook;

    document.addEventListener('DOMContentLoaded', function () {
        setupProjectSelectors();
        toggleModelFields();
        startStatusUpdates();
        moveModalsToBody();
        refreshMcpServers();
        initHubTabs();
        loadSkillOptions();
        loadCustomAgents();
        loadWebhookAgents();
        populateWebhookServers();
        loadWebhooks();
        updateHubStats();
        renderAgentServerPicker();

        var agentSearch = document.getElementById('agent-search');
        if (agentSearch) {
            agentSearch.addEventListener('input', function () { renderCustomAgents(); });
        }
        var serverSearch = document.getElementById('agent-server-search');
        if (serverSearch) {
            serverSearch.addEventListener('input', function () {
                renderAgentServerPicker();
            });
        }
        var allServersToggle = document.getElementById('agent-editor-all-servers');
        if (allServersToggle) {
            allServersToggle.addEventListener('change', function () {
                var select = document.getElementById('agent-editor-allowed-servers');
                if (select) {
                    select.disabled = allServersToggle.checked;
                    if (!allServersToggle.checked && !select.options.length) {
                        populateAgentServers([]);
                    }
                }
                var picker = document.getElementById('agent-server-list');
                if (picker) {
                    if (allServersToggle.checked) picker.classList.add('disabled');
                    else picker.classList.remove('disabled');
                }
            });
            var pickerInit = document.getElementById('agent-server-list');
            if (pickerInit) {
                if (allServersToggle.checked) pickerInit.classList.add('disabled');
                else pickerInit.classList.remove('disabled');
            }
        }
        var webhookMode = document.getElementById('webhook-execution-mode');
        if (webhookMode) {
            webhookMode.addEventListener('change', updateWebhookWorkflowFields);
            updateWebhookWorkflowFields();
        }
        var webhookPreset = document.getElementById('webhook-source-preset');
        if (webhookPreset) {
            webhookPreset.addEventListener('change', function () {
                var val = webhookPreset.value || 'generic';
                if (val === 'custom') return;
                applyWebhookPreset(val, { setPreset: true });
            });
        }
        
        // Загружаем список моделей при старте
        loadAvailableModels();
        
        // Загружаем настройку выбора моделей
        if (localStorage.getItem('weu_allow_model_selection') === null) {
            fetch('/api/settings/', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.config && data.config.allow_model_selection !== undefined) {
                        localStorage.setItem('weu_allow_model_selection', data.config.allow_model_selection ? '1' : '0');
                    }
                })
                .catch(function() { localStorage.setItem('weu_allow_model_selection', '0'); });
        }
    });
})();
