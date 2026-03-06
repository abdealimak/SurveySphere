/*
 * ============================================================
 *  app.js  —  SurveySphere Application Controller
 * ============================================================
 *  The main entry point and coordinator for the entire app.
 *  Initialises the app on page load and wires everything together.
 *
 *  Includes:
 *    - showSection()      — section routing (dashboard/builder/analytics)
 *    - showToast()        — temporary notification messages
 *    - showLoading()      — full-screen loading overlay for async tasks
 *    - openApiModal()     — Groq API key management modal
 *    - Dashboard          — survey card grid with tab switcher + search
 *    - Survey actions     — view analytics, edit, delete, share
 *    - AI modal           — Generate with AI form + submission
 *    - escHtml()          — XSS-safe HTML escaping utility
 *    - DOMContentLoaded   — seeds templates + initialises the app
 * ============================================================
 */


/* ── ROUTING ─────────────────────────────────────────────── */

/*
 * showSection
 * Switches the visible section (dashboard, builder, or analytics).
 * Deactivates all sections/tabs first, then activates the target.
 * Also triggers any section-specific data loading.
 */
function showSection(name) {
    /* Hide all sections and deselect all nav tabs */
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

    /* Show the requested section and highlight its nav tab */
    document.getElementById('section-' + name).classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');

    /* Load section-specific data */
    if (name === 'dashboard') loadDashboard();
    if (name === 'analytics') loadAnalyticsSidebar();
}


/* ── TOAST NOTIFICATIONS ─────────────────────────────────── */

/*
 * showToast
 * Displays a temporary slide-up notification at the bottom of the screen.
 * Automatically dismisses after ~2.8 seconds.
 * type: '' (default) | 'success' | 'error'
 */
function showToast(msg, type = '') {
    /* Create the toast element if it doesn't exist yet */
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.textContent = msg;
    toast.className = 'toast ' + type;

    /* Small delay before adding 'show' so the CSS transition fires */
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 2800);
}


/* ── LOADING OVERLAY ─────────────────────────────────────── */

/*
 * showLoading / hideLoading
 * Controls the full-screen blurred overlay shown during async
 * operations like AI generation and AI analysis.
 */
function showLoading(text = 'Loading...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}


/* ── API KEY MODAL ───────────────────────────────────────── */

/* Opens the API key modal and pre-fills with the saved key if any */
function openApiModal() {
    document.getElementById('apiKeyInput').value  = StorageManager.getApiKey() || '';
    document.getElementById('apiStatus').textContent = '';
    document.getElementById('apiStatus').className   = 'api-status';
    document.getElementById('apiModal').classList.add('active');
}

function closeApiModal() {
    document.getElementById('apiModal').classList.remove('active');
}

/*
 * saveApiKey
 * Validates the entered key by making a real test request to Groq.
 * Only saves the key if the test passes.
 */
async function saveApiKey() {
    const key    = document.getElementById('apiKeyInput').value.trim();
    const status = document.getElementById('apiStatus');

    if (!key) {
        status.textContent = 'Enter an API key';
        status.className   = 'api-status error';
        return;
    }

    showLoading('Testing API key…');
    const ok = await AIManager.testApiKey(key);
    hideLoading();

    if (ok) {
        StorageManager.setApiKey(key);
        status.textContent = '✓ API key saved successfully';
        status.className   = 'api-status success';
        /* Auto-close after 1.5s so the user sees the confirmation */
        setTimeout(closeApiModal, 1500);
    } else {
        status.textContent = '✗ Invalid API key. Check and try again.';
        status.className   = 'api-status error';
    }
}


/* ── DASHBOARD ───────────────────────────────────────────── */

/* Tracks which tab is active: 'my' (user surveys) or 'templates' */
let currentDashTab = 'my';

/*
 * buildSurveyCard
 * Builds and returns a single survey card DOM element.
 * Cards show title, date, response count, and action buttons.
 * Template cards get a gold "TEMPLATE" badge; AI-generated
 * cards get a purple "AI" badge.
 */
function buildSurveyCard(survey) {
    const responses = StorageManager.getResponses(survey.id);

    /* Determine the badge class based on how the survey was created */
    let cardClass = 'survey-card';
    if (survey.isTemplate)    cardClass += ' survey-card-template';
    else if (survey.generatedByAI) cardClass += ' survey-card-ai';

    const card = document.createElement('div');
    card.className = cardClass;
    card.innerHTML = `
        <h3>${escHtml(survey.title)}</h3>
        <p class="survey-card-meta">${StorageManager.formatDate(survey.createdAt)} · ${survey.questions.length} questions</p>
        <div class="survey-card-stats">
            <div>
                <div class="card-stat-val">${responses.length}</div>
                <div class="card-stat-label">Responses</div>
            </div>
            <div>
                <div class="card-stat-val">${survey.questions.length}</div>
                <div class="card-stat-label">Questions</div>
            </div>
        </div>
        <div class="survey-card-actions">
            <button class="btn btn-primary btn-sm" onclick="viewAnalytics('${survey.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6"  y1="20" x2="6"  y2="14"/>
                </svg>Analytics
            </button>
            <button class="btn btn-secondary btn-sm" onclick="shareSurvey('${survey.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>Share
            </button>
            <button class="btn btn-secondary btn-sm" onclick="editSurvey('${survey.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>Edit
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteSurvey('${survey.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>Delete
            </button>
        </div>`;

    return card;
}

/*
 * switchDashTab
 * Switches between "My Surveys" and "Templates" tabs.
 * Clears the search input and re-renders the grid.
 */
function switchDashTab(tab) {
    currentDashTab = tab;

    /* Update the active state on the tab buttons */
    document.getElementById('tabMySurveys').classList.toggle('active', tab === 'my');
    document.getElementById('tabTemplates').classList.toggle('active', tab === 'templates');

    /* Clear search so stale filters don't carry over between tabs */
    const search = document.getElementById('surveySearch');
    if (search) search.value = '';

    renderDashTab();
}

/*
 * renderDashTab
 * Renders the survey grid for the currently active tab.
 * Optionally filters results by a search string.
 * Shows an appropriate empty state if no surveys match.
 */
function renderDashTab(filter = '') {
    const surveys    = StorageManager.getSurveys();
    const grid       = document.getElementById('surveysGrid');
    const isTemplate = currentDashTab === 'templates';

    grid.innerHTML = '';

    /* Filter to only the surveys/templates for the active tab */
    let list = surveys.filter(s => !!s.isTemplate === isTemplate);

    /* Apply text search filter if provided */
    if (filter) {
        const query = filter.toLowerCase();
        list = list.filter(s =>
            s.title.toLowerCase().includes(query) ||
            (s.description || '').toLowerCase().includes(query)
        );
    }

    /* Show empty state if nothing to display */
    if (list.length === 0) {
        const msg = filter
            ? `No ${isTemplate ? 'templates' : 'surveys'} match "${escHtml(filter)}"`
            : isTemplate
                ? 'No templates available.'
                : 'No surveys yet. Build one or generate with AI.';

        grid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 11l3 3L22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                <h3>${isTemplate ? 'No templates' : 'No surveys yet'}</h3>
                <p>${msg}</p>
            </div>`;
        return;
    }

    /* Append one card per survey */
    list.forEach(s => grid.appendChild(buildSurveyCard(s)));
}

/* Called when navigating to the dashboard tab */
function loadDashboard() {
    renderDashTab();
}

/*
 * filterSurveys
 * Called on every keystroke in the search input.
 * Re-renders the current tab with the search filter applied.
 */
function filterSurveys(query) {
    renderDashTab(query);
}


/* ── SURVEY ACTIONS ──────────────────────────────────────── */

/* Navigates to Analytics and auto-selects the given survey */
function viewAnalytics(id) {
    showSection('analytics');
    /* Small delay to let the section render before selecting */
    setTimeout(() => selectAnalyticsSurvey(id), 50);
}

/* Opens the builder with the selected survey loaded for editing */
function editSurvey(id) {
    const survey = StorageManager.getSurvey(id);
    if (!survey) return;
    showSection('builder');
    setTimeout(() => BuilderManager.loadSurvey(survey), 50);
}

/*
 * deleteSurvey
 * Asks for confirmation then permanently removes the survey
 * and all its responses from localStorage.
 */
function deleteSurvey(id) {
    const survey = StorageManager.getSurvey(id);
    if (!survey) return;
    if (!confirm(`Delete "${survey.title}"? This also removes all responses.`)) return;
    StorageManager.deleteSurvey(id);
    loadDashboard();
    showToast('Survey deleted');
}

/*
 * shareSurvey
 * Builds a shareable link to survey.html with the survey ID
 * as a query parameter, then shows the share modal.
 */
function shareSurvey(id) {
    const base = window.location.origin + window.location.pathname.replace('index.html', '');
    const url  = base + 'survey.html?id=' + id;
    document.getElementById('shareLink').value = url;
    document.getElementById('shareModal').classList.add('active');
}

function closeShareModal() {
    document.getElementById('shareModal').classList.remove('active');
}

/* Copies the share link to clipboard using the Clipboard API with fallback */
function copyShareLink() {
    const inp = document.getElementById('shareLink');
    inp.select();
    navigator.clipboard.writeText(inp.value)
        .then(() => showToast('Link copied!', 'success'))
        .catch(() => {
            /* Fallback for older browsers */
            document.execCommand('copy');
            showToast('Link copied!', 'success');
        });
}


/* ── AI SURVEY MODAL ─────────────────────────────────────── */

function openAiModal() {
    document.getElementById('aiModal').classList.add('active');
}

function closeAiModal() {
    document.getElementById('aiModal').classList.remove('active');
    document.getElementById('aiForm').reset();
    document.getElementById('aiError').textContent = '';
}

/*
 * submitAiForm
 * Collects all form values, validates them, then calls
 * AIManager.generateSurvey() to create a survey via Groq AI.
 * On success: saves the survey, opens it in the builder.
 */
async function submitAiForm(e) {
    e.preventDefault();

    /* Require a valid API key before attempting generation */
    if (!StorageManager.getApiKey()) {
        document.getElementById('aiError').textContent = 'Add your Groq API key first (top-right button).';
        return;
    }

    /* Require at least one question type to be selected */
    const qtypes = Array.from(document.querySelectorAll('#aiForm .qtype-cb:checked'))
        .map(cb => cb.value);
    if (qtypes.length === 0) {
        document.getElementById('aiError').textContent = 'Select at least one question type.';
        return;
    }

    document.getElementById('aiError').textContent = '';

    /* Collect all form values into a params object */
    const params = {
        title:         document.getElementById('aiTitle').value,
        purpose:       document.getElementById('aiPurpose').value,
        audience:      document.getElementById('aiAudience').value,
        questionCount: parseInt(document.getElementById('aiCount').value),
        tone:          document.getElementById('aiTone').value,
        topics:        document.getElementById('aiTopics').value,
        questionTypes: qtypes,
        demographics:  { age: 'any', gender: 'any', country: 'any', occupation: 'any' }
    };

    closeAiModal();
    showLoading('Generating your survey with AI…');

    try {
        /* Call Groq to generate the survey, then save and open it */
        const survey = await AIManager.generateSurvey(params);
        StorageManager.saveSurvey(survey);
        hideLoading();
        showToast('Survey generated!', 'success');
        loadDashboard();
        showSection('builder');
        setTimeout(() => BuilderManager.loadSurvey(survey), 50);
    } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
    }
}


/* ── UTILITIES ───────────────────────────────────────────── */

/*
 * escHtml
 * Escapes special HTML characters to prevent XSS injection.
 * Used whenever user-generated content is inserted into innerHTML.
 */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


/* ── INITIALISATION ──────────────────────────────────────── */

/*
 * DOMContentLoaded
 * Runs once the HTML is fully parsed.
 * 1. Seeds the 6 built-in templates (skips any already present)
 * 2. Shows the dashboard as the default starting section
 * 3. Wires up backdrop click to close any open modal
 */
document.addEventListener('DOMContentLoaded', () => {

    /* Insert built-in templates into localStorage if missing */
    StorageManager.seedTemplate();

    /* Start on the dashboard */
    showSection('dashboard');

    /* Clicking the dark backdrop behind a modal closes it */
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

});