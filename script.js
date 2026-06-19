import { createClient } from '@supabase/supabase-js';
import mockDatabase from './mockDatabase_output.json';

import Alpine from 'alpinejs';
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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    // Prevent interfering with password recovery routing
    if (window.location.hash.includes('type=recovery')) return;
    
    updateUIAndGuardRoutes(session);
});
    const updateUIAndGuardRoutes = (session) => {
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

        // Secure the dashboard from unauthenticated access
        if (!session && currentPath.includes('dashboard')) {
            window.location.href = "login.html";
            return;
        }

        if (session && (isAuthPage || isHomePage)) {
            window.location.href = "dashboard";
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
        // Attach ONE listener to the whole document or a specific container
        document.addEventListener('change', (e) => {
            // Check if the changed element was a tracker checkbox
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
    if (logoutBtn) {
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

                sessionStorage.setItem('pendingToast', 'Logged in successfully! Welcome back.');
                window.location.href = "dashboard.html"; 
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

const dashboardLogoutBtn = document.getElementById('dashboardLogoutBtn');
const logoutModal = document.getElementById('logoutModal');

if (dashboardLogoutBtn && logoutModal) {
    const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
    const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
    dashboardLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.classList.add('show');
    });

    cancelLogoutBtn.addEventListener('click', () => {
        logoutModal.classList.remove('show');
    });

    logoutModal.addEventListener('click', (e) => {
        if (e.target === logoutModal) {
            logoutModal.classList.remove('show');
        }
    });

    confirmLogoutBtn.addEventListener('click', async () => {
        confirmLogoutBtn.textContent = 'Logging out...';
        confirmLogoutBtn.disabled = true;
        cancelLogoutBtn.style.pointerEvents = 'none'; 
        
        await supabase.auth.signOut();
        sessionStorage.setItem('pendingToast', 'You have been successfully logged out.');
        sessionStorage.setItem('pendingToastType', 'info');
        window.location.href = "index.html"; 
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

    // =========================================
// O2 GHOST FRAME ENGINE (Zero-Latency)
// =========================================
// =========================================
// O2 GHOST FRAME ENGINE (The Matrix Pool)
// =========================================
window.NativeReader = {
    init() {
        if (this.initialized) return;
        
        document.body.insertAdjacentHTML('beforeend', `
            <div id="o2-native-overlay" class="o2-native-overlay">
                <div class="o2-native-toolbar">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        <span id="o2-native-title"></span>
                    </div>
                    <button onclick="NativeReader.close()" class="btn btn-primary" style="padding: 6px 16px;">Close Paper</button>
                </div>
                <iframe id="o2-pool-0" class="o2-native-frame" style="display:none;"></iframe>
                <iframe id="o2-pool-1" class="o2-native-frame" style="display:none;"></iframe>
                <iframe id="o2-pool-2" class="o2-native-frame" style="display:none;"></iframe>
                <iframe id="o2-fallback" class="o2-native-frame" style="display:none;"></iframe>
            </div>
        `);
        
        this.overlay = document.getElementById('o2-native-overlay');
        this.titleEl = document.getElementById('o2-native-title');
        this.frames = [
            document.getElementById('o2-pool-0'),
            document.getElementById('o2-pool-1'),
            document.getElementById('o2-pool-2')
        ];
        this.fallback = document.getElementById('o2-fallback');
        this.urlMap = {};
        this.currentActive = null;
        this.initialized = true;
    },

    primeTheMatrix(topUrls) {
        if (!this.initialized) this.init();
        this.urlMap = {};
        
        // Silently load the top 3 results directly into the GPU
        for (let i = 0; i < 3; i++) {
            if (topUrls[i]) {
                const optimizedUrl = topUrls[i] + '#toolbar=0&navpanes=0&view=FitH';
                if (this.frames[i].src !== optimizedUrl) {
                    this.frames[i].src = optimizedUrl;
                }
                this.urlMap[topUrls[i]] = this.frames[i];
            }
        }
    },

    open(url, title) {
        if (!this.initialized) this.init();
        this.titleEl.textContent = title;
        
        // Hide all frames
        this.frames.forEach(f => f.style.display = 'none');
        this.fallback.style.display = 'none';

        // If it's already rendered in the Matrix pool, it appears instantly (0ms DOM execution)
        if (this.urlMap && this.urlMap[url]) {
            this.currentActive = this.urlMap[url];
        } else {
            // Fallback for papers further down the list
            const optimizedUrl = url + '#toolbar=0&navpanes=0&view=FitH';
            if (this.fallback.src !== optimizedUrl) this.fallback.src = optimizedUrl;
            this.currentActive = this.fallback;
        }

        this.currentActive.style.display = 'block';
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; 
    },

    close() {
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // We intentionally DO NOT wipe the src of the pooled frames here
        // so they remain instantly cached in the GPU for the next click.
        setTimeout(() => {
            if (this.currentActive === this.fallback) {
                this.fallback.src = 'about:blank';
            }
        }, 300);
    }
};

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
                            onpointerdown="NativeReader.open('${safeUrl}', '${safeSubject} ${safeYear}'); event.preventDefault();">
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
                const variantCount = group.variants.length;
                const tileClass = isJoint ? "paper-card joint-tile" : "paper-card";
                const variantGroupClass = `variant-btn-group cols-${variantCount}`;

                const variantButtons = group.variants.sort((a, b) => a.variant.localeCompare(b.variant)).map(paper => {
                    const paperUrl = `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.file}`;
                    topUrlsForMatrix.push(paperUrl); // Collect URL for the pool
                    
                    const safeVariant = escapeHTML(paper.variant);
                    const safeUrl = escapeHTML(paperUrl);
                    
                    return `
                        <button class="paper-btn" 
                                onpointerdown="NativeReader.open('${safeUrl}', '${safeSubject} ${safeYear} V${safeVariant}'); event.preventDefault();">
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
                    <div class="${variantGroupClass}">
                        ${variantButtons}
                    </div>
                </div>
            `}).join('');
        }

        // The killing blow: Silently prime the GPU with the top 3 papers currently on screen
        if (topUrlsForMatrix.length > 0) {
            setTimeout(() => {
                window.NativeReader.primeTheMatrix(topUrlsForMatrix.slice(0, 3));
            }, 100); // Slight delay to let the DOM paint the grid first
        }
    };

    filters.forEach(filter => filter.addEventListener('change', renderCards));
    renderCards();
};

document.addEventListener('DOMContentLoaded', renderArchive);