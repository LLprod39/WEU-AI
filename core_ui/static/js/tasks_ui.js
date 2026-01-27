/**
 * Tasks UI: validation, drag/drop, AI actions (Improve/Breakdown), toasts, loading states
 */
(function () {
    'use strict';

    var config = window.TASKS_UI_CONFIG || {};
    var getCsrf = function () { return config.csrfToken || (document.querySelector('[name=csrfmiddlewaretoken]') && document.querySelector('[name=csrfmiddlewaretoken]').value) || ''; };

    function validateCreateTaskForm(event) {
        var titleInput = document.getElementById('create-task-title');
        var errorEl = document.getElementById('create-task-title-error');
        var val = (titleInput && titleInput.value) ? titleInput.value.trim() : '';
        if (val.length === 0) {
            if (event) event.preventDefault();
            if (titleInput) titleInput.classList.add('input-error');
            if (errorEl) {
                errorEl.textContent = 'Введите название задачи';
                errorEl.style.display = 'block';
            }
            return false;
        }
        if (titleInput) titleInput.classList.remove('input-error');
        if (errorEl) errorEl.style.display = 'none';
        return true;
    }

    function setupCreateTaskTitleValidation() {
        var titleInput = document.getElementById('create-task-title');
        var errorEl = document.getElementById('create-task-title-error');
        if (!titleInput || !errorEl) return;
        titleInput.addEventListener('input', function () {
            if ((titleInput.value || '').trim().length > 0) {
                titleInput.classList.remove('input-error');
                errorEl.style.display = 'none';
            }
        });
        titleInput.addEventListener('blur', function () {
            if ((titleInput.value || '').trim().length === 0) {
                titleInput.classList.add('input-error');
                errorEl.textContent = 'Введите название задачи';
                errorEl.style.display = 'block';
            } else {
                titleInput.classList.remove('input-error');
                errorEl.style.display = 'none';
            }
        });
    }

    function allowDrop(ev) {
        ev.preventDefault();
    }

    function drag(ev) {
        ev.dataTransfer.setData('text', ev.target.id);
    }

    function drop(ev, status) {
        ev.preventDefault();
        var data = ev.dataTransfer.getData('text');
        var card = document.getElementById(data);
        if (!card) return;
        var container = ev.target.classList.contains('space-y-3') ? ev.target : ev.target.closest('.space-y-3');
        if (container) container.appendChild(card);
        var taskId = (data || '').replace('task-', '');
        if (!taskId) return;
        fetch('/tasks/' + taskId + '/update-status/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
            body: JSON.stringify({ status: status })
        }).then(function () { if (window.showToast) window.showToast('Статус обновлён', 'success'); }).catch(function () { if (window.showToast) window.showToast('Не удалось обновить статус', 'error'); });
    }

    function setButtonLoading(btn, loading) {
        var icon = btn && btn.querySelector('.btn-icon-default');
        var text = btn && btn.querySelector('.btn-text');
        if (!btn) return;
        btn.disabled = !!loading;
        if (loading) {
            if (icon) {
                icon.textContent = 'refresh';
                icon.classList.add('animate-spin');
            }
            if (text) text.textContent = btn.getAttribute('data-action') === 'improve' ? '…' : 'План…';
        } else {
            if (icon) {
                icon.textContent = btn.getAttribute('data-action') === 'improve' ? 'auto_fix_high' : 'account_tree';
                icon.classList.remove('animate-spin');
            }
            if (text) text.textContent = btn.getAttribute('data-action') === 'improve' ? 'Improve' : 'Breakdown';
        }
    }

    function improveTask(btn, taskId) {
        var card = document.getElementById('task-' + taskId);
        var descEl = card && card.querySelector('.task-desc');
        setButtonLoading(btn, true);
        fetch('/tasks/' + taskId + '/ai-improve/', { method: 'POST', headers: { 'X-CSRFToken': getCsrf() } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.description && descEl) descEl.textContent = data.description;
                if (window.showToast) window.showToast('Описание улучшено', 'success');
            })
            .catch(function () { if (window.showToast) window.showToast('Не удалось улучшить описание', 'error'); })
            .then(function () { setButtonLoading(btn, false); });
    }

    function breakdownTask(btn, taskId) {
        var card = document.getElementById('task-' + taskId);
        var subtasksEl = card && card.querySelector('.subtasks-list');
        setButtonLoading(btn, true);
        fetch('/tasks/' + taskId + '/ai-breakdown/', { method: 'POST', headers: { 'X-CSRFToken': getCsrf() } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.subtasks && subtasksEl) {
                    var frag = document.createDocumentFragment();
                    data.subtasks.forEach(function (st) {
                        var div = document.createElement('div');
                        div.className = 'flex items-center gap-2 text-xs text-gray-400';
                        div.innerHTML = '<span class="material-icons-round text-[10px] text-primary">check_circle_outline</span><span></span>';
                        div.querySelector('span:last-child').textContent = st.title || '';
                        frag.appendChild(div);
                    });
                    subtasksEl.innerHTML = '';
                    subtasksEl.appendChild(frag);
                    subtasksEl.classList.remove('hidden');
                }
                if (window.showToast) window.showToast('Подзадачи созданы', 'success');
            })
            .catch(function () { if (window.showToast) window.showToast('Не удалось разбить на подзадачи', 'error'); })
            .then(function () { setButtonLoading(btn, false); });
    }

    function onActionClick(ev) {
        var btn = ev.target.closest('.task-action-ai');
        if (!btn) return;
        var taskId = btn.getAttribute('data-task-id');
        var action = btn.getAttribute('data-action');
        if (!taskId || !action) return;
        if (action === 'improve') improveTask(btn, taskId);
        else if (action === 'breakdown') breakdownTask(btn, taskId);
    }

    function init() {
        document.querySelectorAll('.task-column-skeletons').forEach(function (el) { el.classList.add('hidden'); });
        setupCreateTaskTitleValidation();
        var params = typeof window.location !== 'undefined' && window.location.search ? new URLSearchParams(window.location.search) : null;
        if (params && params.get('error') === 'empty_title') {
            if (window.showToast) window.showToast('Введите название задачи', 'error');
            var modal = document.getElementById('createTaskModal');
            if (modal) modal.classList.remove('hidden');
            if (typeof history.replaceState === 'function') history.replaceState({}, '', window.location.pathname);
        }
        document.body.addEventListener('click', onActionClick);
    }

    window.validateCreateTaskForm = validateCreateTaskForm;
    window.allowDrop = allowDrop;
    window.drag = drag;
    window.drop = drop;
    window.TasksUI = {
        allowDrop: allowDrop,
        drag: drag,
        drop: drop,
        validateCreateTaskForm: validateCreateTaskForm,
        improveTask: improveTask,
        breakdownTask: breakdownTask
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
