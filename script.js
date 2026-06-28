import { createClient } from '@supabase/supabase-js';
import mockDatabase from './mockDatabase_output.json';
import {
    SYLLABUSES,
    EXAM_SERIES,
    loadUserPreferences,
    saveUserPreferences,
    getSyllabusLabel,
    getSeriesLabel,
    getConfiguredPlans,
    isSubjectAllowedInSeries
} from './userPreferences.js';

import Alpine from 'alpinejs';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const createExamPlanMixin = () => ({
    examPlans: [],
    configuredPlansList: [], 
    activeSeriesId: EXAM_SERIES[0]?.id ?? '',
    syllabuses: SYLLABUSES,
    examSeries: EXAM_SERIES,
    updateDerivedState() {
        this.configuredPlansList = this.examPlans.filter(plan => plan.subjectIds && plan.subjectIds.length > 0);
    },

    seriesLabel(id) {
        return getSeriesLabel(id);
    },

    syllabusLabel(id) {
        return getSyllabusLabel(id);
    },

    isSubjectDisabled(subjectId) {
        // 1. Check if the subject is already assigned to a DIFFERENT series
        for (let plan of this.examPlans) {
            if (plan.seriesId !== this.activeSeriesId && plan.subjectIds?.includes(subjectId)) {
                return true;
            }
        }
        
        // 2. Check if the subject is legally allowed in the CURRENTLY selected series
        if (!isSubjectAllowedInSeries(subjectId, this.activeSeriesId)) {
            return true;
        }
        
        return false;
    },

    isSubjectSelected(subjectId) {
        const plan = this.examPlans.find((entry) => entry.seriesId === this.activeSeriesId);
        return plan ? plan.subjectIds.includes(subjectId) : false;
    },

    assignedElsewhereLabel(subjectId) {
        // 1. Label if assigned elsewhere
        for (let plan of this.examPlans) {
            if (plan.seriesId !== this.activeSeriesId && plan.subjectIds?.includes(subjectId)) {
                return this.seriesLabel(plan.seriesId);
            }
        }
        
        // 2. Label if restricted by the exam board
        if (!isSubjectAllowedInSeries(subjectId, this.activeSeriesId)) {
            return 'Not offered in Oct/Nov';
        }
        
        return '';
    },

    async hydrateExamPlans() {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const prefs = await loadUserPreferences(user.id, user);
                this.examPlans = JSON.parse(JSON.stringify(prefs.examPlans || []));
                this.updateDerivedState(); // Keep sync
            }
        } catch (error) {
            console.error("Error hydrating exam plans:", error);
        }
    },

    debugState() {
        console.group("🛑 O2 STATE DEBUGGER");
        console.log("1. Active Series ID:", this.activeSeriesId);
        console.log("2. Raw Exam Plans Array:", JSON.parse(JSON.stringify(this.examPlans)));
        console.log("3. Configured Plans Pure State:", JSON.parse(JSON.stringify(this.configuredPlansList)));
        console.log("4. Can Save?", this.canSave());
        console.groupEnd();
        alert("State dumped! Press F12 to view.");
    },

    isSubjectSelectedForActiveSeries() {
        const plan = this.examPlans.find((entry) => entry.seriesId === this.activeSeriesId);
        return plan ? plan.subjectIds.length > 0 : false;
    },

    toggleSubject(subjectId) {
        if (this.isSubjectDisabled(subjectId)) return;

        let rawPlans = JSON.parse(JSON.stringify(this.examPlans));
        let planIndex = rawPlans.findIndex((entry) => entry.seriesId === this.activeSeriesId);

        if (planIndex === -1) {
            rawPlans.push({ seriesId: this.activeSeriesId, subjectIds: [subjectId] });
        } else {
            let plan = rawPlans[planIndex];
            const subjectIndex = plan.subjectIds.indexOf(subjectId);
            
            if (subjectIndex >= 0) {
                plan.subjectIds.splice(subjectIndex, 1);
            } else {
                plan.subjectIds.push(subjectId);
            }

            if (plan.subjectIds.length === 0) {
                rawPlans.splice(planIndex, 1);
            }
        }

        this.examPlans = rawPlans;
        this.updateDerivedState(); 
    },

    removeSubject(seriesId, subjectId) {
        let rawPlans = JSON.parse(JSON.stringify(this.examPlans));
        const planIndex = rawPlans.findIndex((entry) => entry.seriesId === seriesId);
        
        if (planIndex === -1) return;

        let plan = rawPlans[planIndex];
        plan.subjectIds = plan.subjectIds.filter((id) => id !== subjectId);
        
        if (plan.subjectIds.length === 0) {
            rawPlans.splice(planIndex, 1);
        }
        
        this.examPlans = rawPlans;
        this.updateDerivedState();
    },

    clearSeries(seriesId) {
        this.examPlans = this.examPlans.filter(p => p.seriesId !== seriesId);
        this.updateDerivedState();
    },

    canSave() {
        return this.configuredPlansList.length > 0;
    }
});
Alpine.data('onboardingFlow', () => ({
    saving: false,
    userId: null,
    ...createExamPlanMixin(),

    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        this.userId = session.user.id;
        const prefs = await loadUserPreferences(session.user.id, session.user);
        this.hydrateExamPlans(prefs.examPlans);
    },

    async finishOnboarding() {
        // Prevent silent failures with explicit toasts
        if (!this.canSave()) {
            showToast('Please select at least one syllabus to continue.', 'error');
            return;
        }
        if (!this.userId) {
            showToast('Session missing. Please log in again.', 'error');
            return;
        }

        this.saving = true;
        try {
            const prefs = await loadUserPreferences(this.userId);
            await saveUserPreferences(this.userId, {
                ...prefs,
                onboardingComplete: true,
                examPlans: this.configuredPlansList, 
            }, supabase);

            sessionStorage.setItem('pendingToast', 'Your exam plan is saved. Welcome aboard.');
            window.location.href = 'dashboard.html';
        } catch (error) {
            showToast(error.message || 'Could not save your exam plan.', 'error');
            this.saving = false;
        }
    },
}));

Alpine.data('accountSettings', () => ({
    fullName: '',
    originalName: '', 
    isEditingName: false, 
    savingName: false,
    savingPlan: false,
    userId: null,
    
    // THEME VARIABLES
    activeTheme: 'light',
    savedTheme: 'light',
    
    // DELETION VARIABLES
    showDeleteModal: false,
    deleteConfirmWord: '',
    deleteEmail: '',
    deletePassword: '',
    userEmail: '',
    isOAuthUser: false,
    isDeleting: false,
    
    ...createExamPlanMixin(),

    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Establish User Identity & Provider
        this.userEmail = session.user.email;
        const providers = session.user.app_metadata?.providers || [];
        this.isOAuthUser = providers.includes('google') && !providers.includes('email');

        // Initialize Theme from localStorage
        this.savedTheme = localStorage.getItem('o2_theme') || 'light';
        this.activeTheme = this.savedTheme;

        this.userId = session.user.id;
        this.fullName = session.user.user_metadata?.full_name || localStorage.getItem('o2_user_fullName') || '';
        this.originalName = this.fullName; 
        
        const prefs = await loadUserPreferences(session.user.id, session.user);
        this.hydrateExamPlans(prefs.examPlans);
    },

    // --- THEME ENGINE ---
    previewTheme(theme) {
        this.activeTheme = theme;
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    },

    saveTheme() {
        this.savedTheme = this.activeTheme;
        localStorage.setItem('o2_theme', this.activeTheme);
        showToast('Theme saved successfully.', 'success');
    },

    // --- PROFILE ENGINE ---
    startEditingName() {
        this.originalName = this.fullName;
        this.isEditingName = true;
        setTimeout(() => this.$refs.nameInput.focus(), 50);
    },

    cancelEditingName() {
        this.fullName = this.originalName;
        this.isEditingName = false;
    },

    async saveName() {
        const trimmedName = this.fullName.trim();
        if (!trimmedName || !this.userId) return;

        if (trimmedName === this.originalName) {
            this.isEditingName = false;
            return;
        }

        this.originalName = trimmedName; 
        this.isEditingName = false; 
        
        try {
            const { error } = await supabase.auth.updateUser({
                data: { full_name: trimmedName },
            });
            if (error) throw error;

            localStorage.setItem('o2_user_firstName', trimmedName.split(' ')[0]);
            localStorage.setItem('o2_user_fullName', trimmedName);
            
            showToast('Name updated successfully.', 'success');
        } catch (error) {
            this.isEditingName = true; 
            showToast(error.message || 'Could not update your name.', 'error');
        }
    },

    async saveExamPlan() {
        if (!this.canSave() || !this.userId) return;

        this.savingPlan = true;
        try {
            const prefs = await loadUserPreferences(this.userId);
            await saveUserPreferences(this.userId, {
                ...prefs,
                onboardingComplete: true,
                examPlans: this.configuredPlansList,
            }, supabase);

            showToast('Exam plan saved.', 'success');
        } catch (error) {
            showToast(error.message || 'Could not save your exam plan.', 'error');
        } finally {
            this.savingPlan = false;
        }
    },

    // --- DELETION ENGINE ---
    openDeleteModal() {
        this.deleteConfirmWord = '';
        this.deleteEmail = '';
        this.deletePassword = '';
        this.showDeleteModal = true;
    },

    closeDeleteModal() {
        this.showDeleteModal = false;
    },

    canProceedWithDeletion() {
        if (this.deleteConfirmWord !== 'DELETE') return false;
        if (this.deleteEmail !== this.userEmail) return false;
        if (!this.isOAuthUser && this.deletePassword.length === 0) return false;
        return true;
    },

    async executeDeletion() {
        if (!this.canProceedWithDeletion() || this.isDeleting) return;
        this.isDeleting = true;

        try {
            // Note: Make sure your Supabase edge function 'delete-account' accepts the password for verification
            const { error } = await supabase.functions.invoke('delete-account', {
                body: {
                    email: this.userEmail,
                    password: this.deletePassword,
                    isOAuth: this.isOAuthUser
                },
            });

            if (error) throw error;

            await supabase.auth.signOut();
            sessionStorage.setItem('pendingToast', 'Your account has been permanently deleted.');
            sessionStorage.setItem('pendingToastType', 'info');
            window.location.href = "index.html";
        } catch (error) {
            showToast(error.message || 'Failed to delete account. Please verify your credentials.', 'error');
            this.isDeleting = false;
        }
    },
}));

window.Alpine = Alpine;
Alpine.start();

const savedTheme = localStorage.getItem('o2_theme');
if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
}

const showToast = (message, type = 'success') => {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500); 
        }, 3500);
};

const escapeHTML = (str) => {
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
};

const warmPdfCache = async (url) => {
    try {
        await fetch(url, {
            headers: { 'Range': 'bytes=0-262144' },
            priority: 'low' 
        });
    } catch (e) {
    
    }
};

window.O2UserPreferences = {
    SYLLABUSES,
    EXAM_SERIES,
    loadUserPreferences,
    saveUserPreferences,
    getConfiguredPlans,
    METADATA_KEY: 'syllabus_preferences',
};

document.addEventListener('DOMContentLoaded', async () => {
    // --- 1. SECURITY INTERCEPTOR: Catch Expired/Invalid Links ---
    // Supabase throws token errors into the URL hash on failed link clicks
    if (window.location.hash.includes('error=')) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const errorDesc = hashParams.get('error_description') || '';
        
        // If Supabase flags the token as dead
        if (errorDesc.toLowerCase().includes('expired') || errorDesc.toLowerCase().includes('invalid')) {
            
            // Instantly assassinate the ghost session from the first click
            await supabase.auth.signOut();
            
            // Fire the specific error state
            sessionStorage.setItem('pendingToast', 'This link has expired or is invalid. Please request a new one.');
            sessionStorage.setItem('pendingToastType', 'error');
            
            // Scrub the ugly hash from the URL and drop them at the login gate
            window.history.replaceState(null, '', window.location.pathname);
            window.location.href = "login.html";
            return;
        }
    }

    // --- 2. STANDARD ROUTING ---
    const { data: { session } } = await supabase.auth.getSession();
    
    // Prevent the guard from interfering with an ACTIVE password recovery
    if (window.location.hash.includes('type=recovery')) return;
    
    updateUIAndGuardRoutes(session);
});
    const activateDashboardTab = (tabName) => {
        if (!tabName) return;

        const targetNav = document.querySelector(`.sidebar-nav .dash-nav-item[data-target="${tabName}"]`);
        const targetView = document.getElementById(`view-${tabName}`);
        if (!targetNav || !targetView) return;

        document.querySelectorAll('.sidebar-nav .dash-nav-item').forEach((nav) => nav.classList.remove('active'));
        document.querySelectorAll('.dashboard-view').forEach((view) => view.classList.remove('active-view'));
        targetNav.classList.add('active');
        targetView.classList.add('active-view');
    };

    const updateUIAndGuardRoutes = async (session) => {
        const currentPath = window.location.pathname;
        
        const heroLoginBtn = document.getElementById('heroLoginBtn');
        const heroSignupBtn = document.getElementById('heroSignupBtn');
        const profileMenu = document.getElementById('profileMenu');

        if (profileMenu) {
            if (session) {
                if (heroLoginBtn) heroLoginBtn.style.display = 'none';
                if (heroSignupBtn) heroSignupBtn.style.display = 'none';
                profileMenu.style.display = 'inline-block';
            } else {
                if (heroLoginBtn) heroLoginBtn.style.display = 'inline-block';
                if (heroSignupBtn) heroSignupBtn.style.display = 'inline-block';
                profileMenu.style.display = 'none';
            }
        }

        const isHomePage = currentPath.endsWith('index.html') || currentPath === '/';
        const isAuthPage = currentPath.includes('login.html') || currentPath.includes('signup.html');
        const isOnboardingPage = currentPath.includes('onboarding');

        if (!session && (currentPath.includes('dashboard') || isOnboardingPage)) {
            window.location.href = "login.html";
            return;
        }

        let userPrefs = null;
        if (session) {
            userPrefs = await loadUserPreferences(session.user.id, session.user);
        }

        if (session && userPrefs && !userPrefs.onboardingComplete && !isOnboardingPage && !currentPath.includes('reset')) {
            if (currentPath.includes('dashboard') || isAuthPage || isHomePage) {
                window.location.href = "onboarding.html";
                return;
            }
        }

        if (session && userPrefs?.onboardingComplete && isOnboardingPage) {
            window.location.href = "dashboard.html";
            return;
        }

        if (session && (isAuthPage || isHomePage)) {
            window.location.href = userPrefs?.onboardingComplete ? "dashboard.html" : "onboarding.html";
            return;
        }

        const loader = document.getElementById('global-loader');
        if (loader) {
            loader.classList.add('hidden');
        }


        if (session) {
            initializeScopedTracker(session.user.id);
        } else {
            clearUnauthenticatedTrackerDisplay();
        }

        if (session && currentPath.includes('dashboard')) {
            const params = new URLSearchParams(window.location.search);
            const requestedTab = params.get('tab') || window.location.hash.replace('#', '');
            if (requestedTab) {
                activateDashboardTab(requestedTab);
            }

            const typingStage = document.getElementById('typingStage');
            const typingText = document.getElementById('typingText');
            const defaultOverview = document.getElementById('defaultOverview');
                         
            if (typingStage && typingText && defaultOverview) {
                if (sessionStorage.getItem('hasSeenGreeting') === 'true') {
                    typingStage.style.display = 'none';
                    defaultOverview.style.display = 'block';
                    defaultOverview.style.opacity = '1';
                    return; 
                }

                if (typingStage.dataset.started !== 'true') {
                    typingStage.dataset.started = 'true';
                    const firstName = localStorage.getItem('o2_user_firstName') || "Hustler";
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                    const type = async (text) => {
                        for (let i = 0; i < text.length; i++) {
                            typingText.textContent += text.charAt(i);
                            const fastSpeed = Math.floor(Math.random() * (35 - 15 + 1) + 15);
                            await sleep(fastSpeed);
                        }
                    };

                    const erase = async () => {
                        while (typingText.textContent.length > 0) {
                            typingText.textContent = typingText.textContent.slice(0, -1);
                            await sleep(15); 
                        }
                    };
                    
                    const runSequence = async () => {
                        typingText.textContent = '';             
                        await sleep(200); 
                        await type(`Welcome back, ${firstName}`);
                        await sleep(600); 
                        await erase();
                        await sleep(150); 
                        await type("Let's get to work...");
                        await sleep(400);
                                                 
                        typingStage.style.display = 'none';
                        defaultOverview.style.display = 'block';
                                                 
                        void defaultOverview.offsetWidth; 
                        defaultOverview.classList.add('reveal-dashboard');
                                                 
                        sessionStorage.setItem('hasSeenGreeting', 'true');
                    };
                    runSequence();
                }
            }
        }
    };

    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            sessionStorage.setItem('pendingToast', 'Access verified. Please set your new password.');
            sessionStorage.setItem('pendingToastType', 'info');
            window.location.href = "reset-password.html";
            return;
        }

        updateUIAndGuardRoutes(session);
    });

    const pendingToast = sessionStorage.getItem('pendingToast');
    const pendingToastType = sessionStorage.getItem('pendingToastType') || 'success';
    if (pendingToast) {
        showToast(pendingToast, pendingToastType);
        sessionStorage.removeItem('pendingToast');
        sessionStorage.removeItem('pendingToastType');
    }

    const queueOfflineAction = (userId, topicId, targetState) => {
        const pendingKey = `o2_archive_pending_${userId}`;
        let queue = JSON.parse(localStorage.getItem(pendingKey) || "{}");
        queue[topicId] = targetState; 
        localStorage.setItem(pendingKey, JSON.stringify(queue));
    };

    const syncOfflineProgress = async (userId) => {
        if (!navigator.onLine) return;

        const pendingKey = `o2_archive_pending_${userId}`;
        const queue = JSON.parse(localStorage.getItem(pendingKey) || "{}");
        const topicsToSync = Object.keys(queue);

        if (topicsToSync.length === 0) return;
        const payload = topicsToSync.map(topicId => ({
            user_id: userId,
            topic_id: topicId,
            is_completed: queue[topicId]
        }));

        const { error } = await supabase
            .from('user_progress')
            .upsert(payload, { onConflict: 'user_id, topic_id' });

        if (!error) {
            localStorage.removeItem(pendingKey); 
            showToast("Offline progress synced to cloud.", "success");
        }
    };

    window.addEventListener('online', async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            syncOfflineProgress(session.user.id);
        }
    });

    const checkboxes = document.querySelectorAll('.tracker-checkbox');

    let trackerUserId = null; 
    let batchSyncQueue = {}; 
    let batchSyncTimer = null;

    const initializeScopedTracker = async (userId) => {
        trackerUserId = userId; 
        
        const cacheKey = `o2_archive_progress_${userId}`;
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            try {
                const completedTopics = JSON.parse(cachedData);
                checkboxes.forEach(cb => {
                    cb.disabled = false;
                    cb.checked = completedTopics.includes(cb.id);
                });
            } catch (e) {}
        } else {
            checkboxes.forEach(cb => {
                cb.disabled = false;
                cb.checked = false;
            });
        }
    
        await syncOfflineProgress(userId);
        if (navigator.onLine) {
            const { data, error } = await supabase
                .from('user_progress')
                .select('topic_id')
                .eq('user_id', userId)
                .eq('is_completed', true);
    
            if (!error && data) {
                const cloudTopics = data.map(record => record.topic_id);
                localStorage.setItem(cacheKey, JSON.stringify(cloudTopics));
                checkboxes.forEach(cb => {
                    cb.checked = cloudTopics.includes(cb.id);
                });
            }
        }
    };
    
    const clearUnauthenticatedTrackerDisplay = () => {
        trackerUserId = null; 
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            checkbox.disabled = true; 
        });
    };
    
    const executeBatchSync = async () => {
        if (!navigator.onLine || !trackerUserId) return;
        
        const topicsToSync = Object.keys(batchSyncQueue);
        if (topicsToSync.length === 0) return;
        const payload = topicsToSync.map(topicId => ({
            user_id: trackerUserId,
            topic_id: topicId,
            is_completed: batchSyncQueue[topicId]
        }));

        batchSyncQueue = {}; 
        const { error } = await supabase
            .from('user_progress')
            .upsert(payload, { onConflict: 'user_id, topic_id' });
    
        if (error) {
            payload.forEach(item => queueOfflineAction(trackerUserId, item.topic_id, item.is_completed));
            showToast("Connection weak. Changes saved to device.", "info");
        }
    };
    

    checkboxes.forEach(checkbox => {
        document.addEventListener('change', (e) => {
            if (!e.target.classList.contains('tracker-checkbox')) return;

            const checkbox = e.target;
            
            if (!trackerUserId) {
                showToast("Please create a free account to log and save your work progress.", "info");
                checkbox.checked = false;
                return;
            }

            const topicId = checkbox.id;
            const targetState = checkbox.checked;
            const cacheKey = `o2_archive_progress_${trackerUserId}`;
            
            try {
                let cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
                if (targetState) {
                    if (!cached.includes(topicId)) cached.push(topicId);
                } else {
                    cached = cached.filter(id => id !== topicId);
                }
                localStorage.setItem(cacheKey, JSON.stringify(cached));
            } catch (e) {}

            if (!navigator.onLine) {
                queueOfflineAction(trackerUserId, topicId, targetState);
                showToast("Offline. Saved to device.", "info");
                return;
            }

            batchSyncQueue[topicId] = targetState;
            if (batchSyncTimer) clearTimeout(batchSyncTimer);
            batchSyncTimer = setTimeout(executeBatchSync, 2000);
        });
    });

    const logoutBtn = document.getElementById('logoutBtn');
    const logoutModal = document.getElementById('logoutModal');

    if (logoutBtn && logoutModal) {
        const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
        const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutModal.classList.add('show');
        });

        if (cancelLogoutBtn) {
            cancelLogoutBtn.addEventListener('click', () => {
                logoutModal.classList.remove('show');
            });
        }

        logoutModal.addEventListener('click', (e) => {
            if (e.target === logoutModal) {
                logoutModal.classList.remove('show');
            }
        });

        if (confirmLogoutBtn) {
            confirmLogoutBtn.addEventListener('click', async () => {
                confirmLogoutBtn.textContent = 'Logging out...';
                confirmLogoutBtn.disabled = true;
                if (cancelLogoutBtn) cancelLogoutBtn.style.pointerEvents = 'none';

                await supabase.auth.signOut();
                sessionStorage.setItem('pendingToast', 'You have been successfully logged out.');
                sessionStorage.setItem('pendingToastType', 'info');
                window.location.href = "index.html";
            });
        }
    } else if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const { error } = await supabase.auth.signOut();
            
            if (error) {
                showToast(error.message, 'error');
            } else {
                sessionStorage.setItem('pendingToast', 'You have been successfully logged out.');
                sessionStorage.setItem('pendingToastType', 'info');
                window.location.href = "index.html"; 
            }
        });
    }

    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault(); 
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            localStorage.setItem('o2_user_firstName', name.split(' ')[0]);
            localStorage.setItem('o2_user_fullName', name);
            if (password !== confirmPassword) {
                showToast("Passwords do not match.", "error");
                return; 
            }

            const submitBtn = signupForm.querySelector('button');
            
            submitBtn.textContent = 'Creating account...';
            submitBtn.disabled = true;

            const { error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { full_name: name } }
            });

            if (error) {
                showToast(error.message, 'error');
                submitBtn.textContent = 'Create Free Account';
                submitBtn.disabled = false;
            } else {
                
                submitBtn.textContent = 'Create Free Account';
                submitBtn.disabled = false;      
                const modal = document.getElementById('verifyEmailModal');
                if (modal) {
                    modal.classList.add('show');
                    const okBtn = document.getElementById('modalOkBtn');
                    okBtn.addEventListener('click', () => {
                        window.location.href = "login.html";
                    });
                } else {
                    window.location.href = "login.html";
                }
            }
        });
    }

    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const submitBtn = loginForm.querySelector('button');
            
            submitBtn.textContent = 'Logging in...';
            submitBtn.disabled = true;

            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                if (error.message.includes("Email not confirmed")) {
                    showToast("Please click the verification link sent to your email before logging in.", 'error');
                } else {
                    showToast("Invalid email or password.", 'error');
                }
                submitBtn.textContent = 'Log In';
                submitBtn.disabled = false;
            } else {
                const fullName = data?.user?.user_metadata?.full_name || "Hustler";
                localStorage.setItem('o2_user_firstName', fullName.split(' ')[0]);
                localStorage.setItem('o2_user_fullName', fullName);

                sessionStorage.setItem('pendingToast', 'Logged in successfully! Welcome back.');
                const prefs = await loadUserPreferences(data.user.id, data.user);
                window.location.href = prefs.onboardingComplete ? "dashboard.html" : "onboarding.html";
            }
        });
    }

    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) {
        let isCooldown = false; 

        forgotPasswordLink.addEventListener('click', async (e) => {
            e.preventDefault();        
            if (isCooldown) return; 
            const email = document.getElementById('loginEmail').value;

            if (!email) {
                showToast("Please enter your email address in the box first.", "error");
                document.getElementById('loginEmail').focus();
                return;
            }

            isCooldown = true;
            forgotPasswordLink.style.color = '#bdc3c7'; 
            forgotPasswordLink.style.pointerEvents = 'none'; 
            forgotPasswordLink.textContent = 'Sending...';

            const currentOrigin = window.location.origin;
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${currentOrigin}/reset-password.html`
            });

            if (error) {
                showToast(error.message, 'error');
                isCooldown = false;
                forgotPasswordLink.style.color = 'var(--text-main)';
                forgotPasswordLink.style.pointerEvents = 'auto';
                forgotPasswordLink.textContent = 'Forgot Password?';
            } else {
                showToast("Recovery link dispatched. Check your inbox.", "success");
                let timeLeft = 60;
                forgotPasswordLink.textContent = `Wait ${timeLeft}s`;

                const timerInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        forgotPasswordLink.textContent = `Wait ${timeLeft}s`;
                    } else {
                        clearInterval(timerInterval);
                        isCooldown = false;
                        forgotPasswordLink.style.color = 'var(--primary)';
                        forgotPasswordLink.style.pointerEvents = 'auto';
                        forgotPasswordLink.textContent = 'Forgot Password?';
                    }
                }, 1000); 
            }
        });
    }

    const dedicatedResetForm = document.getElementById('dedicatedResetForm');
    if (dedicatedResetForm) {
        const recoveryPassword = document.getElementById('recoveryPassword');
        const recoveryConfirm = document.getElementById('recoveryConfirmPassword');
        const showRecoveryCheckbox = document.getElementById('showRecoveryPasswordCheckbox');

        if (showRecoveryCheckbox) {
            showRecoveryCheckbox.addEventListener('change', () => {
                const type = showRecoveryCheckbox.checked ? 'text' : 'password';
                recoveryPassword.type = type;
                recoveryConfirm.type = type;
            });
        }

        dedicatedResetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (recoveryPassword.value !== recoveryConfirm.value) {
                showToast("Passwords do not match.", "error");
                return;
            }

            const submitBtn = dedicatedResetForm.querySelector('button');
            submitBtn.textContent = 'Securing account...';
            submitBtn.disabled = true;
            const { error } = await supabase.auth.updateUser({ password: recoveryPassword.value });

            if (error) {
                showToast(error.message, 'error');
                submitBtn.textContent = 'Lock In New Password';
                submitBtn.disabled = false;
            } else {
                await supabase.auth.signOut();
                sessionStorage.setItem('pendingToast', 'Password updated successfully. Please log in with your new credentials.');
                sessionStorage.setItem('pendingToastType', 'success');
                window.location.href = "login.html";
            }
        });
    }

    const showSignupCheckbox = document.getElementById('showSignupPasswordCheckbox');
    if (showSignupCheckbox) {
        showSignupCheckbox.addEventListener('change', () => {
            const type = showSignupCheckbox.checked ? 'text' : 'password';
            document.getElementById('password').type = type;
            document.getElementById('confirmPassword').type = type;
        });
    }

    const showLoginCheckbox = document.getElementById('showLoginPasswordCheckbox');
    if (showLoginCheckbox) {
        showLoginCheckbox.addEventListener('change', () => {
            document.getElementById('loginPassword').type = showLoginCheckbox.checked ? 'text' : 'password';
        });
    }

// ==========================================
    // GOOGLE OAUTH INTEGRATION
    // ==========================================
    const googleAuthBtns = document.querySelectorAll('.google-auth-btn');
    
    if (googleAuthBtns.length > 0) {
        googleAuthBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                
                // Visual feedback to show it's processing
                const originalText = btn.innerHTML;
                btn.innerHTML = `<div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>`;
                btn.style.pointerEvents = 'none';

                const currentOrigin = window.location.origin;
                
                const { data, error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: `${currentOrigin}/dashboard.html` // Supabase handles routing them here upon success
                    }
                });

                if (error) {
                    showToast(error.message, 'error');
                    btn.innerHTML = originalText;
                    btn.style.pointerEvents = 'auto';
                }
                // Note: On success, the page physically redirects to Google, so we don't need a success state here.
            });
        });
    }

const navItems = document.querySelectorAll('.sidebar-nav .dash-nav-item');
const views = document.querySelectorAll('.dashboard-view');
const sidebar = document.getElementById('dashboardSidebar');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');

if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
    });
}

if (closeMenuBtn && sidebar) {
    closeMenuBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
    });
}

if (navItems.length > 0 && views.length > 0) {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const targetId = `view-${item.getAttribute('data-target')}`;
            views.forEach(view => {
                view.classList.remove('active-view');
            });
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active-view');
            if (window.innerWidth <= 850 && sidebar) {
                sidebar.classList.remove('open');
            }
        });
    });
}

// ==========================================
// THE NATIVE JAVASCRIPT READER (PDF.js)
// ==========================================
// ==========================================
// THE NATIVE JAVASCRIPT READER (PDF.js + Audio Engine)
// ==========================================
class NativeReaderSystem {
    constructor() {
        this.isOpen = false;
        this.activePages = new Map(); 
        this.renderQueue = []; 
        this.isRendering = false;
        this.currentScale = 1.5;
        this.visualScale = 1.0; 
        this.zoomTimeout = null;
        this.isTranslucent = false;
        this.isInverted = false;
        
        this.modal = null;
        this.container = null;
        this.scaleWrapper = null;
        this.titleNode = null;
        this.observer = null;

        // --- THE PDF.js CACHE ---
        this.pdfCache = new Map(); 
        this.activePdfDoc = null;
        this.numPages = 0;

        // --- AUDIO ENGINE CORE ---
        this.audioNode = new Audio();
        this.audioToolbar = null;
        this.playBtn = null;
        this.playIcon = null;
        this.pauseIcon = null;
        this.seekSlider = null;
        this.timeCurrent = null;
        this.timeTotal = null;
    }

    async primeTheMatrix(urlArray) {
        this.init();
        if (!Array.isArray(urlArray)) return;
        
        const targets = urlArray.slice(0, 8);
        for (const url of targets) {
            if (!this.pdfCache.has(url)) {
                try {
                    const loadingTask = pdfjsLib.getDocument({
                        url: url,
                        disableAutoFetch: true, 
                        disableStream: false
                    });
                    this.pdfCache.set(url, loadingTask);
                } catch (e) {
                    console.warn("Pre-load skipped for", url);
                }
            }
        }
    }

    // UPDATED: Now accepts an audioUrl parameter
    async openPaper(paperUrl, title, audioUrl = null) {
        this.init();
        this.isOpen = true; 
        this.modal.classList.add('nr-open');
        this.scaleWrapper.innerHTML = ''; 
        this.titleNode.style.color = '#4ade80';
        this.titleNode.textContent = `Deploying ${title}...`;

        // Handle Audio Routing
        if (audioUrl) {
            this.audioToolbar.classList.add('active');
            this.audioNode.src = audioUrl;
            this.playIcon.style.display = 'block';
            this.pauseIcon.style.display = 'none';
            this.seekSlider.value = 0;
            this.seekSlider.style.setProperty('--progress', '0%');
            this.timeCurrent.textContent = "0:00";
            this.timeTotal.textContent = "0:00";
        } else {
            this.audioToolbar.classList.remove('active');
            this.audioNode.src = '';
        }

        try {
            let loadingTask = this.pdfCache.get(paperUrl);
            if (!loadingTask) {
                loadingTask = pdfjsLib.getDocument({
                    url: paperUrl,
                    disableAutoFetch: true,
                    disableStream: false
                });
                this.pdfCache.set(paperUrl, loadingTask);
            }

            this.activePdfDoc = await loadingTask.promise;
            this.numPages = this.activePdfDoc.numPages;
            
            this.titleNode.textContent = title;
            this.titleNode.style.color = '#fff';

            await this.buildScrollMatrix();
        } catch (err) {
            console.error(err);
            this.titleNode.textContent = 'Failed to load document.';
            this.titleNode.style.color = '#ef4444';
        }
    }

    async buildScrollMatrix() {
        if (this.observer) this.observer.disconnect();
        this.setupVirtualizationObserver();

        const page1 = await this.activePdfDoc.getPage(1);
        const viewport = page1.getViewport({ scale: this.currentScale });
        const logicalWidth = viewport.width;
        const logicalHeight = viewport.height;

        const existingWrappers = this.scaleWrapper.querySelectorAll('.nr-page-wrapper');
        
        if (existingWrappers.length === 0) {
            for (let i = 1; i <= this.numPages; i++) {
                const wrapper = document.createElement('div');
                wrapper.className = 'nr-page-wrapper';
                wrapper.dataset.pageNum = i;
                wrapper.style.width = `${logicalWidth}px`;
                wrapper.style.height = `${logicalHeight}px`;
                this.scaleWrapper.appendChild(wrapper);
                this.observer.observe(wrapper); 
            }
        } else {
            existingWrappers.forEach(wrapper => {
                wrapper.style.width = `${logicalWidth}px`;
                wrapper.style.height = `${logicalHeight}px`;
                this.observer.observe(wrapper);
            });
        }
    }

    requestRender(pageNum, wrapper) {
        if (this.renderQueue.find(q => q.pageNum === pageNum) || this.activePages.has(pageNum)) return;
        this.activePages.set(pageNum, { wrapper, renderTask: null, canvas: null }); 
        this.renderQueue.push({ pageNum, wrapper, timestamp: performance.now() });
        this.processRenderQueue();
    }

    cancelRender(pageNum) {
        this.renderQueue = this.renderQueue.filter(q => q.pageNum !== pageNum);
    }

    async processRenderQueue() {
        if (this.isRendering || this.renderQueue.length === 0 || !this.activePdfDoc) return;
        this.isRendering = true; 

        const containerRect = this.container.getBoundingClientRect();
        const centerY = this.container.scrollTop + (containerRect.height / 2);

        this.renderQueue.sort((a, b) => {
            const rectA = a.wrapper.getBoundingClientRect();
            const rectB = b.wrapper.getBoundingClientRect();
            const distA = Math.abs((a.wrapper.offsetTop + (rectA.height / 2)) - centerY);
            const distB = Math.abs((b.wrapper.offsetTop + (rectB.height / 2)) - centerY);
            return distA - distB; 
        });

        const task = this.renderQueue.shift();
        await this.executeRender(task.pageNum, task.wrapper);

        this.isRendering = false;
        requestAnimationFrame(() => this.processRenderQueue());
    }

    async executeRender(pageNum, wrapper) {
        if (!this.activePdfDoc) return;
        
        const state = this.activePages.get(pageNum);
        if (!state || wrapper.dataset.rendered === 'true') return;
        
        wrapper.dataset.rendered = 'true'; 

        try {
            const page = await this.activePdfDoc.getPage(pageNum);
            const dpr = window.devicePixelRatio || 1;
            const viewport = page.getViewport({ scale: this.currentScale * dpr });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { alpha: false });
            
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = `${viewport.width / dpr}px`;
            canvas.style.height = `${viewport.height / dpr}px`;

            wrapper.innerHTML = '';
            wrapper.appendChild(canvas);

            const renderTask = page.render({
                canvasContext: ctx,
                viewport: viewport,
            });

            state.renderTask = renderTask;
            state.canvas = canvas;

            await renderTask.promise;
        } catch (e) {
            if (e.name !== 'RenderingCancelledException') {
                console.error(`Error rendering page ${pageNum}:`, e);
                wrapper.dataset.rendered = 'false';
            }
        }
    }

    destroySpecificPage(pageNum) {
        const state = this.activePages.get(pageNum);
        if (!state) return;

        this.cancelRender(pageNum);
        
        if (state.renderTask) {
            state.renderTask.cancel();
        }

        if (state.wrapper) {
            state.wrapper.innerHTML = '';
            state.wrapper.dataset.rendered = 'false';
        }

        this.activePages.delete(pageNum);
    }

    setupVirtualizationObserver() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const pageNum = parseInt(entry.target.dataset.pageNum);
                if (entry.isIntersecting) {
                    this.requestRender(pageNum, entry.target);
                } else {
                    this.destroySpecificPage(pageNum);
                }
            });
        }, { root: this.container, rootMargin: '600px' }); 
    }

    init() {
        if (document.getElementById('native-reader-modal')) return;

        const style = document.createElement('style');
        style.textContent = `
            #native-reader-modal { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999; flex-direction: column; opacity: 0; transition: opacity 0.2s ease-out; }
            #native-reader-modal.nr-open { display: flex; opacity: 1; }
            #native-reader-modal.nr-bg-black { background: #111111; }
            #native-reader-modal.nr-bg-translucent { background: rgba(20, 20, 20, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
            
            /* PDF Toolbar */
            .nr-toolbar { width: 100%; height: 60px; background: #1a1a1a; color: #fff; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; box-sizing: border-box; font-family: system-ui, sans-serif; flex-shrink: 0; z-index: 10; border-bottom: 1px solid #2a2a2a; }
            .nr-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30vw; color: #4ade80; font-family: monospace;}
            .nr-controls { display: flex; gap: 8px; align-items: center; }
            .nr-btn { background: #333; color: #fff; border: 1px solid #444; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
            .nr-btn:hover { background: #555; }
            .nr-close-btn { background: #c92a2a; border-color: #e03131; font-weight: bold; }
            
            /* Audio Extension Toolbar */
            .nr-audio-toolbar { width: 100%; height: 56px; background: #141414; border-bottom: 1px solid #2a2a2a; display: none; align-items: center; justify-content: space-between; padding: 0 20px; box-sizing: border-box; flex-shrink: 0; z-index: 9; font-family: monospace; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
            .nr-audio-toolbar.active { display: flex; }
            .nr-audio-controls { display: flex; gap: 12px; align-items: center; }
            .nr-audio-btn { width: 34px; height: 34px; border-radius: 50%; border: 1px solid #333; background: #222; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; }
            .nr-audio-btn:hover { background: #333; transform: scale(1.05); border-color: #444; }
            .nr-audio-play { background: #4ade80; color: #000; border: none; width: 38px; height: 38px; }
            .nr-audio-play:hover { background: #22c55e; }
            .nr-audio-scrubber-container { flex-grow: 1; margin: 0 24px; display: flex; align-items: center; gap: 16px; font-size: 0.85rem; color: #aaa; }
            .nr-audio-slider { -webkit-appearance: none; width: 100%; height: 6px; background: #333; border-radius: 3px; outline: none; cursor: pointer; position: relative; }
            .nr-audio-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; transition: transform 0.1s; z-index: 2; position: relative; }
            .nr-audio-slider::-webkit-slider-thumb:hover { transform: scale(1.3); }
            .nr-audio-slider::before { content: ''; position: absolute; left: 0; top: 0; height: 100%; background: #4ade80; border-radius: 3px; width: var(--progress, 0%); pointer-events: none; z-index: 1; }
            
            .nr-canvas-container { flex-grow: 1; width: 100%; overflow: auto; display: block; box-sizing: border-box; will-change: scroll-position; }
            #nr-scale-wrapper { transform-origin: 0 0; display: flex; flex-direction: column; align-items: center; width: max-content; margin: 0 auto; padding: 20px 0; gap: 20px; will-change: transform; }
            .nr-page-wrapper { background: #ffffff; box-shadow: 0 4px 15px rgba(0,0,0,0.2); position: relative; overflow: hidden; }
            .nr-page-wrapper canvas { display: block; }
            .nr-canvas-container.nr-inverted .nr-page-wrapper canvas { filter: invert(0.92) hue-rotate(180deg) contrast(1.05) brightness(0.95); }
        `;
        document.head.appendChild(style);

        this.modal = document.createElement('div');
        this.modal.id = 'native-reader-modal';
        this.modal.className = 'nr-bg-black'; 
        this.modal.innerHTML = `
            <div class="nr-toolbar">
                <div class="nr-title" id="nr-title">Preparing Environment...</div>
                <div class="nr-controls">
                    <button class="nr-btn" id="nr-zoom-out">− Zoom</button>
                    <button class="nr-btn" id="nr-zoom-in">+ Zoom</button>
                    <button class="nr-btn" id="nr-bg-toggle">Matte Translucent</button>
                    <button class="nr-btn" id="nr-invert-toggle">Dark PDF</button>
                    <button class="nr-btn nr-close-btn" id="nr-close">Close</button>
                </div>
            </div>
            <div class="nr-audio-toolbar" id="nr-audio-toolbar">
                <div class="nr-audio-controls">
                    <button class="nr-audio-btn" id="nr-audio-rw" title="Rewind 5 seconds">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg>
                    </button>
                    <button class="nr-audio-btn" id="nr-audio-fw" title="Forward 5 seconds">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg>
                    </button>
                </div>
                <div class="nr-audio-scrubber-container">
                    <span id="nr-audio-current">0:00</span>
                    <input type="range" class="nr-audio-slider" id="nr-audio-seek" min="0" max="100" value="0">
                    <span id="nr-audio-total">0:00</span>
                </div>
                <div class="nr-audio-controls">
                    <button class="nr-audio-btn nr-audio-play" id="nr-audio-play" title="Play/Pause">
                        <svg id="nr-play-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        <svg id="nr-pause-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:none;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                    </button>
                </div>
            </div>
            <div class="nr-canvas-container" id="nr-container"><div id="nr-scale-wrapper"></div></div>
        `;
        document.body.appendChild(this.modal);

        this.container = document.getElementById('nr-container');
        this.scaleWrapper = document.getElementById('nr-scale-wrapper');
        this.titleNode = document.getElementById('nr-title');

        // Setup Document Listeners
        document.getElementById('nr-close').addEventListener('click', () => this.close());
        document.getElementById('nr-zoom-in').addEventListener('click', () => { this.applyVisualZoom(1.25, this.container.getBoundingClientRect().width/2, this.container.getBoundingClientRect().height/2); this.commitZoom(); });
        document.getElementById('nr-zoom-out').addEventListener('click', () => { this.applyVisualZoom(0.8, this.container.getBoundingClientRect().width/2, this.container.getBoundingClientRect().height/2); this.commitZoom(); });

        const bgBtn = document.getElementById('nr-bg-toggle');
        bgBtn.addEventListener('click', () => {
            this.isTranslucent = !this.isTranslucent;
            this.modal.className = this.isTranslucent ? 'nr-open nr-bg-translucent' : 'nr-open nr-bg-black';
            bgBtn.textContent = this.isTranslucent ? 'Solid Black' : 'Matte Translucent';
        });

        const invertBtn = document.getElementById('nr-invert-toggle');
        invertBtn.addEventListener('click', () => {
            this.isInverted = !this.isInverted;
            this.container.classList.toggle('nr-inverted', this.isInverted);
            invertBtn.textContent = this.isInverted ? 'Normal PDF' : 'Dark PDF';
        });

        this.setupZoomHandlers();
        this.setupAudioHandlers();
    }

    setupAudioHandlers() {
        this.audioToolbar = document.getElementById('nr-audio-toolbar');
        this.playBtn = document.getElementById('nr-audio-play');
        this.playIcon = document.getElementById('nr-play-icon');
        this.pauseIcon = document.getElementById('nr-pause-icon');
        this.seekSlider = document.getElementById('nr-audio-seek');
        this.timeCurrent = document.getElementById('nr-audio-current');
        this.timeTotal = document.getElementById('nr-audio-total');

        const formatTime = (time) => {
            if (isNaN(time)) return "0:00";
            const mins = Math.floor(time / 60);
            const secs = Math.floor(time % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        };

        this.audioNode.addEventListener('loadedmetadata', () => {
            this.timeTotal.textContent = formatTime(this.audioNode.duration);
            this.seekSlider.max = this.audioNode.duration;
        });

        this.audioNode.addEventListener('timeupdate', () => {
            this.timeCurrent.textContent = formatTime(this.audioNode.currentTime);
            this.seekSlider.value = this.audioNode.currentTime;
            const progress = (this.audioNode.currentTime / this.audioNode.duration) * 100;
            this.seekSlider.style.setProperty('--progress', `${progress}%`);
        });

        this.audioNode.addEventListener('ended', () => {
            this.playIcon.style.display = 'block';
            this.pauseIcon.style.display = 'none';
        });

        this.seekSlider.addEventListener('input', (e) => {
            this.audioNode.currentTime = e.target.value;
            const progress = (this.audioNode.currentTime / this.audioNode.duration) * 100;
            this.seekSlider.style.setProperty('--progress', `${progress}%`);
        });

        this.playBtn.addEventListener('click', () => {
            if (this.audioNode.paused) {
                this.audioNode.play();
                this.playIcon.style.display = 'none';
                this.pauseIcon.style.display = 'block';
            } else {
                this.audioNode.pause();
                this.playIcon.style.display = 'block';
                this.pauseIcon.style.display = 'none';
            }
        });

        document.getElementById('nr-audio-rw').addEventListener('click', () => {
            this.audioNode.currentTime = Math.max(0, this.audioNode.currentTime - 5);
        });

        document.getElementById('nr-audio-fw').addEventListener('click', () => {
            this.audioNode.currentTime = Math.min(this.audioNode.duration, this.audioNode.currentTime + 5);
        });
    }

    setupZoomHandlers() {
        this.container.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault(); 
                const zoomFactor = Math.exp(e.deltaY * -0.01); 
                this.applyVisualZoom(zoomFactor, e.clientX, e.clientY);
                clearTimeout(this.zoomTimeout);
                this.zoomTimeout = setTimeout(() => this.commitZoom(), 200);
            }
        }, { passive: false });
    }

    applyVisualZoom(zoomFactor, clientX, clientY) {
        const newVisualScale = this.visualScale * zoomFactor;
        const projectedNativeScale = this.currentScale * newVisualScale;
        if (projectedNativeScale < 0.5 || projectedNativeScale > 6.0) return;

        if (this.visualScale === 1.0) {
            this.startX = clientX; this.startY = clientY;
            const rect = this.scaleWrapper.getBoundingClientRect();
            this.startLeft = rect.left; this.startTop = rect.top;
            this.startWidth = rect.width; this.startHeight = rect.height;
        }

        this.visualScale = newVisualScale;
        let targetLeft = clientX - ((this.startX - this.startLeft) * this.visualScale);
        let targetTop = clientY - ((this.startY - this.startTop) * this.visualScale);

        const containerRect = this.container.getBoundingClientRect();
        const scaledWidth = this.startWidth * this.visualScale;
        const scaledHeight = this.startHeight * this.visualScale;

        if (scaledWidth <= containerRect.width) targetLeft = containerRect.left + (containerRect.width - scaledWidth) / 2;
        else targetLeft = Math.max(containerRect.left - (scaledWidth - containerRect.width), Math.min(containerRect.left, targetLeft));

        if (scaledHeight <= containerRect.height) targetTop = containerRect.top + (containerRect.height - scaledHeight) / 2;
        else targetTop = Math.max(containerRect.top - (scaledHeight - containerRect.height), Math.min(containerRect.top, targetTop));

        this.scaleWrapper.style.transform = `translate(${targetLeft - this.startLeft}px, ${targetTop - this.startTop}px) scale(${this.visualScale})`;
        this.lastTargetLeft = targetLeft; this.lastTargetTop = targetTop;
    }

    async commitZoom() {
        if (this.visualScale === 1.0) return;
        this.currentScale *= this.visualScale;
        const finalLeft = this.lastTargetLeft; const finalTop = this.lastTargetTop;
        
        this.visualScale = 1.0;
        this.scaleWrapper.style.transform = '';
        
        for (const pageNum of this.activePages.keys()) {
            this.destroySpecificPage(pageNum);
        }
        
        await this.buildScrollMatrix(); 
        
        const containerRect = this.container.getBoundingClientRect();
        this.container.scrollLeft = containerRect.left - finalLeft;
        this.container.scrollTop = containerRect.top - finalTop;
    }

    close() {
        this.isOpen = false;
        this.modal.classList.remove('nr-open');
        if (this.observer) this.observer.disconnect();
        this.scaleWrapper.innerHTML = ''; 

        this.renderQueue = [];
        for (const pageNum of this.activePages.keys()) {
            this.destroySpecificPage(pageNum);
        }
        
        // Shut down audio engine gracefully
        if (this.audioNode) {
            this.audioNode.pause();
            this.audioNode.src = '';
        }
        if (this.audioToolbar) {
            this.audioToolbar.classList.remove('active');
        }
        
        this.activePdfDoc = null;
        this.currentScale = 1.5;
        this.visualScale = 1.0;
        this.scaleWrapper.style.transform = 'scale(1)';
    }
}

window.NativeReader = new NativeReaderSystem();
const renderArchive = () => {
    const mountPoint = document.getElementById('archive-mount');
    if (!mountPoint) return; 

    const uniqueSubjects = [...new Set(mockDatabase.map(item => item.subject))].sort();
    const uniqueYears = [...new Set(mockDatabase.map(item => item.year))].sort().reverse();
    const uniqueSeries = [...new Set(mockDatabase.map(item => item.series))].sort();
    
    let html = `
        <div class="archive-toolbar">
            <select class="filter-select" id="filter-subject">
                <option value="all">All Subjects</option>
                ${uniqueSubjects.map(sub => `<option value="${sub}">${sub}</option>`).join('')}
            </select>
            <select class="filter-select" id="filter-year">
                <option value="all">All Years</option>
                ${uniqueYears.map(year => `<option value="${year}">${year}</option>`).join('')}
            </select>
            <select class="filter-select" id="filter-series">
                <option value="all">All Series</option>
                ${uniqueSeries.map(series => `<option value="${series}">${series}</option>`).join('')}
            </select>
        </div>
        <div class="archive-grid" id="archive-grid"></div>
    `;
    
    mountPoint.innerHTML = html;
    
    const grid = document.getElementById('archive-grid');
    const filters = document.querySelectorAll('.filter-select');

    const renderCards = () => {
        const subjectFilter = document.getElementById('filter-subject').value;
        const yearFilter = document.getElementById('filter-year').value;
        const seriesFilter = document.getElementById('filter-series').value;
        
        const filteredData = mockDatabase.filter(paper => {
            return (subjectFilter === 'all' || paper.subject === subjectFilter) &&
                   (yearFilter === 'all' || paper.year === yearFilter) &&
                   (seriesFilter === 'all' || paper.series === seriesFilter);
        });

        if (filteredData.length === 0) {
            grid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No papers found matching these filters.</p>`;
            return;
        }

        const isFiltered = subjectFilter !== 'all' || yearFilter !== 'all' || seriesFilter !== 'all';
        let topUrlsForMatrix = [];

        if (isFiltered) {
            // --- INDIVIDUAL TILES ---
            grid.innerHTML = filteredData.map(paper => {
                const paperUrl = `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.file}`;
                const audioUrl = paper.audio_file ? `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.audio_file}` : '';
                topUrlsForMatrix.push(paperUrl); 
                
                const safeSubject = escapeHTML(paper.subject);
                const safeYear = escapeHTML(paper.year);
                const safeSeries = escapeHTML(paper.series);
                const safeVariant = escapeHTML(paper.variant);
                const safeUrl = escapeHTML(paperUrl);
                const safeAudioUrl = escapeHTML(audioUrl);
                
                const btnText = audioUrl ? "Open Paper & Audio" : "Open Paper & Mark Scheme";
                const btnIcon = audioUrl 
                    ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`
                    : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`;

                return `
                <div class="paper-card">
                    <div>
                        <div class="paper-card-header">
                            <div>
                                <div class="paper-code">${safeSubject}</div>
                                <div class="paper-meta">${safeSeries} ${safeYear} • Variant ${safeVariant}</div>
                            </div>
                            <span class="badge" style="margin:0; background: var(--bg-main);">Merged</span>
                        </div>
                    </div>
                    <button class="paper-btn" 
                            onpointerdown="NativeReader.openPaper('${safeUrl}', '${safeSubject} ${safeYear}', '${safeAudioUrl}'); event.preventDefault();">
                        ${btnIcon}
                        ${btnText}
                    </button>
                </div>
            `}).join('');
        } else {
            // --- GROUPED TILES ---
            const groupedData = {};
            filteredData.forEach(paper => {
                const key = `${paper.subject}_${paper.year}_${paper.series}`;
                if (!groupedData[key]) groupedData[key] = { subject: paper.subject, year: paper.year, series: paper.series, variants: [] };
                groupedData[key].variants.push(paper);
            });

            grid.innerHTML = Object.values(groupedData).map(group => {
                const safeSubject = escapeHTML(group.subject);
                const safeYear = escapeHTML(group.year);
                const safeSeries = escapeHTML(group.series);
                const isJoint = group.variants.length > 1;
                const tileClass = isJoint ? "paper-card joint-tile" : "paper-card";

                const variantButtons = group.variants.sort((a, b) => a.variant.localeCompare(b.variant)).map(paper => {
                    const paperUrl = `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.file}`;
                    const audioUrl = paper.audio_file ? `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.audio_file}` : '';
                    topUrlsForMatrix.push(paperUrl); 
                    
                    const safeVariant = escapeHTML(paper.variant);
                    const safeUrl = escapeHTML(paperUrl);
                    const safeAudioUrl = escapeHTML(audioUrl);
                    
                    const btnIcon = audioUrl 
                        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`
                        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`;

                    return `
                        <button class="paper-btn" 
                                onpointerdown="NativeReader.openPaper('${safeUrl}', '${safeSubject} ${safeYear} V${safeVariant}', '${safeAudioUrl}'); event.preventDefault();">
                            ${btnIcon}
                            Open Variant ${safeVariant}
                        </button>
                    `;
                }).join('');

                return `
                <div class="${tileClass}">
                    <div>
                        <div class="paper-card-header">
                            <div>
                                <div class="paper-code">${safeSubject}</div>
                                <div class="paper-meta">${safeSeries} ${safeYear} • ${isJoint ? 'Multiple Variants' : 'Single Variant'}</div>
                            </div>
                            <span class="badge" style="margin:0; background: var(--bg-main);">Merged</span>
                        </div>
                    </div>
                    <div class="variant-btn-group">
                        ${variantButtons}
                    </div>
                </div>
            `}).join('');
        }

        if (topUrlsForMatrix.length > 0) {
            setTimeout(() => {
                window.NativeReader.primeTheMatrix(topUrlsForMatrix.slice(0, 3));
            }, 100); 
        }
    };

    filters.forEach(filter => filter.addEventListener('change', renderCards));
    renderCards();
};

document.addEventListener('DOMContentLoaded', renderArchive);