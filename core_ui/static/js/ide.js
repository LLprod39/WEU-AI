/**
 * Web IDE JavaScript
 * Управление проектами, файловым деревом, редактором кода и чатом с агентом
 */

// Глобальные переменные
let currentWorkspace = null;
let currentFilePath = null;  // активная вкладка (path)
let editor = null;
let openTabs = [];  // { path, model, dirty }
let emptyModel = null;  // одна пустая модель для «нет открытого файла»
let currentChatId = null;
let chatAbortController = null;
let isSaving = false;
let hasUnsavedChanges = false;

// Инициализация Monaco Editor
(function() {
    if (typeof require === 'undefined') {
        // Если require ещё не загружен, ждём загрузки скрипта Monaco
        const checkRequire = setInterval(function() {
            if (typeof require !== 'undefined') {
                clearInterval(checkRequire);
                initMonaco();
            }
        }, 100);
        setTimeout(function() {
            clearInterval(checkRequire);
            if (typeof require === 'undefined') {
                console.error('Monaco Editor loader not found');
            }
        }, 5000);
    } else {
        initMonaco();
    }
    
    function initMonaco() {
        require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
        require(['vs/editor/editor.main'], function() {
            const container = document.getElementById('editor-container');
            if (!container) {
                console.error('Editor container not found');
                return;
            }
            
            editor = monaco.editor.create(container, {
                value: '',
                language: 'plaintext',
                theme: 'vs-dark',
                automaticLayout: true,
                minimap: { enabled: true },
                fontSize: 14,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                wordWrap: 'on',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
            });
            emptyModel = editor.getModel();
            
            editor.onDidChangeModelContent(function() {
                if (currentFilePath) {
                    const tab = openTabs.find(function(t) { return t.path === currentFilePath; });
                    if (tab) {
                        tab.dirty = true;
                        hasUnsavedChanges = true;
                    }
                }
                updateSaveButton();
                renderTabs();
            });
            
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
                saveCurrentFile();
            });
            
            console.log('Monaco Editor initialized');
        });
    }
})();

// Загрузка списка проектов
async function loadProjects() {
    try {
        const response = await fetch('/agents/api/projects/', {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load projects');
        }
        
        const data = await response.json();
        const selector = document.getElementById('project-selector');
        selector.innerHTML = '<option value="">Выберите проект...</option>';
        
        (data.projects || []).forEach(function(project) {
            const option = document.createElement('option');
            option.value = project.path || project.name;
            option.textContent = project.name || project.path;
            selector.appendChild(option);
        });
        
        // Если есть проект в URL, выбираем его
        const urlParams = new URLSearchParams(window.location.search);
        const projectParam = urlParams.get('project');
        if (projectParam) {
            selector.value = projectParam;
            selector.dispatchEvent(new Event('change'));
        }
    } catch (error) {
        console.error('Error loading projects:', error);
        showToast('Ошибка загрузки проектов', 'error');
    }
}

// Выбор проекта
document.getElementById('project-selector').addEventListener('change', function(e) {
    const workspace = e.target.value;
    if (workspace) {
        currentWorkspace = workspace;
        loadFileTree('');
        // Обновляем URL
        const url = new URL(window.location.href);
        url.searchParams.set('project', workspace);
        window.history.replaceState({}, '', url);
    } else {
        currentWorkspace = null;
        clearFileTree();
        clearEditor();
    }
});

// Загрузка дерева файлов
async function loadFileTree(path) {
    if (!currentWorkspace) return;
    
    const container = document.getElementById('file-tree-container');
    
    try {
        const url = `/api/ide/files/?workspace=${encodeURIComponent(currentWorkspace)}&path=${encodeURIComponent(path)}`;
        const response = await fetch(url, { credentials: 'same-origin' });
        
        if (!response.ok) {
            throw new Error('Failed to load files');
        }
        
        const data = await response.json();
        renderFileTree(data.files || [], path, container);
    } catch (error) {
        console.error('Error loading file tree:', error);
        container.innerHTML = '<div class="ide-placeholder text-red-500">Ошибка загрузки файлов</div>';
    }
}

// Рендеринг дерева файлов (только для корневого уровня)
function renderFileTree(files, basePath, container) {
    if (basePath === '') {
        // Корневой уровень - заменяем весь контент
        container.innerHTML = '';
        const ul = document.createElement('ul');
        ul.className = 'space-y-1';
        files.forEach(file => {
            ul.appendChild(createFileTreeNode(file, basePath));
        });
        container.appendChild(ul);
    }
}

// Создание узла дерева файлов
function createFileTreeNode(file, parentPath) {
    const li = document.createElement('li');
    li.dataset.name = file.name;
    li.dataset.type = file.type;
    li.dataset.path = file.path;
    
    const fullPath = parentPath ? `${parentPath}/${file.name}` : file.name;
    
    var div = document.createElement('div');
    div.className = 'file-item flex items-center gap-2';
    
    const icon = document.createElement('span');
    icon.className = 'material-icons-round text-base';
    icon.textContent = file.type === 'dir' ? 'folder' : 'description';
    icon.style.color = file.type === 'dir' ? '#818cf8' : '#9ca3af';
    
    const name = document.createElement('span');
    name.className = 'text-gray-300';
    name.textContent = file.name;
    
    div.appendChild(icon);
    div.appendChild(name);
    
    if (file.type === 'dir') {
        // Для директорий - раскрытие/сворачивание
        const expandIcon = document.createElement('span');
        expandIcon.className = 'material-icons-round text-xs ml-auto';
        expandIcon.textContent = 'chevron_right';
        expandIcon.style.transition = 'transform 0.2s';
        div.appendChild(expandIcon);
        
        let isExpanded = false;
        let isLoading = false;
        const subUl = document.createElement('ul');
        subUl.className = 'ml-4 space-y-1 hidden';
        subUl.dataset.path = file.path;
        
        div.addEventListener('click', async function(e) {
            e.stopPropagation();
            isExpanded = !isExpanded;
            
            if (isExpanded) {
                expandIcon.style.transform = 'rotate(90deg)';
                subUl.classList.remove('hidden');
                // Загружаем содержимое если ещё не загружено
                if (!isLoading && (!subUl.hasChildNodes() || subUl.children.length === 0)) {
                    isLoading = true;
                    try {
                        const url = `/api/ide/files/?workspace=${encodeURIComponent(currentWorkspace)}&path=${encodeURIComponent(file.path)}`;
                        const response = await fetch(url, { credentials: 'same-origin' });
                        if (response.ok) {
                            const data = await response.json();
                            data.files.forEach(subFile => {
                                subUl.appendChild(createFileTreeNode(subFile, file.path));
                            });
                        }
                    } catch (error) {
                        console.error('Error loading subdirectory:', error);
                    } finally {
                        isLoading = false;
                    }
                }
            } else {
                expandIcon.style.transform = 'rotate(0deg)';
                subUl.classList.add('hidden');
            }
        });
        
        li.appendChild(div);
        li.appendChild(subUl);
    } else {
        // Для файлов - открытие в редакторе
        div.addEventListener('click', function(e) {
            e.stopPropagation();
            openFile(file.path);
        });
        li.appendChild(div);
    }
    
    return li;
}

// Очистка дерева файлов
function clearFileTree() {
    var container = document.getElementById('file-tree-container');
    container.innerHTML = '<div class="ide-placeholder">Выберите проект для просмотра файлов</div>';
}

function getLanguageForPath(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const languageMap = {
        'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
        'py': 'python', 'html': 'html', 'css': 'css', 'json': 'json', 'md': 'markdown',
        'yml': 'yaml', 'yaml': 'yaml', 'sh': 'shell', 'bash': 'shell', 'sql': 'sql', 'xml': 'xml',
    };
    return languageMap[ext] || 'plaintext';
}

function renderTabs() {
    const container = document.getElementById('ide-tabs');
    if (!container) return;
    container.innerHTML = '';
    openTabs.forEach(function(tab) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ide-tab' + (tab.path === currentFilePath ? ' active' : '') + (tab.dirty ? ' dirty' : '');
        btn.setAttribute('data-path', tab.path);
        const name = document.createElement('span');
        name.className = 'ide-tab-name';
        name.textContent = tab.path.split('/').pop() || tab.path;
        const close = document.createElement('span');
        close.className = 'ide-tab-close material-icons-round';
        close.textContent = 'close';
        close.setAttribute('aria-label', 'Закрыть');
        btn.appendChild(name);
        btn.appendChild(close);
        btn.addEventListener('click', function(e) {
            if (e.target === close || e.target.closest('.ide-tab-close')) {
                e.stopPropagation();
                closeTab(tab.path);
            } else {
                switchTab(tab.path);
            }
        });
        container.appendChild(btn);
    });
}

function switchTab(path) {
    const tab = openTabs.find(function(t) { return t.path === path; });
    if (!tab || !editor) return;
    currentFilePath = path;
    hasUnsavedChanges = !!tab.dirty;
    editor.setModel(tab.model);
    document.getElementById('current-file-name').textContent = path;
    updateSaveButton();
    renderTabs();
}

function closeTab(path) {
    var idx = openTabs.findIndex(function(t) { return t.path === path; });
    if (idx === -1) return;
    var tab = openTabs[idx];
    if (tab.dirty && !confirm('Файл изменён. Закрыть без сохранения?')) return;
    if (tab.model && !tab.model.isDisposed()) tab.model.dispose();
    openTabs.splice(idx, 1);
    if (currentFilePath === path) {
        if (openTabs.length > 0) {
            switchTab(openTabs[Math.min(idx, openTabs.length - 1)].path);
        } else {
            currentFilePath = null;
            hasUnsavedChanges = false;
            if (editor) {
                if (!emptyModel || emptyModel.isDisposed()) emptyModel = monaco.editor.createModel('', 'plaintext');
                editor.setModel(emptyModel);
            }
            document.getElementById('current-file-name').textContent = 'Нет открытого файла';
            updateSaveButton();
        }
    }
    renderTabs();
}

// Открытие файла в редакторе (вкладки)
async function openFile(filePath) {
    if (!currentWorkspace) {
        showToast('Выберите проект перед открытием файла', 'error');
        return;
    }
    if (!editor) {
        showToast('Редактор ещё не загружен. Подождите...', 'error');
        return;
    }
    var existing = openTabs.find(function(t) { return t.path === filePath; });
    if (existing) {
        switchTab(filePath);
        return;
    }
    try {
        var url = '/api/ide/file/?workspace=' + encodeURIComponent(currentWorkspace) + '&path=' + encodeURIComponent(filePath);
        var response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) {
            if (response.status === 404) throw new Error('Файл не найден');
            throw new Error('Ошибка загрузки файла');
        }
        var content = await response.text();
        var language = getLanguageForPath(filePath);
        var uri = monaco.Uri.parse('file:///' + filePath);
        var model = monaco.editor.getModel(uri) || monaco.editor.createModel(content, language, uri);
        model.setValue(content);
        monaco.editor.setModelLanguage(model, language);
        openTabs.push({ path: filePath, model: model, dirty: false });
        switchTab(filePath);
        renderTabs();
    } catch (error) {
        console.error('Error opening file:', error);
        showToast(error.message || 'Ошибка открытия файла', 'error');
    }
}

// Сохранение текущего файла
async function saveCurrentFile() {
    if (!currentWorkspace || !currentFilePath || !editor || isSaving) {
        if (!editor) showToast('Редактор ещё не загружен', 'error');
        return;
    }
    var model = editor.getModel();
    if (!model) return;
    isSaving = true;
    updateSaveButton();
    try {
        var content = model.getValue();
        var response = await fetch('/api/ide/file/', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            credentials: 'same-origin',
            body: JSON.stringify({ workspace: currentWorkspace, path: currentFilePath, content: content })
        });
        if (!response.ok) {
            var err = await response.json();
            throw new Error(err.error || 'Ошибка сохранения файла');
        }
        var tab = openTabs.find(function(t) { return t.path === currentFilePath; });
        if (tab) tab.dirty = false;
        hasUnsavedChanges = false;
        updateSaveButton();
        renderTabs();
        showToast('Файл сохранён', 'success');
    } catch (error) {
        console.error('Error saving file:', error);
        showToast(error.message || 'Ошибка сохранения файла', 'error');
    } finally {
        isSaving = false;
        updateSaveButton();
    }
}

// Обновление кнопки сохранения
function updateSaveButton() {
    var btn = document.getElementById('btn-save');
    if (btn) btn.disabled = !currentFilePath || isSaving || !hasUnsavedChanges;
}

// Очистка редактора (закрыть все вкладки)
function clearEditor() {
    openTabs.forEach(function(tab) {
        if (tab.model && !tab.model.isDisposed()) tab.model.dispose();
    });
    openTabs = [];
    currentFilePath = null;
    hasUnsavedChanges = false;
    if (editor) {
        if (!emptyModel || emptyModel.isDisposed()) emptyModel = monaco.editor.createModel('', 'plaintext');
        editor.setModel(emptyModel);
    }
    document.getElementById('current-file-name').textContent = 'Нет открытого файла';
    updateSaveButton();
    renderTabs();
}

// Обработка отправки сообщения в чат
document.getElementById('btn-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message) return;
    if (!currentWorkspace) {
        showToast('Выберите проект перед отправкой сообщения', 'error');
        return;
    }
    
    input.value = '';
    appendChatMessage('user', message);
    
    var statusEl = document.getElementById('agent-status');
    var statusText = document.getElementById('agent-status-text');
    function setStatus(text) {
        if (statusText) statusText.textContent = text;
        if (statusEl) statusEl.classList.remove('hidden');
    }
    setStatus('Думает…');
    
    if (chatAbortController) chatAbortController.abort();
    chatAbortController = new AbortController();
    
    var aiMessageEl = appendChatMessage('ai', '');
    
    try {
        var response = await fetch('/api/chat/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            credentials: 'same-origin',
            body: JSON.stringify({
                message: message,
                model: 'auto',
                use_rag: false,
                chat_id: currentChatId,
                workspace: currentWorkspace
            }),
            signal: chatAbortController.signal
        });
        
        if (!response.ok) throw new Error('Ошибка запроса');
        
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var fullText = '';
        var changedFiles = [];
        
        while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.startsWith('IDE_FILE_CHANGED:')) {
                    changedFiles.push(line.substring('IDE_FILE_CHANGED:'.length).trim());
                    continue;
                }
                if (line.startsWith('CHAT_ID:')) {
                    var chatId = parseInt(line.substring('CHAT_ID:'.length).trim(), 10);
                    if (chatId) currentChatId = chatId;
                    continue;
                }
                if (line.indexOf('Using tool:') !== -1) {
                    setStatus('Редактирует файлы…');
                } else if (fullText.length === 0 && line.trim()) {
                    setStatus('Пишет ответ…');
                }
                fullText += line + '\n';
            }
            aiMessageEl.innerHTML = formatMarkdown(fullText);
        }
        
        if (buffer.trim()) {
            fullText += buffer;
            aiMessageEl.innerHTML = formatMarkdown(fullText);
        }
        
        if (changedFiles.length > 0) {
            loadFileTree('');
            openTabs.forEach(function(t) {
                if (changedFiles.indexOf(t.path) !== -1) {
                    fetch('/api/ide/file/?workspace=' + encodeURIComponent(currentWorkspace) + '&path=' + encodeURIComponent(t.path))
                        .then(function(r) { return r.ok ? r.text() : Promise.reject(); })
                        .then(function(content) {
                            t.model.setValue(content);
                            t.dirty = false;
                            renderTabs();
                            updateSaveButton();
                        })
                        .catch(function() {});
                }
            });
        } else {
            loadFileTree('');
        }
        
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Error sending message:', error);
        aiMessageEl.innerHTML = '<span class="text-red-500">Ошибка: ' + error.message + '</span>';
    } finally {
        if (statusEl) statusEl.classList.add('hidden');
        chatAbortController = null;
    }
}

// Добавление сообщения в чат
function appendChatMessage(role, content) {
    var container = document.getElementById('chat-messages');
    var placeholder = container.querySelector('.ide-placeholder');
    if (placeholder) placeholder.remove();
    
    var messageEl = document.createElement('div');
    messageEl.className = 'ide-msg ' + (role === 'user' ? 'user' : 'ai');
    
    var avatar = document.createElement('div');
    avatar.className = 'ide-msg-avatar';
    avatar.innerHTML = '<span class="material-icons-round text-lg text-white">' + (role === 'user' ? 'person' : 'support_agent') + '</span>';
    
    var contentEl = document.createElement('div');
    contentEl.className = 'ide-msg-body';
    if (role === 'ai') {
        contentEl.innerHTML = formatMarkdown(content);
    } else {
        contentEl.textContent = content;
    }
    
    messageEl.appendChild(avatar);
    messageEl.appendChild(contentEl);
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
    return contentEl;
}

// Форматирование Markdown (упрощённое)
function formatMarkdown(text) {
    // Простое форматирование: код в обратных кавычках и блоки кода
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-bg-surface p-2 rounded my-2 overflow-x-auto"><code>$2</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<code class="bg-bg-surface px-1 rounded">$1</code>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/\n/g, '<br>');
    return text;
}

// Вспомогательные функции
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

function showToast(message, type = 'info') {
    // Простое уведомление через alert (можно заменить на toast библиотеку)
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Привязка кнопки сохранения
document.getElementById('btn-save').addEventListener('click', saveCurrentFile);

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    loadProjects();
});
