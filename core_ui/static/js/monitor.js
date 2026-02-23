/**
 * AI Monitor - Unified monitoring dashboard for agent and workflow runs
 */
(function() {
    'use strict';

    const app = document.getElementById('monitorApp');
    if (!app) return;
    const TAB_STORAGE_KEY = 'monitor.activeTab';
    const LOG_UI_STORAGE_KEY = 'monitor.logsUi';
    const DEFAULT_TAB = 'overview';

    // State
    const state = {
        runs: [],
        currentRun: null,
        events: [],
        lastEventId: 0,
        adminData: null,
        selectedStepIdx: null,
        autoScroll: true,
        liveUpdates: true,
        filter: 'all',
        search: '',
        visibleLogGroups: [],
        pollInterval: null,
        activeTab: DEFAULT_TAB,
        logsUi: {
            wrap: true,
            compact: false,
            expandAll: false
        }
    };

    // DOM Elements
    const els = {
        // Header
        connectionStatus: document.getElementById('connectionStatus'),
        statRunning: document.getElementById('statRunning'),
        statTotal: document.getElementById('statTotal'),
        statSucceeded: document.getElementById('statSucceeded'),
        statFailed: document.getElementById('statFailed'),
        btnRefresh: document.getElementById('btnRefresh'),
        btnLive: document.getElementById('btnLive'),

        // Sidebar
        sidebar: document.getElementById('monitorSidebar'),
        sidebarCollapseBtn: document.getElementById('sidebarCollapseBtn'),
        filterSearch: document.getElementById('filterSearch'),
        filterType: document.getElementById('filterType'),
        filterStatus: document.getElementById('filterStatus'),
        runsList: document.getElementById('runsList'),
        runsEmpty: document.getElementById('runsEmpty'),
        runsMeta: document.getElementById('runsMeta'),

        // Run detail (new header: agent, task, status)
        runAgentName: document.getElementById('runAgentName'),
        runTaskPreview: document.getElementById('runTaskPreview'),
        runBadge: document.getElementById('runBadge'),
        runMetaTime: document.getElementById('runMetaTime'),
        runActions: document.getElementById('runActions'),
        runTypeMeta: document.getElementById('runTypeMeta'),
        runRuntimeMeta: document.getElementById('runRuntimeMeta'),
        runEventsMeta: document.getElementById('runEventsMeta'),
        runUpdatedMeta: document.getElementById('runUpdatedMeta'),

        // Overview tab
        overviewTaskText: document.getElementById('overviewTaskText'),
        overviewCommandText: document.getElementById('overviewCommandText'),
        overviewOutputText: document.getElementById('overviewOutputText'),

        // Logs
        logsContainer: document.getElementById('logsContainer'),
        logsTimeline: document.getElementById('logsTimeline'),
        logsEmpty: document.getElementById('logsEmpty'),
        logsSearch: document.getElementById('logsSearch'),
        btnCopyLogs: document.getElementById('btnCopyLogs'),
        btnCopyVisibleLogs: document.getElementById('btnCopyVisibleLogs'),
        btnExpandLogs: document.getElementById('btnExpandLogs'),
        btnWrapLogs: document.getElementById('btnWrapLogs'),
        btnCompactLogs: document.getElementById('btnCompactLogs'),
        btnAutoScroll: document.getElementById('btnAutoScroll'),
        logsVisibleCount: document.getElementById('logsVisibleCount'),
        logsTotalCount: document.getElementById('logsTotalCount'),
        logsLastEventId: document.getElementById('logsLastEventId'),

        // Command
        commandText: document.getElementById('commandText'),
        promptText: document.getElementById('promptText'),

        // Config
        configText: document.getElementById('configText'),
        mcpText: document.getElementById('mcpText'),
        envText: document.getElementById('envText'),

        // Raw
        rawOutput: document.getElementById('rawOutput'),
        btnCopyRaw: document.getElementById('btnCopyRaw'),

        // Workflow steps
        workflowSteps: document.getElementById('workflowSteps'),
        stepsMeta: document.getElementById('stepsMeta'),
        stepsList: document.getElementById('stepsList'),

        // Pipeline tab
        pipelineCanvas: document.getElementById('pipelineCanvas'),
        pipelineEmpty: document.getElementById('pipelineEmpty'),
        stepDetailPanel: document.getElementById('stepDetailPanel'),
        stepDetailTitle: document.getElementById('stepDetailTitle'),
        stepDetailPrompt: document.getElementById('stepDetailPrompt'),
        stepDetailCmd: document.getElementById('stepDetailCmd'),
        stepDetailOutput: document.getElementById('stepDetailOutput'),
        stepDetailActions: document.getElementById('stepDetailActions'),
        stepDetailClose: document.getElementById('stepDetailClose')
    };

    // Utilities
    function getCsrfToken() {
        const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
        return cookie ? cookie.split('=')[1] : '';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function formatTime(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function showToast(msg, type = 'info') {
        if (window.showToast) {
            window.showToast(msg, type);
        } else {
            console.log(`[${type}] ${msg}`);
        }
    }

    function escapeRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function readLogsUiState() {
        try {
            const raw = localStorage.getItem(LOG_UI_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || !parsed) return;
            state.logsUi.wrap = parsed.wrap !== false;
            state.logsUi.compact = Boolean(parsed.compact);
            state.logsUi.expandAll = Boolean(parsed.expandAll);
        } catch (e) {
            // Ignore malformed persisted state
        }
    }

    function persistLogsUiState() {
        try {
            localStorage.setItem(LOG_UI_STORAGE_KEY, JSON.stringify(state.logsUi));
        } catch (e) {
            // Ignore storage failures
        }
    }

    function applyLogsUiState() {
        if (els.logsContainer) {
            els.logsContainer.classList.toggle('logs-nowrap', !state.logsUi.wrap);
            els.logsContainer.classList.toggle('logs-compact', state.logsUi.compact);
        }
        if (els.btnWrapLogs) els.btnWrapLogs.classList.toggle('active', state.logsUi.wrap);
        if (els.btnCompactLogs) els.btnCompactLogs.classList.toggle('active', state.logsUi.compact);
        if (els.btnExpandLogs) {
            els.btnExpandLogs.classList.toggle('active', state.logsUi.expandAll);
            els.btnExpandLogs.textContent = state.logsUi.expandAll ? 'Collapse all' : 'Expand all';
        }
        if (els.btnAutoScroll) els.btnAutoScroll.classList.toggle('active', state.autoScroll);
    }

    function setConnectionStatus(connected) {
        const statusEl = els.connectionStatus;
        if (!statusEl) return;
        if (connected) {
            statusEl.classList.add('connected');
            statusEl.querySelector('.status-text').textContent = 'Connected';
        } else {
            statusEl.classList.remove('connected');
            statusEl.querySelector('.status-text').textContent = 'Connecting...';
        }
    }

    function statusDisplay(status) {
        const names = {
            running: 'Running',
            succeeded: 'Succeeded',
            failed: 'Failed',
            paused: 'Paused',
            cancelled: 'Cancelled',
            queued: 'Queued'
        };
        return names[status] || (status ? String(status) : 'Unknown');
    }

    function runTypeLabel(type) {
        return type === 'workflow' ? 'Workflow' : 'Agent Run';
    }

    function getLastUpdateTimestamp(statusData, adminData) {
        const details = adminData?.details || {};
        const lastEvent = state.events && state.events.length ? state.events[state.events.length - 1] : null;
        return lastEvent?.ts || details.updated_at || details.finished_at || details.started_at || statusData?.updated_at || statusData?.finished_at || statusData?.started_at || '';
    }

    function updateRunInsights(statusData, adminData) {
        if (!state.currentRun) {
            if (els.runTypeMeta) els.runTypeMeta.textContent = '—';
            if (els.runRuntimeMeta) els.runRuntimeMeta.textContent = '—';
            if (els.runEventsMeta) els.runEventsMeta.textContent = '0';
            if (els.runUpdatedMeta) els.runUpdatedMeta.textContent = '—';
            return;
        }

        const details = adminData?.details || {};
        const runtime = details.runtime || statusData?.runtime || '';
        const updatedTs = getLastUpdateTimestamp(statusData, adminData);

        if (els.runTypeMeta) els.runTypeMeta.textContent = runTypeLabel(state.currentRun.type);
        if (els.runRuntimeMeta) els.runRuntimeMeta.textContent = runtime ? runtimeDisplayName(runtime) : '—';
        if (els.runEventsMeta) els.runEventsMeta.textContent = String(state.events?.length || 0);
        if (els.runUpdatedMeta) els.runUpdatedMeta.textContent = updatedTs ? formatTime(updatedTs) : '—';
    }

    function updateRunsMeta() {
        if (!els.runsMeta) return;
        const running = state.runs.filter(r => r.status === 'running').length;
        const summary = `${state.runs.length} runs • ${running} running`;
        const hasFilters = Boolean(els.filterSearch?.value?.trim()) || (els.filterType?.value && els.filterType.value !== 'all') || (els.filterStatus?.value && els.filterStatus.value !== 'all');
        els.runsMeta.textContent = hasFilters ? `${summary} • filtered` : summary;
    }

    function updateRunStats() {
        const running = state.runs.filter(r => r.status === 'running').length;
        const succeeded = state.runs.filter(r => r.status === 'succeeded').length;
        const failed = state.runs.filter(r => r.status === 'failed').length;

        if (els.statRunning) els.statRunning.textContent = String(running);
        if (els.statTotal) els.statTotal.textContent = String(state.runs.length);
        if (els.statSucceeded) els.statSucceeded.textContent = String(succeeded);
        if (els.statFailed) els.statFailed.textContent = String(failed);
        updateRunsMeta();
    }

    // API Calls
    async function fetchRuns() {
        try {
            const params = new URLSearchParams();
            const search = els.filterSearch?.value?.trim();
            const type = els.filterType?.value;
            const status = els.filterStatus?.value;

            if (search) params.set('q', search);
            if (type && type !== 'all') params.set('type', type);
            if (status && status !== 'all') params.set('status', status);

            const url = '/agents/admin/api/runs/' + (params.toString() ? '?' + params.toString() : '');
            const res = await fetch(url);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            state.runs = data.items || [];

            setConnectionStatus(true);
            updateRunStats();
            renderRunsList();
        } catch (e) {
            console.error('Failed to fetch runs:', e);
            setConnectionStatus(false);
            state.runs = [];
            updateRunStats();
            renderRunsList();
        }
    }

    async function fetchRunStatus(runType, runId) {
        try {
            const url = runType === 'workflow'
                ? `/agents/api/workflows/run/${runId}/status/`
                : `/agents/api/runs/${runId}/status/`;

            const params = state.lastEventId ? `?after_id=${state.lastEventId}` : '';
            const res = await fetch(url + params);

            if (res.status === 404) {
                showToast(`Run #${runId} not found`, 'error');
                state.currentRun = null;
                return null;
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            return data;
        } catch (e) {
            console.error('Failed to fetch run status:', e);
            return null;
        }
    }

    async function fetchAdminRunStatus(runType, runId) {
        try {
            const url = runType === 'workflow'
                ? `/agents/admin/api/workflows/run/${runId}/status/`
                : `/agents/admin/api/runs/${runId}/status/`;

            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            return await res.json();
        } catch (e) {
            console.error('Failed to fetch admin run status:', e);
            return null;
        }
    }

    // Render Functions
    function renderRunsList() {
        if (!els.runsList) return;

        if (!state.runs.length) {
            els.runsList.innerHTML = '';
            els.runsEmpty?.classList.remove('hidden');
            return;
        }

        els.runsEmpty?.classList.add('hidden');

        els.runsList.innerHTML = state.runs.map(run => {
            const isActive = state.currentRun &&
                state.currentRun.type === run.type &&
                state.currentRun.id === run.id;

            const statusIcon = getStatusIcon(run.status);
            const label = run.type === 'workflow' ? `W#${run.id}` : `R#${run.id}`;
            const runtimeBadge = run.runtime ? `<span class="run-item-runtime">${escapeHtml(run.runtime)}</span>` : '';
            const title = escapeHtml((run.title || run.runtime || '-').slice(0, 150));
            const timeStr = run.created_at ? formatTime(run.created_at) : '';
            const status = statusDisplay(run.status);

            return `
                <button class="run-item ${isActive ? 'active' : ''} status-${run.status}"
                        data-id="${run.id}" data-type="${run.type}">
                    <div class="run-item-header">
                        <span class="run-item-label">${label}</span>
                        ${runtimeBadge}
                        <span class="run-item-status">${statusIcon}</span>
                    </div>
                    <div class="run-item-title run-item-title-wrap">${title}</div>
                    <div class="run-item-meta">
                        <span>${escapeHtml(status)}</span>
                        ${timeStr ? `<span>• ${timeStr}</span>` : ''}
                        <span>${escapeHtml(run.user || '-')}</span>
                    </div>
                </button>
            `;
        }).join('');
    }

    function getStatusIcon(status) {
        const icons = {
            running: '●',
            succeeded: '✓',
            failed: '✗',
            paused: '⏸',
            cancelled: '⊘',
            queued: '○'
        };
        return icons[status] || '○';
    }

    function runtimeDisplayName(runtime) {
        const names = { cursor: 'Cursor CLI', claude: 'Claude Code CLI', ralph: 'Ralph', codex: 'Codex CLI', gemini: 'Gemini', internal: 'Internal' };
        return names[runtime] || runtime || '—';
    }

    function renderRunDetail(statusData, adminData) {
        if (!state.currentRun) {
            if (els.runAgentName) els.runAgentName.textContent = '—';
            if (els.runTaskPreview) els.runTaskPreview.textContent = 'Выберите run в боковой панели';
            if (els.runBadge) els.runBadge.textContent = '—';
            if (els.runMetaTime) els.runMetaTime.textContent = '';
            if (els.runActions) els.runActions.innerHTML = '';
            updateRunInsights(null, null);
            renderPipeline(null, 0, null);
            return;
        }

        const details = (adminData && adminData.details) || {};
        const status = statusData?.status || details.status || 'unknown';
        const runtime = details.runtime || statusData?.runtime || '';
        const profile = details.profile || '';
        const agentName = profile || runtimeDisplayName(runtime);

        if (els.runAgentName) els.runAgentName.textContent = agentName;
        const taskPreview = details.input_prompt_full || adminData?.prompt || statusData?.prompt || '';
        if (els.runTaskPreview) els.runTaskPreview.textContent = taskPreview ? (taskPreview.length > 200 ? taskPreview.slice(0, 200) + '…' : taskPreview) : '—';

        if (els.runBadge) {
            els.runBadge.textContent = status;
            els.runBadge.className = `run-detail-badge status-${status}`;
        }

        const timeParts = [];
        if (details.started_at) timeParts.push('Старт: ' + formatTime(details.started_at));
        if (details.finished_at) timeParts.push('Конец: ' + formatTime(details.finished_at));
        if (els.runMetaTime) els.runMetaTime.textContent = timeParts.join(' • ') || '';

        renderRunActions(status);
        updateRunInsights(statusData, adminData);

        const steps = details.steps || statusData?.steps;
        const currentStep = details.current_step ?? statusData?.current_step ?? 0;
        if (state.currentRun.type === 'workflow' && steps && steps.length) {
            renderWorkflowSteps(steps, currentStep);
            renderPipeline(steps, currentStep, status);
            if (els.workflowSteps) els.workflowSteps.classList.remove('hidden');
        } else {
            renderPipeline(null, 0, null);
            if (els.workflowSteps) els.workflowSteps.classList.add('hidden');
        }
    }

    function renderRunActions(status) {
        let html = '';

        if (status === 'running') {
            html = `<button class="action-btn danger" data-action="stop">Stop</button>`;
        } else if (status === 'failed' || status === 'paused') {
            html = `
                <button class="action-btn warning" data-action="retry">Retry</button>
                <button class="action-btn" data-action="skip">Skip</button>
                <button class="action-btn success" data-action="continue">Continue</button>
            `;
        }

        els.runActions.innerHTML = html;
    }

    function renderWorkflowSteps(steps, currentStep) {
        if (!steps || !steps.length) {
            els.stepsList.innerHTML = '<p class="no-steps">No steps defined</p>';
            els.stepsMeta.textContent = '0/0';
            return;
        }

        els.stepsMeta.textContent = `${currentStep}/${steps.length}`;

        els.stepsList.innerHTML = steps.map((step, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum === currentStep;
            const isDone = stepNum < currentStep;
            const status = step.status || (isDone ? 'completed' : (isActive ? 'running' : 'pending'));

            return `
                <div class="step-item status-${status} ${isActive ? 'active' : ''}">
                    <div class="step-number">${stepNum}</div>
                    <div class="step-content">
                        <div class="step-title">${escapeHtml(step.title || `Step ${stepNum}`)}</div>
                        ${step.prompt ? `<div class="step-desc">${escapeHtml(step.prompt.substring(0, 100))}...</div>` : ''}
                    </div>
                    <div class="step-status-icon">${getStatusIcon(status)}</div>
                </div>
            `;
        }).join('');
    }

    function getPipelineStepStatus(step, stepNum, currentStep, runStatus) {
        if (step.status) return step.status;
        if (stepNum < currentStep) return 'completed';
        if (stepNum === currentStep) {
            if (runStatus === 'running') return 'running';
            if (runStatus === 'failed' || runStatus === 'paused') return 'failed';
            return 'running';
        }
        return 'pending';
    }

    function renderPipeline(steps, currentStep, runStatus) {
        if (!els.pipelineCanvas) return;
        if (!steps || !steps.length) {
            if (els.pipelineEmpty) els.pipelineEmpty.classList.remove('hidden');
            els.pipelineCanvas.querySelectorAll('.pipeline-node, .pipeline-arrow').forEach(n => n.remove());
            return;
        }
        if (els.pipelineEmpty) els.pipelineEmpty.classList.add('hidden');

        const statusLabels = { pending: '○', running: '●', completed: '✓', failed: '✗', skipped: '⊘' };
        const fragment = document.createDocumentFragment();

        steps.forEach((step, idx) => {
            const stepNum = idx + 1;
            const nodeStatus = getPipelineStepStatus(step, stepNum, currentStep, runStatus);
            const icon = statusLabels[nodeStatus] || '○';

            if (idx > 0) {
                const arrow = document.createElement('div');
                arrow.className = 'pipeline-arrow';
                arrow.innerHTML = '<svg viewBox="0 0 24 12" class="pipeline-arrow-svg"><path d="M0 6 L18 6 M14 2 L18 6 L14 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
                fragment.appendChild(arrow);
            }

            const node = document.createElement('button');
            node.type = 'button';
            node.className = `pipeline-node status-${nodeStatus}`;
            node.dataset.stepIdx = stepNum;
            node.innerHTML = `
                <span class="pipeline-node-icon">${icon}</span>
                <span class="pipeline-node-num">${stepNum}</span>
                <span class="pipeline-node-title">${escapeHtml(step.title || `Шаг ${stepNum}`)}</span>
            `;
            fragment.appendChild(node);
        });

        els.pipelineCanvas.querySelectorAll('.pipeline-node, .pipeline-arrow').forEach(n => n.remove());
        els.pipelineCanvas.appendChild(fragment);

        els.pipelineCanvas.querySelectorAll('.pipeline-node').forEach(btn => {
            btn.addEventListener('click', () => selectStep(parseInt(btn.dataset.stepIdx, 10)));
        });
    }

    function selectStep(stepIdx) {
        state.selectedStepIdx = stepIdx;
        if (els.stepDetailPanel) els.stepDetailPanel.classList.remove('hidden');
        renderStepDetailPanel(stepIdx);
    }

    function closeStepDetail() {
        state.selectedStepIdx = null;
        if (els.stepDetailPanel) els.stepDetailPanel.classList.add('hidden');
    }

    function renderStepDetailPanel(stepIdx) {
        if (!els.stepDetailTitle || !els.stepDetailPrompt || !els.stepDetailCmd || !els.stepDetailOutput || !els.stepDetailActions) return;
        const details = state.adminData?.details || {};
        const meta = details.meta || {};
        const steps = details.steps || state.adminData?.details?.steps || [];
        const step = steps.find(s => s.idx === stepIdx) || {};
        const runStatus = state.adminData?.details?.status;

        els.stepDetailTitle.textContent = `Шаг ${stepIdx}: ${step.title || ''}`;
        const prompt = meta[`step_${stepIdx}_prompt`] || step.prompt || '—';
        els.stepDetailPrompt.textContent = typeof prompt === 'string' ? prompt : '—';
        const cmd = meta[`step_${stepIdx}_cmd`] || step.cmd;
        els.stepDetailCmd.textContent = formatCliCommand(cmd);

        let outputText = '—';
        if (state.events && state.events.length) {
            const cmdOutputs = state.events.filter(e => e.type === 'cmd_output').map(e => e.message || '');
            if (cmdOutputs.length) outputText = cmdOutputs.slice(-25).join('\n');
        }
        if (outputText === '—' && state.adminData && (state.adminData.logs || state.adminData.output)) {
            const raw = (state.adminData.logs || state.adminData.output || '').trim().split('\n');
            outputText = raw.slice(-25).join('\n') || '—';
        }
        els.stepDetailOutput.textContent = outputText;

        let actionsHtml = '';
        const isCurrent = (details.current_step ?? 0) === stepIdx;
        if (runStatus === 'running') {
            actionsHtml = '<button type="button" class="action-btn danger step-action" data-action="stop">Stop</button>';
        } else if (runStatus === 'failed' || runStatus === 'paused') {
            if (isCurrent) {
                actionsHtml = `
                    <button type="button" class="action-btn warning step-action" data-action="retry">Retry</button>
                    <button type="button" class="action-btn step-action" data-action="skip">Skip</button>
                `;
            }
            actionsHtml += `<button type="button" class="action-btn success step-action" data-action="continue" data-from-step="${stepIdx}">Continue from here</button>`;
        }
        actionsHtml += `<button type="button" class="action-btn step-action" data-action="edit-prompt" data-step-idx="${stepIdx}">Edit prompt</button>`;
        els.stepDetailActions.innerHTML = actionsHtml;

        els.stepDetailActions.querySelectorAll('.step-action').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const fromStep = btn.dataset.fromStep ? parseInt(btn.dataset.fromStep, 10) : null;
                const stepIdxForEdit = btn.dataset.stepIdx ? parseInt(btn.dataset.stepIdx, 10) : null;
                if (action === 'edit-prompt') {
                    editStepPrompt(stepIdxForEdit);
                } else {
                    performStepAction(action, fromStep);
                }
            });
        });
    }

    async function editStepPrompt(stepIdx) {
        if (!state.currentRun || state.currentRun.type !== 'workflow' || !state.adminData || !stepIdx) return;
        const details = state.adminData.details || {};
        const meta = details.meta || {};
        const steps = details.steps || [];
        const step = steps.find(s => s.idx === stepIdx);
        const currentPrompt = meta[`step_${stepIdx}_prompt`] || (step && step.prompt) || '';
        const scriptJson = state.adminData.script_json;
        if (!scriptJson) {
            showToast('Script not available', 'error');
            return;
        }
        let script;
        try {
            script = JSON.parse(scriptJson);
        } catch (e) {
            showToast('Invalid script', 'error');
            return;
        }
        const stepsArr = script.steps;
        if (!stepsArr || stepIdx < 1 || stepIdx > stepsArr.length) {
            showToast('Invalid step', 'error');
            return;
        }
        const newPrompt = window.prompt('Новый prompt для шага ' + stepIdx + ':', currentPrompt);
        if (newPrompt === null) return;
        stepsArr[stepIdx - 1].prompt = newPrompt;
        try {
            const res = await fetch(`/agents/admin/api/workflows/run/${state.currentRun.id}/update/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ script })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && !data.error) {
                showToast('Prompt обновлён', 'success');
                state.adminData.script_json = JSON.stringify(script);
                renderStepDetailPanel(stepIdx);
                refreshCurrentRun();
            } else {
                showToast(data.error || 'Ошибка обновления', 'error');
            }
        } catch (e) {
            showToast('Ошибка: ' + e.message, 'error');
        }
    }

    async function performStepAction(action, fromStep) {
        if (!state.currentRun || state.currentRun.type !== 'workflow') return;
        const id = state.currentRun.id;
        let url = '';
        let body = null;

        switch (action) {
            case 'stop':
                url = `/agents/api/workflows/run/${id}/stop/`;
                break;
            case 'skip':
                if (state.selectedStepIdx != null) {
                    url = `/agents/api/workflows/run/${id}/skip-step/`;
                    body = JSON.stringify({ step_idx: state.selectedStepIdx });
                } else {
                    url = `/agents/api/workflows/run/${id}/skip/`;
                }
                break;
            case 'continue':
                url = `/agents/api/workflows/run/${id}/continue/`;
                body = JSON.stringify({ from_step: fromStep != null ? fromStep : (state.adminData?.details?.current_step || 1) });
                break;
            case 'retry':
                url = `/agents/api/workflows/run/${id}/retry/`;
                break;
            default:
                return;
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success !== false) {
                showToast('Выполнено', 'success');
                closeStepDetail();
                refreshCurrentRun();
            } else {
                showToast(data.error || `Ошибка: ${res.status}`, 'error');
            }
        } catch (e) {
            showToast('Ошибка: ' + e.message, 'error');
        }
    }

    function groupLogEvents(events) {
        const groups = [];
        let i = 0;
        while (i < events.length) {
            const ev = events[i];
            if (ev.type === 'cmd' && (ev.subtype === 'start' || !ev.subtype)) {
                const outputs = [];
                let j = i + 1;
                while (j < events.length && events[j].type === 'cmd_output') {
                    outputs.push(events[j]);
                    j++;
                }
                groups.push({ type: 'cmd_block', cmd: ev, outputs });
                i = j;
                continue;
            }
            groups.push({ type: 'single', ev });
            i++;
        }
        return groups;
    }

    function buildEventText(ev) {
        if (!ev) return '';
        const lines = [];
        const title = ev.title || ev.type || 'Event';
        const time = formatTime(ev.ts);
        const idPart = Number.isFinite(Number(ev.id)) ? `#${ev.id}` : '';
        const header = [idPart, title, time].filter(Boolean).join(' • ');
        if (header) lines.push(header);
        if (ev.message) lines.push(String(ev.message));
        else if (ev.command) lines.push(String(ev.command));
        return lines.join('\n');
    }

    function buildGroupText(group) {
        if (!group) return '';
        if (group.type === 'cmd_block') {
            const cmdText = group.cmd?.message || group.cmd?.command || '';
            const outputText = (group.outputs || []).map((o) => o.message || o.command || '').filter(Boolean).join('\n');
            const title = group.cmd?.title || 'Команда';
            const lines = [title];
            if (cmdText) lines.push(cmdText);
            if (outputText) lines.push('--- output ---', outputText);
            return lines.join('\n');
        }
        return buildEventText(group.ev);
    }

    function groupMatchesFilter(group, filter) {
        if (!group) return false;
        if (filter === 'all') return true;
        if (group.type === 'cmd_block') {
            if (filter === 'cmd') return true;
            if (filter === 'cmd_output') return (group.outputs || []).length > 0;
            if ((group.cmd?.type || 'cmd') === filter) return true;
            return (group.outputs || []).some((ev) => (ev.type || '') === filter);
        }
        return (group.ev?.type || 'text') === filter;
    }

    function groupMatchesSearch(group, search) {
        if (!search) return true;
        return buildGroupText(group).toLowerCase().includes(search);
    }

    function getFilteredLogGroups(events) {
        const groups = groupLogEvents(events || []);
        const search = String(state.search || '').trim().toLowerCase();
        const filteredGroups = groups.filter((group) => {
            if (!groupMatchesFilter(group, state.filter)) return false;
            return groupMatchesSearch(group, search);
        });
        const visibleEventsCount = filteredGroups.reduce((sum, group) => {
            if (group.type === 'cmd_block') return sum + 1 + (group.outputs || []).length;
            return sum + 1;
        }, 0);
        return { groups: filteredGroups, visibleEventsCount };
    }

    function getLatestEventId(events) {
        for (let i = (events || []).length - 1; i >= 0; i--) {
            const eventId = Number((events[i] || {}).id);
            if (Number.isFinite(eventId) && eventId > 0) return eventId;
        }
        const fallback = Number(state.lastEventId);
        return Number.isFinite(fallback) ? fallback : 0;
    }

    function countLines(text) {
        if (!text) return 0;
        return String(text).split('\n').length;
    }

    function formatLogSourceText(message) {
        const raw = String(message || '');
        if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                return JSON.stringify(parsed, null, 2);
            } catch (e) {
                // Keep original payload for invalid JSON fragments
            }
        }
        return raw;
    }

    function highlightText(text) {
        const escaped = escapeHtml(text || '');
        const query = String(state.search || '').trim();
        if (!query || query.length < 2) return escaped;
        const matcher = new RegExp(`(${escapeRegExp(query)})`, 'ig');
        return escaped.replace(matcher, '<mark class="log-mark">$1</mark>');
    }

    function formatLogMessage(message) {
        return highlightText(formatLogSourceText(message));
    }

    function updateLogsMeta(visibleCount, totalCount, latestEventId) {
        if (els.logsVisibleCount) els.logsVisibleCount.textContent = String(visibleCount || 0);
        if (els.logsTotalCount) els.logsTotalCount.textContent = String(totalCount || 0);
        if (els.logsLastEventId) els.logsLastEventId.textContent = String(latestEventId || 0);
    }

    function toggleLogItemExpanded(item, forceExpanded = null) {
        if (!item) return;
        const shouldExpand = forceExpanded == null ? !item.classList.contains('expanded') : Boolean(forceExpanded);
        item.classList.toggle('expanded', shouldExpand);
        const btn = item.querySelector('[data-log-action="toggle-item"]');
        if (btn) btn.textContent = shouldExpand ? 'Collapse' : 'Expand';
    }

    function renderCmdGroup(group) {
        const cmd = group.cmd || {};
        const time = formatTime(cmd.ts);
        const cmdText = cmd.message || cmd.command || '';
        const outputLines = (group.outputs || []).map((o) => o.message || o.command || '').filter(Boolean);
        const outputText = outputLines.join('\n');
        const outputLineCount = countLines(outputText);
        const hasOutput = Boolean(outputText.trim());
        const isLongOutput = hasOutput && (outputText.length > 1400 || outputLineCount > 28);
        const expandedClass = isLongOutput && state.logsUi.expandAll ? ' expanded' : '';
        const idText = Number.isFinite(Number(cmd.id)) ? `<span class="log-event-id">#${escapeHtml(String(cmd.id))}</span>` : '';
        return `
            <div class="log-item log-item-cmd-block type-cmd ${isLongOutput ? 'cmd-collapsible' : ''}${expandedClass}" data-id="${escapeHtml(String(cmd.id || ''))}">
                <div class="log-item-header">
                    <span class="log-icon">${getEventIcon('cmd')}</span>
                    <span class="log-title">${highlightText(cmd.title || 'Команда')}</span>
                    <span class="log-block-meta">${hasOutput ? `${outputLineCount} lines` : 'no output'}</span>
                    ${idText}
                    <span class="log-time">${time || '—'}</span>
                    ${isLongOutput ? `<button type="button" class="log-expand-btn" data-log-action="toggle-item">${state.logsUi.expandAll ? 'Collapse' : 'Expand'}</button>` : ''}
                    <button type="button" class="log-copy-btn" data-log-action="copy-item" title="Copy">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                    </button>
                </div>
                <div class="cmd-output-block cmd-line"><pre class="log-message">${formatLogMessage(cmdText)}</pre></div>
                ${hasOutput ? `<div class="cmd-output-block output-line"><pre class="log-message">${formatLogMessage(outputText)}</pre></div>` : ''}
            </div>
        `;
    }

    function renderSingleGroup(group) {
        const ev = group.ev || {};
        const icon = getEventIcon(ev.type);
        const time = formatTime(ev.ts);
        const message = ev.message || ev.command || '';
        const isLongMessage = message.length > 500 || countLines(message) > 14;
        const isJson = message.trim().startsWith('{') || message.trim().startsWith('[');
        const typeClass = (ev.type === 'error' ? ' log-item-error' : '') + (ev.type === 'step' || ev.type === 'phase' ? ' log-item-step' : '');
        const expandedClass = isLongMessage && state.logsUi.expandAll ? ' expanded' : '';
        const idText = Number.isFinite(Number(ev.id)) ? `<span class="log-event-id">#${escapeHtml(String(ev.id))}</span>` : '';
        return `
            <div class="log-item type-${ev.type || 'text'}${typeClass} ${isLongMessage ? 'collapsible' : ''}${expandedClass}" data-id="${escapeHtml(String(ev.id || ''))}">
                <div class="log-item-header">
                    <span class="log-icon">${icon}</span>
                    <span class="log-title">${highlightText(ev.title || ev.type || 'Event')}</span>
                    ${idText}
                    <span class="log-time">${time || '—'}</span>
                    ${isLongMessage ? `<button type="button" class="log-expand-btn" data-log-action="toggle-item">${state.logsUi.expandAll ? 'Collapse' : 'Expand'}</button>` : ''}
                    <button type="button" class="log-copy-btn" data-log-action="copy-item" title="Copy">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                    </button>
                </div>
                ${message ? `<pre class="log-message ${isJson ? 'json' : ''}">${formatLogMessage(message)}</pre>` : ''}
            </div>
        `;
    }

    function renderLogs(events) {
        if (!els.logsTimeline) return;
        const allEvents = events || [];
        updateLogFilterCounts(allEvents);

        if (!allEvents.length) {
            state.visibleLogGroups = [];
            els.logsTimeline.innerHTML = '';
            updateLogsMeta(0, 0, 0);
            if (els.logsEmpty) els.logsEmpty.classList.remove('hidden');
            return;
        }

        const filtered = getFilteredLogGroups(allEvents);
        state.visibleLogGroups = filtered.groups;
        updateLogsMeta(filtered.visibleEventsCount, allEvents.length, getLatestEventId(allEvents));

        if (!filtered.groups.length) {
            els.logsTimeline.innerHTML = '';
            if (els.logsEmpty) els.logsEmpty.classList.remove('hidden');
            return;
        }

        if (els.logsEmpty) els.logsEmpty.classList.add('hidden');
        const html = filtered.groups.map((group) => {
            return group.type === 'cmd_block' ? renderCmdGroup(group) : renderSingleGroup(group);
        }).join('');
        els.logsTimeline.innerHTML = html;

        if (state.autoScroll && els.logsContainer) {
            els.logsContainer.scrollTop = els.logsContainer.scrollHeight;
        }
    }

    function updateLogFilterCounts(events) {
        const counts = { all: events.length };
        events.forEach((ev) => {
            const key = ev.type || 'other';
            counts[key] = (counts[key] || 0) + 1;
        });

        document.querySelectorAll('.log-chip').forEach((chip) => {
            const key = chip.dataset.filter || 'all';
            chip.dataset.count = String(counts[key] || 0);
        });
    }

    function buildVisibleLogsText() {
        return (state.visibleLogGroups || []).map((group) => buildGroupText(group)).filter(Boolean).join('\n\n');
    }

    function copyLogItemContent(item) {
        if (!item) return;
        const title = item.querySelector('.log-title')?.textContent?.trim();
        const messages = Array.from(item.querySelectorAll('.log-message'))
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean);
        const payload = [title, ...messages].filter(Boolean).join('\n');
        if (!payload) return;
        navigator.clipboard.writeText(payload)
            .then(() => showToast('Copied', 'success'))
            .catch(() => showToast('Copy failed', 'error'));
    }

    function getEventIcon(type) {
        const icons = {
            assistant: '💬',
            tool_call: '🔧',
            cmd: '🖥️',
            cmd_output: '📤',
            error: '⚠️',
            system: '🤖',
            prompt: '📝',
            phase: '🔄',
            summary: '📊',
            step: '✅',
            result: '⏱️'
        };
        return icons[type] || '•';
    }

    function formatCliCommand(cmd) {
        if (!cmd) return '-';
        if (Array.isArray(cmd)) return cmd.join(' ');
        return String(cmd);
    }

    function renderCommandTab(data) {
        const details = data.details || data;
        const cmd = details.cli_command_full || details.cli_command || data.command || data.cli_command;
        const prompt = details.input_prompt_full || data.prompt || data.task;
        els.commandText.textContent = formatCliCommand(cmd);
        els.promptText.textContent = prompt || '-';
    }

    function renderConfigTab(data) {
        const details = data.details || data;
        els.configText.textContent = JSON.stringify(details.config || data.config || {}, null, 2);
        els.mcpText.textContent = JSON.stringify(details.mcp_config || data.mcp_config || {}, null, 2);
        els.envText.textContent = JSON.stringify(details.env_vars || data.env_vars || {}, null, 2);
    }

    function renderOverviewTab(data, statusData) {
        const details = (data && data.details) || data || {};
        const prompt = details.input_prompt_full || (data && data.prompt) || '-';
        const cmd = details.cli_command_full || details.cli_command;
        els.overviewTaskText.textContent = prompt || '-';
        els.overviewCommandText.textContent = formatCliCommand(cmd);

        const lastOutputLines = 30;
        let outputText = '';
        const rawOutput = statusData && (statusData.output || statusData.logs);
        if (rawOutput) {
            const lines = String(rawOutput).trim().split('\n');
            outputText = lines.slice(-lastOutputLines).join('\n') || '-';
        } else if (state.events && state.events.length) {
            const cmdOutputs = state.events.filter(e => e.type === 'cmd_output').map(e => e.message || '');
            outputText = cmdOutputs.slice(-lastOutputLines).join('\n') || '-';
        } else if (data && (data.output || data.logs)) {
            const raw = data.output || data.logs || '';
            const lines = String(raw).trim().split('\n');
            outputText = lines.slice(-lastOutputLines).join('\n') || '-';
        }
        els.overviewOutputText.textContent = outputText || '-';
    }

    function renderRawTab(data) {
        els.rawOutput.textContent = data.logs || data.output || '-';
    }

    // Actions
    async function performAction(action) {
        if (!state.currentRun) return;

        const { type, id } = state.currentRun;
        let url, method = 'POST', body = null;

        switch (action) {
            case 'stop':
                url = type === 'workflow'
                    ? `/agents/api/workflows/run/${id}/stop/`
                    : `/agents/api/runs/${id}/stop/`;
                break;
            case 'skip':
                url = `/agents/api/workflows/run/${id}/skip/`;
                break;
            case 'continue':
                url = `/agents/api/workflows/run/${id}/continue/`;
                body = JSON.stringify({ from_step: state.adminData?.details?.current_step || 1 });
                break;
            case 'retry':
                url = `/agents/api/workflows/run/${id}/retry/`;
                break;
            default:
                return;
        }

        try {
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body
            });

            if (res.status === 404) {
                showToast(`Run #${id} not found`, 'error');
                return;
            }

            if (!res.ok) {
                showToast(`Server error: ${res.status}`, 'error');
                return;
            }

            const data = await res.json();

            if (data.success) {
                showToast(`Action "${action}" completed`, 'success');
                refreshCurrentRun();
            } else {
                showToast(data.error || `Failed to ${action}`, 'error');
            }
        } catch (e) {
            showToast(`Error: ${e.message}`, 'error');
        }
    }

    // Load run details
    async function loadRun(type, id) {
        state.currentRun = { type, id };
        state.events = [];
        state.lastEventId = 0;
        state.adminData = null;
        updateUrlParams(type, id);
        closeStepDetail();

        // Clear UI
        if (els.logsTimeline) els.logsTimeline.innerHTML = '';
        if (els.logsEmpty) els.logsEmpty.classList.remove('hidden');
        state.visibleLogGroups = [];
        updateLogsMeta(0, 0, 0);

        const statusData = await fetchRunStatus(type, id);
        if (!statusData) {
            state.currentRun = null;
            state.adminData = null;
            renderRunDetail(null, null);
            renderRunsList();
            return;
        }

        if (state.currentRun) renderRunDetail(statusData, state.adminData);

        if (statusData.events) {
            state.events = statusData.events;
            state.lastEventId = statusData.last_event_id || 0;
        } else if (statusData.logs || statusData.output) {
            state.events = parseTextLogs(statusData.logs || statusData.output);
        }

        renderLogs(state.events);
        renderRawTab(statusData);
        updateRunInsights(statusData, null);

        const adminData = await fetchAdminRunStatus(type, id);
        if (adminData) {
            state.adminData = adminData;
            renderRunDetail(statusData, adminData);
            renderCommandTab(adminData);
            renderConfigTab(adminData);
            renderOverviewTab(adminData, statusData);
            updateRunInsights(statusData, adminData);
        } else {
            renderOverviewTab(null, statusData);
        }

        renderRunsList();
    }

    async function refreshCurrentRun() {
        if (!state.currentRun) return;
        await loadRun(state.currentRun.type, state.currentRun.id);
    }

    function parseTextLogs(text) {
        if (!text) return [];
        const lines = text.split('\n');
        const events = [];
        let currentEvent = null;

        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed) {
                if (currentEvent) {
                    events.push(currentEvent);
                    currentEvent = null;
                }
                return;
            }

            let type = 'text';
            if (trimmed.startsWith('💬')) type = 'assistant';
            else if (trimmed.startsWith('🖥️') || trimmed.startsWith('[CMD]')) type = 'cmd';
            else if (trimmed.startsWith('✅')) type = 'step';
            else if (trimmed.startsWith('⚠️') || trimmed.startsWith('❌')) type = 'error';
            else if (trimmed.startsWith('🔧')) type = 'tool_call';

            if (!currentEvent || type !== currentEvent.type) {
                if (currentEvent) events.push(currentEvent);
                currentEvent = {
                    id: idx,
                    type,
                    title: trimmed.substring(0, 60),
                    message: trimmed,
                    ts: null
                };
            } else {
                currentEvent.message += '\n' + trimmed;
            }
        });

        if (currentEvent) events.push(currentEvent);
        return events;
    }

    // Polling
    function startPolling() {
        if (state.pollInterval) return;

        state.pollInterval = setInterval(async () => {
            if (!state.liveUpdates) return;

            // Fetch runs list
            await fetchRuns();

            // Update current run if selected
            if (state.currentRun) {
                const data = await fetchRunStatus(state.currentRun.type, state.currentRun.id);
                if (data) {
                    renderRunDetail(data, state.adminData);

                    if (data.events && data.events.length) {
                        const existingIds = new Set(state.events.map(e => e.id));
                        const newEvents = data.events.filter(e => !existingIds.has(e.id));
                        if (newEvents.length) {
                            state.events.push(...newEvents);
                            state.lastEventId = data.last_event_id || state.lastEventId;
                            renderLogs(state.events);
                        }
                    }

                    renderRawTab(data);
                    renderOverviewTab(state.adminData, data);
                    updateRunInsights(data, state.adminData);
                }
            }
        }, 2000);
    }

    function stopPolling() {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
            state.pollInterval = null;
        }
    }

    function setLiveUpdates(enabled) {
        state.liveUpdates = Boolean(enabled);
        els.btnLive?.classList.toggle('active', state.liveUpdates);
        if (state.liveUpdates) {
            startPolling();
        } else {
            stopPolling();
        }
    }

    function setActiveTab(tabName, persist = true) {
        const tab = tabName || DEFAULT_TAB;
        const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
        const panel = document.querySelector(`.tab-panel[data-tab="${tab}"]`);
        if (!btn || !panel) return;

        state.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        panel.classList.add('active');

        if (persist) {
            try {
                localStorage.setItem(TAB_STORAGE_KEY, tab);
            } catch (e) {
                // Ignore storage failures (private mode, strict browser policy)
            }
        }
    }

    function restoreActiveTab() {
        let stored = '';
        try {
            stored = localStorage.getItem(TAB_STORAGE_KEY) || '';
        } catch (e) {
            stored = '';
        }
        setActiveTab(stored || DEFAULT_TAB, false);
    }

    function isTypingTarget(target) {
        if (!target) return false;
        const tag = (target.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }

    function bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;

            const key = e.key.toLowerCase();
            const typing = isTypingTarget(e.target);

            if (key === '/' && !typing) {
                e.preventDefault();
                els.filterSearch?.focus();
                els.filterSearch?.select();
                return;
            }

            if (key === 'l' && !typing) {
                e.preventDefault();
                setLiveUpdates(!state.liveUpdates);
                showToast(state.liveUpdates ? 'Live updates on' : 'Live updates off', 'info');
                return;
            }

            if (key === 'r' && !typing) {
                e.preventDefault();
                fetchRuns();
                refreshCurrentRun();
                showToast('Refreshed', 'success');
                return;
            }

            if (state.activeTab === 'logs' && !typing && key === 'f') {
                e.preventDefault();
                els.logsSearch?.focus();
                els.logsSearch?.select();
                return;
            }

            if (state.activeTab === 'logs' && !typing && key === 'a') {
                e.preventDefault();
                state.autoScroll = !state.autoScroll;
                applyLogsUiState();
                showToast(state.autoScroll ? 'Auto-scroll on' : 'Auto-scroll off', 'info');
                return;
            }

            if (state.activeTab === 'logs' && !typing && key === 'w') {
                e.preventDefault();
                state.logsUi.wrap = !state.logsUi.wrap;
                persistLogsUiState();
                applyLogsUiState();
                showToast(state.logsUi.wrap ? 'Wrap on' : 'Wrap off', 'info');
                return;
            }

            if (e.key === 'Escape' && els.stepDetailPanel && !els.stepDetailPanel.classList.contains('hidden')) {
                closeStepDetail();
            }
        });
    }

    // Event Handlers
    function bindEvents() {
        // Sidebar collapse
        els.sidebarCollapseBtn?.addEventListener('click', () => {
            els.sidebar.classList.toggle('collapsed');
        });

        // Pipeline step detail close
        els.stepDetailClose?.addEventListener('click', closeStepDetail);

        // Filters
        els.filterSearch?.addEventListener('input', debounce(fetchRuns, 300));
        els.filterType?.addEventListener('change', fetchRuns);
        els.filterStatus?.addEventListener('change', fetchRuns);

        // Refresh
        els.btnRefresh?.addEventListener('click', () => {
            fetchRuns();
            refreshCurrentRun();
        });

        // Live toggle
        els.btnLive?.addEventListener('click', () => {
            setLiveUpdates(!state.liveUpdates);
            showToast(state.liveUpdates ? 'Live updates on' : 'Live updates off', 'info');
        });

        // Run selection
        els.runsList?.addEventListener('click', (e) => {
            const item = e.target.closest('.run-item');
            if (!item) return;

            const id = parseInt(item.dataset.id, 10);
            const type = item.dataset.type;
            if (!Number.isFinite(id)) return;
            loadRun(type, id);
        });

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                setActiveTab(tab);
            });
        });

        // Log filters
        document.querySelectorAll('.log-chip').forEach(chip => {
            chip.dataset.count = '0';
            chip.addEventListener('click', () => {
                document.querySelectorAll('.log-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.filter = chip.dataset.filter;
                renderLogs(state.events);
            });
        });

        // Log search
        els.logsSearch?.addEventListener('input', debounce(() => {
            state.search = els.logsSearch.value;
            renderLogs(state.events);
        }, 200));

        els.logsTimeline?.addEventListener('click', (e) => {
            const control = e.target.closest('[data-log-action]');
            if (!control) return;
            const item = control.closest('.log-item');
            if (!item) return;
            const action = control.dataset.logAction;
            if (action === 'copy-item') {
                copyLogItemContent(item);
                return;
            }
            if (action === 'toggle-item') {
                toggleLogItemExpanded(item);
            }
        });

        // Auto-scroll
        els.btnAutoScroll?.addEventListener('click', () => {
            state.autoScroll = !state.autoScroll;
            applyLogsUiState();
            showToast(state.autoScroll ? 'Auto-scroll on' : 'Auto-scroll off', 'info');
        });

        // Log view controls
        els.btnWrapLogs?.addEventListener('click', () => {
            state.logsUi.wrap = !state.logsUi.wrap;
            persistLogsUiState();
            applyLogsUiState();
        });

        els.btnCompactLogs?.addEventListener('click', () => {
            state.logsUi.compact = !state.logsUi.compact;
            persistLogsUiState();
            applyLogsUiState();
        });

        els.btnExpandLogs?.addEventListener('click', () => {
            state.logsUi.expandAll = !state.logsUi.expandAll;
            persistLogsUiState();
            renderLogs(state.events);
            applyLogsUiState();
        });

        // Copy buttons
        els.btnCopyLogs?.addEventListener('click', () => {
            const text = state.events.map((e) => buildEventText(e)).filter(Boolean).join('\n\n');
            navigator.clipboard.writeText(text)
                .then(() => showToast('Logs copied', 'success'))
                .catch(() => showToast('Copy failed', 'error'));
        });

        els.btnCopyVisibleLogs?.addEventListener('click', () => {
            const text = buildVisibleLogsText();
            if (!text) {
                showToast('No visible logs to copy', 'info');
                return;
            }
            navigator.clipboard.writeText(text)
                .then(() => showToast('Visible logs copied', 'success'))
                .catch(() => showToast('Copy failed', 'error'));
        });

        els.btnCopyRaw?.addEventListener('click', () => {
            navigator.clipboard.writeText(els.rawOutput.textContent)
                .then(() => showToast('Raw output copied', 'success'))
                .catch(() => showToast('Copy failed', 'error'));
        });

        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.copy;
                const el = document.getElementById(target);
                if (el) {
                    navigator.clipboard.writeText(el.textContent)
                        .then(() => showToast('Copied', 'success'))
                        .catch(() => showToast('Copy failed', 'error'));
                }
            });
        });

        // Run actions
        els.runActions?.addEventListener('click', (e) => {
            const btn = e.target.closest('.action-btn');
            if (!btn) return;

            const action = btn.dataset.action;
            if (action) performAction(action);
        });
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // URL parameter handling (?run_id= from dashboard, ?run= and ?workflow= for direct links)
    function parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            runId: params.get('run_id') || params.get('run'),
            workflowId: params.get('workflow'),
            type: params.get('type')
        };
    }

    function updateUrlParams(type, id) {
        if (!Number.isFinite(Number(id))) return;
        const url = new URL(window.location);
        url.searchParams.delete('run_id');
        url.searchParams.delete('type');
        if (type === 'workflow') {
            url.searchParams.set('workflow', id);
            url.searchParams.delete('run');
        } else {
            url.searchParams.set('run', id);
            url.searchParams.delete('workflow');
        }
        history.replaceState({}, '', url);
    }

    // Initialize
    async function init() {
        readLogsUiState();
        bindEvents();
        bindKeyboardShortcuts();
        restoreActiveTab();
        applyLogsUiState();
        await fetchRuns();

        // Check for URL parameters to auto-select a run
        const params = parseUrlParams();
        if (params.workflowId) {
            const workflowId = parseInt(params.workflowId, 10);
            if (Number.isFinite(workflowId)) loadRun('workflow', workflowId);
        } else if (params.runId) {
            const runId = parseInt(params.runId, 10);
            if (Number.isFinite(runId)) loadRun('run', runId);
        }

        setLiveUpdates(true);
    }

    init();
})();
