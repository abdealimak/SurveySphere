/*
 * ============================================================
 *  survey.js  —  SurveySphere Survey Response Handler
 * ============================================================
 *  Runs on survey.html. Loads the survey from localStorage
 *  using the ?id= query parameter and walks the respondent
 *  through it one question at a time.
 *
 *  Includes:
 *    - Eligibility gate: validates demographics before Q1
 *    - showQuestion()    — renders one question with its saved answer
 *    - renderAnswer()    — builds the type-specific answer UI
 *    - selectOption()    — handles single-select (radio-style) clicks
 *    - toggleCheckbox()  — handles multi-select (checkbox-style) clicks
 *    - selectRating()    — handles rating/linear scale button clicks
 *    - saveAnswer()      — stores text/dropdown/date/number answers
 *    - nextQuestion()    — validates required answer then advances
 *    - prevQuestion()    — goes back without validation
 *    - submitSurvey()    — validates all required Qs then saves response
 *    - saveTime()        — records time spent on the current question
 *    - showError()       — renders an inline validation error message
 *    - clearError()      — removes the error message
 * ============================================================
 */


/* ── STATE ───────────────────────────────────────────────── */

let currentSurvey        = null;  /* The loaded survey object */
let currentQuestionIndex = 0;     /* Which question is currently visible */
let userAnswers          = [];    /* Stores one answer per question index */
let demographicData      = {};    /* Stores eligibility gate answers */
let questionStartTime    = null;  /* Timestamp when current question was shown */
let timePerQuestion      = [];    /* Seconds spent on each question */
let surveyStartTime      = null;  /* Timestamp when Q1 was first shown */


/* ── ENTRY POINT ─────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

    /* Read the survey ID from the URL query string (?id=survey_xxx) */
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) { show('surveyNotFound'); return; }

    currentSurvey = StorageManager.getSurvey(id);
    if (!currentSurvey) { show('surveyNotFound'); return; }

    /* Set the browser tab title to the survey name */
    document.title = currentSurvey.title + ' — SurveySphere';

    /* Initialise answers array with nulls — one slot per question */
    userAnswers = new Array(currentSurvey.questions.length).fill(null);

    show('surveyForm');

    /*
     * Check if any demographic gate is configured.
     * If yes, show the eligibility screen first.
     * If no restrictions, jump straight to Q1.
     */
    const d = currentSurvey.demographics;
    const hasGate = d && typeof d === 'object' && (
        (d.ageMin || d.ageMax) ||
        (d.gender     && d.gender     !== 'any') ||
        (d.country    && d.country    !== 'any') ||
        (d.occupation && d.occupation !== 'any')
    );

    if (hasGate) {
        showEligibilityScreen();
    } else {
        startSurvey();
    }

    /* Wire up the navigation buttons */
    document.getElementById('prevBtn').addEventListener('click', prevQuestion);
    document.getElementById('nextBtn').addEventListener('click', nextQuestion);
    document.getElementById('submitBtn').addEventListener('click', submitSurvey);
});


/* ── VISIBILITY HELPERS ──────────────────────────────────── */

/*
 * show
 * Shows one of the three main views and hides the others:
 *   surveyNotFound — invalid/missing survey ID
 *   surveyForm     — the active question-by-question form
 *   surveyCompleted — thank you screen after submission
 */
function show(id) {
    ['surveyNotFound', 'surveyForm', 'surveyCompleted'].forEach(s => {
        document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
}

/* Begins the survey — records start time and shows the first question */
function startSurvey() {
    surveyStartTime = Date.now();
    showQuestion(0);
}


/* ── ELIGIBILITY GATE ────────────────────────────────────── */

/*
 * showEligibilityScreen
 * Renders a form collecting only the demographic fields that
 * the survey creator restricted. The respondent must confirm
 * they meet the criteria before they can access Q1.
 */
function showEligibilityScreen() {
    const container = document.getElementById('questionContainer');
    const d         = currentSurvey.demographics;

    let html = `
        <div class="question-number">Eligibility Check</div>
        <div class="question-text">Please confirm you meet the criteria for this survey.</div>`;

    /* Age field — shown only if a min or max age was set */
    if (d.ageMin || d.ageMax) {
        const label = d.ageMin && d.ageMax ? d.ageMin + '–' + d.ageMax
                    : d.ageMin             ? d.ageMin + '+'
                    : 'Under ' + d.ageMax;

        html += `
            <div style="margin-bottom:14px">
                <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px">
                    Your Age <span style="color:var(--red)">*</span>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Required: ${label}</p>
                <input class="form-input" id="elig_age" type="number" placeholder="Enter your age" min="0" max="120">
            </div>`;
    }

    /* Gender field */
    if (d.gender && d.gender !== 'any') {
        html += `
            <div style="margin-bottom:14px">
                <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px">
                    Gender <span style="color:var(--red)">*</span>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Required: ${d.gender}</p>
                <select class="form-select" id="elig_gender">
                    <option value="">Select your gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non-binary">Non-binary</option>
                    <option value="other">Other</option>
                </select>
            </div>`;
    }

    /* Location/country field */
    if (d.country && d.country !== 'any') {
        const countryNames = { US: 'United States', IN: 'India', UK: 'United Kingdom', CA: 'Canada', AU: 'Australia', other: 'Other' };
        html += `
            <div style="margin-bottom:14px">
                <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px">
                    Location <span style="color:var(--red)">*</span>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Required: ${countryNames[d.country] || d.country}</p>
                <select class="form-select" id="elig_country">
                    <option value="">Select your country</option>
                    <option value="US">United States</option>
                    <option value="IN">India</option>
                    <option value="UK">United Kingdom</option>
                    <option value="CA">Canada</option>
                    <option value="AU">Australia</option>
                    <option value="other">Other</option>
                </select>
            </div>`;
    }

    /* Occupation field */
    if (d.occupation && d.occupation !== 'any') {
        html += `
            <div style="margin-bottom:14px">
                <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px">
                    Occupation <span style="color:var(--red)">*</span>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Required: ${d.occupation}</p>
                <select class="form-select" id="elig_occupation">
                    <option value="">Select your occupation</option>
                    <option value="student">Student</option>
                    <option value="employed">Employed</option>
                    <option value="self-employed">Self-employed</option>
                    <option value="unemployed">Unemployed</option>
                    <option value="retired">Retired</option>
                </select>
            </div>`;
    }

    container.innerHTML = html;

    /* Show only the "Check Eligibility" button */
    document.getElementById('prevBtn').style.display   = 'none';
    document.getElementById('nextBtn').style.display   = 'flex';
    document.getElementById('nextBtn').textContent     = 'Check Eligibility →';
    document.getElementById('submitBtn').style.display = 'none';

    /* Override Next button to run eligibility check instead of advancing */
    document.getElementById('nextBtn').onclick = checkEligibility;
}

/*
 * checkEligibility
 * Validates each filled demographic field against the survey's requirements.
 * Stores matching values in demographicData for later inclusion in the response.
 * Shows the ineligible screen if any criteria are not met.
 */
function checkEligibility() {
    const d          = currentSurvey.demographics;
    let mismatches   = [];

    /* Validate age */
    if (d.ageMin || d.ageMax) {
        const age = parseInt(document.getElementById('elig_age')?.value);
        if (!age) { showError('Please enter your age'); return; }
        if (d.ageMin && age < parseInt(d.ageMin)) mismatches.push('Age must be ' + d.ageMin + '+');
        if (d.ageMax && age > parseInt(d.ageMax)) mismatches.push('Age must be under ' + d.ageMax);
        demographicData.age = age;
    }

    /* Validate gender */
    if (d.gender && d.gender !== 'any') {
        const gender = document.getElementById('elig_gender')?.value;
        if (!gender) { showError('Please select your gender'); return; }
        if (gender !== d.gender) mismatches.push('Gender must be ' + d.gender);
        demographicData.gender = gender;
    }

    /* Validate country */
    if (d.country && d.country !== 'any') {
        const country = document.getElementById('elig_country')?.value;
        if (!country) { showError('Please select your country'); return; }
        if (country !== d.country) mismatches.push('Location must be ' + d.country);
        demographicData.country = country;
    }

    /* Validate occupation */
    if (d.occupation && d.occupation !== 'any') {
        const occupation = document.getElementById('elig_occupation')?.value;
        if (!occupation) { showError('Please select your occupation'); return; }
        if (occupation !== d.occupation) mismatches.push('Occupation must be ' + d.occupation);
        demographicData.occupation = occupation;
    }

    /* If any criteria failed, show the rejection screen */
    if (mismatches.length > 0) {
        showIneligibleScreen(mismatches);
        return;
    }

    /* All criteria passed — restore the Next button and start the survey */
    document.getElementById('nextBtn').onclick = null;
    clearError();
    startSurvey();
}

/*
 * showIneligibleScreen
 * Shown when the respondent does not meet the demographic criteria.
 * Lists each failed requirement and hides all navigation buttons.
 */
function showIneligibleScreen(reasons) {
    document.getElementById('questionContainer').innerHTML = `
        <div style="text-align:center;padding:24px 0">
            <div style="width:52px;height:52px;border-radius:50%;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 18px">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
            </div>
            <h3 style="font-size:18px;font-weight:600;color:var(--text);margin-bottom:8px">Not eligible</h3>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:18px">You don't meet the criteria for this survey.</p>
            <div style="background:var(--bg-elevated);border:1px solid rgba(248,113,113,0.15);border-radius:8px;padding:14px;text-align:left">
                ${reasons.map(r => `
                    <div style="font-size:12px;color:var(--red);padding:3px 0;display:flex;gap:8px">
                        <span>✕</span><span>${escHtml(r)}</span>
                    </div>`).join('')}
            </div>
        </div>`;

    /* Hide all navigation controls */
    document.getElementById('prevBtn').style.display   = 'none';
    document.getElementById('nextBtn').style.display   = 'none';
    document.getElementById('submitBtn').style.display = 'none';
}


/* ── QUESTION DISPLAY ────────────────────────────────────── */

/*
 * showQuestion
 * Renders the question at the given index.
 * Updates the progress bar, shows/hides navigation buttons,
 * and starts the per-question timer.
 */
function showQuestion(index) {
    if (index < 0 || index >= currentSurvey.questions.length) return;

    currentQuestionIndex = index;
    questionStartTime    = Date.now();  /* Start timing this question */
    clearError();

    const q     = currentSurvey.questions[index];
    const total = currentSurvey.questions.length;

    /* Update progress bar width and label */
    document.getElementById('progressFill').style.width  = (((index + 1) / total) * 100) + '%';
    document.getElementById('progressLabel').textContent = (index + 1) + ' / ' + total;

    /* Render the question and its answer area */
    document.getElementById('questionContainer').innerHTML = `
        <div class="question-number">Question ${index + 1} of ${total}</div>
        <div class="question-text">
            ${escHtml(q.text)}${q.required ? '<span class="question-required">*</span>' : ''}
        </div>
        <div id="answerArea">${renderAnswer(q, index)}</div>`;

    /* Show/hide Previous button */
    document.getElementById('prevBtn').style.display = index > 0 ? 'flex' : 'none';

    /* Show Next or Submit depending on whether this is the last question */
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.style.display   = index < total - 1 ? 'flex' : 'none';
    nextBtn.textContent     = 'Next';
    nextBtn.onclick         = null;  /* Clear any eligibility override */

    document.getElementById('submitBtn').style.display = index === total - 1 ? 'flex' : 'none';
}

/*
 * renderAnswer
 * Returns the HTML string for the answer area of a given question.
 * Pre-selects/fills with the saved answer if the user navigated back.
 */
function renderAnswer(q, index) {
    const saved = userAnswers[index];

    /* ── Single select: Multiple Choice + Yes/No ── */
    if (q.type === 'multiple_choice' || q.type === 'yes_no') {
        const opts = q.type === 'yes_no' ? ['Yes', 'No'] : q.options;
        return '<div class="option-list">' +
            opts.map(opt => `
                <div class="option-item ${saved === opt ? 'selected' : ''}"
                     onclick="selectOption(${index}, '${escAttr(opt)}', this)">
                    <div class="option-dot"></div>
                    <span class="option-label">${escHtml(opt)}</span>
                </div>`).join('') +
            '</div>';
    }

    /* ── Multi select: Checkbox ── */
    if (q.type === 'checkbox') {
        const checked = Array.isArray(saved) ? saved : [];
        return '<div class="option-list">' +
            q.options.map(opt => `
                <div class="option-item ${checked.includes(opt) ? 'selected' : ''}"
                     onclick="toggleCheckbox(${index}, '${escAttr(opt)}', this)">
                    <div class="option-check"></div>
                    <span class="option-label">${escHtml(opt)}</span>
                </div>`).join('') +
            '</div>';
    }

    /* ── Dropdown ── */
    if (q.type === 'dropdown') {
        return `
            <select class="form-select" onchange="saveAnswer(${index}, this.value)">
                <option value="">Select an option</option>
                ${q.options.map(opt => `
                    <option value="${escAttr(opt)}" ${saved === opt ? 'selected' : ''}>
                        ${escHtml(opt)}
                    </option>`).join('')}
            </select>`;
    }

    /* ── Rating (1–5 stars) ── */
    if (q.type === 'rating') {
        return `
            <div class="rating-row">
                ${[1, 2, 3, 4, 5].map(n => `
                    <button class="rating-btn ${saved === n ? 'selected' : ''}"
                            onclick="selectRating(${index}, ${n}, this)">
                        ${n}
                    </button>`).join('')}
            </div>
            <div class="rating-scale-labels">
                <span>Not at all</span>
                <span>Extremely</span>
            </div>`;
    }

    /* ── Linear Scale (1 to scaleMax) ── */
    if (q.type === 'linear_scale') {
        const max = parseInt(q.scaleMax) || 5;
        return `
            <div class="rating-row">
                ${Array.from({ length: max }, (_, i) => i + 1).map(n => `
                    <button class="rating-btn ${saved === n ? 'selected' : ''}"
                            onclick="selectRating(${index}, ${n}, this)">
                        ${n}
                    </button>`).join('')}
            </div>
            <div class="rating-scale-labels">
                <span>${escHtml(q.options?.[0] || 'Low')}</span>
                <span>${escHtml(q.options?.[1] || 'High')}</span>
            </div>`;
    }

    /* ── Short Text ── */
    if (q.type === 'text') {
        return `<input class="form-input" type="text" placeholder="Your answer…"
                    value="${escAttr(saved || '')}"
                    oninput="saveAnswer(${index}, this.value)">`;
    }

    /* ── Long Answer ── */
    if (q.type === 'long_answer') {
        return `<textarea class="form-textarea" rows="5" placeholder="Your answer…"
                    oninput="saveAnswer(${index}, this.value)">${escHtml(saved || '')}</textarea>`;
    }

    /* ── Date ── */
    if (q.type === 'date') {
        return `<input class="form-input" type="date"
                    value="${escAttr(saved || '')}"
                    onchange="saveAnswer(${index}, this.value)">`;
    }

    /* ── Number ── */
    if (q.type === 'number') {
        return `<input class="form-input" type="number" placeholder="0"
                    value="${escAttr(saved || '')}"
                    oninput="saveAnswer(${index}, this.value)">`;
    }

    return '';
}


/* ── ANSWER HANDLERS ─────────────────────────────────────── */

/*
 * selectOption
 * Handles single-select answers (multiple choice, yes/no).
 * Stores the selected value and updates the visual selected state.
 * Using divs instead of <label>+<input> avoids the browser's native
 * double-fire where clicking a label triggers both the onclick and
 * the associated input's change event.
 */
function selectOption(index, value, clickedEl) {
    userAnswers[index] = value;

    /* Deselect all options in this question */
    document.querySelectorAll('#answerArea .option-item').forEach(el => el.classList.remove('selected'));

    /* Highlight the clicked one */
    clickedEl.classList.add('selected');
    clearError();
}

/*
 * toggleCheckbox
 * Handles multi-select answers (checkboxes).
 * Adds or removes the value from the array and toggles its visual state.
 */
function toggleCheckbox(index, value, clickedEl) {
    if (!Array.isArray(userAnswers[index])) userAnswers[index] = [];

    const arr = userAnswers[index];
    const pos = arr.indexOf(value);

    if (pos === -1) {
        /* Not selected yet — add it */
        arr.push(value);
    } else {
        /* Already selected — remove it */
        arr.splice(pos, 1);
    }

    /* Toggle the visual selected state to match the data */
    clickedEl.classList.toggle('selected', arr.includes(value));
    clearError();
}

/*
 * selectRating
 * Handles rating scale and linear scale button clicks.
 * Stores the numeric value and highlights only the clicked button.
 */
function selectRating(index, value, clickedBtn) {
    userAnswers[index] = value;

    /* Remove selected from all rating buttons */
    document.querySelectorAll('#answerArea .rating-btn').forEach(b => b.classList.remove('selected'));

    /* Highlight the clicked one */
    clickedBtn.classList.add('selected');
    clearError();
}

/*
 * saveAnswer
 * Used by text inputs, dropdowns, date, and number fields.
 * Stores the value directly (no visual state to manage).
 */
function saveAnswer(index, value) {
    userAnswers[index] = value;
    clearError();
}


/* ── NAVIGATION ──────────────────────────────────────────── */

/*
 * nextQuestion
 * Validates the current question if it's required,
 * records the time spent, then advances to the next question.
 */
function nextQuestion() {
    const q   = currentSurvey.questions[currentQuestionIndex];
    const ans = userAnswers[currentQuestionIndex];

    /* Block navigation if a required question has no answer */
    if (q.required) {
        const isEmpty = !ans || (Array.isArray(ans) && ans.length === 0) || ans === '';
        if (isEmpty) {
            showError('Please answer this question before continuing');
            return;
        }
    }

    saveTime();
    showQuestion(currentQuestionIndex + 1);
}

/* Goes back one question without any validation */
function prevQuestion() {
    saveTime();
    clearError();
    showQuestion(currentQuestionIndex - 1);
}

/*
 * submitSurvey
 * Validates ALL required questions before submitting.
 * If any are unanswered, it jumps to that question and shows an error.
 * On success, saves the full response object to localStorage.
 */
function submitSurvey() {
    /* Check every question for required compliance */
    for (let i = 0; i < currentSurvey.questions.length; i++) {
        const q   = currentSurvey.questions[i];
        const ans = userAnswers[i];
        const isEmpty = !ans || (Array.isArray(ans) && ans.length === 0) || ans === '';

        if (q.required && isEmpty) {
            /* Jump to the unanswered question and show an error */
            showQuestion(i);
            setTimeout(() => showError('Please answer this question before submitting'), 30);
            return;
        }
    }

    /* Record final question time */
    saveTime();

    /* Calculate total time in seconds */
    const totalTime = Math.floor((Date.now() - surveyStartTime) / 1000);

    /* Build and save the response object */
    StorageManager.saveResponse(currentSurvey.id, {
        id:              StorageManager.generateResponseId(),
        surveyId:        currentSurvey.id,
        answers:         userAnswers.map((value, i) => ({
                             questionId: currentSurvey.questions[i].id,
                             value
                         })),
        demographics:    demographicData,
        timePerQuestion: timePerQuestion,
        totalTime:       totalTime,
        completedAt:     new Date().toISOString()
    });

    /* Show the thank you screen */
    show('surveyCompleted');
    document.getElementById('completionTime').innerHTML =
        `<p style="font-size:13px;color:var(--text-muted)">Completed in ${StorageManager.formatTime(totalTime)}</p>`;
}


/* ── TIMING ──────────────────────────────────────────────── */

/*
 * saveTime
 * Records the number of seconds spent on the current question.
 * Called before navigating away from a question.
 * This data is used in the analytics "Time Per Question" chart.
 */
function saveTime() {
    if (questionStartTime) {
        timePerQuestion[currentQuestionIndex] = Math.floor((Date.now() - questionStartTime) / 1000);
    }
}


/* ── ERROR HANDLING ──────────────────────────────────────── */

/*
 * showError
 * Appends a styled inline error message to the question container.
 * Replaces any existing error first.
 */
function showError(msg) {
    clearError();
    const container = document.getElementById('questionContainer');
    const error     = document.createElement('div');
    error.id        = 'questionError';
    error.className = 'question-error';
    error.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8"  x2="12"   y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        ${msg}`;
    container.appendChild(error);
}

/* Removes the inline error message if one is currently shown */
function clearError() {
    document.getElementById('questionError')?.remove();
}


/* ── XSS SAFETY UTILITIES ────────────────────────────────── */

/* Escapes HTML special characters for safe insertion into innerHTML */
function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Escapes double quotes for safe use in HTML attribute values */
function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
}