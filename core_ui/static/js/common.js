/**
 * Common helpers: getCookie, shared across settings, rag_ui, agent_hub.
 */
(function () {
    'use strict';

    function getCookie(name) {
        var v = null, c = document.cookie, i, p, parts;
        if (c && c.length) {
            parts = c.split(';');
            for (i = 0; i < parts.length; i++) {
                p = parts[i].trim().split('=');
                if (p[0] === name) {
                    v = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
                    break;
                }
            }
        }
        return v;
    }

    window.getCookie = getCookie;
})();
