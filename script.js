import { createClient } from '@supabase/supabase-js';
import mockDatabase from './mockDatabase_output.json';

// ==========================================
// UNIVERSAL THEME TOGGLE LOGIC
// ==========================================
// 1. Instantly load saved theme on refresh
const savedTheme = localStorage.getItem('o2_theme');
if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
}

// 2. Listen for clicks on ALL theme buttons across the app
const themeToggleBtns = document.querySelectorAll('.theme-toggle-btn');
themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault(); // Prevents dashboard from jumping to the top of the page
        
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

window.openSecurePaper = (url, paperTitle) => {
    // 1. Instantly snap open a new tab (bypasses the white-void lag)
    const newTab = window.open('', '_blank');

    // 2. Inject a branded loading environment directly into the new tab
    newTab.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Opening ${paperTitle}...</title>
            <style>
                body {
                    background-color: #F5F3E8; /* Your Signature Cream */
                    color: #1C1917; /* Deep Slate */
                    font-family: 'Inter', -apple-system, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    -webkit-font-smoothing: antialiased;
                }
                .spinner {
                    width: 36px;
                    height: 36px;
                    border: 3px solid #E7E5E4;
                    border-top-color: #292524;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                    margin-bottom: 24px;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                h2 {
                    font-family: 'Space Grotesk', sans-serif;
                    font-size: 1.25rem;
                    font-weight: 600;
                    margin: 0 0 8px 0;
                    letter-spacing: -0.5px;
                }
                p {
                    font-size: 0.95rem;
                    color: #78716C;
                    margin: 0;
                }
            </style>
        </head>
        <body>
            <div class="spinner"></div>
            <h2>Securing Connection</h2>
            <p>Retrieving ${paperTitle} from the cloud vault...</p>
            
            <script>
                // 3. Force the browser to render the UI, then silently redirect to the PDF
                setTimeout(() => {
                    window.location.replace('${url}');
                }, 150);
            </script>
        </body>
        </html>
    `);
    
    // Close the document stream so the browser knows the HTML is finished
    newTab.document.close();
};

// ==========================================
// THE SPECULATIVE PRE-FETCH PIPELINE
// ==========================================
const warmPdfCache = async (url) => {
    try {
        // Fetch exactly the first 256KB to grab the linearized PDF header and Page 1
        await fetch(url, {
            headers: { 'Range': 'bytes=0-262144' },
            priority: 'low' // Tells the browser not to block the main thread
        });
    } catch (e) {
        // Silently fail if network drops; it's just an optimization anyway
    }
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
    // --- NEW: FETCH SESSION IMMEDIATELY ON LOAD ---
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
        if (!session && currentPath.includes('dashboard.html')) {
            window.location.href = "login.html";
            return;
        }

        if (session && (isAuthPage || isHomePage)) {
            window.location.href = "dashboard.html";
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

        // --- NEW: THE TYPING ANIMATION SEQUENCE ---
        if (session && currentPath.includes('dashboard.html')) {
            const typingStage = document.getElementById('typingStage');
            const typingText = document.getElementById('typingText');
            const defaultOverview = document.getElementById('defaultOverview');
                         
            if (typingStage && typingText && defaultOverview) {
                
                // THE FIX: If they already saw it this session, INSTANTLY show the dashboard.
                // This prevents the "stuck static" bug on Vercel during re-renders or auth checks.
                if (sessionStorage.getItem('hasSeenGreeting') === 'true') {
                    typingStage.style.display = 'none';
                    defaultOverview.style.display = 'block';
                    defaultOverview.style.opacity = '1';
                    return; // EXIT EARLY
                }

                if (typingStage.dataset.started !== 'true') {
                    typingStage.dataset.started = 'true';
                                         
                    // THE FIX: Read from local cache instantly. Zero network dependency.
                    const firstName = localStorage.getItem('o2_user_firstName') || "Hustler";
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                    
                    // Accelerated typing speed (15-35ms per character)
                    const type = async (text) => {
                        for (let i = 0; i < text.length; i++) {
                            typingText.textContent += text.charAt(i);
                            const fastSpeed = Math.floor(Math.random() * (35 - 15 + 1) + 15);
                            await sleep(fastSpeed);
                        }
                    };
                    
                    // Accelerated erasing (15ms per character)
                    const erase = async () => {
                        while (typingText.textContent.length > 0) {
                            typingText.textContent = typingText.textContent.slice(0, -1);
                            await sleep(15); 
                        }
                    };
                    
                    const runSequence = async () => {
                        typingText.textContent = '';
                                                  
                        await sleep(200); // Quick breath
                        await type(`Welcome back, ${firstName}`);
                        await sleep(600); // Shortened reading pause
                        await erase();
                        await sleep(150); // Micro-pause
                        await type("Let's get to work...");
                        await sleep(400); // Shortened final pause
                                                 
                        typingStage.style.display = 'none';
                        defaultOverview.style.display = 'block';
                                                 
                        void defaultOverview.offsetWidth; // Trigger reflow
                        defaultOverview.classList.add('reveal-dashboard');
                                                 
                        sessionStorage.setItem('hasSeenGreeting', 'true');
                    };
                    runSequence();
                }
            }
        }
    };
    // VULNERABILITY FIX: Listen live to authorization state changes globally
    supabase.auth.onAuthStateChange((event, session) => {
        // Intercept password recovery clicks from the email
        if (event === 'PASSWORD_RECOVERY') {
            sessionStorage.setItem('pendingToast', 'Access verified. Please set your new password.');
            sessionStorage.setItem('pendingToastType', 'info');
            // Force them to the isolated trap page, NOT settings.html
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
        // Overwrite any previous pending state for this specific topic
        queue[topicId] = targetState; 
        localStorage.setItem(pendingKey, JSON.stringify(queue));
    };

    const syncOfflineProgress = async (userId) => {
        if (!navigator.onLine) return; // Don't try if still offline

        const pendingKey = `o2_archive_pending_${userId}`;
        const queue = JSON.parse(localStorage.getItem(pendingKey) || "{}");
        const topicsToSync = Object.keys(queue);

        if (topicsToSync.length === 0) return;

        // Batch package the offline clicks into a single payload
        const payload = topicsToSync.map(topicId => ({
            user_id: userId,
            topic_id: topicId,
            is_completed: queue[topicId]
        }));

        // Fire to Supabase
        const { error } = await supabase
            .from('user_progress')
            .upsert(payload, { onConflict: 'user_id, topic_id' });

        if (!error) {
            localStorage.removeItem(pendingKey); // Wipe queue on success
            showToast("Offline progress synced to cloud.", "success");
        }
    };

    // Auto-sync the literal second the device regains internet
    window.addEventListener('online', async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            syncOfflineProgress(session.user.id);
        }
    });

    const checkboxes = document.querySelectorAll('.tracker-checkbox');

    // 1. Fetch saved progress from Cloud (WITH LOCAL-FIRST CACHING)
    const initializeScopedTracker = async (userId) => {
        const cacheKey = `o2_archive_progress_${userId}`;

        // INSTANT LOAD: Read from phone's local storage first
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

        // BACKGROUND: Push any clicks that happened while offline
        await syncOfflineProgress(userId);

        // BACKGROUND: Pull the absolute truth from Supabase (if online)
        if (navigator.onLine) {
            const { data, error } = await supabase
                .from('user_progress')
                .select('topic_id')
                .eq('user_id', userId)
                .eq('is_completed', true);

            if (!error && data) {
                const cloudTopics = data.map(record => record.topic_id);
                
                // Update the Local Cache so it's ready for the next offline session
                localStorage.setItem(cacheKey, JSON.stringify(cloudTopics));

                // Silently align UI to the cloud truth
                checkboxes.forEach(cb => {
                    cb.checked = cloudTopics.includes(cb.id);
                });
            }
        }
    };

    // 2. Wipe UI cleanly if logged out
    const clearUnauthenticatedTrackerDisplay = () => {
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            // Freeze checkbox modification until an explicit sign-in occurs
            checkbox.disabled = true; 
        });
    };

    // 3. Save progress to the cloud whenever a box is clicked
    // 3. Save progress to the cloud (WITH OFFLINE QUEUE)
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', async () => {
            const { data: { session } } = await supabase.auth.getSession();
                         
            if (!session) {
                showToast("Please create a free account to log and save your work progress.", "info");
                checkbox.checked = false;
                return;
            }

            const userId = session.user.id;
            const topicId = checkbox.id;
            const targetState = checkbox.checked;
            const cacheKey = `o2_archive_progress_${userId}`;

            // OPTIMISTIC UI: Instantly update the Local Cache
            try {
                let cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
                if (targetState) {
                    if (!cached.includes(topicId)) cached.push(topicId);
                } else {
                    cached = cached.filter(id => id !== topicId);
                }
                localStorage.setItem(cacheKey, JSON.stringify(cached));
            } catch (e) {}

            // IF OFFLINE: Queue it and exit. Do not freeze the UI.
            if (!navigator.onLine) {
                queueOfflineAction(userId, topicId, targetState);
                showToast("Offline. Saved to device.", "info");
                return;
            }

            // IF ONLINE: Execute the Cloud Upsert silently
            const { error } = await supabase
                .from('user_progress')
                .upsert({
                    user_id: userId,
                    topic_id: topicId,
                    is_completed: targetState
                }, { 
                    onConflict: 'user_id, topic_id' 
                });

            if (error) {
                // If the network drops mid-request, catch it and queue it.
                queueOfflineAction(userId, topicId, targetState);
                showToast("Connection weak. Saved to device.", "info");
            }
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
            
            // NEW: Validate they match immediately
            if (password !== confirmPassword) {
                showToast("Passwords do not match.", "error");
                return; // Kills the submission dead in its tracks
            }

            const submitBtn = signupForm.querySelector('button');
            
            submitBtn.textContent = 'Creating account...';
            submitBtn.disabled = true;

            // ... (The rest of your Supabase signUp call continues here as normal)
            
            
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
                // THE FIX: Cache the user's first name locally for the animation
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

// ==========================================
    // SHOW PASSWORD TOGGLES
    // ==========================================
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

const renderArchive = () => {
    const mountPoint = document.getElementById('archive-mount');
    if (!mountPoint) return; 
    const uniqueYears = [...new Set(mockDatabase.map(item => item.year))].sort().reverse();
    const uniqueSeries = [...new Set(mockDatabase.map(item => item.series))].sort();
    let html = `
        <div class="archive-toolbar">
            <select class="filter-select" id="filter-subject">
                <option value="all">All Subjects</option>
                <option value="Islamiyat">Islamiyat</option>
                <option value="Pak Studies">Pak Studies</option>
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
        
        <div class="archive-grid" id="archive-grid">
        </div>
    `;
    
    mountPoint.innerHTML = html;
    
    const grid = document.getElementById('archive-grid');
    const filters = document.querySelectorAll('.filter-select');
    // 2. The Card Generator Logic
    const renderCards = () => {
        const subjectFilter = document.getElementById('filter-subject').value;
        const yearFilter = document.getElementById('filter-year').value;
        const seriesFilter = document.getElementById('filter-series').value;

        // Filter the database based on dropdowns
        const filteredData = mockDatabase.filter(paper => {
            return (subjectFilter === 'all' || paper.subject === subjectFilter) &&
                   (yearFilter === 'all' || paper.year === yearFilter) &&
                   (seriesFilter === 'all' || paper.series === seriesFilter);
        });

        // Generate the HTML for the cards
        if (filteredData.length === 0) {
            grid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No papers found matching these filters.</p>`;
            return;
        }

        grid.innerHTML = filteredData.map(paper => {
            // Build the exact secure URL for this specific paper
            const paperUrl = `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.file}`;
            
            return `
            <div class="paper-card">
                <div>
                    <div class="paper-card-header">
                        <div>
                            <div class="paper-code">${paper.subject}</div>
                            <div class="paper-meta">${paper.series} ${paper.year} • Variant ${paper.variant}</div>
                        </div>
                        <span class="badge" style="margin:0; background: var(--bg-main);">Merged</span>
                    </div>
                </div>
                <button class="paper-btn" 
                        data-preloaded="false"
                        onmouseenter="
                            if(this.dataset.preloaded === 'false') { 
                                let link = document.createElement('link'); 
                                link.rel = 'prefetch'; 
                                link.href = '${paperUrl}'; 
                                link.as = 'fetch';
                                document.head.appendChild(link); 
                                this.dataset.preloaded = 'true'; 
                            }
                        "
                        onclick="openSecurePaper('${paperUrl}', '${paper.subject} ${paper.year}')">
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

        // --- NEW: THE SPECULATIVE ENGINE TRIGGER ---
        // If the user has narrowed the search down to 4 or fewer papers (e.g., they selected a year),
        // intelligently start pulling the first 256KB of those specific papers into memory.
        if (filteredData.length > 0 && filteredData.length <= 4) {
            filteredData.forEach(paper => {
                const paperUrl = `${supabaseUrl}/storage/v1/object/public/the_archive/${paper.file}`;
                warmPdfCache(paperUrl);
            });
        }
    };

    filters.forEach(filter => filter.addEventListener('change', renderCards));
    renderCards();
};

document.addEventListener('DOMContentLoaded', renderArchive);