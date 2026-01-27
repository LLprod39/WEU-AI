/**
 * Toast notifications — window.showToast(message, type?, duration?, actionUrl?)
 */
(function () {
    'use strict';

    function showToast(message, type, duration, actionUrl) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        duration = (typeof duration === 'number' && duration > 0) ? duration : 4000;
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (type || 'info');
        var span = document.createElement('span');
        span.textContent = message;
        toast.appendChild(span);
        if (actionUrl && typeof actionUrl === 'string') {
            var sep = document.createTextNode(' ');
            var a = document.createElement('a');
            a.href = actionUrl;
            a.textContent = 'Перейти в Настройки';
            a.className = 'toast-action-link ml-1 font-semibold underline hover:no-underline';
            a.style.color = 'inherit';
            toast.appendChild(sep);
            toast.appendChild(a);
        }
        container.appendChild(toast);
        setTimeout(function () {
            toast.classList.add('toast-hiding');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, duration);
    }

    window.showToast = showToast;
})();
