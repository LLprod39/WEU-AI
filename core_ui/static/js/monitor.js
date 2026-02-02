/**
 * AI Monitor - Unified monitoring dashboard for agent and workflow runs
 */
(function() {
    'use strict';

    const app = document.getElementById('monitorApp');
    if (!app) return;

    // State
    const state = {
        runs: [],
        currentRun: null,
        events: [],
        lastEventId: 0,
        autoScroll: true,
        liveUpdates: true,
        filter: 'all',
        search: '',
        pollInterval: null
    };

    // DOM Elements
    const els = {
        // Header
        connectionStatus: document.getElementById('connectionStatus'),
        statRunning: document.getElementById('statRunning'),
        statTotal: document.getElementById('statTotal'),
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

        // Run detail
        runBadge: document.getElementById('runBadge'),
        runTitle: document.getElementById('runTitle'),
        runSubtitle: document.getElementById('runSubtitle'),
        runActions: document.getElementById('runActions'),

        // Logs
        logsContainer: document.getElementById('logsContainer'),
        logsTimeline: document.getElementById('logsTimeline'),
        logsEmpty: document.getElementById('logsEmpty'),
        logsSearch: document.getElementById('logsSearch'),
        btnCopyLogs: document.getElementById('btnCopyLogs'),
        btnAutoScroll: document.getElementById('btnAutoScroll'),

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
        stepsList: document.getElementById('stepsList')
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

    function setConnectionStatus(connected) {
        const statusEl = els.connectionStatus;
        if (connected) {
            statusEl.classList.add('connected');
            statusEl.querySelector('.status-text').textContent = 'Connected';
        } else {
            statusEl.classList.remove('connected');
            statusEl.querySelector('.status-text').textContent = 'Connecting...';
        }
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

            // Update stats
            const running = state.runs.filter(r => r.status === 'running').length;
            els.statRunning.textContent = running;
            els.statTotal.textContent = state.runs.length;

            setConnectionStatus(true);
            renderRunsList();
        } catch (e) {
            console.error('Failed to fetch runs:', e);
            setConnectionStatus(false);
            state.runs = [];
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
                ? `/agents/admin/api/workflow-runs/${runId}/status/`
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

            return `
                <button class="run-item ${isActive ? 'active' : ''} status-${run.status}"
                        data-id="${run.id}" data-type="${run.type}">
                    <div class="run-item-header">
                        <span class="run-item-label">${label}</span>
                        <span class="run-item-status">${statusIcon}</span>
                    </div>
                    <div class="run-item-title">${escapeHtml(run.title || run.runtime || '-')}</div>
                    <div class="run-item-meta">
                        <span>${escapeHtml(run.runtime || '-')}</span>
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

    function renderRunDetail(data) {
        if (!data) {
            els.runBadge.textContent = '-';
            els.runTitle.textContent = 'Select a run';
            els.runSubtitle.textContent = 'Choose a run from the sidebar';
            els.runActions.innerHTML = '';
            return;
        }

        // Badge
        const label = state.currentRun.type === 'workflow'
            ? `Workflow #${state.currentRun.id}`
            : `Run #${state.currentRun.id}`;
        els.runBadge.textContent = data.status || 'unknown';
        els.runBadge.className = `run-detail-badge status-${data.status || 'unknown'}`;

        // Title
        els.runTitle.textContent = label;

        // Subtitle
        const meta = [];
        if (data.runtime) meta.push(data.runtime);
        if (data.current_step_title) meta.push(`Step: ${data.current_step_title}`);
        if (data.finished_at) meta.push(`Finished: ${formatTime(data.finished_at)}`);
        els.runSubtitle.textContent = meta.join(' • ') || '-';

        // Actions
        renderRunActions(data.status);

        // Workflow steps
        if (state.currentRun.type === 'workflow' && data.steps) {
            renderWorkflowSteps(data.steps, data.current_step || 0);
            els.workflowSteps.classList.remove('hidden');
        } else {
            els.workflowSteps.classList.add('hidden');
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

    function renderLogs(events) {
        if (!events || !events.length) {
            els.logsTimeline.innerHTML = '';
            els.logsEmpty.classList.remove('hidden');
            return;
        }

        els.logsEmpty.classList.add('hidden');

        // Filter events
        let filtered = events;
        if (state.filter !== 'all') {
            filtered = events.filter(ev => ev.type === state.filter);
        }
        if (state.search) {
            const search = state.search.toLowerCase();
            filtered = filtered.filter(ev => {
                const text = (ev.message || ev.title || ev.command || '').toLowerCase();
                return text.includes(search);
            });
        }

        els.logsTimeline.innerHTML = filtered.map(ev => {
            const icon = getEventIcon(ev.type);
            const time = formatTime(ev.ts);
            const message = ev.message || ev.command || '';
            const isLongMessage = message.length > 500;
            const isJson = message.trim().startsWith('{') || message.trim().startsWith('[');

            return `
                <div class="log-item type-${ev.type || 'text'} ${isLongMessage ? 'collapsible' : ''}" data-id="${ev.id}">
                    <div class="log-item-header" ${isLongMessage ? 'onclick="this.parentElement.classList.toggle(\'expanded\')"' : ''}>
                        <span class="log-icon">${icon}</span>
                        <span class="log-title">${escapeHtml(ev.title || ev.type || 'Event')}</span>
                        ${isLongMessage ? '<span class="log-expand-icon">▶</span>' : ''}
                        <span class="log-time">${time}</span>
                        <button class="log-copy-btn" onclick="event.stopPropagation();navigator.clipboard.writeText(this.closest('.log-item').querySelector('.log-message')?.textContent||'');if(window.showToast)showToast('Copied','success');" title="Copy">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                            </svg>
                        </button>
                    </div>
                    ${message ? `<pre class="log-message ${isJson ? 'json' : ''}">${formatLogMessage(message)}</pre>` : ''}
                </div>
            `;
        }).join('');

        // Auto-scroll
        if (state.autoScroll) {
            els.logsContainer.scrollTop = els.logsContainer.scrollHeight;
        }
    }

    function formatLogMessage(message) {
        // Try to format JSON
        if (message.trim().startsWith('{') || message.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(message);
                return escapeHtml(JSON.stringify(parsed, null, 2));
            } catch (e) {
                // Not valid JSON, return as-is
            }
        }
        return escapeHtml(message);
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

    function renderCommandTab(data) {
        els.commandText.textContent = data.command || data.cli_command || '-';
        els.promptText.textContent = data.prompt || data.task || '-';
    }

    function renderConfigTab(data) {
        els.configText.textContent = JSON.stringify(data.config || {}, null, 2);
        els.mcpText.textContent = JSON.stringify(data.mcp_config || {}, null, 2);
        els.envText.textContent = JSON.stringify(data.env_vars || {}, null, 2);
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
                body = JSON.stringify({ from_step: state.currentStep || 0 });
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

        // Clear UI
        els.logsTimeline.innerHTML = '';
        els.logsEmpty.classList.remove('hidden');

        // Fetch basic status
        const statusData = await fetchRunStatus(type, id);
        if (statusData) {
            renderRunDetail(statusData);

            // Parse events
            if (statusData.events) {
                state.events = statusData.events;
                state.lastEventId = statusData.last_event_id || 0;
            } else if (statusData.logs || statusData.output) {
                // Fallback to text parsing
                state.events = parseTextLogs(statusData.logs || statusData.output);
            }

            renderLogs(state.events);
            renderRawTab(statusData);
        }

        // Fetch admin details (command, config, etc.)
        const adminData = await fetchAdminRunStatus(type, id);
        if (adminData) {
            renderCommandTab(adminData);
            renderConfigTab(adminData);
        }

        // Re-render runs list to show active state
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
                    renderRunDetail(data);

                    // Append new events
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

    // Event Handlers
    function bindEvents() {
        // Sidebar collapse
        els.sidebarCollapseBtn?.addEventListener('click', () => {
            els.sidebar.classList.toggle('collapsed');
        });

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
            state.liveUpdates = !state.liveUpdates;
            els.btnLive.classList.toggle('active', state.liveUpdates);

            if (state.liveUpdates) {
                startPolling();
            }
        });

        // Run selection
        els.runsList?.addEventListener('click', (e) => {
            const item = e.target.closest('.run-item');
            if (!item) return;

            const id = parseInt(item.dataset.id, 10);
            const type = item.dataset.type;

            loadRun(type, id);
        });

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;

                // Update buttons
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update panels
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                document.querySelector(`.tab-panel[data-tab="${tab}"]`)?.classList.add('active');
            });
        });

        // Log filters
        document.querySelectorAll('.log-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.log-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.filter = chip.dataset.filter;
                renderLogs(state.events);
            });
        });

        // Log search
        els.logsSearch?.addEventListener('input', debounce(() => {
            state.search = els.logsSearch.value.toLowerCase();
            renderLogs(state.events);
        }, 200));

        // Auto-scroll
        els.btnAutoScroll?.addEventListener('click', () => {
            state.autoScroll = !state.autoScroll;
            els.btnAutoScroll.classList.toggle('active', state.autoScroll);
        });

        // Copy buttons
        els.btnCopyLogs?.addEventListener('click', () => {
            const text = state.events.map(e => e.message || e.title || '').join('\n');
            navigator.clipboard.writeText(text);
            showToast('Logs copied', 'success');
        });

        els.btnCopyRaw?.addEventListener('click', () => {
            navigator.clipboard.writeText(els.rawOutput.textContent);
            showToast('Raw output copied', 'success');
        });

        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.copy;
                const el = document.getElementById(target);
                if (el) {
                    navigator.clipboard.writeText(el.textContent);
                    showToast('Copied', 'success');
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

    // URL parameter handling
    function parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            runId: params.get('run'),
            workflowId: params.get('workflow'),
            type: params.get('type')
        };
    }

    function updateUrlParams(type, id) {
        const url = new URL(window.location);
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
        bindEvents();
        await fetchRuns();

        // Check for URL parameters to auto-select a run
        const params = parseUrlParams();
        if (params.workflowId) {
            loadRun('workflow', parseInt(params.workflowId, 10));
        } else if (params.runId) {
            loadRun('run', parseInt(params.runId, 10));
        }

        startPolling();
    }

    // Override loadRun to also update URL
    const originalLoadRun = loadRun;
    async function loadRunWithUrl(type, id) {
        await originalLoadRun.call(this, type, id);
        updateUrlParams(type, id);
    }
    // Replace the loadRun function
    window.loadRun = loadRunWithUrl;

    init();
})();
