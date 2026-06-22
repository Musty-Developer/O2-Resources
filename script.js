import { createClient } from '@supabase/supabase-js';
import mockDatabase from './mockDatabase_output.json';
import {
    SYLLABUSES,
    EXAM_SERIES,
    loadUserPreferences,
    saveUserPreferences,
    getSubjectSeriesMap,
    getSyllabusLabel,
    getSeriesLabel,
    getConfiguredPlans,
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
        for (let plan of this.examPlans) {
            if (plan.seriesId !== this.activeSeriesId && plan.subjectIds?.includes(subjectId)) {
                return true;
            }
        }
        return false;
    },

    isSubjectSelected(subjectId) {
        const plan = this.examPlans.find((entry) => entry.seriesId === this.activeSeriesId);
        return plan ? plan.subjectIds.includes(subjectId) : false;
    },

    assignedElsewhereLabel(subjectId) {
        for (let plan of this.examPlans) {
            if (plan.seriesId !== this.activeSeriesId && plan.subjectIds?.includes(subjectId)) {
                return this.seriesLabel(plan.seriesId);
            }
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
    savingName: false,
    savingPlan: false,
    requestingDeletion: false,
    userId: null,
    ...createExamPlanMixin(),

    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        this.userId = session.user.id;
        this.fullName = session.user.user_metadata?.full_name || localStorage.getItem('o2_user_fullName') || '';
        const prefs = await loadUserPreferences(session.user.id, session.user);
        this.hydrateExamPlans(prefs.examPlans);

        const deleteModal = document.getElementById('deleteAccountModal');
        const cancelDeleteBtn = document.getElementById('cancelDeleteAccountBtn');
        const confirmDeleteBtn = document.getElementById('confirmDeleteAccountBtn');

        if (cancelDeleteBtn && deleteModal) {
            cancelDeleteBtn.addEventListener('click', () => deleteModal.classList.remove('show'));
        }

        if (deleteModal) {
            deleteModal.addEventListener('click', (event) => {
                if (event.target === deleteModal) deleteModal.classList.remove('show');
            });
        }

        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => this.requestAccountDeletion());
        }
    },

    async saveName() {
        const trimmedName = this.fullName.trim();
        if (!trimmedName || !this.userId) return;

        this.savingName = true;
        try {
            const { error } = await supabase.auth.updateUser({
                data: { full_name: trimmedName },
            });
            if (error) throw error;

            localStorage.setItem('o2_user_firstName', trimmedName.split(' ')[0]);
            localStorage.setItem('o2_user_fullName', trimmedName);
            showToast('Name updated successfully.', 'success');
        } catch (error) {
            showToast(error.message || 'Could not update your name.', 'error');
        } finally {
            this.savingName = false;
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

    openDeleteModal() {
        const deleteModal = document.getElementById('deleteAccountModal');
        if (deleteModal) deleteModal.classList.add('show');
    },

    async requestAccountDeletion() {
        if (this.requestingDeletion) return;

        this.requestingDeletion = true;
        const deleteModal = document.getElementById('deleteAccountModal');
        const confirmDeleteBtn = document.getElementById('confirmDeleteAccountBtn');

        try {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError || !user?.email) throw userError || new Error('No account email found.');

            const currentOrigin = window.location.origin;
            const { error } = await supabase.functions.invoke('request-account-deletion', {
                body: {
                    email: user.email,
                    redirectTo: `${currentOrigin}/delete-account.html`,
                },
            }).catch(() => ({ error: null }));

            if (error) {
                // Fallback until the Edge Function is deployed in Supabase.
                console.info('Account deletion Edge Function not yet connected.', error);
            }

            if (deleteModal) deleteModal.classList.remove('show');
            showToast('A secure account deletion link has been sent to your email.', 'success');
        } catch (error) {
            showToast(error.message || 'Could not send the deletion link.', 'error');
        } finally {
            this.requestingDeletion = false;
            if (confirmDeleteBtn) confirmDeleteBtn.textContent = 'Send Deletion Link';
        }
    },
}));

window.Alpine = Alpine;
Alpine.start();

const savedTheme = localStorage.getItem('o2_theme');
if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
}

const themeToggleBtns = document.querySelectorAll('.theme-toggle-btn');
themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault(); 
        
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', targetTheme);
        localStorage.setItem('o2_theme', targetTheme);
    });
});

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
    const { data: { session } } = await supabase.auth.getSession();
    
    // Prevent interfering with password recovery routing
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

class NativeReaderSystem {
    constructor() {
        this.isOpen = false;
        this.currentPdf = null;
        this.VRAM_LIMIT_BYTES = 150 * 1024 * 1024; 
        this.currentVRAM = 0;
        this.canvasPool = [];
        this.activePages = new Map(); 
        this.renderQueue = []; 
        this.isRendering = false;
        this.currentScale = 1.5;
        this.visualScale = 1.0; 
        this.zoomTimeout = null;
        this.touchDist = 0;
        this.isTranslucent = false;
        this.isInverted = false;
        this.modal = null;
        this.container = null;
        this.scaleWrapper = null;
        this.titleNode = null;
        this.observer = null;
        this.configurePDFJS();
    }

    configurePDFJS() {
        if (!window.pdfjsLib) return;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        // Disable features we don't need to save worker memory
        pdfjsLib.disableAutoFetch = false; // We WANT range requests
        pdfjsLib.disableStream = false;
        pdfjsLib.disableFontFace = true; // Speeds up text-layer drastically
    }

    initializeCanvasPool(size = 8) {
        this.canvasPool = [];
        for (let i = 0; i < size; i++) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
            this.canvasPool.push({ canvas, ctx, inUse: false });
        }
    }

    acquireCanvas() {
        let freeCanvas = this.canvasPool.find(c => !c.inUse);
        if (freeCanvas) {
            freeCanvas.inUse = true;
            return freeCanvas;
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
        const newObj = { canvas, ctx, inUse: true };
        this.canvasPool.push(newObj);
        return newObj;
    }

    releaseCanvas(canvasObj) {
        if (!canvasObj) return;
        // Wipe memory cleanly but keep the DOM element alive
        canvasObj.canvas.width = 0;
        canvasObj.canvas.height = 0;
        canvasObj.inUse = false;
    }

    requestRender(pageNum, wrapper) {
        // Prevent duplicate queuing
        if (this.renderQueue.find(q => q.pageNum === pageNum) || this.activePages.has(pageNum)) return;

        this.renderQueue.push({ pageNum, wrapper, timestamp: performance.now() });
        this.processRenderQueue();
    }

    cancelRender(pageNum) {
        this.renderQueue = this.renderQueue.filter(q => q.pageNum !== pageNum);
    }

    async processRenderQueue() {
        if (this.isRendering || this.renderQueue.length === 0) return;
        this.isRendering = true;

        // Sort queue by distance to the dead center of the viewport (Spatial Heuristics)
        const containerRect = this.container.getBoundingClientRect();
        const centerY = this.container.scrollTop + (containerRect.height / 2);

        this.renderQueue.sort((a, b) => {
            const rectA = a.wrapper.getBoundingClientRect();
            const rectB = b.wrapper.getBoundingClientRect();
            const distA = Math.abs((a.wrapper.offsetTop + (rectA.height / 2)) - centerY);
            const distB = Math.abs((b.wrapper.offsetTop + (rectB.height / 2)) - centerY);
            return distA - distB; // Render closest to center first
        });

        const task = this.renderQueue.shift();

        try {
            await this.executeRender(task.pageNum, task.wrapper);
        } catch (e) {
            if (e.name !== 'RenderingCancelledException') console.error(e);
        }

        this.isRendering = false;
        
        // Sub-frame recursive loop
        requestAnimationFrame(() => this.processRenderQueue());
    }

    async executeRender(pageNum, wrapper) {
        if (wrapper.dataset.rendered === 'true') return;
        
        const page = await this.currentPdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.currentScale });
        const pixelRatio = window.devicePixelRatio || 1;
        
        // VRAM Byte Calculation (Width * Height * 4 bytes per RGBA pixel)
        const vramCost = (viewport.width * pixelRatio) * (viewport.height * pixelRatio) * 4;

        // VRAM Protection: If this pushes us over the edge, evict the furthest page
        if (this.currentVRAM + vramCost > this.VRAM_LIMIT_BYTES) {
            this.evictFurthestPage();
        }

        const poolObj = this.acquireCanvas();
        poolObj.canvas.width = viewport.width * pixelRatio;
        poolObj.canvas.height = viewport.height * pixelRatio;
        poolObj.ctx.scale(pixelRatio, pixelRatio);

        // Store state immediately to prevent race conditions
        const pageState = {
            poolObj,
            renderTask: null,
            textTask: null,
            vramCost,
            wrapper
        };
        this.activePages.set(pageNum, pageState);
        this.currentVRAM += vramCost;

        // 1. Paint to Canvas
        pageState.renderTask = page.render({ canvasContext: poolObj.ctx, viewport });
        await pageState.renderTask.promise;

        // Double-buffer swap
        wrapper.innerHTML = ''; 
        wrapper.appendChild(poolObj.canvas);
        wrapper.dataset.rendered = 'true';

        // 2. Yield to Main Thread, then paint invisible text layer
        await new Promise(resolve => setTimeout(resolve, 30)); 

        if (wrapper.dataset.rendered !== 'true') return; // User scrolled away during yield

        const textContent = await page.getTextContent();
        if (wrapper.dataset.rendered !== 'true') return;

        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
        wrapper.appendChild(textLayerDiv);

        pageState.textTask = window.pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        await pageState.textTask.promise;
    }

    evictFurthestPage() {
        if (this.activePages.size === 0) return;

        const containerRect = this.container.getBoundingClientRect();
        const centerY = this.container.scrollTop + (containerRect.height / 2);

        let furthestPageNum = -1;
        let maxDist = -1;

        // Find the active page that is mathematically furthest from the user's eyes
        for (const [pageNum, state] of this.activePages.entries()) {
            const rect = state.wrapper.getBoundingClientRect();
            const dist = Math.abs((state.wrapper.offsetTop + (rect.height / 2)) - centerY);
            if (dist > maxDist) {
                maxDist = dist;
                furthestPageNum = pageNum;
            }
        }

        if (furthestPageNum !== -1) {
            this.destroySpecificPage(furthestPageNum);
        }
    }

    destroySpecificPage(pageNum) {
        const state = this.activePages.get(pageNum);
        if (!state) return;

        this.cancelRender(pageNum);

        if (state.renderTask) state.renderTask.cancel();
        if (state.textTask) state.textTask.cancel();

        state.wrapper.innerHTML = '';
        state.wrapper.dataset.rendered = 'false';

        // Release hardware memory and update VRAM tracker
        this.releaseCanvas(state.poolObj);
        this.currentVRAM -= state.vramCost;
        this.activePages.delete(pageNum);
    }

    // ==========================================
    // 3. UI, MATH, AND ZOOM ARCHITECTURE
    // ==========================================

    init() {
        if (document.getElementById('native-reader-modal')) return;

        const style = document.createElement('style');
        style.textContent = `
            #native-reader-modal {
                display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                z-index: 9999; flex-direction: column; opacity: 0; transition: opacity 0.2s ease-out;
            }
            #native-reader-modal.nr-open { display: flex; opacity: 1; }
            #native-reader-modal.nr-bg-black { background: #111111; }
            #native-reader-modal.nr-bg-translucent { 
                background: rgba(20, 20, 20, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            }
            .nr-toolbar {
                width: 100%; height: 60px; background: #1a1a1a; color: #fff;
                display: flex; justify-content: space-between; align-items: center;
                padding: 0 20px; box-sizing: border-box; font-family: system-ui, sans-serif;
                flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 10;
            }
            .nr-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
            .nr-controls { display: flex; gap: 8px; align-items: center; }
            .nr-btn { background: #333; color: #fff; border: 1px solid #444; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
            .nr-btn:hover { background: #555; }
            .nr-close-btn { background: #c92a2a; border-color: #e03131; font-weight: bold; }
            .nr-canvas-container {
                flex-grow: 1; width: 100%; overflow: auto; display: block; box-sizing: border-box; will-change: scroll-position;
            }
            #nr-scale-wrapper {
                transform-origin: 0 0; display: flex; flex-direction: column; align-items: center; width: max-content; margin: 0 auto;
                padding: 20px 0; gap: 20px; will-change: transform;
            }
            .nr-page-wrapper {
                background: #ffffff; box-shadow: 0 4px 15px rgba(0,0,0,0.2); position: relative; overflow: hidden;
            }
            .nr-page-wrapper canvas { display: block; width: 100% !important; height: 100% !important; }
            .textLayer { position: absolute; left: 0; top: 0; right: 0; bottom: 0; overflow: hidden; line-height: 1.0; }
            .textLayer > span { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; }
            .textLayer ::selection { background: rgba(0, 115, 255, 0.3); }
            .nr-canvas-container.nr-inverted .nr-page-wrapper canvas { filter: invert(0.92) hue-rotate(180deg) contrast(1.05) brightness(0.95); }
            .nr-canvas-container.nr-inverted .textLayer ::selection { background: rgba(255, 200, 0, 0.4); }
        `;
        document.head.appendChild(style);

        this.modal = document.createElement('div');
        this.modal.id = 'native-reader-modal';
        this.modal.className = 'nr-bg-black'; 
        this.modal.innerHTML = `
            <div class="nr-toolbar">
                <div class="nr-title" id="nr-title">Loading...</div>
                <div class="nr-controls">
                    <button class="nr-btn" id="nr-zoom-out">− Zoom</button>
                    <button class="nr-btn" id="nr-zoom-in">+ Zoom</button>
                    <button class="nr-btn" id="nr-bg-toggle">Matte Translucent</button>
                    <button class="nr-btn" id="nr-invert-toggle">Dark PDF</button>
                    <button class="nr-btn nr-close-btn" id="nr-close">Close</button>
                </div>
            </div>
            <div class="nr-canvas-container" id="nr-container"><div id="nr-scale-wrapper"></div></div>
        `;
        document.body.appendChild(this.modal);

        this.container = document.getElementById('nr-container');
        this.scaleWrapper = document.getElementById('nr-scale-wrapper');
        this.titleNode = document.getElementById('nr-title');

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

        this.initializeCanvasPool(8); // Pre-allocate the GPU memory pool
        this.setupZoomHandlers();
        this.setupVirtualizationObserver();
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

        this.container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                this.touchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                clearTimeout(this.zoomTimeout); 
            }
        }, { passive: false });

        this.container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const newDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                const zoomFactor = newDist / this.touchDist;
                this.touchDist = newDist;
                this.applyVisualZoom(zoomFactor, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
            }
        }, { passive: false });

        this.container.addEventListener('touchend', (e) => {
            if (e.touches.length < 2 && this.visualScale !== 1.0) this.commitZoom();
        });
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

        // Hardware-bound walls
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
        
        await this.buildScrollMatrix(); // Natively resizes bounding boxes
        
        const containerRect = this.container.getBoundingClientRect();
        this.container.scrollLeft = containerRect.left - finalLeft;
        this.container.scrollTop = containerRect.top - finalTop;
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
        }, { root: this.container, rootMargin: '1000px' }); // Render aggressive 1000px look-ahead
    }

    async primeTheMatrix(urlArray) {
        this.init();
        if (!Array.isArray(urlArray)) return;
        urlArray.slice(0, 3).forEach(url => {
            try { fetch(url, { headers: { 'Range': 'bytes=0-262144' }, priority: 'low' }); } catch (e) {}
        });
    }

    async openPaper(paperUrl, title) {
        this.init();
        if (!window.pdfjsLib) return;
        this.isOpen = true; this.modal.classList.add('nr-open');
        this.titleNode.textContent = title || 'Document';
        this.scaleWrapper.innerHTML = ''; 

        try {
            const loadingTask = window.pdfjsLib.getDocument(paperUrl);
            this.currentPdf = await loadingTask.promise;
            if (!this.isOpen) { this.currentPdf.destroy(); this.currentPdf = null; return; }
            await this.buildScrollMatrix();
        } catch (err) {
            this.titleNode.textContent = 'Error loading document.';
        }
    }

    async buildScrollMatrix() {
        this.observer.disconnect();
        const page1 = await this.currentPdf.getPage(1);
        const viewport = page1.getViewport({ scale: this.currentScale });
        const existingWrappers = this.scaleWrapper.querySelectorAll('.nr-page-wrapper');
        
        if (existingWrappers.length === 0) {
            for (let i = 1; i <= this.currentPdf.numPages; i++) {
                const wrapper = document.createElement('div');
                wrapper.className = 'nr-page-wrapper';
                wrapper.dataset.pageNum = i;
                wrapper.style.width = `${viewport.width}px`;
                wrapper.style.height = `${viewport.height}px`;
                this.scaleWrapper.appendChild(wrapper);
                this.observer.observe(wrapper); 
            }
        } else {
            existingWrappers.forEach(wrapper => {
                wrapper.style.width = `${viewport.width}px`;
                wrapper.style.height = `${viewport.height}px`;
                // Intentionally leave old canvases inside until observer paints over them (Double Buffering)
                this.observer.observe(wrapper);
            });
        }
    }

    async close() {
        this.isOpen = false;
        this.modal.classList.remove('nr-open');
        this.observer.disconnect();
        this.scaleWrapper.innerHTML = ''; 

        // Flush Queue and Active Memory
        this.renderQueue = [];
        for (const pageNum of this.activePages.keys()) {
            this.destroySpecificPage(pageNum);
        }

        if (this.currentPdf) {
            await this.currentPdf.destroy();
            this.currentPdf = null;
        }
        
        this.currentScale = 1.5;
        this.visualScale = 1.0;
        this.scaleWrapper.style.transform = 'scale(1)';
        this.currentVRAM = 0;
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
                topUrlsForMatrix.push(paperUrl); // Collect URL for the pool
                
                const safeSubject = escapeHTML(paper.subject);
                const safeYear = escapeHTML(paper.year);
                const safeSeries = escapeHTML(paper.series);
                const safeVariant = escapeHTML(paper.variant);
                const safeUrl = escapeHTML(paperUrl);

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
                            onpointerdown="NativeReader.openPaper('${safeUrl}', '${safeSubject} ${safeYear}'); event.preventDefault();">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="12" y1="18" x2="12" y2="12"></line>
                            <line x1="9" y1="15" x2="15" y2="15"></line>
                        </svg>
                        Open Paper & Mark Scheme
                    </button>
                </div>
            `}).join('');
        } else {
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
                    topUrlsForMatrix.push(paperUrl); 
                    
                    const safeVariant = escapeHTML(paper.variant);
                    const safeUrl = escapeHTML(paperUrl);
                    
                    return `
                        <button class="paper-btn" 
                                onpointerdown="NativeReader.openPaper('${safeUrl}', '${safeSubject} ${safeYear} V${safeVariant}'); event.preventDefault();">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="12" y1="18" x2="12" y2="12"></line>
                                <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
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