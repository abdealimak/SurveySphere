/*
 * ============================================================
 *  analytics.js  —  SurveySphere Analytics Engine
 * ============================================================
 *  Handles everything in the Analytics section of the app.
 *
 *  Includes:
 *    - Sidebar: lists all surveys with response counts
 *    - renderAnalytics(): header stats + chart grid
 *    - renderQuestionCharts(): smart chart per question type
 *        · Rating        → vertical bar (red-to-gold gradient)
 *        · Linear Scale  → vertical bar (blue-to-gold gradient)
 *        · Multiple Choice / Yes-No / Dropdown → doughnut chart
 *        · Checkbox      → horizontal bar (multi-select comparison)
 *        · Number        → vertical bar (frequency distribution)
 *        · Text / Long Answer → text card list
 *        · Date          → sorted text list
 *    - renderTimeChart(): avg time per question bar chart
 *    - runAiAnalysis(): calls Groq AI to generate insights
 *    - exportCSV() / exportTXT(): trigger file downloads
 * ============================================================
 */

/* Tracks which survey is currently open in analytics */
let activeAnalyticsSurvey = null;

/* Stores all active Chart.js instances so we can destroy them
   before rendering new ones (prevents canvas memory leaks) */
let analyticsCharts = [];


/* ── SIDEBAR ─────────────────────────────────────────────── */

/*
 * loadAnalyticsSidebar
 * Rebuilds the left sidebar list of all surveys.
 * Called on initial load and whenever the active survey changes
 * so the highlight updates correctly.
 */
function loadAnalyticsSidebar() {
    const surveys   = StorageManager.getSurveys();
    const container = document.getElementById('analyticsSidebar');

    /* Reset to just the section label */
    container.innerHTML = '<div class="analytics-sidebar-label">Surveys</div>';

    if (surveys.length === 0) {
        container.innerHTML += '<p style="font-size:12px;color:var(--text-muted);padding:0 8px">No surveys yet.</p>';
        return;
    }

    /* Create one clickable item per survey */
    surveys.forEach(s => {
        const responses = StorageManager.getResponses(s.id);
        const item      = document.createElement('div');

        /* Highlight the currently selected survey */
        item.className = 'analytics-survey-item' + (activeAnalyticsSurvey === s.id ? ' active' : '');
        item.innerHTML = `
            <h4>${escHtml(s.title)}</h4>
            <p>${responses.length} response${responses.length !== 1 ? 's' : ''} · ${s.questions.length} questions</p>`;

        item.onclick = () => selectAnalyticsSurvey(s.id);
        container.appendChild(item);
    });
}

/*
 * selectAnalyticsSurvey
 * Sets the active survey, refreshes the sidebar highlight,
 * then renders the full analytics view for that survey.
 */
function selectAnalyticsSurvey(id) {
    activeAnalyticsSurvey = id;
    loadAnalyticsSidebar();
    renderAnalytics(id);
}


/* ── MAIN ANALYTICS VIEW ─────────────────────────────────── */

/*
 * renderAnalytics
 * Builds the full analytics panel for the given survey:
 *   1. Destroys any existing Chart.js instances
 *   2. Renders the header (title, export buttons, AI Insights)
 *   3. Renders the 3 stat cards (responses, questions, avg time)
 *   4. If responses exist — triggers chart rendering
 */
function renderAnalytics(id) {
    const survey    = StorageManager.getSurvey(id);
    const responses = StorageManager.getResponses(id);
    const main      = document.getElementById('analyticsMain');

    /* Destroy all previous Chart.js instances to free canvas memory */
    analyticsCharts.forEach(c => c.destroy());
    analyticsCharts = [];

    if (!survey) {
        main.innerHTML = '<div class="analytics-empty"><p>Survey not found.</p></div>';
        return;
    }

    /* Calculate average completion time across all responses */
    const avgTime = responses.length > 0
        ? Math.floor(responses.reduce((sum, r) => sum + (r.totalTime || 0), 0) / responses.length)
        : 0;

    /* Render the main HTML scaffold */
    main.innerHTML = `
        <div class="analytics-header">
            <div>
                <h2>${escHtml(survey.title)}</h2>
                <p>Created ${StorageManager.formatDate(survey.createdAt)}</p>
            </div>
            <div class="export-actions">
                <button class="btn btn-secondary btn-sm" onclick="exportCSV('${id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export CSV
                </button>
                <button class="btn btn-secondary btn-sm" onclick="exportTXT('${id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Export TXT
                </button>
                <button class="btn btn-ai btn-sm" onclick="runAiAnalysis('${id}')" id="aiInsightsBtn">✦ AI Insights</button>
            </div>
        </div>

        <!-- Summary stat cards -->
        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-card-val">${responses.length}</div>
                <div class="stat-card-label">Total Responses</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-val">${survey.questions.length}</div>
                <div class="stat-card-label">Questions</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-val">${StorageManager.formatTime(avgTime)}</div>
                <div class="stat-card-label">Avg Completion</div>
            </div>
        </div>

        ${responses.length === 0
            ? `<div class="no-data">No responses yet. Share your survey to collect data.</div>`
            : `<div class="charts-grid" id="chartsGrid"></div>
               <div id="aiInsightsContainer"></div>`
        }`;

    /* Only render charts if there is data to visualise */
    if (responses.length > 0) {
        renderQuestionCharts(survey, responses);
        renderTimeChart(survey, responses);
    }
}


/* ── QUESTION CHARTS ─────────────────────────────────────── */

/*
 * renderQuestionCharts
 * Loops through every question and renders the most appropriate
 * chart type based on the question's data type.
 *
 * Chart type decisions:
 *   rating / linear_scale → vertical bar (shows distribution across values)
 *   multiple_choice / yes_no / dropdown → doughnut (part-of-whole)
 *   checkbox → horizontal bar (multi-select, compare popularity)
 *   number → vertical bar (frequency distribution)
 *   text / long_answer → text card list (can't aggregate free text)
 *   date → sorted text list (no useful aggregation without buckets)
 */
function renderQuestionCharts(survey, responses) {
    const grid = document.getElementById('chartsGrid');
    if (!grid) return;

    /* Gold accent used for single-dataset charts */
    const GOLD = '#c9a84c';

    /* Colour palette used for multi-option charts */
    const colors = ['#c9a84c', '#a78bfa', '#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#34d399', '#f9a8d4'];

    /* Shared tooltip style — dark background matching app theme */
    const tooltipBase = {
        backgroundColor: '#1a1a1a',
        borderColor:     'rgba(255,255,255,0.08)',
        borderWidth:     1,
        titleColor:      '#ddd8cc',
        bodyColor:       '#888',
        padding:         10
    };

    /* Shared axis style — subtle grid lines, muted tick labels */
    const scaleBase = {
        x: {
            grid:  { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#666', font: { family: 'Sora', size: 11 } }
        },
        y: {
            grid:         { color: 'rgba(255,255,255,0.04)' },
            ticks:        { color: '#666', font: { family: 'Sora', size: 11 } },
            beginAtZero:  true
        }
    };

    /* Iterate over every question */
    survey.questions.forEach((q, qi) => {

        /* Collect non-empty answers for this question */
        const answers = responses
            .map(r => r.answers[qi]?.value)
            .filter(v => v !== null && v !== undefined && v !== '');

        /* Skip questions with no answers */
        if (answers.length === 0) return;

        const card   = document.createElement('div');
        const qTitle = escHtml(q.text || `Question ${qi + 1}`);


        /* ── TEXT / LONG ANSWER ──────────────────────────── */
        /* Free-text responses cannot be aggregated into a chart,
           so we display up to 6 responses as readable text cards */
        if (q.type === 'text' || q.type === 'long_answer') {
            card.className = 'chart-card chart-card-full';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">Open text · ${answers.length} answered</div>
                <div class="text-responses">
                    ${answers.slice(0, 6).map(a => `<div class="text-response-item">${escHtml(String(a))}</div>`).join('')}
                    ${answers.length > 6 ? `<div style="font-size:11px;color:var(--text-muted);padding:4px 0">+ ${answers.length - 6} more responses</div>` : ''}
                </div>`;
            grid.appendChild(card);
            return;
        }


        /* ── RATING ──────────────────────────────────────── */
        /* Vertical bar with warm-to-gold colour gradient.
           Low ratings (1) are muted red; high ratings (5) are gold.
           Average score is displayed as a large number callout. */
        if (q.type === 'rating') {
            const nums  = answers.map(Number).filter(n => !isNaN(n));
            const avg   = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);

            /* Build frequency distribution for stars 1–5 */
            const dist  = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            nums.forEach(n => { if (dist[n] !== undefined) dist[n]++; });

            /* Red → orange → yellow → light gold → gold */
            const barColors = ['#f87171cc', '#fb923ccc', '#fbbf24cc', '#e0be6ecc', '#c9a84ccc'];

            card.className = 'chart-card';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">Rating Scale · ${nums.length} answered</div>
                <div class="rating-summary">
                    <div class="rating-avg">${avg}</div>
                    <div style="margin-left:4px">
                        <div style="font-size:11px;color:var(--text-muted)">avg score</div>
                        <div style="font-size:10px;color:var(--text-muted)">out of 5</div>
                    </div>
                </div>
                <div class="chart-wrap-sm"><canvas id="chart_${qi}"></canvas></div>`;
            grid.appendChild(card);

            /* Use requestAnimationFrame to ensure the canvas is in the DOM */
            requestAnimationFrame(() => {
                const ctx = document.getElementById('chart_' + qi)?.getContext('2d');
                if (!ctx) return;

                /* Force integer Y-axis ticks (no 0.5, 1.5 etc.) */
                const intScale = {
                    x: scaleBase.x,
                    y: { ...scaleBase.y, ticks: { ...scaleBase.y.ticks, stepSize: 1, precision: 0 } }
                };

                analyticsCharts.push(new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels:   ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'],
                        datasets: [{
                            data:            Object.values(dist),
                            backgroundColor: barColors,
                            borderColor:     barColors.map(c => c.replace('cc', '')),
                            borderWidth:     1,
                            borderRadius:    5
                        }]
                    },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend:  { display: false },
                            tooltip: { ...tooltipBase, callbacks: { label: c => ` ${c.parsed.y} responses` } }
                        },
                        scales: intScale
                    }
                }));
            });
            return;
        }


        /* ── LINEAR SCALE ────────────────────────────────── */
        /* Same structure as rating but uses a blue-to-gold gradient
           to visually distinguish it. Also shows the low/high labels
           the creator defined (e.g. "Strongly Disagree → Strongly Agree"). */
        if (q.type === 'linear_scale') {
            const nums     = answers.map(Number).filter(n => !isNaN(n));
            const avg      = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
            const max      = 5;
            const dist     = {};
            for (let i = 1; i <= max; i++) dist[i] = 0;
            nums.forEach(n => { if (dist[n] !== undefined) dist[n]++; });

            /* Blue → indigo → purple → light gold → gold */
            const scaleColors = ['#60a5facc', '#818cf8cc', '#a78bfacc', '#e0be6ecc', '#c9a84ccc'];

            /* The creator can set custom low/high labels when building the survey */
            const lowLabel  = q.options?.[0] || 'Low';
            const highLabel = q.options?.[1] || 'High';

            card.className = 'chart-card';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">Linear Scale · ${nums.length} answered · <span style="color:var(--text-dim)">${lowLabel} → ${highLabel}</span></div>
                <div class="rating-summary">
                    <div class="rating-avg">${avg}</div>
                    <div style="margin-left:4px">
                        <div style="font-size:11px;color:var(--text-muted)">avg score</div>
                        <div style="font-size:10px;color:var(--text-muted)">out of ${max}</div>
                    </div>
                </div>
                <div class="chart-wrap-sm"><canvas id="chart_${qi}"></canvas></div>`;
            grid.appendChild(card);

            requestAnimationFrame(() => {
                const ctx = document.getElementById('chart_' + qi)?.getContext('2d');
                if (!ctx) return;
                const intScaleL = {
                    x: scaleBase.x,
                    y: { ...scaleBase.y, ticks: { ...scaleBase.y.ticks, stepSize: 1, precision: 0 } }
                };
                analyticsCharts.push(new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels:   Object.keys(dist),
                        datasets: [{
                            data:            Object.values(dist),
                            backgroundColor: scaleColors,
                            borderColor:     scaleColors.map(c => c.replace('cc', '')),
                            borderWidth:     1,
                            borderRadius:    5
                        }]
                    },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend:  { display: false },
                            tooltip: { ...tooltipBase, callbacks: { label: c => ` ${c.parsed.y} responses` } }
                        },
                        scales: intScaleL
                    }
                }));
            });
            return;
        }


        /* ── MULTIPLE CHOICE / YES-NO / DROPDOWN ─────────── */
        /* Doughnut chart — ideal for single-select "part of whole" data.
           Each slice represents the share of respondents who chose that option.
           A custom legend below the chart shows label + percentage. */
        if (['multiple_choice', 'yes_no', 'dropdown'].includes(q.type)) {
            const counts = {};
            answers.forEach(a => { counts[String(a)] = (counts[String(a)] || 0) + 1; });

            const labels       = Object.keys(counts);
            const data         = Object.values(counts);
            const total        = data.reduce((a, b) => a + b, 0);
            const bgColors     = labels.map((_, i) => colors[i % colors.length] + 'cc');
            const borderColors = labels.map((_, i) => colors[i % colors.length]);

            card.className = 'chart-card';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">${formatQType(q.type)} · ${answers.length} answered</div>
                <div class="donut-wrap">
                    <div class="donut-canvas-wrap"><canvas id="chart_${qi}"></canvas></div>
                    <div id="legend_${qi}" class="donut-legend"></div>
                </div>`;
            grid.appendChild(card);

            requestAnimationFrame(() => {
                const ctx = document.getElementById('chart_' + qi)?.getContext('2d');
                if (!ctx) return;

                analyticsCharts.push(new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels,
                        datasets: [{
                            data,
                            backgroundColor: bgColors,
                            borderColor:     '#0e0e0e',
                            borderWidth:     3,
                            hoverOffset:     5
                        }]
                    },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend:  { display: false },
                            tooltip: {
                                ...tooltipBase,
                                callbacks: {
                                    label: c => ` ${c.label}: ${c.parsed} (${((c.parsed / total) * 100).toFixed(1)}%)`
                                }
                            }
                        },
                        cutout: '65%'  /* Controls the "hole" size in the doughnut */
                    }
                }));

                /* Build the custom colour-coded legend below the chart */
                const legend = document.getElementById('legend_' + qi);
                if (legend) {
                    legend.innerHTML = labels.map((l, i) => `
                        <div class="donut-legend-item">
                            <div class="donut-legend-dot" style="background:${borderColors[i]}"></div>
                            <span class="donut-legend-label" title="${escHtml(l)}">${escHtml(l)}</span>
                            <span class="donut-legend-pct">${((data[i] / total) * 100).toFixed(0)}%</span>
                        </div>`).join('');
                }
            });
            return;
        }


        /* ── CHECKBOX (multi-select) ─────────────────────── */
        /* Horizontal bar chart — better than doughnut here because
           respondents can select multiple options, so slices don't
           add up to 100%. Instead bars show how many people selected
           each option, sorted from most to least popular. */
        if (q.type === 'checkbox') {
            const counts = {};
            answers.forEach(a => {
                /* Each answer can be a single value or an array of values */
                const vals = Array.isArray(a) ? a : [a];
                vals.forEach(v => { counts[String(v)] = (counts[String(v)] || 0) + 1; });
            });

            /* Sort options by popularity (most selected first) */
            const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
            const data   = labels.map(l => counts[l]);
            const total  = responses.length;

            card.className = 'chart-card chart-card-full';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">Checkboxes (multi-select) · ${answers.length} responded · percentages of total respondents</div>
                <div class="chart-wrap"><canvas id="chart_${qi}"></canvas></div>`;
            grid.appendChild(card);

            requestAnimationFrame(() => {
                const ctx = document.getElementById('chart_' + qi)?.getContext('2d');
                if (!ctx) return;
                analyticsCharts.push(new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            data,
                            backgroundColor: labels.map((_, i) => colors[i % colors.length] + '66'),
                            borderColor:     labels.map((_, i) => colors[i % colors.length]),
                            borderWidth:     1,
                            borderRadius:    5
                        }]
                    },
                    options: {
                        indexAxis: 'y',  /* Makes the bars horizontal */
                        responsive:          true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend:  { display: false },
                            tooltip: {
                                ...tooltipBase,
                                callbacks: {
                                    label: c => ` ${c.parsed.x} selected (${((c.parsed.x / total) * 100).toFixed(1)}% of respondents)`
                                }
                            }
                        },
                        scales: {
                            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#666', font: { family: 'Sora', size: 11 } }, beginAtZero: true },
                            y: { grid: { display: false },                  ticks: { color: '#aaa', font: { family: 'Sora', size: 11 } } }
                        }
                    }
                }));
            });
            return;
        }


        /* ── NUMBER ──────────────────────────────────────── */
        /* Vertical bar chart showing how often each numeric value
           was submitted (frequency distribution). */
        if (q.type === 'number') {
            const nums  = answers.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
            const avg   = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
            const counts = {};
            nums.forEach(n => { counts[n] = (counts[n] || 0) + 1; });

            const labels = Object.keys(counts);
            const data   = Object.values(counts);

            card.className = 'chart-card';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">Number · ${nums.length} answered · avg: ${avg}</div>
                <div class="chart-wrap"><canvas id="chart_${qi}"></canvas></div>`;
            grid.appendChild(card);

            requestAnimationFrame(() => {
                const ctx = document.getElementById('chart_' + qi)?.getContext('2d');
                if (!ctx) return;
                const intScaleN = {
                    x: scaleBase.x,
                    y: { ...scaleBase.y, ticks: { ...scaleBase.y.ticks, stepSize: 1, precision: 0 } }
                };
                analyticsCharts.push(new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            data,
                            backgroundColor: GOLD + '66',
                            borderColor:     GOLD,
                            borderWidth:     1,
                            borderRadius:    4
                        }]
                    },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend:  { display: false },
                            tooltip: { ...tooltipBase, callbacks: { label: c => ` ${c.parsed.y} responses` } }
                        },
                        scales: intScaleN
                    }
                }));
            });
            return;
        }


        /* ── DATE ────────────────────────────────────────── */
        /* Date values can't be meaningfully bucketed without more
           complex logic, so we just display them as a sorted list */
        if (q.type === 'date') {
            const sorted = [...answers].sort();
            card.className = 'chart-card';
            card.innerHTML = `
                <h4>${qTitle}</h4>
                <div class="chart-card-meta">Date · ${answers.length} answered</div>
                <div class="text-responses">
                    ${sorted.slice(0, 6).map(a => `<div class="text-response-item">${escHtml(String(a))}</div>`).join('')}
                    ${sorted.length > 6 ? `<div style="font-size:11px;color:var(--text-muted);padding:4px 0">+ ${sorted.length - 6} more</div>` : ''}
                </div>`;
            grid.appendChild(card);
        }

    }); /* end forEach question */
}


/* ── AI INSIGHTS ─────────────────────────────────────────── */

/*
 * runAiAnalysis
 * Sends survey + response data to the Groq AI model and renders
 * the returned insights: summary, sentiment score, key themes,
 * recommendations, and highlights.
 *
 * Requires a valid Groq API key to be saved in settings.
 */
async function runAiAnalysis(id) {
    const survey    = StorageManager.getSurvey(id);
    const responses = StorageManager.getResponses(id);

    if (!survey || responses.length === 0) {
        showToast('Need at least one response for AI analysis');
        return;
    }

    /* Show a prompt to add the key if it's not configured */
    if (!StorageManager.getApiKey()) {
        const container = document.getElementById('aiInsightsContainer');
        if (container) container.innerHTML = `
            <div class="ai-insights" style="border-color:var(--border)">
                <div class="ai-insights-header">
                    <span>✦</span>
                    <h4>AI Insights</h4>
                </div>
                <p class="ai-insights-summary">Add your Groq API key to unlock AI-powered analysis — sentiment scores, key themes, and actionable recommendations.</p>
                <button class="btn btn-secondary btn-sm" onclick="openApiModal()" style="margin-top:8px">Add API Key →</button>
            </div>`;
        return;
    }

    showLoading('Analysing responses with AI…');

    try {
        /* AIManager sends the data to Groq and returns structured JSON */
        const result = await AIManager.analyzeResponses(survey, responses);
        hideLoading();

        const container = document.getElementById('aiInsightsContainer');
        if (!container) return;

        /* Pick the sentiment indicator colour */
        const sentiment  = result.sentiment || {};
        const sentColor  = sentiment.overall === 'positive' ? '#4ade80'
                         : sentiment.overall === 'negative' ? '#f87171'
                         : '#c9a84c';

        /* Render the full insights card */
        container.innerHTML = `
            <div class="ai-insights">
                <div class="ai-insights-header">
                    <span>✦</span>
                    <h4>AI Insights</h4>
                    <span class="ai-insight-tag">POWERED BY GROQ</span>
                    ${sentiment.overall
                        ? `<span style="font-size:11px;color:${sentColor};margin-left:auto">${sentiment.overall} sentiment · ${sentiment.score || 0}/100</span>`
                        : ''}
                </div>

                <!-- Overall summary paragraph -->
                <p class="ai-insights-summary">${escHtml(result.summary || '')}</p>

                <!-- Key highlights as bullet arrows -->
                ${result.highlights?.length ? `
                    <div class="ai-highlights">
                        ${result.highlights.map(h => `<div class="ai-highlight">${escHtml(h)}</div>`).join('')}
                    </div>` : ''}

                <!-- Actionable recommendations -->
                ${result.recommendations?.length ? `
                    <div style="margin-top:16px">
                        <p style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px">Recommendations</p>
                        ${result.recommendations.map(r => `
                            <div style="margin-bottom:10px;padding:10px 14px;background:var(--bg-elevated);border-radius:6px;border-left:2px solid var(--gold-border)">
                                <p style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px">${escHtml(r.title)}</p>
                                <p style="font-size:12px;color:var(--text-muted)">${escHtml(r.description)}</p>
                            </div>`).join('')}
                    </div>` : ''}
            </div>`;

    } catch (err) {
        hideLoading();
        showToast('AI Insights failed: ' + err.message, 'error');
    }
}


/* ── TIME PER QUESTION CHART ─────────────────────────────── */

/*
 * renderTimeChart
 * Adds a bar chart showing the average time (in seconds) respondents
 * spent on each question. Bars over 30s are highlighted red to flag
 * potentially confusing or complex questions.
 *
 * Only renders if at least one response has time tracking data.
 */
function renderTimeChart(survey, responses) {
    const grid = document.getElementById('chartsGrid');
    if (!grid) return;

    /* Calculate average time per question across all responses */
    const avgTimes = survey.questions.map((q, qi) => {
        const times = responses
            .map(r => r.timePerQuestion?.[qi])
            .filter(t => typeof t === 'number');

        if (times.length === 0) return 0;
        return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    });

    /* Don't render the chart if no time data was collected */
    if (avgTimes.every(t => t === 0)) return;

    const card = document.createElement('div');
    card.className = 'chart-card chart-card-full';
    card.innerHTML = `
        <h4>Time Per Question</h4>
        <div class="chart-card-meta">Average seconds respondents spent on each question — bars over 30s (red) may indicate confusing or complex questions</div>
        <div class="chart-wrap"><canvas id="chart_timepq"></canvas></div>`;
    grid.appendChild(card);

    requestAnimationFrame(() => {
        const ctx = document.getElementById('chart_timepq')?.getContext('2d');
        if (!ctx) return;

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels:   survey.questions.map((q, i) => `Q${i + 1}`),
                datasets: [{
                    label:           'Avg seconds',
                    data:            avgTimes,
                    /* Red if >30s (potential confusion), gold otherwise */
                    backgroundColor: avgTimes.map(t => t > 30 ? 'rgba(248,113,113,0.5)' : 'rgba(201,168,76,0.45)'),
                    borderColor:     avgTimes.map(t => t > 30 ? '#f87171' : '#c9a84c'),
                    borderWidth:     1,
                    borderRadius:    4
                }]
            },
            options: {
                responsive:          true,
                maintainAspectRatio: false,
                plugins: {
                    legend:  { display: false },
                    tooltip: {
                        backgroundColor: '#1a1a1a',
                        borderColor:     'rgba(255,255,255,0.08)',
                        borderWidth:     1,
                        titleColor:      '#ddd8cc',
                        bodyColor:       '#888',
                        padding:         10,
                        callbacks:       { label: ctx => ` ${ctx.parsed.y}s avg` }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#666', font: { family: 'Sora', size: 11 } } },
                    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#666', font: { family: 'Sora', size: 11 }, callback: v => v + 's' }, beginAtZero: true }
                }
            }
        });

        analyticsCharts.push(chart);
    });
}


/* ── EXPORT HANDLERS ─────────────────────────────────────── */

/* Generates CSV data and triggers a browser file download */
function exportCSV(id) {
    const csv = StorageManager.exportToCSV(id);
    if (!csv) { showToast('No responses to export', 'error'); return; }
    const survey = StorageManager.getSurvey(id);
    downloadFile(csv, (survey?.title || 'survey').replace(/\s+/g, '_') + '_responses.csv', 'text/csv');
    showToast('CSV exported!', 'success');
}

/* Generates plain-text report and triggers a browser file download */
function exportTXT(id) {
    const txt = StorageManager.exportToTXT(id);
    if (!txt) { showToast('No responses to export', 'error'); return; }
    const survey = StorageManager.getSurvey(id);
    downloadFile(txt, (survey?.title || 'survey').replace(/\s+/g, '_') + '_responses.txt', 'text/plain');
    showToast('TXT exported!', 'success');
}

/*
 * downloadFile
 * Creates a temporary <a> tag, assigns a Blob URL to it,
 * programmatically clicks it to trigger the browser's
 * save-file dialog, then cleans up the URL.
 */
function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}


/* ── UTILITY ─────────────────────────────────────────────── */

/*
 * formatQType
 * Converts internal question type keys to human-readable labels
 * for display in chart cards.
 */
function formatQType(type) {
    const map = {
        multiple_choice: 'Multiple Choice',
        checkbox:        'Checkboxes',
        yes_no:          'Yes / No',
        dropdown:        'Dropdown',
        rating:          'Rating',
        linear_scale:    'Linear Scale',
        text:            'Short Text',
        long_answer:     'Long Answer',
        date:            'Date',
        number:          'Number'
    };
    return map[type] || type;
}