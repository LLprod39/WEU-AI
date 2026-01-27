/**
 * Form validation helpers. Settings page uses SettingsValidation (setOptions, validateAllRequired, setupValidation).
 */
(function () {
    'use strict';

    var FIELD_ERROR_MSG = 'Required field';
    var apiKeyIds = [];
    var requiredFieldIds = [];
    var ragIds = null;

    function setFieldError(inputEl, errorEl, hasError, msg) {
        if (!inputEl || !errorEl) return;
        var text = (msg != null ? msg : FIELD_ERROR_MSG);
        if (hasError) {
            inputEl.classList.add('input-error');
            errorEl.textContent = text;
            errorEl.style.display = '';
        } else {
            inputEl.classList.remove('input-error');
            errorEl.style.display = 'none';
        }
    }

    function validateRequired(inputEl) {
        if (!inputEl) return true;
        var val = (inputEl.value || '').trim();
        return val.length > 0;
    }

    function validateField(inputId, errorId) {
        var input = document.getElementById(inputId);
        var err = document.getElementById(errorId);
        var ok = validateRequired(input);
        setFieldError(input, err, !ok, FIELD_ERROR_MSG);
        return ok;
    }

    function validateAllRequired() {
        var valid = true;
        var i, pair, ragSel, ragCustom, ragErr, ragOk;
        for (i = 0; i < apiKeyIds.length; i++) {
            pair = apiKeyIds[i];
            if (!validateField(pair[0], pair[1])) valid = false;
        }
        for (i = 0; i < requiredFieldIds.length; i++) {
            pair = requiredFieldIds[i];
            if (!validateField(pair[0], pair[1])) valid = false;
        }
        if (ragIds) {
            ragSel = document.getElementById(ragIds.selId);
            ragCustom = document.getElementById(ragIds.customId);
            ragErr = document.getElementById(ragIds.errId);
            ragOk = (ragSel && (ragSel.value || '').trim()) || (ragCustom && (ragCustom.value || '').trim());
            if (!ragOk && ragErr) {
                ragErr.textContent = FIELD_ERROR_MSG;
                ragErr.style.display = '';
                if (ragSel) ragSel.classList.add('input-error');
                if (ragCustom) ragCustom.classList.add('input-error');
                valid = false;
            } else {
                if (ragErr) ragErr.style.display = 'none';
                if (ragSel) ragSel.classList.remove('input-error');
                if (ragCustom) ragCustom.classList.remove('input-error');
            }
        }
        return valid;
    }

    function setupBlurValidation(inputId, errorId) {
        var input = document.getElementById(inputId);
        var err = document.getElementById(errorId);
        if (!input || !err) return;
        input.addEventListener('blur', function () {
            setFieldError(input, err, !validateRequired(input), FIELD_ERROR_MSG);
        });
        input.addEventListener('input', function () {
            if (validateRequired(input)) setFieldError(input, err, false);
        });
        input.addEventListener('change', function () {
            if (validateRequired(input)) setFieldError(input, err, false);
        });
    }

    function setupClearOnInput(inputId, errorId) {
        var input = document.getElementById(inputId);
        var err = document.getElementById(errorId);
        if (!input || !err) return;
        function clearIfValid() {
            if (validateRequired(input)) setFieldError(input, err, false);
        }
        input.addEventListener('input', clearIfValid);
        input.addEventListener('change', clearIfValid);
    }

    function setupValidation() {
        var i, pair, ragSel, ragCustom, ragErr, ok;
        for (i = 0; i < apiKeyIds.length; i++) {
            pair = apiKeyIds[i];
            setupBlurValidation(pair[0], pair[1]);
        }
        for (i = 0; i < requiredFieldIds.length; i++) {
            pair = requiredFieldIds[i];
            setupClearOnInput(pair[0], pair[1]);
        }
        if (ragIds) {
            ragSel = document.getElementById(ragIds.selId);
            ragCustom = document.getElementById(ragIds.customId);
            ragErr = document.getElementById(ragIds.errId);
            function clearRagError() {
                ok = (ragSel && (ragSel.value || '').trim()) || (ragCustom && (ragCustom.value || '').trim());
                if (ok && ragErr) {
                    ragErr.style.display = 'none';
                    if (ragSel) ragSel.classList.remove('input-error');
                    if (ragCustom) ragCustom.classList.remove('input-error');
                }
            }
            if (ragSel) {
                ragSel.addEventListener('input', clearRagError);
                ragSel.addEventListener('change', clearRagError);
            }
            if (ragCustom) {
                ragCustom.addEventListener('input', clearRagError);
                ragCustom.addEventListener('change', clearRagError);
            }
        }
    }

    function setOptions(opts) {
        apiKeyIds = opts.apiKeyIds || [];
        requiredFieldIds = opts.requiredFieldIds || [];
        ragIds = opts.rag || null;
    }

    window.SettingsValidation = {
        setOptions: setOptions,
        validateAllRequired: validateAllRequired,
        setupValidation: setupValidation
    };
})();
