/*
 * ============================================================
 *  ai.js  —  SurveySphere AI Integration (Groq)
 * ============================================================
 *  Handles all communication with the Groq AI API.
 *  Uses the llama-3.3-70b-versatile model via Groq's
 *  OpenAI-compatible chat completions endpoint.
 *
 *  Includes:
 *    - post()             — shared fetch helper for all API calls
 *    - testApiKey()       — verifies a key is valid before saving
 *    - generateSurvey()   — creates a full survey from parameters
 *    - analyzeResponses() — analyses response data and returns
 *                           structured insights (sentiment, themes,
 *                           recommendations, highlights)
 * ============================================================
 */

const AIManager = {

    /* Groq's OpenAI-compatible endpoint */
    ENDPOINT: 'https://api.groq.com/openai/v1/chat/completions',

    /* Model to use — fast, free-tier capable, great at structured JSON */
    MODEL: 'llama-3.3-70b-versatile',

    /* Retrieves the saved API key from localStorage */
    getApiKey() {
        return StorageManager.getApiKey();
    },


    /* ── CORE FETCH HELPER ───────────────────────────────── */

    /*
     * post
     * Sends a chat completion request to Groq.
     * Uses a system prompt to set the AI's role/behaviour
     * and a user prompt containing the actual task.
     *
     * Automatically strips markdown code fences from the response
     * so the caller always receives clean text or JSON.
     */
    async post(apiKey, systemPrompt, userPrompt, temperature, maxTokens) {
        const res = await fetch(this.ENDPOINT, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + apiKey   /* Groq uses standard Bearer auth */
            },
            body: JSON.stringify({
                model:       this.MODEL,
                temperature: temperature,
                max_tokens:  maxTokens,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt }
                ]
            })
        });

        const data = await res.json();

        /* 401 = bad key, fail immediately with a clear message */
        if (res.status === 401) throw new Error('Invalid API key.');

        /* Any other API-level error (rate limit, model error, etc.) */
        if (data.error) throw new Error(data.error.message || 'API error');

        /* Extract the text content from the first completion choice */
        const text = data.choices?.[0]?.message?.content || '';

        /* Strip markdown code fences in case the model wraps output in ```json */ 
        return text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    },


    /* ── API KEY VALIDATION ──────────────────────────────── */

    /*
     * testApiKey
     * Sends a minimal "Hi" message to check if the key is valid.
     *
     * Status code logic:
     *   200 (res.ok)  → valid key, request succeeded ✓
     *   429           → rate limited, but the key itself IS valid ✓
     *   400/401/403   → bad or malformed key ✗
     *
     * We must check res.ok (2xx) OR 429 specifically.
     * The previous check of "not 401/403" was wrong because Groq
     * returns 400 for invalid keys, which would incorrectly pass.
     */
    async testApiKey(apiKey) {
        try {
            const res = await fetch(this.ENDPOINT, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({
                    model:      this.MODEL,
                    max_tokens: 5,
                    messages:   [{ role: 'user', content: 'Hi' }]
                })
            });

            /* 429 = rate limited but key is valid; res.ok = genuine 2xx success */
            return res.status === 429 || res.ok;

        } catch {
            /* Network error or other failure */
            return false;
        }
    },


    /* ── SURVEY GENERATION ───────────────────────────────── */

    /*
     * generateSurvey
     * Takes the parameters from the AI generation modal and
     * prompts Groq to return a JSON array of survey questions.
     *
     * The AI returns raw JSON which we parse and wrap into a
     * full survey object ready to save in localStorage.
     */
    async generateSurvey(params) {
        const apiKey = this.getApiKey();
        if (!apiKey) throw new Error('No API key. Add your Groq API key in settings.');

        /* System prompt: strict role — return JSON only */
        const system = 'You are a survey builder. Return ONLY valid JSON, no markdown, no explanation.';

        /* User prompt: build from parameters using array join (avoids template literal issues) */
        const user = [
            'Generate a survey with these specs:',
            'Title: '                    + params.title,
            'Purpose: '                  + params.purpose,
            'Audience: '                 + params.audience,
            'Number of questions: '      + params.questionCount,
            'Question types to use: '    + params.questionTypes.join(', '),
            'Tone: '                     + params.tone,
            params.topics ? 'Topics to cover: ' + params.topics : '',
            '',
            'Return this JSON structure:',
            '{ "questions": [ { "text": "...", "type": "multiple_choice", "required": true, "options": ["A", "B", "C"] } ] }',
            '',
            'Valid types: multiple_choice, checkbox, rating, text, long_answer, yes_no, dropdown, linear_scale, date, number',
            'Only include "options" for multiple_choice, checkbox, yes_no, dropdown types.'
        ].filter(Boolean).join('\n');

        /* Call the API */
        const raw = await this.post(apiKey, system, user, 0.7, 2048);

        /* Extract the JSON object from the response */
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Failed to parse AI response');

        const parsed = JSON.parse(match[0]);

        /* Wrap into a complete survey object */
        return {
            id:          StorageManager.generateId(),
            title:       params.title,
            description: params.purpose,
            questions:   parsed.questions.map(function(q, i) {
                return {
                    id:       'q_' + (i + 1),
                    text:     q.text,
                    type:     q.type,
                    required: q.required !== false,
                    options:  q.options || []
                };
            }),
            demographics:  params.demographics || {},
            createdAt:     new Date().toISOString(),
            generatedByAI: true
        };
    },


    /* ── RESPONSE ANALYSIS ───────────────────────────────── */

    /*
     * analyzeResponses
     * Aggregates survey response data into a readable summary,
     * then sends it to Groq for AI-powered analysis.
     *
     * Returns a structured object with:
     *   - summary        : 2-3 sentence overview
     *   - sentiment      : overall tone + score out of 100
     *   - keyThemes      : recurring topics with frequency
     *   - recommendations: actionable next steps with priority
     *   - highlights     : 3 key insights as bullet points
     */
    async analyzeResponses(survey, responses) {
        const apiKey = this.getApiKey();
        if (!apiKey) throw new Error('No API key configured.');

        /* ── Step 1: Aggregate response data into readable text ── */
        let dataLines = '';

        survey.questions.forEach(function(q, qi) {
            dataLines += '\nQ' + (qi + 1) + ': ' + q.text + ' (' + q.type + ')\n';

            /* Collect non-empty answers for this question */
            const answers = responses.map(function(r) {
                return r.answers && r.answers[qi] && r.answers[qi].value;
            }).filter(Boolean);

            /* Format based on question type */
            if (['multiple_choice', 'yes_no', 'dropdown'].includes(q.type)) {
                /* Count how many times each option was selected */
                const counts = {};
                answers.forEach(function(a) { counts[a] = (counts[a] || 0) + 1; });
                Object.entries(counts).forEach(function(kv) {
                    dataLines += '  ' + kv[0] + ': ' + kv[1] + ' responses\n';
                });

            } else if (q.type === 'rating' || q.type === 'linear_scale') {
                /* Calculate average score */
                const nums = answers.map(Number).filter(function(n) { return !isNaN(n); });
                if (nums.length > 0) {
                    const avg = nums.reduce(function(a, b) { return a + b; }, 0) / nums.length;
                    dataLines += '  Average: ' + avg.toFixed(2) + '\n';
                }

            } else if (q.type === 'checkbox') {
                /* Count selections across all checkbox answers (each can be an array) */
                const counts = {};
                answers.forEach(function(a) {
                    var vals = Array.isArray(a) ? a : [a];
                    vals.forEach(function(v) { counts[v] = (counts[v] || 0) + 1; });
                });
                Object.entries(counts).forEach(function(kv) {
                    dataLines += '  ' + kv[0] + ': ' + kv[1] + ' responses\n';
                });

            } else if (q.type === 'text' || q.type === 'long_answer') {
                /* Include first 5 text responses as examples */
                answers.slice(0, 5).forEach(function(a, i) {
                    dataLines += '  ' + (i + 1) + '. ' + String(a).substring(0, 120) + '\n';
                });
            }
        });

        /* ── Step 2: Build the AI prompt ── */
        const system = 'You are a survey analyst. Return ONLY a valid JSON object, no markdown, no explanation, no extra text.';

        const user = [
            'Analyze this survey response data:',
            '',
            'Survey: '          + survey.title,
            'Total responses: ' + responses.length,
            '',
            dataLines,
            '',
            'Return exactly this JSON shape (fill in real values based on the data):',
            '{',
            '  "summary": "2-3 sentence overview of the responses",',
            '  "sentiment": { "overall": "positive", "score": 72, "description": "one sentence" },',
            '  "keyThemes": [ { "theme": "Theme Name", "description": "what this means", "frequency": "60%" } ],',
            '  "recommendations": [ { "title": "Action title", "description": "what to do", "priority": "high" } ],',
            '  "highlights": [ "Insight 1", "Insight 2", "Insight 3" ]',
            '}'
        ].join('\n');

        /* ── Step 3: Call the API and parse the response ── */
        const raw   = await this.post(apiKey, system, user, 0.4, 1024);
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Could not parse AI response. Try again.');

        return JSON.parse(match[0]);
    }
};

/* Make AIManager available globally across all script files */
window.AIManager = AIManager;