import { createClient } from '@supabase/supabase-js';
import Alpine from 'alpinejs'; 
import mockDatabase from './archiveDatabase.json';

window.Alpine = Alpine;
Alpine.start();

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

        // --- THE NEW ROUTE GUARDS ---
        const isHomePage = currentPath.endsWith('index.html') || currentPath === '/';
        const isAuthPage = currentPath.includes('login.html') || currentPath.includes('signup.html');
        
        // 1. Kick logged-out users away from protected pages
        if (!session && (currentPath.includes('settings.html') || currentPath.includes('dashboard.html'))) {
            window.location.href = "login.html";
            return;
        }
        
        // 2. Kick logged-in users away from the marketing and auth pages, straight to the dashboard
        if (session && (isAuthPage || isHomePage)) {
            window.location.href = "dashboard.html";
            return;
        }

        const loader = document.getElementById('global-loader');
        if (loader) {
            loader.classList.add('hidden');
        }
        // -----------------------------------------

        if (session) {
            initializeScopedTracker(session.user.id);
        } else {
            clearUnauthenticatedTrackerDisplay();
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
                
                // 1. If they have already completed the sequence this session, skip straight to the dashboard
                /*if (sessionStorage.getItem('hasSeenGreeting') === 'true') {
                    typingStage.style.display = 'none';
                    defaultOverview.style.display = 'block';
                    defaultOverview.style.opacity = '1';
                }*/
                // 2. THE FIX: The Execution Lock. If 'started' is already set, absolutely do not run this again.
                if (typingStage.dataset.started !== 'true') {
                    
                    // Immediately lock the element so Supabase double-fires are ignored
                    typingStage.dataset.started = 'true';
                    
                    const fullName = session.user.user_metadata?.full_name || "Hustler";
                    const firstName = fullName.split(' ')[0];

                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                    const type = async (text) => {
                        for (let i = 0; i < text.length; i++) {
                            typingText.textContent += text.charAt(i);
                            const humanSpeed = Math.floor(Math.random() * (70 - 30 + 1) + 30);
                            await sleep(humanSpeed);
                        }
                    };

                    const erase = async () => {
                        while (typingText.textContent.length > 0) {
                            typingText.textContent = typingText.textContent.slice(0, -1);
                            await sleep(25); 
                        }
                    };

                    const runSequence = async () => {
                        // Force a totally clean slate just in case HTML rendered stray spaces
                        typingText.textContent = ''; 
                        
                        await sleep(400); 
                        await type(`Welcome back, ${firstName}`);
                        await sleep(1400); 
                        await erase();
                        await sleep(300); 
                        await type("Let's get to work...");
                        await sleep(1000); 
                        await erase();
                        
                        typingStage.style.display = 'none';
                        defaultOverview.style.display = 'block';
                        
                        void defaultOverview.offsetWidth; 
                        defaultOverview.classList.add('reveal-dashboard');
                        
                        // Mark as completely finished in the session
                        sessionStorage.setItem('hasSeenGreeting', 'true');
                    };

                    runSequence();
                }
            }
        }
    };
    // VULNERABILITY FIX: Listen live to authorization state changes globally
    supabase.auth.onAuthStateChange((event, session) => {
        console.log(`Auth Event Triggered: ${event}`);
        
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

    // ==========================================
    // 3. CLOUD-SYNCED SYLLABUS TRACKER
    // ==========================================
    const checkboxes = document.querySelectorAll('.tracker-checkbox');

    // 1. Fetch saved progress from the Supabase Cloud on load
    const initializeScopedTracker = async (userId) => {
        // First, unlock all checkboxes and clear them visually
        checkboxes.forEach(cb => {
            cb.disabled = false;
            cb.checked = false;
        });

        // Query the database for this specific user's completed topics
        const { data, error } = await supabase
            .from('user_progress')
            .select('topic_id')
            .eq('user_id', userId)
            .eq('is_completed', true);

        if (error) {
            console.error('Error fetching cloud progress:', error.message);
            showToast("Failed to load saved progress.", "error");
            return;
        }

        // Loop through the returned cloud data and check the corresponding UI boxes
        if (data && data.length > 0) {
            data.forEach(record => {
                const checkbox = document.getElementById(record.topic_id);
                if (checkbox) {
                    checkbox.checked = true;
                }
            });
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
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', async () => {
            const { data: { session } } = await supabase.auth.getSession();
            
            if (!session) {
                showToast("Please create a free account to log and save your work progress.", "info");
                checkbox.checked = false;
                return;
            }

            // Temporarily freeze the checkbox while the database processes the network request
            checkbox.disabled = true;

            // Execute the Cloud Upsert (Insert if new, Update if exists)
            const { error } = await supabase
                .from('user_progress')
                .upsert({
                    user_id: session.user.id,
                    topic_id: checkbox.id,
                    is_completed: checkbox.checked
                }, { 
                    // This tells Supabase to use the Unique Constraint you built to resolve conflicts
                    onConflict: 'user_id, topic_id' 
                });

            // Unlock the checkbox
            checkbox.disabled = false;

            if (error) {
                console.error("Cloud Save Error:", error.message);
                showToast("Failed to sync progress. Check your connection.", "error");
                // Revert the visual UI check state because the database rejected the save
                checkbox.checked = !checkbox.checked; 
            } else {
                if (checkbox.checked) {
                    showToast("Topic marked as complete! Cloud synced.", 'success');
                }
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
            const submitBtn = signupForm.querySelector('button');
            
            submitBtn.textContent = 'Creating account...';
            submitBtn.disabled = true;

            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { full_name: name } }
            });

            if (error) {
                showToast(error.message, 'error');
                submitBtn.textContent = 'Create Free Account';
                submitBtn.disabled = false;
            } else {
                // Reset the button to its default state
                submitBtn.textContent = 'Create Free Account';
                submitBtn.disabled = false;
                
                // Trigger the beautiful modal instead of a toast
                const modal = document.getElementById('verifyEmailModal');
                if (modal) {
                    modal.classList.add('show');
                    
                    // Attach the redirect to the OK button
                    const okBtn = document.getElementById('modalOkBtn');
                    okBtn.addEventListener('click', () => {
                        window.location.href = "login.html";
                    });
                } else {
                    // Fallback just in case
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
                // NEW: Specifically intercept the unverified email error
                if (error.message.includes("Email not confirmed")) {
                    showToast("Please click the verification link sent to your email before logging in.", 'error');
                } else {
                    showToast("Invalid email or password.", 'error');
                }
                submitBtn.textContent = 'Log In';
                submitBtn.disabled = false;
            } else {
                sessionStorage.setItem('pendingToast', 'Logged in successfully! Welcome back.');
                window.location.href = "dashboard.html"; 
            }
        });
    }

    // --- FORGOT PASSWORD ROUTINE ---
    // --- FORGOT PASSWORD ROUTINE WITH COOLDOWN ---
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) {
        let isCooldown = false; // Prevents spam-clicking

        forgotPasswordLink.addEventListener('click', async (e) => {
            e.preventDefault(); // Stops HTML from trying to navigate anywhere
            
            if (isCooldown) return; // Block execution if timer is running

            const email = document.getElementById('loginEmail').value;

            // Guard clause: Ensure they typed an email
            if (!email) {
                showToast("Please enter your email address in the box first.", "error");
                document.getElementById('loginEmail').focus();
                return;
            }

            // Lock the button and start sending state
            isCooldown = true;
            forgotPasswordLink.style.color = '#bdc3c7'; // Turn it a flat gray
            forgotPasswordLink.style.pointerEvents = 'none'; // Disable hover effects/clicking
            forgotPasswordLink.textContent = 'Sending...';

            // BUG FIX: Explicitly tell Supabase to ONLY route them to the trap page 
            // *after* they click the link in the email, preventing local misfires.
            const currentOrigin = window.location.origin;
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${currentOrigin}/reset-password.html`
            });

            if (error) {
                showToast(error.message, 'error');
                // If it fails (e.g. no internet), unlock the button immediately
                isCooldown = false;
                forgotPasswordLink.style.color = 'var(--primary)';
                forgotPasswordLink.style.pointerEvents = 'auto';
                forgotPasswordLink.textContent = 'Forgot Password?';
            } else {
                showToast("Recovery link dispatched. Check your inbox.", "success");
                
                // Start the 60-second lockdown timer
                let timeLeft = 60;
                forgotPasswordLink.textContent = `Wait ${timeLeft}s`;

                const timerInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        forgotPasswordLink.textContent = `Wait ${timeLeft}s`;
                    } else {
                        // Timer finished: Unlock the button
                        clearInterval(timerInterval);
                        isCooldown = false;
                        forgotPasswordLink.style.color = 'var(--primary)';
                        forgotPasswordLink.style.pointerEvents = 'auto';
                        forgotPasswordLink.textContent = 'Forgot Password?';
                    }
                }, 1000); // 1000ms = 1 second ticks
            }
        });
    }

    // --- DEDICATED PASSWORD RECOVERY PAGE LOGIC ---
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

            // Update the password in the database
            const { error } = await supabase.auth.updateUser({ password: recoveryPassword.value });

            if (error) {
                showToast(error.message, 'error');
                submitBtn.textContent = 'Lock In New Password';
                submitBtn.disabled = false;
            } else {
                // Critical Security Step: Kill the temporary recovery session
                await supabase.auth.signOut();
                
                // Route them to login so they have to prove they know the new password
                sessionStorage.setItem('pendingToast', 'Password updated successfully. Please log in with your new credentials.');
                sessionStorage.setItem('pendingToastType', 'success');
                window.location.href = "login.html";
            }
        });
    }


// 8. Dashboard Developer Controls
// 8. Dashboard Developer Controls & Modals
const dashboardLogoutBtn = document.getElementById('dashboardLogoutBtn');
const logoutModal = document.getElementById('logoutModal');

if (dashboardLogoutBtn && logoutModal) {
    const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
    const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

    // 1. Show the modal when the sidebar button is clicked
    dashboardLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.classList.add('show');
    });

    // 2. Hide the modal if they click 'Return'
    cancelLogoutBtn.addEventListener('click', () => {
        logoutModal.classList.remove('show');
    });

    // 3. Optional touch: Hide the modal if they click the dark background outside the card
    logoutModal.addEventListener('click', (e) => {
        if (e.target === logoutModal) {
            logoutModal.classList.remove('show');
        }
    });

    // 4. Actually execute the logout if they confirm
    confirmLogoutBtn.addEventListener('click', async () => {
        confirmLogoutBtn.textContent = 'Logging out...';
        confirmLogoutBtn.disabled = true;
        cancelLogoutBtn.style.pointerEvents = 'none'; // Stop them from clicking return while loading
        
        await supabase.auth.signOut();
        sessionStorage.setItem('pendingToast', 'You have been successfully logged out.');
        sessionStorage.setItem('pendingToastType', 'info');
        window.location.href = "index.html"; 
    });
// ==========================================
// THE INTERNAL ROUTER & MOBILE NAVIGATION
// ==========================================
const navItems = document.querySelectorAll('.sidebar-nav .dash-nav-item');
const views = document.querySelectorAll('.dashboard-view');
const sidebar = document.getElementById('dashboardSidebar');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');

// Open Mobile Menu
if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
    });
}

// Close Mobile Menu (Manual)
if (closeMenuBtn && sidebar) {
    closeMenuBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
    });
}

// Internal Tab Switching
if (navItems.length > 0 && views.length > 0) {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // 1. Shift active state on buttons
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // 2. Crossfade the right-hand canvas views
            const targetId = `view-${item.getAttribute('data-target')}`;
            views.forEach(view => {
                view.classList.remove('active-view');
            });
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active-view');

            // 3. THE FIX: If on mobile, automatically slide the menu shut
            if (window.innerWidth <= 850 && sidebar) {
                sidebar.classList.remove('open');
            }
        });
    });
}
}

// ==========================================
// THE ARCHIVE RENDERER (Single Source of Truth)
// ==========================================

// This mimics the data we will eventually pull from Supabase Storage


const renderArchive = () => {
    const mountPoint = document.getElementById('archive-mount');
    if (!mountPoint) return; 

    // 1. Build the HTML Structure
    let html = `
        <!-- The updated button with Alpine.js predictive fetching -->
<button class="paper-btn" 
        x-data="{ preloaded: false, url: 'https://ydhecoqcckzgibwdcnxm.supabase.co/storage/v1/object/public/the_archive/${paper.file}' }"
        @mouseenter.once="
            if(!preloaded) { 
                let link = document.createElement('link'); 
                link.rel = 'prefetch'; 
                link.href = url; 
                link.as = 'fetch';
                document.head.appendChild(link); 
                preloaded = true; 
            }
        "
        @click="window.open(url, '_blank')">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="12" y1="18" x2="12" y2="12"></line>
        <line x1="9" y1="15" x2="15" y2="15"></line>
    </svg>
    Open Paper & Mark Scheme
</button>
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

        grid.innerHTML = filteredData.map(paper => `
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
                <button class="paper-btn" onclick="showToast('Opening ${paper.file}...', 'info')">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="12" y1="18" x2="12" y2="12"></line>
                        <line x1="9" y1="15" x2="15" y2="15"></line>
                    </svg>
                    Open Paper & Mark Scheme
                </button>
            </div>
        `).join('');
    };

    // 3. Attach Event Listeners to the Dropdowns
    filters.forEach(filter => filter.addEventListener('change', renderCards));

    // 4. Initial Render
    renderCards();
};

// Trigger the renderer when the script loads
document.addEventListener('DOMContentLoaded', renderArchive);