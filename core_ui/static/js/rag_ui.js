/**
 * RAG Knowledge Base — UI logic (enterprise module).
 * confirm() for reset/delete; success/error via showToast.
 */
(function () {
    'use strict';

    function escapeHtml(text) {
        var d = document.createElement('div');
        d.textContent = text == null ? '' : String(text);
        return d.innerHTML;
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    var RAGUI = {
        _documents: [],
        _listEl: null,
        _loadingEl: null,
        _emptyEl: null,
        _filterEmptyEl: null,

        openAddModal: function () {
            var m = document.getElementById('add-modal');
            if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        },

        closeAddModal: function () {
            var m = document.getElementById('add-modal');
            if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
        },

        removeDocCards: function () {
            var list = document.getElementById('documents-list');
            if (!list) return;
            [].forEach.call(list.querySelectorAll('.kb-doc-row'), function (el) { el.remove(); });
        },

        renderTable: function (docs) {
            var list = document.getElementById('documents-list');
            var loadingEl = document.getElementById('documents-loading');
            var emptyEl = document.getElementById('documents-empty');
            var filterEmptyEl = document.getElementById('documents-filter-empty');
            if (!list) return;

            this.removeDocCards();
            if (loadingEl) loadingEl.classList.add('hidden');

            if (!docs || docs.length === 0) {
                var hasAny = (this._documents || []).length > 0;
                if (hasAny && filterEmptyEl) {
                    filterEmptyEl.classList.remove('hidden');
                    if (emptyEl) emptyEl.classList.add('hidden');
                } else if (emptyEl) {
                    emptyEl.classList.remove('hidden');
                    if (filterEmptyEl) filterEmptyEl.classList.add('hidden');
                }
                return;
            }
            if (emptyEl) emptyEl.classList.add('hidden');
            if (filterEmptyEl) filterEmptyEl.classList.add('hidden');

            var self = this;
            var insertRef = loadingEl;
            var i;
            for (i = 0; i < docs.length; i++) {
                var doc = docs[i];
                var id = (doc.id || '').toString();
                var src = doc.source || '—';
                var text = doc.text || '';
                var size = formatSize((text.length * 2)); // UTF-16 approx
                var date = doc.date || doc.created_at || '—';
                var short = text.length > 120 ? text.slice(0, 120) + '…' : text;

                var row = document.createElement('div');
                row.className = 'kb-doc-row';
                row.setAttribute('data-doc-id', id);
                row.innerHTML =
                    '<div class="kb-doc-cell kb-doc-source">' + escapeHtml(src) + '</div>' +
                    '<div class="kb-doc-cell kb-doc-date">' + escapeHtml(String(date)) + '</div>' +
                    '<div class="kb-doc-cell kb-doc-size">' + escapeHtml(size) + '</div>' +
                    '<div class="kb-doc-cell kb-doc-preview" title="' + escapeHtml(short) + '">' + escapeHtml(short) + '</div>' +
                    '<div class="kb-doc-cell kb-doc-actions">' +
                    '<button type="button" class="kb-doc-btn kb-doc-btn-view" aria-label="View" title="View">' +
                    '<span class="material-icons-round">visibility</span></button>' +
                    '<button type="button" class="kb-doc-btn kb-doc-btn-delete" aria-label="Delete" title="Delete">' +
                    '<span class="material-icons-round">delete_outline</span></button>' +
                    '</div>';

                var viewBtn = row.querySelector('.kb-doc-btn-view');
                var delBtn = row.querySelector('.kb-doc-btn-delete');
                (function (docId, docText) {
                    if (viewBtn) viewBtn.addEventListener('click', function () {
                        if (window.RAGUI) window.RAGUI.previewDocument(docId, docText);
                    });
                    if (delBtn) delBtn.addEventListener('click', function () {
                        if (window.RAGUI) window.RAGUI.deleteDocument(docId);
                    });
                })(id, text);

                list.insertBefore(row, insertRef);
                insertRef = row;
            }
        },

        fillSourceFilter: function () {
            var sel = document.getElementById('kb-filter-source');
            if (!sel) return;
            var seen = {};
            var opts = [{ v: '', t: 'All sources' }];
            (this._documents || []).forEach(function (d) {
                var s = (d.source || '').trim() || '—';
                if (s && !seen[s]) { seen[s] = true; opts.push({ v: s, t: s }); }
            });
            sel.innerHTML = opts.map(function (o) { return '<option value="' + escapeHtml(o.v) + '">' + escapeHtml(o.t) + '</option>'; }).join('');
        },

        previewDocument: function (id, text) {
            var t = text || (this._documents.find(function (d) { return (d.id || '').toString() === id; }) || {}).text || '';
            if (typeof window.showToast === 'function') {
                window.showToast(t.length > 200 ? t.slice(0, 200) + '…' : t, 'info');
            } else {
                alert(t.slice(0, 500) + (t.length > 500 ? '…' : ''));
            }
        },

        deleteDocument: function (docId) {
            if (!confirm('Delete this document? This cannot be undone.')) return;
            var self = this;
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/rag/delete/');
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('X-CSRFToken', (window.getCookie && window.getCookie('csrftoken')) || '');
            xhr.onload = function () {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { data = {}; }
                if (data.success) {
                    if (window.showToast) window.showToast('Document deleted', 'success');
                    self._documents = self._documents.filter(function (d) { return (d.id || '').toString() !== docId; });
                    self.applyFilter();
                } else {
                    if (window.showToast) window.showToast('Error: ' + (data.error || 'Unknown'), 'error');
                }
            };
            xhr.onerror = function () { if (window.showToast) window.showToast('Network error', 'error'); };
            xhr.send(JSON.stringify({ doc_id: docId }));
        },

        getFilter: function () {
            var q = (document.getElementById('kb-filter-query') || {}).value || '';
            var src = (document.getElementById('kb-filter-source') || {}).value || '';
            return { q: (q || '').trim().toLowerCase(), source: (src || '').trim().toLowerCase() };
        },

        applyFilter: function () {
            var f = this.getFilter();
            var docs = this._documents;
            var list = (docs || []).filter(function (d) {
                var src = (d.source || '').toLowerCase();
                var text = (d.text || '').toLowerCase();
                var matchSrc = !f.source || src.indexOf(f.source) !== -1;
                var matchQ = !f.q || src.indexOf(f.q) !== -1 || text.indexOf(f.q) !== -1;
                return matchSrc && matchQ;
            });
            this.renderTable(list);
        },

        addDocument: function () {
            var contentEl = document.getElementById('doc-content');
            var sourceEl = document.getElementById('doc-source');
            var content = (contentEl && contentEl.value || '').trim();
            var source = (sourceEl && sourceEl.value || '').trim() || 'manual';
            if (!content) {
                if (window.showToast) window.showToast('Введите содержимое документа', 'info');
                return;
            }
            var btn = document.getElementById('kb-add-doc-btn');
            if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
            var self = this;

            fetch('/api/rag/add/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' },
                body: JSON.stringify({ text: content, source: source })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success) {
                        if (window.showToast) window.showToast('Document added', 'success');
                        self.closeAddModal();
                        if (contentEl) contentEl.value = '';
                        self.loadDocuments();
                    } else {
                        if (window.showToast) window.showToast('Error: ' + (data.error || 'Unknown'), 'error');
                    }
                })
                .catch(function (e) {
                    if (window.showToast) window.showToast('Error: ' + (e && e.message ? e.message : 'Unknown'), 'error');
                })
                .then(function () {
                    if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
                });
        },

        searchKnowledge: function () {
            var queryEl = document.getElementById('search-query');
            var query = (queryEl && queryEl.value || '').trim();
            if (!query) return;
            var btn = document.getElementById('kb-search-btn');
            if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }

            fetch('/api/rag/query/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' },
                body: JSON.stringify({ query: query, n_results: 5 })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var resDiv = document.getElementById('search-results');
                    var listEl = document.getElementById('results-list');
                    if (resDiv) resDiv.classList.remove('hidden');
                    if (!listEl) return;
                    if (data.success && data.documents && data.documents[0] && data.documents[0].length) {
                        listEl.innerHTML = data.documents[0].map(function (doc, i) {
                            var meta = (data.metadatas && data.metadatas[0] && data.metadatas[0][i]) || {};
                            var score = (((meta.score || 0) * 100)).toFixed(1);
                            var src = meta.source || 'unknown';
                            var txt = (doc || '').substring(0, 300) + (doc.length > 300 ? '…' : '');
                            return '<div class="kb-result-item"><div class="kb-result-meta"><span>' + escapeHtml(src) + '</span><span>' + score + '%</span></div>' + escapeHtml(txt) + '</div>';
                        }).join('');
                    } else {
                        listEl.innerHTML = '<div class="kb-result-item kb-result-empty">No results</div>';
                    }
                })
                .catch(function (e) {
                    var resDiv = document.getElementById('search-results');
                    var listEl = document.getElementById('results-list');
                    if (resDiv) resDiv.classList.remove('hidden');
                    if (listEl) listEl.innerHTML = '<div class="kb-result-item kb-result-error">' + escapeHtml(e && e.message ? e.message : 'Error') + '</div>';
                })
                .then(function () {
                    if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
                });
        },

        resetDatabase: function () {
            if (!confirm('Reset database? All documents will be deleted.')) return;
            var self = this;
            fetch('/api/rag/reset/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (window.getCookie && window.getCookie('csrftoken')) || '' }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success) {
                        if (window.showToast) window.showToast('Database reset successfully', 'success');
                        self._documents = [];
                        self.removeDocCards();
                        var loadingEl = document.getElementById('documents-loading');
                        var emptyEl = document.getElementById('documents-empty');
                        var filterEmpty = document.getElementById('documents-filter-empty');
                        if (loadingEl) { loadingEl.classList.remove('hidden'); }
                        if (emptyEl) emptyEl.classList.add('hidden');
                        if (filterEmpty) filterEmpty.classList.add('hidden');
                        self.loadDocuments();
                    } else {
                        if (window.showToast) window.showToast('Error: ' + (data.error || 'Unknown'), 'error');
                    }
                })
                .catch(function (e) {
                    if (window.showToast) window.showToast('Error: ' + (e && e.message ? e.message : 'Unknown'), 'error');
                });
        },

        loadDocuments: function () {
            var loadingEl = document.getElementById('documents-loading');
            var emptyEl = document.getElementById('documents-empty');
            var countEl = document.getElementById('doc-count');
            var self = this;

            if (loadingEl) loadingEl.classList.remove('hidden');
            if (emptyEl) emptyEl.classList.add('hidden');

            fetch('/api/rag/documents/?limit=500')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (loadingEl) loadingEl.classList.add('hidden');
                    var docs = (data.success && data.documents) ? data.documents : [];
                    var total = data.doc_count != null ? data.doc_count : docs.length;
                    if (countEl) countEl.textContent = total;

                    self._documents = docs.map(function (d) {
                        return {
                            id: d.id,
                            source: d.source || '—',
                            text: d.text || '',
                            date: d.date || '—',
                            size: (d.text || '').length
                        };
                    });
                    self.fillSourceFilter();
                    self.applyFilter();
                })
                .catch(function (e) {
                    if (loadingEl) loadingEl.classList.add('hidden');
                    if (emptyEl) {
                        emptyEl.classList.remove('hidden');
                        emptyEl.innerHTML = '<span class="material-icons-round empty-state-icon" style="color:#f87171">error</span><p class="empty-state-text">Load error</p><p class="empty-state-desc">' + escapeHtml(e && e.message ? e.message : 'Unknown') + '</p>';
                    }
                    if (countEl) countEl.textContent = '0';
                });
        },

        init: function () {
            var self = this;
            window.RAGUI = self;

            var q = document.getElementById('search-query');
            if (q) q.addEventListener('keypress', function (e) { if (e.key === 'Enter') self.searchKnowledge(); });

            var fq = document.getElementById('kb-filter-query');
            var fs = document.getElementById('kb-filter-source');
            if (fq) fq.addEventListener('input', function () { self.applyFilter(); });
            if (fq) fq.addEventListener('keypress', function (e) { if (e.key === 'Enter') self.applyFilter(); });
            if (fs) fs.addEventListener('change', function () { self.applyFilter(); });

            self.loadDocuments();
        }
    };

    if (typeof window !== 'undefined') {
        window.RAGUI = RAGUI;
    }
})();
