/*
 * ============================================================
 *  storage.js  —  SurveySphere Data Layer
 * ============================================================
 *  Everything that touches localStorage lives here.
 *  All other JS files read/write data exclusively through
 *  this manager so there is one single source of truth.
 *
 *  Includes:
 *    - Survey CRUD  (create, read, update, delete)
 *    - Response storage
 *    - API key storage
 *    - CSV & TXT export helpers
 *    - ID & date formatting utilities
 *    - Template seeding (pre-loads 6 BTech survey templates)
 * ============================================================
 */

const StorageManager = {

    /* ── localStorage key names ─────────────────────────── */
    SURVEYS_KEY:   'surveysphere_surveys',
    RESPONSES_KEY: 'surveysphere_responses',
    API_KEY:       'surveysphere_api_key',


    /* ── SURVEY CRUD ─────────────────────────────────────── */

    /* Returns all surveys as an array (empty array if none exist) */
    getSurveys() {
        return JSON.parse(localStorage.getItem(this.SURVEYS_KEY) || '[]');
    },

    /* Finds a single survey by its ID, returns null if not found */
    getSurvey(id) {
        return this.getSurveys().find(s => s.id === id) || null;
    },

    /* Saves a survey — updates it if it already exists, adds it if new */
    saveSurvey(survey) {
        const surveys = this.getSurveys();
        const existingIndex = surveys.findIndex(s => s.id === survey.id);

        if (existingIndex !== -1) {
            /* Replace the existing survey at the same index */
            surveys[existingIndex] = survey;
        } else {
            /* New survey — push it to the end of the list */
            surveys.push(survey);
        }

        localStorage.setItem(this.SURVEYS_KEY, JSON.stringify(surveys));
        return survey;
    },

    /* Deletes a survey AND all its responses in one operation */
    deleteSurvey(id) {
        /* Remove the survey from the surveys list */
        const surveys = this.getSurveys().filter(s => s.id !== id);
        localStorage.setItem(this.SURVEYS_KEY, JSON.stringify(surveys));

        /* Also clean up all responses for this survey */
        const responses = this.getAllResponses();
        delete responses[id];
        localStorage.setItem(this.RESPONSES_KEY, JSON.stringify(responses));
    },


    /* ── RESPONSES ───────────────────────────────────────── */

    /*
     * All responses are stored as one object keyed by survey ID:
     * { "survey_123": [ response1, response2, ... ], ... }
     */
    getAllResponses() {
        return JSON.parse(localStorage.getItem(this.RESPONSES_KEY) || '{}');
    },

    /* Returns the responses array for a specific survey */
    getResponses(surveyId) {
        return this.getAllResponses()[surveyId] || [];
    },

    /* Appends a new response to the correct survey's response list */
    saveResponse(surveyId, response) {
        const all = this.getAllResponses();

        /* Initialise the array if this is the first response */
        if (!all[surveyId]) all[surveyId] = [];

        all[surveyId].push(response);
        localStorage.setItem(this.RESPONSES_KEY, JSON.stringify(all));
        return response;
    },


    /* ── API KEY ─────────────────────────────────────────── */

    /* Retrieves the saved Groq API key (null if not set) */
    getApiKey() {
        return localStorage.getItem(this.API_KEY);
    },

    /* Stores the API key so it persists across sessions */
    setApiKey(key) {
        localStorage.setItem(this.API_KEY, key);
    },


    /* ── ID & DATE UTILITIES ─────────────────────────────── */

    /* Generates a unique survey ID using timestamp + random string */
    generateId() {
        return 'survey_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    /* Generates a unique response ID */
    generateResponseId() {
        return 'resp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    /* Formats an ISO date string into a readable format e.g. "Mar 5, 2026" */
    formatDate(date) {
        return new Date(date).toLocaleDateString('en-US', {
            year:  'numeric',
            month: 'short',
            day:   'numeric'
        });
    },

    /* Formats a duration in seconds as "m:ss" e.g. 90s → "1:30" */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },


    /* ── EXPORTS ─────────────────────────────────────────── */

    /*
     * exportToCSV — builds a comma-separated values string
     * Each row = one response; columns = metadata + each question answer.
     * Returns null if there are no responses to export.
     */
    exportToCSV(surveyId) {
        const survey    = this.getSurvey(surveyId);
        const responses = this.getResponses(surveyId);
        if (!survey || responses.length === 0) return null;

        /* Build the header row — always include base columns */
        const headers = ['Response ID', 'Timestamp', 'Completion Time'];

        /* Only include demographic columns if the survey collected them */
        const demo = survey.demographics || {};
        if (demo.age        && demo.age        !== 'any') headers.push('Age');
        if (demo.gender     && demo.gender     !== 'any') headers.push('Gender');
        if (demo.country    && demo.country    !== 'any') headers.push('Country');
        if (demo.occupation && demo.occupation !== 'any') headers.push('Occupation');

        /* Add one column per question */
        survey.questions.forEach((q, i) => headers.push(`Q${i + 1}: ${q.text}`));

        /* Build each data row */
        const rows = [headers];
        responses.forEach(response => {
            const row = [
                response.id,
                new Date(response.completedAt).toLocaleString(),
                this.formatTime(response.totalTime || 0)
            ];

            /* Append demographic values if collected */
            if (demo.age        && demo.age        !== 'any') row.push(response.demographics?.age        || '');
            if (demo.gender     && demo.gender     !== 'any') row.push(response.demographics?.gender     || '');
            if (demo.country    && demo.country    !== 'any') row.push(response.demographics?.country    || '');
            if (demo.occupation && demo.occupation !== 'any') row.push(response.demographics?.occupation || '');

            /* Append each answer — join arrays (checkbox) with semicolons */
            response.answers.forEach(a => {
                row.push(Array.isArray(a.value) ? a.value.join('; ') : (a.value || ''));
            });

            rows.push(row);
        });

        /* Wrap every cell in quotes and escape any existing quotes */
        return rows
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');
    },

    /*
     * exportToTXT — builds a plain-text report string
     * Readable format, one section per response.
     * Returns null if there are no responses to export.
     */
    exportToTXT(surveyId) {
        const survey    = this.getSurvey(surveyId);
        const responses = this.getResponses(surveyId);
        if (!survey || responses.length === 0) return null;

        /* File header */
        let txt = `SURVEY EXPORT: ${survey.title}\n`;
        txt += `Exported: ${new Date().toLocaleString()}\n`;
        txt += `Total Responses: ${responses.length}\n`;
        txt += '='.repeat(60) + '\n\n';

        /* One block per response */
        responses.forEach((response, ri) => {
            txt += `RESPONSE #${ri + 1}\n`;
            txt += `Submitted: ${new Date(response.completedAt).toLocaleString()}\n`;
            txt += `Time: ${this.formatTime(response.totalTime || 0)}\n`;
            txt += '-'.repeat(40) + '\n';

            /* Print each question and its answer */
            survey.questions.forEach((q, qi) => {
                const ans = response.answers[qi];
                const val = ans
                    ? (Array.isArray(ans.value) ? ans.value.join(', ') : ans.value)
                    : '(no answer)';
                txt += `Q${qi + 1}: ${q.text}\nA: ${val}\n\n`;
            });

            txt += '\n';
        });

        return txt;
    },


    /* ── TEMPLATE SEEDING ────────────────────────────────── */

    /*
     * seedTemplate — called once on app load.
     * Checks which of the 6 built-in templates already exist by title
     * and only inserts the missing ones. This way templates are never
     * duplicated even if the user already has surveys in localStorage.
     */
    seedTemplate() {
        const surveys        = this.getSurveys();
        const existingTitles = surveys.map(s => s.title);

        const templateTitles = [
            'Customer Satisfaction Survey',
            'College Event Feedback',
            'Faculty Teaching Quality Feedback',
            'Campus Facilities & Infrastructure Survey',
            'Hackathon / Technical Fest Participant Survey',
            'Internship & Placement Experience Survey'
        ];

        /* Filter to only the templates that are not yet saved */
        const missing = templateTitles.filter(t => !existingTitles.includes(t));
        if (missing.length === 0) return;

        /*
         * Helper: generates an ISO timestamp offset by `offset` seconds
         * into the past so templates appear in the correct order
         */
        const ts = (offset = 0) => new Date(Date.now() - offset * 1000).toISOString();

        const templates = [

            /* ── 1. Customer Satisfaction ──────────────────── */
            {
                id:          this.generateId(),
                title:       'Customer Satisfaction Survey',
                description: 'Help us improve by sharing your experience with our service.',
                questions: [
                    { id: 'q1_1', text: 'How satisfied are you with our service overall?',          type: 'rating',         required: true,  options: [] },
                    { id: 'q1_2', text: 'How did you hear about us?',                                type: 'multiple_choice', required: true,  options: ['Social Media', 'Friend or Family', 'Search Engine', 'Advertisement', 'Other'] },
                    { id: 'q1_3', text: 'Which aspects do you find most valuable?',                 type: 'checkbox',        required: false, options: ['Product Quality', 'Customer Support', 'Pricing', 'Speed of Delivery', 'Ease of Use'] },
                    { id: 'q1_4', text: 'How would you rate our customer support?',                 type: 'rating',         required: true,  options: [] },
                    { id: 'q1_5', text: 'Would you recommend us to a friend or colleague?',         type: 'yes_no',          required: true,  options: [] },
                    { id: 'q1_6', text: 'How long have you been using our service?',                type: 'dropdown',        required: false, options: ['Less than 1 month', '1–6 months', '6–12 months', '1–2 years', 'More than 2 years'] },
                    { id: 'q1_7', text: 'What is one thing we could do better?',                    type: 'long_answer',     required: false, options: [] }
                ],
                demographics:   {},
                createdAt:      ts(5),
                generatedByAI:  false,
                isTemplate:     true
            },

            /* ── 2. College Event Feedback ─────────────────── */
            {
                id:          this.generateId(),
                title:       'College Event Feedback',
                description: 'Share your experience of the event to help us make future editions even better.',
                questions: [
                    { id: 'q2_1', text: 'Which event did you attend?',                                          type: 'dropdown',        required: true,  options: ['Technical Fest', 'Cultural Fest', 'Sports Meet', 'Hackathon', 'Seminar / Guest Lecture', 'Workshop', 'Other'] },
                    { id: 'q2_2', text: 'How would you rate the event overall?',                                type: 'rating',         required: true,  options: [] },
                    { id: 'q2_3', text: 'How was the event organisation and management?',                       type: 'rating',         required: true,  options: [] },
                    { id: 'q2_4', text: 'Which aspects of the event did you enjoy the most?',                  type: 'checkbox',        required: false, options: ['Performances / Competitions', 'Networking Opportunities', 'Guest Speakers', 'Food & Refreshments', 'Venue & Ambience', 'Activities & Games'] },
                    { id: 'q2_5', text: 'Was the event well-publicised and easy to find information about?',   type: 'yes_no',          required: true,  options: [] },
                    { id: 'q2_6', text: 'How would you rate the quality of speakers or performers?',           type: 'rating',         required: false, options: [] },
                    { id: 'q2_7', text: 'Would you attend this event again next year?',                        type: 'yes_no',          required: true,  options: [] },
                    { id: 'q2_8', text: 'What could the organisers have done better?',                         type: 'long_answer',     required: false, options: [] }
                ],
                demographics:   {},
                createdAt:      ts(4),
                generatedByAI:  false,
                isTemplate:     true
            },

            /* ── 3. Faculty Teaching Quality ───────────────── */
            {
                id:          this.generateId(),
                title:       'Faculty Teaching Quality Feedback',
                description: 'Anonymous feedback on teaching effectiveness to help faculty and the department improve.',
                questions: [
                    { id: 'q3_1', text: 'Which semester are you currently in?',                              type: 'dropdown',        required: true,  options: ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'] },
                    { id: 'q3_2', text: 'How clearly does the faculty explain concepts?',                   type: 'rating',         required: true,  options: [] },
                    { id: 'q3_3', text: 'How available is the faculty for doubt-solving outside class?',    type: 'rating',         required: true,  options: [] },
                    { id: 'q3_4', text: 'Which teaching methods does the faculty use?',                     type: 'checkbox',        required: false, options: ['Lecture-based', 'Presentations / Slides', 'Practical Demos', 'Problem Solving on Board', 'Videos & Case Studies', 'Discussions & Q&A'] },
                    { id: 'q3_5', text: 'Is the pace of lectures suitable for students?',                   type: 'multiple_choice', required: true,  options: ['Too fast', 'Slightly fast', 'Just right', 'Slightly slow', 'Too slow'] },
                    { id: 'q3_6', text: 'How would you rate the quality of study material provided?',       type: 'rating',         required: true,  options: [] },
                    { id: 'q3_7', text: 'Does the faculty encourage students to ask questions?',            type: 'yes_no',          required: true,  options: [] },
                    { id: 'q3_8', text: 'What suggestions do you have to improve the quality of teaching?', type: 'long_answer',     required: false, options: [] }
                ],
                demographics:   {},
                createdAt:      ts(3),
                generatedByAI:  false,
                isTemplate:     true
            },

            /* ── 4. Campus Facilities ──────────────────────── */
            {
                id:          this.generateId(),
                title:       'Campus Facilities & Infrastructure Survey',
                description: 'Rate campus facilities to help administration prioritise improvements.',
                questions: [
                    { id: 'q4_1', text: 'How satisfied are you with the college canteen / food quality?',    type: 'rating',          required: true,  options: [] },
                    { id: 'q4_2', text: 'How would you rate the library resources and availability?',        type: 'rating',          required: true,  options: [] },
                    { id: 'q4_3', text: 'Which facilities do you think need the most improvement?',         type: 'checkbox',        required: true,  options: ['Canteen & Food', 'Library', 'Classrooms', 'Labs & Equipment', 'Sports Facilities', 'Wi-Fi & Internet', 'Washrooms', 'Hostel'] },
                    { id: 'q4_4', text: 'How is the Wi-Fi connectivity across campus?',                     type: 'multiple_choice', required: true,  options: ['Excellent', 'Good', 'Average', 'Poor', 'Non-existent in my area'] },
                    { id: 'q4_5', text: 'Are the computer labs and equipment up to date?',                  type: 'yes_no',          required: true,  options: [] },
                    { id: 'q4_6', text: 'How would you rate cleanliness and maintenance of campus?',        type: 'rating',          required: true,  options: [] },
                    { id: 'q4_7', text: 'How satisfied are you with the sports and recreational facilities?', type: 'rating',        required: false, options: [] },
                    { id: 'q4_8', text: 'Describe the facility improvement you feel is most urgently needed.', type: 'long_answer',  required: false, options: [] }
                ],
                demographics:   {},
                createdAt:      ts(2),
                generatedByAI:  false,
                isTemplate:     true
            },

            /* ── 5. Hackathon / Technical Fest ─────────────── */
            {
                id:          this.generateId(),
                title:       'Hackathon / Technical Fest Participant Survey',
                description: 'Post-event feedback for hackathons and technical competitions.',
                questions: [
                    { id: 'q5_1', text: 'Which role did you participate in?',                               type: 'multiple_choice', required: true,  options: ['Competitor / Participant', 'Organiser / Volunteer', 'Mentor / Judge', 'Sponsor Representative', 'Spectator'] },
                    { id: 'q5_2', text: 'How would you rate the overall event experience?',                 type: 'rating',          required: true,  options: [] },
                    { id: 'q5_3', text: 'How was the problem statement quality and clarity?',               type: 'rating',          required: false, options: [] },
                    { id: 'q5_4', text: 'Which resources were made available during the event?',            type: 'checkbox',        required: false, options: ['Mentors', 'Cloud Credits / APIs', 'Hardware Kits', 'Food & Refreshments', 'Strong Internet', 'Printed Documentation'] },
                    { id: 'q5_5', text: 'Was the judging criteria clearly communicated and fair?',          type: 'yes_no',          required: true,  options: [] },
                    { id: 'q5_6', text: 'How was the time allocated for the hackathon?',                    type: 'multiple_choice', required: true,  options: ['Too short', 'Slightly short', 'Just right', 'A bit too long', 'Too long'] },
                    { id: 'q5_7', text: 'Would you participate in this hackathon again?',                   type: 'yes_no',          required: true,  options: [] },
                    { id: 'q5_8', text: 'What changes would make this hackathon better next time?',         type: 'long_answer',     required: false, options: [] }
                ],
                demographics:   {},
                createdAt:      ts(1),
                generatedByAI:  false,
                isTemplate:     true
            },

            /* ── 6. Internship & Placement ─────────────────── */
            {
                id:          this.generateId(),
                title:       'Internship & Placement Experience Survey',
                description: 'Help juniors and the placement cell understand the internship and placement process better.',
                questions: [
                    { id: 'q6_1', text: 'What type of opportunity did you secure?',                                 type: 'multiple_choice', required: true,  options: ['Summer Internship', '6-month Internship', 'Full-time Placement', 'PPO (Pre-Placement Offer)', 'Research Internship', 'Off-campus Role'] },
                    { id: 'q6_2', text: 'How did you find / apply for this opportunity?',                           type: 'multiple_choice', required: true,  options: ['College Placement Cell', 'LinkedIn', 'Company Website', 'Referral from Senior/Alumni', 'Job Portal (Internshala, Naukri etc.)', 'Hackathon / Competition'] },
                    { id: 'q6_3', text: 'Which rounds were part of your selection process?',                        type: 'checkbox',        required: true,  options: ['Online Aptitude Test', 'Coding Round', 'Technical Interview', 'HR Interview', 'Group Discussion', 'Case Study / Assignment'] },
                    { id: 'q6_4', text: 'How prepared did you feel for the interview process?',                     type: 'rating',          required: true,  options: [] },
                    { id: 'q6_5', text: 'How helpful was the college placement cell in your journey?',              type: 'rating',          required: true,  options: [] },
                    { id: 'q6_6', text: 'Which skill area was most tested during the process?',                     type: 'multiple_choice', required: false, options: ['Data Structures & Algorithms', 'System Design', 'Domain Knowledge', 'Communication & Soft Skills', 'Projects & Portfolio', 'Aptitude & Reasoning'] },
                    { id: 'q6_7', text: 'Would you recommend this company / role to your peers?',                   type: 'yes_no',          required: true,  options: [] },
                    { id: 'q6_8', text: 'What advice would you give to students preparing for placements?',         type: 'long_answer',     required: false, options: [] }
                ],
                demographics:   {},
                createdAt:      ts(0),
                generatedByAI:  false,
                isTemplate:     true
            }
        ];

        /* Save only the templates that are not already in localStorage */
        templates
            .filter(t => missing.includes(t.title))
            .forEach(t => this.saveSurvey(t));
    }
};

/* Make StorageManager available globally across all script files */
window.StorageManager = StorageManager;