/*
 * ============================================================
 *  builder.js  —  SurveySphere Survey Builder
 * ============================================================
 *  Manages the entire survey creation and editing experience.
 *  Maintains an in-memory list of question objects and
 *  re-renders the canvas whenever anything changes.
 *
 *  Includes:
 *    - init()               — resets the builder to a blank state
 *    - loadSurvey()         — populates the builder from a saved survey
 *    - addQuestion()        — adds a new question of any supported type
 *    - moveUp/moveDown()    — reorders questions by swapping array items
 *    - deleteQuestion()     — removes a question by index
 *    - updateText/Required/Option() — live updates to question data
 *    - addOption/removeOption()     — manages answer options
 *    - renderCanvas()       — rebuilds all question cards from state
 *    - renderQuestionCard() — generates HTML for one question card
 *    - renderQuestionBody() — generates the type-specific input UI
 *    - toggleRequired()     — toggles the required flag + toggle visually
 *    - saveSurvey()         — validates + saves the survey to localStorage
 *    - previewSurvey()      — opens survey.html in a new tab
 *    - newSurvey()          — resets builder and switches to builder section
 * ============================================================
 */

const BuilderManager = {

    /* In-memory array of question objects being edited */
    questions: [],

    /* ID of the survey being edited (null if creating a new one) */
    surveyId: null,


    /* ── INIT / LOAD ─────────────────────────────────────── */

    /*
     * init
     * Resets the builder to a completely blank state.
     * Called when creating a new survey.
     */
    init() {
        this.questions = [];
        this.surveyId  = null;
        document.getElementById('surveyTitleInput').value = 'Untitled Survey';
        document.getElementById('surveyDescInput').value  = '';
        this.renderCanvas();
    },

    /*
     * loadSurvey
     * Populates the builder fields from an existing survey object.
     * Used when the user clicks "Edit" on a survey card.
     * Deep-clones the questions so edits don't mutate the original.
     */
    loadSurvey(survey) {
        this.surveyId  = survey.id;
        this.questions = JSON.parse(JSON.stringify(survey.questions));

        document.getElementById('surveyTitleInput').value = survey.title;
        document.getElementById('surveyDescInput').value  = survey.description || '';

        /* Populate demographics sidebar with saved values */
        const d = survey.demographics || {};
        document.getElementById('demoAgeMin').value      = d.ageMin      || '';
        document.getElementById('demoAgeMax').value      = d.ageMax      || '';
        document.getElementById('demoGender').value      = d.gender      || 'any';
        document.getElementById('demoCountry').value     = d.country     || 'any';
        document.getElementById('demoOccupation').value  = d.occupation  || 'any';

        this.renderCanvas();
    },


    /* ── QUESTION MANAGEMENT ─────────────────────────────── */

    /*
     * addQuestion
     * Creates a new question object with sensible defaults based
     * on the type, appends it to the questions array, and scrolls
     * the canvas to show the new card.
     */
    addQuestion(type) {
        const id = 'q_' + Date.now();

        /* Types that need pre-filled answer options */
        const defaults = {
            multiple_choice: { options: ['Option 1', 'Option 2'] },
            checkbox:        { options: ['Option 1', 'Option 2'] },
            dropdown:        { options: ['Option 1', 'Option 2'] },
            linear_scale:    { options: ['1', '5'], scaleMin: 1, scaleMax: 5 }
        };

        const q = {
            id,
            type,
            text:     '',
            required: false,
            options:  (defaults[type] || {}).options || [],
            ...(defaults[type] || {})
        };

        this.questions.push(q);
        this.renderCanvas();

        /* Scroll the new card into view after the DOM updates */
        setTimeout(() => {
            const el = document.getElementById('qcard_' + id);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
    },

    /* Moves a question one position up by swapping with its neighbour */
    moveUp(idx) {
        if (idx === 0) return;
        [this.questions[idx - 1], this.questions[idx]] = [this.questions[idx], this.questions[idx - 1]];
        this.renderCanvas();
    },

    /* Moves a question one position down by swapping with its neighbour */
    moveDown(idx) {
        if (idx === this.questions.length - 1) return;
        [this.questions[idx], this.questions[idx + 1]] = [this.questions[idx + 1], this.questions[idx]];
        this.renderCanvas();
    },

    /* Removes a question by index and re-renders */
    deleteQuestion(idx) {
        this.questions.splice(idx, 1);
        this.renderCanvas();
    },

    /* Live updates — called by oninput handlers in question cards */
    updateText(idx, val)             { this.questions[idx].text              = val; },
    updateRequired(idx, val)         { this.questions[idx].required          = val; },
    updateOption(idx, oidx, val)     { this.questions[idx].options[oidx]     = val; },

    /* Adds a new blank option to a multiple-choice/checkbox/dropdown question */
    addOption(idx) {
        const count = this.questions[idx].options.length;
        this.questions[idx].options.push('Option ' + (count + 1));
        this.renderCanvas();
    },

    /* Removes a specific option — minimum of 2 options enforced */
    removeOption(idx, oidx) {
        if (this.questions[idx].options.length <= 2) {
            showToast('Minimum 2 options required');
            return;
        }
        this.questions[idx].options.splice(oidx, 1);
        this.renderCanvas();
    },


    /* ── CANVAS RENDERING ────────────────────────────────── */

    /*
     * renderCanvas
     * Completely re-renders all question cards into #questionsCanvas.
     * Called after every change to the questions array.
     * Shows the drop hint if there are no questions yet.
     */
    renderCanvas() {
        const container = document.getElementById('questionsCanvas');

        if (this.questions.length === 0) {
            container.innerHTML = `
                <div class="drop-hint">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5"  y1="12" x2="19" y2="12"/>
                    </svg>
                    ← Pick a question type to get started
                </div>`;
            return;
        }

        container.innerHTML = this.questions.map((q, i) => this.renderQuestionCard(q, i)).join('');
    },

    /*
     * renderQuestionCard
     * Generates the HTML string for a single question card.
     * Each card has: number badge, type label, move/delete controls,
     * question text input, type-specific body, and required toggle.
     */
    renderQuestionCard(q, idx) {
        const typeLabels = {
            multiple_choice: 'Multiple Choice',
            checkbox:        'Checkboxes',
            text:            'Short Text',
            long_answer:     'Long Answer',
            rating:          'Rating Scale',
            yes_no:          'Yes / No',
            dropdown:        'Dropdown',
            linear_scale:    'Linear Scale',
            date:            'Date',
            number:          'Number'
        };

        /* Disable up/down buttons at the list boundaries */
        const upDisabled   = idx === 0                          ? 'disabled style="opacity:0.3;pointer-events:none"' : '';
        const downDisabled = idx === this.questions.length - 1  ? 'disabled style="opacity:0.3;pointer-events:none"' : '';

        return `
            <div class="q-card" id="qcard_${q.id}">

                <!-- Card header: question number + type + move/delete controls -->
                <div class="q-card-head">
                    <div class="q-num">${idx + 1}</div>
                    <div class="q-type-label">${typeLabels[q.type] || q.type}</div>
                    <div class="q-card-controls">
                        <button class="q-ctrl-btn" ${upDisabled}   onclick="BuilderManager.moveUp(${idx})"       title="Move up">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                        </button>
                        <button class="q-ctrl-btn" ${downDisabled} onclick="BuilderManager.moveDown(${idx})"     title="Move down">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                        <button class="q-ctrl-btn delete"          onclick="BuilderManager.deleteQuestion(${idx})" title="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <!-- Card body: question text input + type-specific controls -->
                <div class="q-card-body">
                    <input class="q-text-input" type="text" placeholder="Question text…"
                        value="${escHtml(q.text)}"
                        oninput="BuilderManager.updateText(${idx}, this.value)">
                    ${this.renderQuestionBody(q, idx)}
                </div>

                <!-- Card footer: Required toggle switch -->
                <div class="q-card-foot">
                    <label class="toggle-wrap" onclick="BuilderManager.toggleRequired(${idx})">
                        <div class="toggle ${q.required ? 'on' : ''}" id="toggle_${q.id}"></div>
                        <span class="toggle-label">Required</span>
                    </label>
                </div>

            </div>`;
    },

    /*
     * renderQuestionBody
     * Returns the type-specific HTML for the editable body of a question card.
     * For choice types: a list of editable option inputs.
     * For others: a disabled preview of what the respondent will see.
     */
    renderQuestionBody(q, idx) {

        /* ── Multiple Choice / Checkbox / Dropdown ── */
        /* Show editable option list with add/remove controls */
        if (['multiple_choice', 'checkbox', 'dropdown'].includes(q.type)) {
            const optionsHtml = q.options.map((opt, oi) => `
                <div class="q-option-row">
                    <input class="q-option-input" type="text" value="${escHtml(opt)}"
                        oninput="BuilderManager.updateOption(${idx}, ${oi}, this.value)"
                        placeholder="Option ${oi + 1}">
                    <button class="q-option-del" onclick="BuilderManager.removeOption(${idx}, ${oi})" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6"  y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>`).join('');

            return `
                <div class="q-options">${optionsHtml}</div>
                <button class="q-add-option" onclick="BuilderManager.addOption(${idx})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5"  y1="12" x2="19" y2="12"/>
                    </svg>
                    Add option
                </button>`;
        }

        /* ── Rating ── preview of 5 numbered pips */
        if (q.type === 'rating') {
            return `
                <div class="rating-preview">
                    ${[1, 2, 3, 4, 5].map(n => `<div class="rating-pip">${n}</div>`).join('')}
                </div>
                <p style="font-size:11px;color:var(--text-muted)">1 = Not at all · 5 = Extremely</p>`;
        }

        /* ── Linear Scale ── preview + editable low/high labels */
        if (q.type === 'linear_scale') {
            return `
                <div class="rating-preview">
                    ${[1, 2, 3, 4, 5].map(n => `<div class="rating-pip">${n}</div>`).join('')}
                </div>
                <div style="display:flex;gap:10px;margin-top:8px">
                    <input class="q-option-input" type="text" placeholder="Low label (e.g. Poor)"
                        value="${escHtml(q.options[0] || '')}"
                        oninput="BuilderManager.updateOption(${idx}, 0, this.value)"
                        style="max-width:160px">
                    <input class="q-option-input" type="text" placeholder="High label (e.g. Excellent)"
                        value="${escHtml(q.options[1] || '')}"
                        oninput="BuilderManager.updateOption(${idx}, 1, this.value)"
                        style="max-width:160px">
                </div>`;
        }

        /* ── Yes / No ── static two-option preview */
        if (q.type === 'yes_no') {
            return `
                <div class="q-options">
                    <div class="q-option-row"><div class="q-preview-input">Yes</div></div>
                    <div class="q-option-row"><div class="q-preview-input">No</div></div>
                </div>`;
        }

        /* ── Text / Long Answer / Date / Number ── disabled input previews */
        if (q.type === 'text') {
            return `<input class="q-preview-input" type="text" placeholder="Short answer preview" disabled>`;
        }
        if (q.type === 'long_answer') {
            return `<textarea class="q-preview-input" placeholder="Long answer preview" rows="3" disabled></textarea>`;
        }
        if (q.type === 'date') {
            return `<input class="q-preview-input" type="date" disabled>`;
        }
        if (q.type === 'number') {
            return `<input class="q-preview-input" type="number" placeholder="0" disabled>`;
        }

        return '';
    },

    /*
     * toggleRequired
     * Flips the required flag on a question and updates the
     * toggle switch visual state without a full re-render.
     */
    toggleRequired(idx) {
        this.questions[idx].required = !this.questions[idx].required;
        const toggle = document.getElementById('toggle_' + this.questions[idx].id);
        if (toggle) toggle.classList.toggle('on', this.questions[idx].required);
    },


    /* ── SAVE & PREVIEW ──────────────────────────────────── */

    /*
     * saveSurvey
     * Validates the survey (title + at least one question), reads
     * any final values from the DOM, then saves to localStorage.
     * Also reads demographics from the sidebar inputs.
     */
    saveSurvey() {
        const title = document.getElementById('surveyTitleInput').value.trim();

        if (!title || title === 'Untitled Survey') {
            showToast('Give your survey a title first', 'error');
            return;
        }
        if (this.questions.length === 0) {
            showToast('Add at least one question', 'error');
            return;
        }

        /*
         * Sync question text from the DOM before saving.
         * This catches any changes that may not have fired oninput
         * (e.g. paste via right-click).
         */
        this.questions.forEach((q, i) => {
            const inp = document.querySelector(`#qcard_${q.id} .q-text-input`);
            if (inp) q.text = inp.value;

            /* Sync option text for choice-type questions */
            if (['multiple_choice', 'checkbox', 'dropdown'].includes(q.type)) {
                const opts = document.querySelectorAll(`#qcard_${q.id} .q-option-input`);
                q.options = Array.from(opts).map(o => o.value).filter(Boolean);
            }
        });

        /* Read demographic gate settings from sidebar */
        const demographics = {
            ageMin:     document.getElementById('demoAgeMin').value,
            ageMax:     document.getElementById('demoAgeMax').value,
            gender:     document.getElementById('demoGender').value,
            country:    document.getElementById('demoCountry').value,
            occupation: document.getElementById('demoOccupation').value
        };

        const survey = {
            id:           this.surveyId || StorageManager.generateId(),
            title,
            description:  document.getElementById('surveyDescInput').value,
            questions:    this.questions.map((q, i) => ({ ...q, id: q.id || `q_${i + 1}` })),
            demographics,
            createdAt:    this.surveyId
                            ? StorageManager.getSurvey(this.surveyId)?.createdAt
                            : new Date().toISOString(),
            updatedAt:    new Date().toISOString(),
            generatedByAI: false
        };

        /* If creating new, set createdAt explicitly */
        if (!this.surveyId) survey.createdAt = new Date().toISOString();

        /* Remember the ID so subsequent saves update rather than duplicate */
        this.surveyId = survey.id;

        StorageManager.saveSurvey(survey);
        showToast('Survey saved!', 'success');
    },

    /*
     * previewSurvey
     * Opens the live survey form in a new browser tab.
     * Requires the survey to be saved first so it has an ID.
     */
    previewSurvey() {
        if (!this.surveyId) {
            showToast('Save survey first to preview', 'error');
            return;
        }
        const base = window.location.origin + '/';
        window.open(base + 'survey.html?id=' + this.surveyId, '_blank');
    },

    /*
     * newSurvey
     * Resets the builder to a blank state and navigates to the builder section.
     * Called from the "Build Survey" button and the Builder nav tab.
     */
    newSurvey() {
        this.init();
        showSection('builder');
    }
};

/* Make BuilderManager available globally across all script files */
window.BuilderManager = BuilderManager;