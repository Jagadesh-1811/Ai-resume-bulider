function resolveApiBase() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:8000/api';
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (window.location.port === '8000') {
            return `${window.location.origin}/api`;
        }
        return 'http://localhost:8000/api';
    }

    // Production environment - use the production backend on Vercel
    return 'https://ai-resume-bulider-six.vercel.app/api';
}

function getFetchErrorMessage(error, action = 'connect to the server') {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
        if (window.location.protocol === 'file:') {
            return 'This page was opened as a local file. Open http://localhost:8000 in the browser instead.';
        }
        return `CORS or network error: Could not ${action}. Backend: ${API_BASE} (this is usually a CORS issue). Check browser console for details. `;
    }
    return error?.message || 'Request failed.';
}

const API_BASE = resolveApiBase();

async function apiFetch(path, options = {}, action = 'complete the request') {
    const url = `${API_BASE}${path}`;
    
    // Ensure proper headers for JSON requests
    if (!options.headers) {
        options.headers = {};
    }
    if (!options.headers['Content-Type'] && options.method !== 'GET') {
        options.headers['Content-Type'] = 'application/json';
    }

    try {
        console.log(`[API] ${options.method || 'GET'} ${url}`);
        const response = await fetch(url, options);
        
        // Log response status
        console.log(`[API] Response status: ${response.status}`);
        
        // Log CORS headers if present
        if (response.headers.get('Access-Control-Allow-Origin')) {
            console.log(`[API] CORS header found: ${response.headers.get('Access-Control-Allow-Origin')}`);
        }
        
        return response;
    } catch (error) {
        console.error(`[API ERROR] ${url}:`, error);
        throw new Error(`${getFetchErrorMessage(error, action)} Endpoint: ${url}`);
    }
}
let currentSessionId = 'session-' + Math.random().toString(36).substring(7);
let currentResumeId = 'resume-demo-123';

// DOM Elements
const templateSelector = document.getElementById('templateSelector');
const resumeDocument = document.getElementById('resumeDocument');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportDocxBtn = document.getElementById('exportDocxBtn');
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Chat DOM Elements
const chatHistory = document.getElementById('chatHistory');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

// Analysis DOM Elements
const runAnalysisBtn = document.getElementById('runAnalysisBtn');
const analyzeJdBtn = document.getElementById('analyzeJdBtn');
const jobDescriptionInput = document.getElementById('jobDescriptionInput');
const jdAnalysisResults = document.getElementById('jdAnalysisResults');

// Auth Variables
let isLoginMode = true;
let authToken = null;
let currentUser = null;
let supabaseClient = null;
let googleAuthUnavailableReason = '';
const GOOGLE_AUTH_PROGRESS_KEY = 'googleAuthInProgress';
let lastHandledLoginKey = null;
let oauthFinalizeInProgress = false;

// ---------- Resume Preview Cache (7-day localStorage) ----------
const RESUME_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
function resumeCacheKey(resumeId) { return `resumeCache_${resumeId}`; }

function saveResumeCache(resumeId, resumeObj) {
    try {
        localStorage.setItem(resumeCacheKey(resumeId), JSON.stringify({
            data: resumeObj,
            savedAt: Date.now()
        }));
    } catch (e) { /* Storage full — silently ignore */ }
}

function loadResumeCache(resumeId) {
    try {
        const raw = localStorage.getItem(resumeCacheKey(resumeId));
        if (!raw) return null;
        const { data, savedAt } = JSON.parse(raw);
        if (Date.now() - savedAt > RESUME_CACHE_TTL) {
            localStorage.removeItem(resumeCacheKey(resumeId)); // expired
            return null;
        }
        return data;
    } catch (e) { return null; }
}

function clearResumeCache(resumeId) {
    localStorage.removeItem(resumeCacheKey(resumeId));
}

// ---------- Chat History Cache (sessionStorage) ----------
const CHAT_HISTORY_KEY = 'chatHistoryCache';

function saveChatHistory() {
    if (!currentUser) return;
    try {
        const messages = [];
        document.querySelectorAll('#chatHistory .message').forEach(msg => {
            const role = msg.classList.contains('user') ? 'user' : 'assistant';
            const text = msg.querySelector('.bubble')?.innerText || '';
            if (text && text !== '...') {
                messages.push({ role, text });
            }
        });
        sessionStorage.setItem(CHAT_HISTORY_KEY + '_' + currentUser.id, JSON.stringify(messages));
    } catch (e) { /* Storage full - ignore */ }
}

function loadChatHistory() {
    if (!currentUser) return;
    try {
        const raw = sessionStorage.getItem(CHAT_HISTORY_KEY + '_' + currentUser.id);
        if (!raw) return;
        const messages = JSON.parse(raw);
        const chatHistoryEl = document.getElementById('chatHistory');
        chatHistoryEl.innerHTML = ''; // clear existing
        messages.forEach(msg => {
            appendMessage(msg.text, msg.role, false, true); // skipSave = true
        });
    } catch (e) { /* Parse error - ignore */ }
}

function clearChatHistory() {
    if (currentUser) {
        sessionStorage.removeItem(CHAT_HISTORY_KEY + '_' + currentUser.id);
    }
}

// ---------- Resume Cache Update Helper ----------
function updateAndSaveResumeCache(extractedData) {
    if (!currentResumeId || !extractedData) return;
    try {
        // Load existing cache or start fresh
        let existing = loadResumeCache(currentResumeId) || {};
        
        // Merge extracted data into existing cache
        Object.keys(extractedData).forEach(key => {
            const newVal = extractedData[key];
            const oldVal = existing[key];
            
            // For arrays, merge unique values
            if (Array.isArray(newVal) && Array.isArray(oldVal)) {
                const merged = [...oldVal];
                newVal.forEach(item => {
                    // Check for duplicates (for objects, compare stringified)
                    const isDupe = merged.some(m => 
                        JSON.stringify(m) === JSON.stringify(item)
                    );
                    if (!isDupe) merged.push(item);
                });
                existing[key] = merged;
            } else if (Array.isArray(newVal)) {
                existing[key] = newVal;
            } else if (newVal && typeof newVal === 'string') {
                existing[key] = newVal;
            } else if (newVal && typeof newVal === 'object') {
                existing[key] = { ...oldVal, ...newVal };
            }
        });
        
        saveResumeCache(currentResumeId, existing);
    } catch (e) { /* Ignore errors */ }
}
// -----------------------------------------------------------

function showAuthError(message) {
    const errorDiv = document.getElementById('authError');
    if (!errorDiv) return;

    let normalizedMessage = message || 'Authentication failed.';
    const lowerMessage = normalizedMessage.toLowerCase();
    if (lowerMessage.includes('unable to exchange external code')) {
        normalizedMessage = 'Google sign-in is configured incorrectly in Supabase or Google Cloud. Fix the Google provider client ID, client secret, and redirect URI settings.';
    }

    errorDiv.innerText = normalizedMessage;
    errorDiv.style.display = 'block';
}

function showAuthDebug(message) {
    const debugDiv = document.getElementById('authDebug');
    if (!debugDiv) return;
    debugDiv.innerText = message;
    debugDiv.style.display = 'block';
}

function clearGoogleAuthProgress() {
    localStorage.removeItem(GOOGLE_AUTH_PROGRESS_KEY);
}

async function finalizeOAuthSession(session) {
    if (!session?.access_token) {
        throw new Error('Missing OAuth session token.');
    }

    if (oauthFinalizeInProgress) {
        return;
    }

    oauthFinalizeInProgress = true;

    try {
        showAuthDebug(`Finalizing OAuth login with backend for ${session.user?.email || 'user'}...`);

        const response = await apiFetch('/auth/oauth/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: session.access_token })
        }, 'complete Google sign-in');

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || 'OAuth completion failed.');
        }

        clearGoogleAuthProgress();
        handleSuccessfulLogin(data.access_token, data.user);
    } finally {
        oauthFinalizeInProgress = false;
    }
}

async function waitForSupabaseSession(maxAttempts = 10, delayMs = 400) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            showAuthDebug(`Recovered session on attempt ${attempt} for ${session.user?.email || 'user'}`);
            return session;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function safeMessage(value) {
    if (value && typeof value === 'object' && typeof value.message === 'string') return value.message;
    if (typeof value === 'string') return value;
    return '';
}

function setGoogleAuthButtonState(isEnabled, reason = '') {
    const googleBtn = document.getElementById('googleAuthBtn');
    if (!googleBtn) return;

    googleBtn.disabled = !isEnabled;
    googleBtn.style.opacity = isEnabled ? '1' : '0.6';
    googleBtn.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
    googleBtn.title = isEnabled ? '' : reason;
    googleAuthUnavailableReason = reason;
}

function buildDocxHtmlFromResume() {
    const clone = resumeDocument.cloneNode(true);

    // Remove interactive controls and edit markers for clean DOCX export
    clone.querySelectorAll('.enhance-btn').forEach((btn) => btn.remove());
    clone.querySelectorAll('[contenteditable="true"]').forEach((el) => {
        el.removeAttribute('contenteditable');
    });

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Calibri, Arial, sans-serif; color: #1f2937; margin: 24px; }
        .resume-wrapper { max-width: 900px; margin: 0 auto; }
        .resume-header h1 { margin: 0; font-size: 28px; }
        .resume-header p { margin: 4px 0 10px 0; font-size: 16px; color: #4b5563; }
        .contact-info { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 12px; }
        .resume-section { margin-top: 18px; }
        .resume-section h2 { font-size: 16px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px; margin-bottom: 8px; }
        .experience-item { margin-bottom: 12px; }
        .item-header h3 { margin: 0; font-size: 14px; }
        .company, .date { margin-left: 8px; color: #6b7280; font-size: 12px; }
        .bullet-list { margin: 8px 0 0 18px; padding: 0; }
        .skills-list { display: block; }
        .skill-tag { display: inline-block; border: 1px solid #d1d5db; border-radius: 999px; padding: 2px 8px; margin: 4px 6px 0 0; font-size: 12px; }
    </style>
</head>
<body>
    ${clone.outerHTML}
</body>
</html>`;
}

function triggerDocxDownload(blob, fileName) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

// --- Diagnostic Helper ---
async function diagnoseBackendConnection() {
    console.log('=== CORS & Backend Diagnostic ===');
    console.log('Frontend URL:', window.location.origin);
    console.log('API Base:', API_BASE);
    console.log('Protocol:', window.location.protocol);
    console.log('Hostname:', window.location.hostname);
    
    try {
        const healthRes = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        console.log('Health Check Status:', healthRes.status);
        console.log('Health Check OK:', healthRes.ok);
        if (healthRes.ok) {
            const data = await healthRes.json();
            console.log('Health Data:', data);
        } else {
            console.warn('Health check failed with status:', healthRes.status);
        }
    } catch (err) {
        console.error('Backend unreachable - CORS issue or backend down:', err.message);
    }
}

// --- Initialize App & Supabase ---
async function initApp() {
    if (window.location.protocol === 'file:') {
        const fileOriginMessage = 'This page was opened as a local file. Start the backend and open http://localhost:8000 instead.';
        showAuthError(fileOriginMessage);
        setGoogleAuthButtonState(false, fileOriginMessage);
        return;
    }

    // Check localStorage for existing session first
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');
    let sessionRestored = false;
    
    console.log('Attempting session restore:', {
        hasToken: !!savedToken,
        hasUser: !!savedUser,
        tokenLength: savedToken?.length,
        userEmail: savedUser ? JSON.parse(savedUser)?.email : 'N/A'
    });
    
    if (savedToken && savedUser) {
        try {
            const user = JSON.parse(savedUser);
            
            // Validate token with backend before restoring session
            try {
                const validateRes = await apiFetch('/auth/validate', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${savedToken}` }
                }, 'validate session').catch(err => {
                    console.warn('Validation fetch failed:', err);
                    return null;
                });
                
                if (validateRes && validateRes.ok) {
                    console.log('✓ Token validated successfully');
                    handleSuccessfulLogin(savedToken, user, true); // true = skip welcome message on restore
                    sessionRestored = true;
                } else if (validateRes && validateRes.status === 401) {
                    // Only clear if explicitly 401 (unauthorized)
                    console.warn('✗ Token rejected (401), clearing session');
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('currentUser');
                } else {
                    // For any other response or null, assume token is still valid
                    console.log('⚠ Validation inconclusive, restoring session anyway');
                    handleSuccessfulLogin(savedToken, user, true);
                    sessionRestored = true;
                }
            } catch (validationError) {
                // Network error or other validation issue - restore session anyway
                console.warn('⚠ Validation error, restoring session:', validationError?.message);
                handleSuccessfulLogin(savedToken, user, true);
                sessionRestored = true;
            }
        } catch (parseError) {
            console.error('✗ Failed to parse saved session:', parseError);
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
        }
    }
    
    if (!sessionRestored) {
        console.log('No session to restore');
    }

    try {
        const healthRes = await apiFetch('/health', { cache: 'no-store' }, 'reach the backend');
        if (!healthRes.ok) {
            throw new Error(`Backend health check failed (${healthRes.status}). Make sure backend is running.`);
        }
        const healthData = await healthRes.json();

        const res = await apiFetch('/config', { cache: 'no-store' }, 'load app configuration');
        if (!res.ok) {
            throw new Error(`Backend config request failed (${res.status}). Make sure backend is running and .env is in backend folder.`);
        }

        const config = await res.json();
        if (!config.supabaseUrl || !config.supabaseKey) {
            throw new Error("Missing SUPABASE_URL or SUPABASE_KEY in backend/.env");
        }

        if (!window.supabase) {
            throw new Error('Supabase client library failed to load in frontend.');
        }

        supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'implicit'
            }
        });
        setGoogleAuthButtonState(true);

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                finalizeOAuthSession(session).catch((error) => {
                    showAuthError(error.message || 'Google login failed.');
                });
            }
        });

        const url = new URL(window.location.href);
        const authCode = url.searchParams.get('code');
        const authError = url.searchParams.get('error_description') || url.searchParams.get('error');
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const authInProgress = localStorage.getItem(GOOGLE_AUTH_PROGRESS_KEY) === 'true';

        if (authError) {
            showAuthDebug(`OAuth returned error: ${authError}`);
            showAuthError(authError);
        }

        if (authCode) {
            showAuthDebug(`OAuth code detected. Exchanging for session...`);
            const { data, error } = await supabaseClient.auth.exchangeCodeForSession(authCode);
            if (error) throw error;
            if (data?.session) {
                showAuthDebug(`Code exchange succeeded for ${data.session.user?.email || 'user'}`);
                window.history.replaceState({}, document.title, window.location.pathname);
                await finalizeOAuthSession(data.session);
                return;
            }
        }

        if (accessToken && refreshToken) {
            showAuthDebug(`OAuth tokens detected in URL hash. Setting session...`);
            const { data, error } = await supabaseClient.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });
            if (error) throw error;
            if (data?.session) {
                showAuthDebug(`Hash session set for ${data.session.user?.email || 'user'}`);
                window.history.replaceState({}, document.title, window.location.pathname);
                await finalizeOAuthSession(data.session);
                return;
            }
        }

        // Check for existing OAuth session on load
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError) {
            throw sessionError;
        }
        if (session) {
            showAuthDebug(`Existing session found for ${session.user?.email || 'user'}`);
            await finalizeOAuthSession(session);
        } else {
            if (authInProgress) {
                showAuthDebug('No immediate session found. Waiting for OAuth session recovery...');
                const recoveredSession = await waitForSupabaseSession();
                if (recoveredSession) {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    await finalizeOAuthSession(recoveredSession);
                    return;
                }
                showAuthError('Google sign-in returned, but no session was created. Check Supabase redirect URLs for this exact page.');
            }
        }
    } catch (err) {
        const reason = getFetchErrorMessage(err, 'initialize the app');
        console.error('Failed to initialize config', err);
        showAuthError(reason);
        setGoogleAuthButtonState(false, reason);
    }
}
initApp();

function handleSuccessfulLogin(token, user, isRestore = false) {
    const loginKey = `${user?.id || 'unknown'}`;
    const isDuplicateLogin = lastHandledLoginKey === loginKey && currentUser?.id === user?.id;
    lastHandledLoginKey = loginKey;

    authToken = token;
    currentUser = user;
    currentSessionId = user.id + '-' + Math.random().toString(36).substring(7);
    currentResumeId = 'resume-' + user.id;

    // Save to localStorage for persistence across refresh
    localStorage.setItem('authToken', token);
    localStorage.setItem('currentUser', JSON.stringify(user));
    
    // Debug: confirm localStorage was set
    console.log('Session saved to localStorage:', {
        hasToken: !!localStorage.getItem('authToken'),
        hasUser: !!localStorage.getItem('currentUser'),
        userId: user.id
    });

    // Update UI
    document.getElementById('authControls').style.display = 'none';
    document.getElementById('userProfile').style.display = 'flex';
    document.getElementById('userAvatar').src = user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${user.email}&background=16232A&color=fff`;

    document.getElementById('landingPage').style.display = 'none'; // hide landing page
    document.getElementById('mainAppContainer').style.display = 'flex'; // reveal app container
    document.getElementById('closeAuthBtn').style.display = 'inline-flex'; // allow closing modal next time
    window.closeAuthModal();
    
    if (!isRestore && !isDuplicateLogin) {
        appendMessage(`Welcome back, ${user.email}! Let's work on your resume.`, 'assistant');
    }

    // Always render cached data immediately if available, then quietly sync with DB
    if (!isDuplicateLogin) {
        const cached = loadResumeCache('resume-' + user.id);
        if (cached) {
            renderResumeFromJson(cached); // instant render from cache
        } else {
            renderResumeFromJson({});
        }
        fetchResumeFromDB();
        
        // Restore chat history on session restore
        if (isRestore) {
            loadChatHistory();
        }
    }
}

// --- Authentication Logic ---

window.showAuthModal = () => {
    const authModal = document.getElementById('authModal');
    if (authModal) authModal.style.display = 'flex';
    
    const authError = document.getElementById('authError');
    if (authError) authError.style.display = 'none';
};

window.closeAuthModal = () => {
    const authModal = document.getElementById('authModal');
    if (authModal) authModal.style.display = 'none';
};

window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    const authTitle = document.getElementById('authTitle');
    if (authTitle) authTitle.innerText = isLoginMode ? 'Sign In' : 'Create Account';
    
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    if (authSubmitBtn) authSubmitBtn.innerText = isLoginMode ? 'Sign In' : 'Sign Up';
    
    const authSwitchText = document.getElementById('authSwitchText');
    if (authSwitchText) authSwitchText.innerText = isLoginMode ? "Don't have an account?" : "Already have an account?";
    
    const authSwitchLink = document.getElementById('authSwitchLink');
    if (authSwitchLink) authSwitchLink.innerText = isLoginMode ? 'Sign Up' : 'Sign In';
};

window.handleAuth = async () => {
    const authEmailEl = document.getElementById('authEmail');
    const authPasswordEl = document.getElementById('authPassword');
    const errorDiv = document.getElementById('authError');
    const btn = document.getElementById('authSubmitBtn');

    if (!authEmailEl || !authPasswordEl || !errorDiv || !btn) {
        console.error('Auth modal elements not found');
        return;
    }

    const email = authEmailEl.value.trim();
    const password = authPasswordEl.value.trim();

    if (!email || !password) {
        errorDiv.innerText = "Email and password are required";
        errorDiv.style.display = 'block';
        return;
    }

    const endpoint = isLoginMode ? '/auth/login' : '/auth/signup';
    const originalText = btn.innerText;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    errorDiv.style.display = 'none';

    try {
        const response = await apiFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        }, isLoginMode ? 'sign in' : 'create your account');

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'Authentication failed');
        }

        // Use the centralized success logic
        handleSuccessfulLogin(data.access_token, data.user);

    } catch (err) {
        errorDiv.innerText = getFetchErrorMessage(err, 'sign in');
        errorDiv.style.display = 'block';
    } finally {
        btn.innerHTML = originalText;
    }
};

window.handleGoogleAuth = async () => {
    if (!supabaseClient) {
        showAuthError(googleAuthUnavailableReason || 'Google sign-in is unavailable. Check backend/.env and Supabase config.');
        return;
    }

    const googleBtn = document.getElementById('googleAuthBtn');
    if (googleBtn) {
        googleBtn.disabled = true;
        googleBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
    }

    try {
        localStorage.setItem(GOOGLE_AUTH_PROGRESS_KEY, 'true');
        showAuthDebug(`Starting Google OAuth\nRedirect: ${window.location.origin + window.location.pathname}`);
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + window.location.pathname
            }
        });
        if (error) {
            throw new Error(error.message || 'Google sign-in failed. Check your Supabase configuration.');
        }
    } catch (err) {
        clearGoogleAuthProgress();
        console.error('Google Auth Error:', err);
        const errorMsg = err.message || 'Google sign-in failed. Please try again.';
        showAuthError(errorMsg);
        showAuthDebug(`Google Auth Error: ${errorMsg}`);
        if (googleBtn) {
            googleBtn.disabled = false;
            googleBtn.innerHTML = '<img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" width="18" height="18"> Continue with Google';
        }
    }
};

window.logout = async () => {
    // Clear chat history before clearing user
    clearChatHistory();
    
    if (supabaseClient) await supabaseClient.auth.signOut();
    // Clear resume cache before wiping currentResumeId
    if (currentResumeId) clearResumeCache(currentResumeId);
    authToken = null;
    currentUser = null;

    // Clear localStorage
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');

    // Reset UI completely
    document.getElementById('authControls').style.display = 'block';
    document.getElementById('userProfile').style.display = 'none';

    document.getElementById('landingPage').style.display = 'flex'; // Show landing page
    document.getElementById('mainAppContainer').style.display = 'none'; // Hide app
    document.getElementById('closeAuthBtn').style.display = 'none'; // Force login constraints

    chatHistory.innerHTML = ''; // clear chat
    appendMessage(`You've been logged out. Please sign in to save your progress.`, 'assistant');

    renderResumeFromJson({}); // Empty out resume
};

// --- DB Logic Stubs ---
async function fetchResumeFromDB() {
    if (!authToken) return;

    // Always prefer localStorage cache — it is the source of truth
    const cachedResume = loadResumeCache(currentResumeId);

    if (cachedResume) {
        // Render immediately from cache
        renderResumeFromJson(cachedResume);
        // Silently sync cache back to backend in-memory struct so the AI has context
        try {
            await apiFetch(`/resume/${currentResumeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ resume_data: cachedResume })
            });
        } catch (err) {
            console.error('Failed to sync cache to backend memory', err);
        }

        // Update chat placeholder based on cached data
        const requiredFields = [
            "name", "email", "github", "linkedin",
            "summary", "skills", "projects", "education", "experience", "achievements"
        ];
        const isFilled = (val) => {
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === 'object' && val !== null) return Object.keys(val).length > 0;
            return val && String(val).trim() !== '';
        };
        updateChatPlaceholder(requiredFields.filter(f => !isFilled(cachedResume[f])));
        return;
    }

    // No cache: try fetching from backend, but ONLY save to cache if there is real data
    try {
        const response = await apiFetch(`/resume/${currentResumeId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        }, 'load your resume');
        if (response.ok) {
            const data = await response.json();
            const resumeData = data.resume || {};

            // Only cache if the backend returned something meaningful (not all-empty defaults)
            const hasRealData = Object.entries(resumeData).some(([, v]) => {
                if (Array.isArray(v)) return v.length > 0;
                return v && String(v).trim() !== '';
            });

            if (hasRealData) {
                saveResumeCache(currentResumeId, resumeData);
                renderResumeFromJson(resumeData);

                const requiredFields = [
                    "name", "email", "github", "linkedin",
                    "summary", "skills", "projects", "education", "experience", "achievements"
                ];
                const isFilled = (val) => {
                    if (Array.isArray(val)) return val.length > 0;
                    if (typeof val === 'object' && val !== null) return Object.keys(val).length > 0;
                    return val && String(val).trim() !== '';
                };
                updateChatPlaceholder(requiredFields.filter(f => !isFilled(resumeData[f])));
            }
        }
    } catch (err) {
        console.error('Failed to fetch resume from backend', err);
    }
}

const defaultDummyResume = {
    name: "Alex Candidate",
    title: "Senior Software Engineer",
    summary: "Detail-oriented Software Engineer with 5+ years of experience...",
    experience: [{
        title: "Frontend Developer", company: "TechCorp", date: "2020", bullets: ["Built React App"]
    }],
    skills: ["JavaScript", "React"]
};

function renderResumeFromJson(resume) {
    if (!resume) return;

    // Direct text mappings (fallback to placeholders if DB is empty)
    const nameEl = document.getElementById('r-name');
    if (nameEl) nameEl.innerText = resume.name || '[Your Name]';
    
    const titleEl = document.getElementById('r-title');
    if (titleEl) titleEl.innerText = resume.title || '';
    
    const emailEl = document.getElementById('r-email');
    if (emailEl) emailEl.innerText = resume.email || resume.gmail || 'your@email.com';
    
    const githubEl = document.getElementById('r-github');
    if (githubEl) githubEl.innerText = resume.github || 'github.com/username';
    
    const linkedinEl = document.getElementById('r-linkedin');
    if (linkedinEl) linkedinEl.innerText = resume.linkedin || 'linkedin.com/in/username';
    
    const summaryEl = document.getElementById('r-summary');
    if (summaryEl) summaryEl.innerText = resume.summary || 'Start chatting with the AI Assistant to generate your professional summary...';

    // Experience mapping
    const expContainer = document.getElementById('r-experience');
    if (resume.experience && Array.isArray(resume.experience) && resume.experience.length > 0) {
        expContainer.innerHTML = resume.experience.map(exp => `
            <div class="experience-item">
                <div class="item-header">
                    <h3>${exp.title || exp.role || 'Role'}</h3>
                    <span class="company">${exp.company || 'Company'}</span>
                    <span class="date">${exp.date || exp.duration || 'Date'}</span>
                </div>
                <ul class="bullet-list editable-content" contenteditable="true">
                    ${(exp.bullets || exp.skills || []).map(b => `<li>${b}</li>`).join('')}
                </ul>
                <button class="btn btn-icon enhance-btn" title="Enhance with AI"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
            </div>
        `).join('');
        attachEnhanceListeners(); // re-attach listeners to new buttons
    } else {
        expContainer.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No experience added yet. Tell the AI about your work history!</p>`;
    }

    // Skills mapping
    const skillsContainer = document.getElementById('r-skills');
    if (resume.skills && Array.isArray(resume.skills) && resume.skills.length > 0) {
        skillsContainer.innerHTML = resume.skills.map(s => `<span class="skill-tag">${s}</span>`).join('');
    } else {
        skillsContainer.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No skills added yet.</p>`;
    }

    // Education mapping
    const eduContainer = document.getElementById('r-education');
    if (eduContainer) {
        if (resume.education && Array.isArray(resume.education) && resume.education.length > 0) {
            eduContainer.innerHTML = resume.education.map(edu => {
                if (typeof edu === 'string') {
                    return `<div class="experience-item"><p class="editable-content" contenteditable="true">${edu}</p></div>`;
                }
                return `
                    <div class="experience-item">
                        <div class="item-header">
                            <h3>${edu.degree || edu.title || 'Degree'}</h3>
                            <span class="company">${edu.school || edu.university || 'University'}</span>
                            <span class="date">${edu.year || edu.date || 'Year'}</span>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            eduContainer.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No education added yet.</p>`;
        }
    }

    // Projects mapping
    const projectsContainer = document.getElementById('r-projects');
    if (projectsContainer) {
        if (resume.projects && Array.isArray(resume.projects) && resume.projects.length > 0) {
            projectsContainer.innerHTML = resume.projects.map(project => {
                if (typeof project === 'string') {
                    return `<div class="experience-item"><h3>${project}</h3></div>`;
                }
                const demoLink = project.demo_link || project.demo || '';
                const ghLink   = project.github_link || project.github || '';
                const linksHtml = (demoLink || ghLink) ? `
                    <div class="project-links">
                        ${demoLink ? `<a href="${demoLink}" target="_blank" class="proj-link"><i class="fa-solid fa-arrow-up-right-from-square"></i> Demo</a>` : ''}
                        ${ghLink   ? `<a href="${ghLink}"   target="_blank" class="proj-link"><i class="fa-brands fa-github"></i> Code</a>` : ''}
                    </div>` : '';
                return `
                    <div class="experience-item" data-demo="${demoLink}" data-ghlink="${ghLink}">
                        <div class="item-header">
                            <h3>${project.name || 'Project'}</h3>
                            <span class="company">${project.tech_stack || project.stack || ''}</span>
                        </div>
                        <p class="editable-content" contenteditable="true">${project.description || project.summary || ''}</p>
                        ${linksHtml}
                    </div>
                `;
            }).join('');
        } else {
            projectsContainer.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No projects added yet.</p>`;
        }
    }

    // Achievements mapping
    const achievementsContainer = document.getElementById('r-achievements');
    if (achievementsContainer) {
        if (resume.achievements && Array.isArray(resume.achievements) && resume.achievements.length > 0) {
            achievementsContainer.innerHTML = resume.achievements.map(a => `<li>${typeof a === 'string' ? a : (a.title || a.description || 'Achievement')}</li>`).join('');
        } else {
            achievementsContainer.innerHTML = `<li style="color: var(--text-muted); font-style: italic;">No achievements added yet.</li>`;
        }
    }
}

// Ensure enhancement buttons work on newly rendered HTML
function attachEnhanceListeners() {
    // We already have a global listener setup in the lower section, 
    // but because we replace innerHTML, we might need event delegation.
    // The existing code uses querySelectorAll so we'll refactor the event listener below.
}

// Live update preview from extracted chat data (no DB fetch)
function updatePreviewLive(extractedData) {
    if (!extractedData) return;
    
    // Update simple text fields
    if (extractedData.name) {
        document.getElementById('r-name').innerText = extractedData.name;
    }
    if (extractedData.title) {
        document.getElementById('r-title').innerText = extractedData.title;
    }
    if (extractedData.email || extractedData.gmail) {
        document.getElementById('r-email').innerText = extractedData.email || extractedData.gmail;
    }
    if (extractedData.github) {
        document.getElementById('r-github').innerText = extractedData.github;
    }
    if (extractedData.linkedin) {
        document.getElementById('r-linkedin').innerText = extractedData.linkedin;
    }
    if (extractedData.summary) {
        document.getElementById('r-summary').innerText = extractedData.summary;
    }
    
    // Update skills (append to existing)
    if (extractedData.skills && Array.isArray(extractedData.skills)) {
        const skillsContainer = document.getElementById('r-skills');
        const existingSkills = Array.from(skillsContainer.querySelectorAll('.skill-tag')).map(s => s.innerText.toLowerCase());
        const newSkills = extractedData.skills.filter(s => !existingSkills.includes(s.toLowerCase()));
        
        // Clear placeholder if exists
        const placeholder = skillsContainer.querySelector('p');
        if (placeholder) placeholder.remove();
        
        newSkills.forEach(skill => {
            const tag = document.createElement('span');
            tag.className = 'skill-tag';
            tag.innerText = skill;
            skillsContainer.appendChild(tag);
        });
    }
    
    // Update experience (append to existing)
    if (extractedData.experience) {
        const expContainer = document.getElementById('r-experience');
        const experiences = Array.isArray(extractedData.experience) ? extractedData.experience : [extractedData.experience];
        
        // Clear placeholder
        const placeholder = expContainer.querySelector('p[style]');
        if (placeholder) placeholder.remove();
        
        experiences.forEach(exp => {
            const expHtml = `
                <div class="experience-item">
                    <div class="item-header">
                        <h3>${exp.title || exp.role || 'Role'}</h3>
                        <span class="company">${exp.company || ''}</span>
                        <span class="date">${exp.date || exp.duration || ''}</span>
                    </div>
                    <ul class="bullet-list editable-content" contenteditable="true">
                        ${(exp.bullets || exp.impact || []).map(b => `<li>${b}</li>`).join('') || '<li>Add details here...</li>'}
                    </ul>
                    <button class="btn btn-icon enhance-btn" title="Enhance with AI"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                </div>
            `;
            expContainer.insertAdjacentHTML('beforeend', expHtml);
        });
    }
    
    // Update education (append to existing)
    if (extractedData.education) {
        const eduContainer = document.getElementById('r-education');
        if (eduContainer) {
            const education = Array.isArray(extractedData.education) ? extractedData.education : [extractedData.education];
            
            // Clear placeholder
            const placeholder = eduContainer.querySelector('p[style]');
            if (placeholder) placeholder.remove();
            
            education.forEach(edu => {
                const eduHtml = typeof edu === 'string' ? 
                    `<div class="experience-item"><p class="editable-content" contenteditable="true">${edu}</p></div>` :
                    `<div class="experience-item">
                        <div class="item-header">
                            <h3>${edu.degree || edu.title || 'Degree'}</h3>
                            <span class="company">${edu.school || edu.university || 'University'}</span>
                            <span class="date">${edu.year || edu.date || 'Year'}</span>
                        </div>
                    </div>`;
                eduContainer.insertAdjacentHTML('beforeend', eduHtml);
            });
        }
    }
    
    // Update projects (append to existing)
    if (extractedData.projects) {
        const projContainer = document.getElementById('r-projects');
        const projects = Array.isArray(extractedData.projects) ? extractedData.projects : [extractedData.projects];
        
        // Clear placeholder
        const placeholder = projContainer.querySelector('p[style]');
        if (placeholder) placeholder.remove();
        
        projects.forEach(proj => {
            const projName  = typeof proj === 'string' ? proj : (proj.name || 'Project');
            const projDesc  = typeof proj === 'string' ? '' : (proj.description || proj.summary || '');
            const demoLink  = typeof proj === 'object' ? (proj.demo_link || proj.demo || '') : '';
            const ghLink    = typeof proj === 'object' ? (proj.github_link || proj.github || '') : '';
            const linksHtml = (demoLink || ghLink) ? `
                <div class="project-links">
                    ${demoLink ? `<a href="${demoLink}" target="_blank" class="proj-link"><i class="fa-solid fa-arrow-up-right-from-square"></i> Demo</a>` : ''}
                    ${ghLink   ? `<a href="${ghLink}"   target="_blank" class="proj-link"><i class="fa-brands fa-github"></i> Code</a>` : ''}
                </div>` : '';
            const projHtml = `
                <div class="experience-item" data-demo="${demoLink}" data-ghlink="${ghLink}">
                    <div class="item-header">
                        <h3>${projName}</h3>
                        <span class="company">${typeof proj === 'object' ? (proj.tech_stack || proj.stack || '') : ''}</span>
                    </div>
                    <p class="editable-content" contenteditable="true">${projDesc}</p>
                    ${linksHtml}
                </div>
            `;
            projContainer.insertAdjacentHTML('beforeend', projHtml);
        });
    }
    
    // Update achievements (append to existing)
    if (extractedData.achievements) {
        const achContainer = document.getElementById('r-achievements');
        const achievements = Array.isArray(extractedData.achievements) ? extractedData.achievements : [extractedData.achievements];
        
        // Clear placeholder
        const placeholderLi = achContainer.querySelector('li[style]');
        if (placeholderLi) placeholderLi.remove();
        
        achievements.forEach(ach => {
            const achText = typeof ach === 'string' ? ach : (ach.title || ach.description || 'Achievement');
            const li = document.createElement('li');
            li.innerText = achText;
            achContainer.appendChild(li);
        });
    }
    
    // Trigger auto-save after live update
    scheduleAutoSave();
}

// --- Event Listeners ---

// 0. Export PDF
if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
        const originalText = exportPdfBtn.innerHTML;
        exportPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';

        try {
            if (authToken) await saveResumeToDB();

            const element = document.getElementById('resumeDocument');
            const rawName = document.getElementById('r-name')?.innerText?.trim() || 'resume';
            const safeName = rawName.replace(/[^a-z0-9\-_. ]/gi, '').replace(/\s+/g, '_') || 'resume';

            const opt = {
                margin: [10, 10, 10, 10],
                filename: `${safeName}_resume.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            document.body.classList.add('export-pdf-mode');
            await html2pdf().set(opt).from(element).save();
            document.body.classList.remove('export-pdf-mode');
        } catch (err) {
            document.body.classList.remove('export-pdf-mode');
            console.error('PDF export failed', err);
            alert('Could not export PDF: ' + (err.message || 'Unknown error'));
        } finally {
            exportPdfBtn.innerHTML = originalText;
        }
    });
}

// 0b. Export DOCX — handled by backend (python-docx)
if (exportDocxBtn) {
    exportDocxBtn.addEventListener('click', async () => {
        if (!authToken) {
            alert('Please sign in to export your resume.');
            window.showAuthModal();
            return;
        }

        const originalText = exportDocxBtn.innerHTML;
        exportDocxBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';

        try {
            // Scrape DOM and cache locally; use the returned data for the export
            const resumeData = (await saveResumeToDB()) || loadResumeCache(currentResumeId) || {};

            // POST resume data directly — avoids relying on volatile server-side memory
            const response = await apiFetch(`/resume/export-docx`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ resume_data: resumeData })
            }, 'export your resume as DOCX');

            if (response.status === 401) { window.logout(); throw new Error('Session expired.'); }
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || 'Export failed.');
            }

            const blob = await response.blob();
            const rawName = (document.getElementById('r-name')?.innerText || 'resume').trim();
            const safeName = rawName.replace(/[^a-z0-9\-_. ]/gi, '').replace(/\s+/g, '_') || 'resume';
            triggerDocxDownload(blob, `${safeName}_resume.docx`);

        } catch (err) {
            console.error('DOCX export failed', err);
            alert(`Could not export DOCX: ${err.message}`);
        } finally {
            exportDocxBtn.innerHTML = originalText;
        }
    });
}

// 1. Template Switching
templateSelector.addEventListener('change', (e) => {
    resumeDocument.className = `resume-wrapper ${e.target.value}`;
});

// 2. Tab Navigation
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class from all
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.style.display = 'none');

        // Add active to current
        tab.classList.add('active');
        const targetId = `tab-${tab.dataset.tab}`;
        document.getElementById(targetId).style.display = 'flex';
    });
});

// 3. Chat Interaction
function updateChatPlaceholder(missingFields) {
    if (missingFields && missingFields.length > 0) {
        const nextField = missingFields[0];
        const placeholders = {
            "name": "e.g., John Doe",
            "email": "e.g., john.doe@gmail.com",
            "github": "e.g., github.com/johndoe",
            "linkedin": "e.g., linkedin.com/in/johndoe",
            "summary": "e.g., Passionate software engineer with 3+ years...",
            "skills": "e.g., Python, React, JavaScript, SQL",
            "projects": "e.g., E-commerce site: Built with React and Node...",
            "education": "e.g., B.S. from Stanford University",
            "experience": "e.g., Frontend Dev at Google from 2020-2023...",
            "achievements": "e.g., Increased sales by 40%..."
        };
        chatInput.placeholder = placeholders[nextField] || "Type your answer here...";
    } else {
        chatInput.placeholder = "Great! Your resume is complete.";
    }
}

async function sendMessage() {
    if (!authToken) {
        alert("Please sign in to use the AI Assistant.");
        window.showAuthModal();
        return;
    }

    const text = chatInput.value.trim();
    if (!text) return;

    // Append user message
    appendMessage(text, 'user');
    chatInput.value = '';

    // Show loading state
    const loadingId = appendMessage('...', 'assistant', true);

    // Build current resume snapshot from cache so backend can recover if memory was wiped
    const resumeSnapshot = loadResumeCache(currentResumeId) || {};

    try {
        const response = await apiFetch('/chat/message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                session_id: currentSessionId,
                user_id: currentUser.id,
                resume_id: currentResumeId,
                user_message: text,
                resume_snapshot: resumeSnapshot
            })
        }, 'send your message');

        if (response.status === 401) {
            window.logout();
            throw new Error("Session expired. Please sign in again.");
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        const data = await response.json();

        // Remove loading state and show real message
        const loadingElement = document.getElementById(loadingId);
        if (loadingElement) {
            loadingElement.remove();
        }
        appendMessage(data.reply, 'assistant');

        // Debug: Show what was extracted
        console.log('Chat response received:', {
            reply: data.reply,
            extracted_data: data.extracted_data,
            missing_fields: data.missing_fields,
            next_step: data.next_step
        });

        // Update cache with newly extracted data
        if (data.extracted_data && Object.keys(data.extracted_data).length > 0) {
            console.log('Updating resume cache with:', data.extracted_data);
            updateAndSaveResumeCache(data.extracted_data);
        } else {
            console.log('No extracted data in response');
        }

        // ALWAYS update preview with full current resume from cache
        // This ensures preview stays in sync even if extraction was empty
        const currentResume = loadResumeCache(currentResumeId) || {};
        console.log('Rendering preview from cache:', currentResume);
        renderResumeFromJson(currentResume);

        // Save to DB after preview is updated
        try {
            await saveResumeToDB();
            console.log('Resume saved successfully');
        } catch (saveErr) {
            console.error('Failed to save resume:', saveErr);
        }

        // Update chat input placeholder based on the next field
        updateChatPlaceholder(data.missing_fields);
        
        // Save chat history after successful response
        saveChatHistory();

    } catch (err) {
        const loadingElement = document.getElementById(loadingId);
        if (loadingElement) {
            loadingElement.remove();
        }
        console.error('Chat error:', err);
        appendMessage(getFetchErrorMessage(err, 'send your message'), 'assistant');
    }
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function appendMessage(text, role, isLoading = false, skipSave = false) {
    if (!chatHistory) {
        console.error('Chat history container not found!');
        return null;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const id = 'msg-' + Math.random().toString(36).substring(7);
    msgDiv.id = id;

    msgDiv.innerHTML = `
        <div class="bubble">${text}</div>
    `;

    if (isLoading) {
        msgDiv.style.opacity = '0.7';
    }

    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    // Save chat history after adding non-loading messages
    if (!isLoading && !skipSave) {
        saveChatHistory();
    }
    
    return id;
}

// 4. Enhance Content Integration (Using Event Delegation)
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.enhance-btn');
    if (!btn) return;

    if (!authToken) {
        alert("Please sign in to use AI enhancement features.");
        window.showAuthModal();
        return;
    }

    const section = e.target.closest('.resume-section') || e.target.closest('.experience-item');
    if (!section) return;

    const h2 = section.closest('.resume-section')?.querySelector('h2');
    const sectionType = h2 ? h2.innerText.toLowerCase() : 'experience';
    const isSkills = sectionType === 'skills';
    const isExperienceSection = sectionType === 'experience' && section.id === 'experience-section';

    // --- Skills section: collect all skill tags ---
    if (isSkills) {
        const skillsContainer = document.getElementById('r-skills');
        const skillTags = Array.from(skillsContainer.querySelectorAll('.skill-tag')).map(t => t.innerText.trim());
        if (!skillTags.length) {
            alert("Please add some skills first before enhancing.");
            return;
        }
        const rawText = skillTags.join(', ');
        const originalBtnHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            const response = await apiFetch('/resume/enhance-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ resume_id: currentResumeId, section_type: 'skills', raw_text: rawText })
            }, 'enhance skills');
            if (response.status === 401) { window.logout(); throw new Error("Session expired."); }
            const data = await response.json();
            // Response is a list of skill strings
            if (data.generated_content && Array.isArray(data.generated_content)) {
                skillsContainer.innerHTML = data.generated_content.map(s => `<span class="skill-tag">${s}</span>`).join('');
                saveResumeToDB();
            }
        } catch (err) {
            console.error('Enhancement failed', err);
            if (err.message === "Session expired.") alert("Session expired. Please sign in again.");
            else alert("Enhancement failed: " + (err.message || "Unknown error"));
        } finally {
            btn.innerHTML = originalBtnHTML;
            btn.disabled = false;
        }
        return;
    }

    // --- Experience section-level button: enhance all experience bullets together ---
    if (isExperienceSection) {
        const expContainer = document.getElementById('r-experience');
        const allBullets = Array.from(expContainer.querySelectorAll('.bullet-list li'))
            .map(li => li.innerText.trim()).filter(t => t.length > 0);
        if (!allBullets.length) {
            alert("Please add some experience bullets first before enhancing.");
            return;
        }
        const rawText = allBullets.join('\n');
        const originalBtnHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            const response = await apiFetch('/resume/enhance-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ resume_id: currentResumeId, section_type: 'experience', raw_text: rawText })
            }, 'enhance experience');
            if (response.status === 401) { window.logout(); throw new Error("Session expired."); }
            const data = await response.json();
            if (data.generated_content && Array.isArray(data.generated_content)) {
                // Distribute enhanced bullets back across experience items
                const bulletLists = expContainer.querySelectorAll('.bullet-list');
                let bulletIdx = 0;
                bulletLists.forEach(ul => {
                    const itemCount = ul.querySelectorAll('li').length || 1;
                    const slice = data.generated_content.slice(bulletIdx, bulletIdx + itemCount);
                    bulletIdx += itemCount;
                    if (slice.length) {
                        ul.innerHTML = slice.map(b => `<li>${b}</li>`).join('');
                    }
                });
                saveResumeToDB();
            }
        } catch (err) {
            console.error('Enhancement failed', err);
            if (err.message === "Session expired.") alert("Session expired. Please sign in again.");
            else alert("Enhancement failed: " + (err.message || "Unknown error"));
        } finally {
            btn.innerHTML = originalBtnHTML;
            btn.disabled = false;
        }
        return;
    }

    // --- Default: find editable-content inside the section/item ---
    const contentArea = section.querySelector('.editable-content');
    if (!contentArea) return;

    // Clean the raw text before sending: strip bullet chars, trim whitespace
    const rawText = contentArea.innerText
        .split('\n')
        .map(line => line.trim().replace(/^[\u2022\u00b7\u2023\u2043\u25aa\u25b8\-\*>\t]+\s*/, '').trim())
        .filter(line => line.length > 0)
        .join('\n');

    if (!rawText) {
        alert("Please add some content first before enhancing.");
        return;
    }

    const originalBtnHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const response = await apiFetch('/resume/enhance-content', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                resume_id: currentResumeId,
                section_type: sectionType,
                raw_text: rawText
            })
        }, 'enhance resume content');

        if (response.status === 401) {
            window.logout();
            throw new Error("Session expired.");
        }

        const data = await response.json();

        // Handle paragraph (summary) vs bullet points
        if (data.is_paragraph && typeof data.generated_content === 'string') {
            contentArea.innerText = data.generated_content;
        } else if (data.generated_content && Array.isArray(data.generated_content)) {
            contentArea.innerHTML = data.generated_content.map(bullet => `<li>${bullet}</li>`).join('');
        }

        saveResumeToDB();

    } catch (err) {
        console.error('Enhancement failed', err);
        if (err.message === "Session expired.") alert("Session expired. Please sign in again.");
        else alert("Enhancement failed: " + (err.message || "Unknown error"));
    } finally {
        btn.innerHTML = originalBtnHTML;
        btn.disabled = false;
    }
});

async function saveResumeToDB() {
    if (!authToken) return;

    // Helper to clean placeholder text
    const cleanPlaceholder = (text, placeholders = []) => {
        const cleaned = text.trim();
        for (const ph of placeholders) {
            if (cleaned.includes(ph)) return '';
        }
        return cleaned;
    };

    // Helper to get text content, handling both structured and plain text
    const getProjectsData = () => {
        const container = document.getElementById('r-projects');
        if (!container) return [];
        const items = container.querySelectorAll('.experience-item');
        if (items.length > 0) {
            return Array.from(items).map(item => ({
                name:        item.querySelector('h3')?.innerText || '',
                description: item.querySelector('p')?.innerText || '',
                demo_link:   item.dataset.demo   || '',
                github_link: item.dataset.ghlink || ''
            }));
        }
        // Fallback: save as plain text if user typed directly
        const text = container.innerText.trim();
        if (text && !text.includes('No projects added')) {
            return [{ name: 'Project', description: text, demo_link: '', github_link: '' }];
        }
        return [];
    };

    const getAchievementsData = () => {
        const container = document.getElementById('r-achievements');
        if (!container) return [];
        const items = container.querySelectorAll('li');
        const achievements = Array.from(items)
            .map(li => li.innerText.trim())
            .filter(text => text && !text.includes('No achievements added'));
        
        // If no li items, check for plain text
        if (achievements.length === 0) {
            const text = container.innerText.trim();
            if (text && !text.includes('No achievements added')) {
                // Split by newlines to get individual achievements
                return text.split('\n').filter(line => line.trim());
            }
        }
        return achievements;
    };

    const getExperienceData = () => {
        const container = document.getElementById('r-experience');
        if (!container) return [];
        const items = container.querySelectorAll('.experience-item');
        if (items.length > 0) {
            return Array.from(items).map(item => ({
                title: item.querySelector('h3')?.innerText || '',
                company: item.querySelector('.company')?.innerText || '',
                date: item.querySelector('.date')?.innerText || '',
                bullets: Array.from(item.querySelectorAll('li')).map(li => li.innerText)
            }));
        }
        // Fallback: save as plain text if user typed directly
        const text = container.innerText.trim();
        if (text && !text.includes('No experience added')) {
            return [{ title: 'Role', company: '', date: '', bullets: [text] }];
        }
        return [];
    };

    const getEducationData = () => {
        const container = document.getElementById('r-education');
        if (!container) return [];
        const items = container.querySelectorAll('.experience-item');
        if (items.length > 0) {
            return Array.from(items).map(item => ({
                degree: item.querySelector('h3')?.innerText || '',
                school: item.querySelector('.company')?.innerText || '',
                year: item.querySelector('.date')?.innerText || '',
            }));
        }
        // Fallback: save as plain text if user typed directly
        const text = container.innerText.trim();
        if (text && !text.includes('No education added')) {
            return [text];
        }
        return [];
    };

    // Get summary, filtering out placeholder text
    const summaryText = document.getElementById('r-summary')?.innerText || '';
    const summaryClean = cleanPlaceholder(summaryText, [
        'Please sign in', 
        'Start chatting with the AI',
        'generate your professional summary'
    ]);

    // Scrape DOM back to JSON
    const resumeObj = {
        name: cleanPlaceholder(document.getElementById('r-name')?.innerText || '', ['[Your Name]']),
        title: cleanPlaceholder(document.getElementById('r-title')?.innerText || '', ['[Your Job Title]']),
        email: cleanPlaceholder(document.getElementById('r-email')?.innerText || '', ['your@email.com']),
        github: cleanPlaceholder(document.getElementById('r-github')?.innerText || '', ['github.com/username']),
        linkedin: cleanPlaceholder(document.getElementById('r-linkedin')?.innerText || '', ['linkedin.com/in/username']),
        summary: summaryClean,
        skills: Array.from(document.querySelectorAll('#r-skills .skill-tag')).map(s => s.innerText),
        experience: getExperienceData(),
        education: getEducationData(),
        projects: getProjectsData(),
        achievements: getAchievementsData()
    };

    // Merge scraped DOM data with existing cache — non-destructive:
    // empty/placeholder fields from the DOM don't overwrite valid chat-extracted data
    const existingCache = loadResumeCache(currentResumeId) || {};
    const mergedCache = { ...existingCache };
    Object.keys(resumeObj).forEach(key => {
        const val = resumeObj[key];
        if (Array.isArray(val) && val.length > 0) {
            mergedCache[key] = val;
        } else if (typeof val === 'string' && val.trim()) {
            mergedCache[key] = val;
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            mergedCache[key] = val;
        }
        // empty / blank values are intentionally NOT saved — existing cache value is kept
    });
    saveResumeCache(currentResumeId, mergedCache);

    try {
        await apiFetch(`/resume/${currentResumeId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ resume_data: mergedCache })
        }, 'save your resume');
        showSaveIndicator('Saved');
    } catch (e) {
        showSaveIndicator('Save failed', true);
    }
    return mergedCache;
}

// Auto-save indicator
function showSaveIndicator(text, isError = false) {
    let indicator = document.getElementById('save-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'save-indicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 9999;
            transition: opacity 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.style.background = isError ? 'var(--danger-color)' : 'var(--success-color)';
    indicator.style.color = 'white';
    indicator.innerHTML = isError ? 
        `<i class="fa-solid fa-exclamation-circle"></i> ${text}` :
        `<i class="fa-solid fa-check-circle"></i> ${text}`;
    indicator.style.opacity = '1';
    
    clearTimeout(indicator._timeout);
    indicator._timeout = setTimeout(() => {
        indicator.style.opacity = '0';
    }, 2000);
}

// Debounced auto-save on content edit
let autoSaveTimeout = null;
function scheduleAutoSave() {
    if (!authToken) return;
    
    clearTimeout(autoSaveTimeout);
    showSaveIndicator('Saving...', false);
    autoSaveTimeout = setTimeout(() => {
        saveResumeToDB();
    }, 1500); // Save 1.5s after user stops typing
}

// Auto-save when editing contenteditable areas
document.addEventListener('input', (e) => {
    const target = e.target;
    // Check if inside resume document
    if (target.closest('#resumeDocument') && target.getAttribute('contenteditable') === 'true') {
        scheduleAutoSave();
    }
});

// Also save on blur (when clicking away from editable field)
document.addEventListener('focusout', (e) => {
    const target = e.target;
    if (target.closest('#resumeDocument') && target.getAttribute('contenteditable') === 'true') {
        if (authToken) {
            clearTimeout(autoSaveTimeout);
            saveResumeToDB();
        }
    }
});

// Helper function to create score gauge HTML
function createScoreGauge(score, label) {
    const getColor = (val) => {
        if (val >= 80) return '#10b981';  // green
        if (val >= 60) return '#f59e0b';  // amber
        return '#ef4444';                 // red
    };
    const color = getColor(score);
    return `
        <div class="metric-box">
            <h4>${label}</h4>
            <div style="position: relative; width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; margin: 8px 0;">
                <div style="width: ${score}%; height: 100%; background: ${color}; border-radius: 4px; transition: width 0.3s;"></div>
            </div>
            <span class="m-value" style="color: ${color}; font-weight: 600;">${score}%</span>
        </div>
    `;
}

// 5. Analysis Trigger - Enhanced with Comprehensive ATS Metrics
runAnalysisBtn.addEventListener('click', async () => {
    if (!authToken) {
        alert("Please sign in to run the ATS Analysis.");
        window.showAuthModal();
        return;
    }

    const fileInput = document.getElementById('resumeUploadInput');
    const targetRoleInput = document.getElementById('targetRoleInput');

    if (!fileInput.files.length) {
        alert("Please upload your resume file (PDF or DOCX).");
        return;
    }

    if (!targetRoleInput.value.trim()) {
        alert("Please enter a Target Role or Job Description.");
        return;
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("target_role", targetRoleInput.value.trim());

    runAnalysisBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    document.getElementById('analysisResultsContainer').style.display = 'none';

    try {
        // Use the API base URL for analysis upload
        const apiUrl = API_BASE + '/analysis/upload';
        
        const fetchOptions = {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        };

        const response = await fetch(apiUrl, fetchOptions);

        if (response.status === 401) {
            window.logout();
            throw new Error("Unauthorized");
        }
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || "Analysis failed.");
        }

        const data = await response.json();
        
        // Extract data safely with comprehensive metrics
        const overallScore = data.overall_ats_score || 0;
        const detailedScores = data.detailed_scores || {};
        const resumeStructure = data.resume_structure || {};
        const keywordAnalysis = data.keyword_analysis || {};
        const issues = safeArray(data.issues);
        const recommendations = safeArray(data.recommendations);
        const strengths = safeArray(data.strengths);
        const altRoles = safeArray(data.alternative_job_roles);
        const formatIssues = safeArray(data.format_issues);
        
        // Display Analysis Results
        document.getElementById('analysisResultsContainer').style.display = 'block';
        document.getElementById('atsScoreValue').innerText = overallScore;

        const circle = document.querySelector('.score-circle');
        const scoreColor = overallScore >= 80 ? '#10b981' : (overallScore >= 60 ? '#f59e0b' : '#ef4444');
        circle.style.borderColor = scoreColor;
        circle.style.color = scoreColor;

        // Replace metrics grid with comprehensive detailed scores
        const metricsGridHtml = `
            ${createScoreGauge(detailedScores.ats_compatibility || 0, 'ATS Compatibility')}
            ${createScoreGauge(detailedScores.impact_and_achievement || 0, 'Impact & Achievement')}
            ${createScoreGauge(detailedScores.section_completeness || 0, 'Section Completeness')}
            ${createScoreGauge(detailedScores.formatting_compliance || 0, 'Format Compliance')}
            ${createScoreGauge(detailedScores.readability || 0, 'Readability')}
        `;
        document.querySelector('.metrics-grid').innerHTML = metricsGridHtml;

        // Build comprehensive feedback HTML
        let feedbackHtml = '';

        // Resume Structure Overview
        const structureChecks = resumeStructure;
        if (Object.keys(structureChecks).length > 0) {
            feedbackHtml += '<h4 style="margin-top: 20px; margin-bottom: 10px;">Resume Structure</h4>';
            feedbackHtml += `
                <ul style="list-style: none; padding: 0; margin: 10px 0;">
                    <li>${structureChecks.has_summary ? '✓' : '✗'} Professional Summary</li>
                    <li>${structureChecks.has_experience ? '✓' : '✗'} Work Experience</li>
                    <li>${structureChecks.has_skills ? '✓' : '✗'} Skills Section</li>
                    <li>${structureChecks.has_education ? '✓' : '✗'} Education</li>
                    <li>${structureChecks.has_contact_info ? '✓' : '✗'} Contact Information</li>
                    <li>Word Count: ${structureChecks.word_count || 0} words</li>
                </ul>
            `;
        }

        // Keyword Analysis
        if (keywordAnalysis.impact_words_found && keywordAnalysis.impact_words_found.length > 0) {
            feedbackHtml += `
                <h4 style="margin-top: 20px; margin-bottom: 10px;">Strong Action Verbs Found</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0;">
                    ${keywordAnalysis.impact_words_found.map(verb => `<span class="skill-tag" style="background: #d1fae5; color: #065f46;">${verb}</span>`).join('')}
                </div>
            `;
        }

        // Missing Keywords
        if (keywordAnalysis.missing_critical_keywords && keywordAnalysis.missing_critical_keywords.length > 0) {
            feedbackHtml += `
                <h4 style="margin-top: 20px; margin-bottom: 10px; color: #dc2626;">Missing Critical Keywords</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0;">
                    ${keywordAnalysis.missing_critical_keywords.map(kw => `<span class="skill-tag" style="background: #fee2e2; color: #991b1b;">${kw}</span>`).join('')}
                </div>
            `;
        }

        // Strengths (positive feedback)
        if (strengths.length > 0) {
            feedbackHtml += '<h4 style="margin-top: 20px; margin-bottom: 10px; color: #059669;">✓ Strengths</h4>';
            strengths.forEach(strength => {
                feedbackHtml += `
                    <li class="suggestion" style="margin: 8px 0; padding: 10px; background: #f0fdf4; border-left: 3px solid #10b981;">
                        <i class="fa-solid fa-check-circle" style="color: #10b981; margin-right: 8px;"></i>
                        <span>${strength}</span>
                    </li>`;
            });
        }

        // Issues (critical problems)
        if (issues.length > 0) {
            feedbackHtml += '<h4 style="margin-top: 20px; margin-bottom: 10px; color: #dc2626;">⚠ Issues to Address</h4>';
            issues.forEach(issue => {
                const message = safeMessage(issue);
                if (!message) return;
                feedbackHtml += `
                    <li class="warning" style="margin: 8px 0; padding: 10px; background: #fef2f2; border-left: 3px solid #ef4444;">
                        <i class="fa-solid fa-triangle-exclamation" style="color: #dc2626; margin-right: 8px;"></i>
                        <span>${message}</span>
                    </li>`;
            });
        }

        // Formatting Issues
        if (formatIssues.length > 0) {
            feedbackHtml += '<h4 style="margin-top: 20px; margin-bottom: 10px; color: #ea580c;">Format Issues</h4>';
            formatIssues.forEach(issue => {
                feedbackHtml += `
                    <li class="warning" style="margin: 8px 0; padding: 10px; background: #feedd5; border-left: 3px solid #ea580c;">
                        <i class="fa-solid fa-wand-magic-sparkles" style="color: #ea580c; margin-right: 8px;"></i>
                        <span>${issue}</span>
                    </li>`;
            });
        }

        // Recommendations for improvement
        if (recommendations.length > 0) {
            feedbackHtml += '<h4 style="margin-top: 20px; margin-bottom: 10px; color: #2563eb;">💡 Recommendations</h4>';
            recommendations.forEach(rec => {
                const message = safeMessage(rec);
                if (!message) return;
                feedbackHtml += `
                    <li class="suggestion" style="margin: 8px 0; padding: 10px; background: #eff6ff; border-left: 3px solid #2563eb;">
                        <i class="fa-solid fa-lightbulb" style="color: #2563eb; margin-right: 8px;"></i>
                        <span>${message}</span>
                        <button class="btn btn-small" onclick="document.querySelectorAll('.tab-btn')[0].click()" style="margin-left: 8px; font-size: 12px;">Edit Resume</button>
                    </li>`;
            });
        }

        // Alternative Job Roles
        if (altRoles.length > 0) {
            feedbackHtml += `
                <h4 style="margin-top: 20px; margin-bottom: 10px;">Alternative Job Roles</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0;">
                    ${altRoles.map(role => `<span class="skill-tag" style="background: #e0e7ff; color: #3730a3;">${role}</span>`).join('')}
                </div>
            `;
        }

        // Default message if analysis is perfect
        if (issues.length === 0 && recommendations.length === 0 && !formatIssues.length && strengths.length === 0) {
            feedbackHtml += '<li style="padding: 10px; color: #10b981;">✓ Great job! Your resume looks solid for ATS systems.</li>';
        }

        document.getElementById('analysisFeedback').innerHTML = feedbackHtml;

    } catch (err) {
        console.error('Analysis error:', err);
        alert("Failed to run analysis. Please ensure you're logged in and the server is running. Error: " + err.message);
        if (err.message === "Unauthorized") window.logout();
    } finally {
        runAnalysisBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Run Full ATS Analysis';
    }
});

// 6. Job Personalization Trigger
analyzeJdBtn.addEventListener('click', async () => {
    if (!authToken) {
        alert("Please sign in to personalize your resume.");
        window.showAuthModal();
        return;
    }

    const jdText = jobDescriptionInput.value;
    if (!jdText) {
        alert("Please paste a job description first.");
        return;
    }

    analyzeJdBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Job Match...';

    try {
        const response = await apiFetch('/resume/personalize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                resume_id: currentResumeId,
                job_description_text: jdText
            })
        }, 'analyze the job description');

        if (response.status === 401) throw new Error("Unauthorized");

        if (!response.ok) {
            throw new Error('Job analysis request failed. Please try again.');
        }

        const data = await response.json();
        jdAnalysisResults.style.display = 'block';

        // Populate missing skills
        const missingSkillsDiv = document.getElementById('missingJdSkills');
        const missingKeywords = Array.isArray(data.missing_keywords) ? data.missing_keywords : [];
        missingSkillsDiv.innerHTML = missingKeywords.length
            ? missingKeywords.map(k => `<span class="skill-tag">${k}</span>`).join('')
            : '<span class="skill-tag">No critical gaps found</span>';

        const suggestedSummary = document.getElementById('jdSuggestedSummary');
        const jdSkillSuggestions = document.getElementById('jdSkillSuggestions');
        const jdRoleRecommendations = document.getElementById('jdRoleRecommendations');
        const jdKeywordMatch = document.getElementById('jdKeywordMatch');
        const jdChangeHint = document.getElementById('jdChangeHint');

        const suggestedChanges = data.suggested_changes && typeof data.suggested_changes === 'object' ? data.suggested_changes : {};
        const aiSkillRecommendations = Array.isArray(suggestedChanges.ai_skill_recommendations)
            ? suggestedChanges.ai_skill_recommendations
            : [];
        const roleRecommendations = Array.isArray(data.recommended_roles) ? data.recommended_roles : [];

        suggestedSummary.innerText = suggestedChanges.summary || 'No summary suggestion returned.';
        jdSkillSuggestions.innerHTML = aiSkillRecommendations.length
            ? aiSkillRecommendations.map(s => `<span class="skill-tag">${s}</span>`).join('')
            : '<span class="skill-tag">No extra skill suggestions</span>';
        jdRoleRecommendations.innerHTML = roleRecommendations.length
            ? roleRecommendations.map(r => `<span class="skill-tag">${r}</span>`).join('')
            : '<span class="skill-tag">No role suggestions yet</span>';

        jdKeywordMatch.innerText = `${data.keyword_match_rate || 0}%`;
        jdChangeHint.innerText = `Focus on adding ${missingKeywords.slice(0, 3).join(', ') || 'strong measurable achievements'} to improve match.`;

    } catch (err) {
        console.error(err);
        alert(err.message || 'Could not analyze this job description right now.');
        if (err.message === "Unauthorized") {
            alert("Session expired. Please sign in again.");
            window.logout();
        }
    } finally {
        analyzeJdBtn.innerHTML = '<i class="fa-solid fa-search"></i> Analyze Job Match';
    }
});
