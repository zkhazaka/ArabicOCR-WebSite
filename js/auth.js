import { app, auth, db, analytics, logEvent } from '../firebase-analytics.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, OAuthProvider, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, getAdditionalUserInfo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const googleProvider = new GoogleAuthProvider();

// Microsoft (Azure AD) sign-in. 'common' accepts both personal Microsoft
// accounts and work/school tenants; a single-tenant app would use its tenant id.
const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({ tenant: 'common' });

// True while a signup/login is mid-flight. The auth state observer fires as soon
// as Firebase creates the account, which would navigate away before the Firestore
// profile write has flushed. While this flag is set the observer holds off and the
// calling function redirects once the write is done.
let authFlowInProgress = false;

// ========================================
// HOW PRO ACCESS IS DECIDED
// ========================================
//
//   isPro = Paddle reports an active subscription
//           OR users/{uid}.plan == 'pro'
//
// The two are INDEPENDENT channels, not a value and its cache:
//
//   Paddle          - live subscriptions bought on this website. Queried on
//                     every check via check_subscription.php. Never persisted.
//   plan == 'pro'   - everything else: Microsoft Store and mobile IAP
//                     purchases written by the desktop/mobile apps, and
//                     accounts comped by hand in the Firebase console.
//
// This website NEVER writes plan, planSource, planExpiresAt, proSince or
// proEndedAt. It only reads them. That field belongs to the apps that own
// those purchases, so the web cannot clobber a Store subscription with a
// stale value, and a lapsed Paddle subscription needs no cleanup write -
// Paddle simply stops saying yes.
//
// To comp an account: set plan to 'pro' in the console. To revoke: set it
// back to 'free'. Paddle subscriptions are unaffected by that field.

// ========================================
// USER PROFILE (users/{uid})
// ========================================

/**
 * Create the Firestore profile document for a newly registered user.
 * Errors are swallowed: a Firestore failure must never make a successful
 * signup look like it failed, or the user would retry and hit
 * "email already in use".
 * @param {import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").User} user
 * @param {string} source - origin of the signup, e.g. 'web_email' | 'web_google'
 */
async function createUserProfile(user, source) {
    try {
        await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email,
            // Some Microsoft work/school accounts come back with a null email,
            // which used to throw here and silently skip the profile write.
            displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
            plan: 'free',
            ocrPagesBalance: 0,
            ocrPagesTotal: 0,
            source: source,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp()
        });
        console.log("User profile created:", user.uid);
    } catch (error) {
        console.error("Failed to create user profile:", error);
    }
}

/**
 * Refresh lastLoginAt on sign-in. Accounts registered before profiles existed
 * have no document, so create one on their next login (backfill).
 * @param {import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").User} user
 * @param {string} source - used only when backfilling a legacy account
 */
async function touchUserProfile(user, source) {
    try {
        const userRef = doc(db, 'users', user.uid);
        const snapshot = await getDoc(userRef);

        if (snapshot.exists()) {
            await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
        } else {
            await createUserProfile(user, source);
        }
    } catch (error) {
        console.error("Failed to update user profile:", error);
    }
}

// Login
export async function loginUser(email, password) {
    authFlowInProgress = true;
    try {

        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        logEvent(analytics, 'user_login');

        await touchUserProfile(userCredential.user, 'web_email');

        // Audit only - records the subscription lifecycle, grants nothing.
        // Access is decided at read time by asking Paddle and reading
        // users/{uid}.plan, so there is no cached plan to keep in step.
        await auditSubscriptionAtLogin(userCredential.user);

        redirectAfterAuth();
        return { success: true, user: userCredential.user };
    } catch (error) {
        // Full detail to the console for debugging, plain language to the user.
        console.error("Login failed:", error.code, error.message);
        return { success: false, error: friendlyAuthError(error), code: error.code };
    } finally {
        authFlowInProgress = false;
    }
}

// Signup
export async function signupUser(email, password) {
    authFlowInProgress = true;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        logEvent(analytics, 'user_signup');

        // Create the users/{uid} profile document
        await createUserProfile(userCredential.user, 'web_email');

        // Someone can subscribe via Paddle before registering (checkout accepts
        // a bare email), so a brand new account can already be Pro. This only
        // records that fact - the subscription is found by email either way.
        await auditSubscriptionAtLogin(userCredential.user);

        redirectAfterAuth();
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error("Signup failed:", error.code, error.message);
        return { success: false, error: friendlyAuthError(error), code: error.code };
    } finally {
        authFlowInProgress = false;
    }
}

/**
 * Turn a Firebase auth error into something a user can act on. Only the cases
 * that actually reach people are special-cased; anything else falls through to
 * Firebase's own message.
 *
 * account-exists-with-different-credential matters much more now that there is
 * more than one social provider: signing up with Google and later clicking
 * "Sign in with Microsoft" on the same address lands here, and the raw message
 * does not tell the user which provider they originally used.
 * @param {any} error
 * @param {string} providerName - human-readable, e.g. 'Microsoft'
 */
function friendlyAuthError(error, providerName = 'this method') {
    switch (error?.code) {

        // --- Email + password ---

        // Firebase deliberately collapses "no such user" and "wrong password"
        // into invalid-credential so an attacker cannot probe which addresses
        // are registered. Older SDK builds still emit the separate codes, so
        // all three are handled here - and all three must give the SAME reply,
        // or the distinction Firebase hid would leak straight back out.
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return `Incorrect email or password. Please check them and try again.`;

        case 'auth/invalid-email':
            return `That email address doesn't look right. Please check it and try again.`;
        case 'auth/missing-password':
            return `Please enter your password.`;
        case 'auth/user-disabled':
            return `This account has been disabled. Please contact support if you think this is a mistake.`;
        case 'auth/too-many-requests':
            return `Too many failed attempts. Please wait a few minutes before trying again, or reset your password.`;

        // --- Signup ---
        case 'auth/email-already-in-use':
            return `An account with this email address already exists. Try signing in instead, or reset your password.`;
        case 'auth/weak-password':
            return `Please choose a stronger password - at least 6 characters.`;

        // --- Social sign-in ---
        case 'auth/account-exists-with-different-credential':
            return `An account already exists with this email address, but it was created using a different sign-in method. Please sign in the way you did originally, or use your email and password.`;
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return `${providerName} sign-in was cancelled.`;
        case 'auth/popup-blocked':
            return `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site and try again.`;
        case 'auth/operation-not-allowed':
            return `${providerName} sign-in is not enabled for this site yet.`;
        case 'auth/unauthorized-domain':
            return `This domain is not authorised for ${providerName} sign-in.`;

        // --- Connectivity ---
        case 'auth/network-request-failed':
            return `Network error. Please check your connection and try again.`;
        case 'auth/timeout':
            return `That took too long. Please check your connection and try again.`;

        default:
            // Never fall back to error.message - it reads
            // "Firebase: Error (auth/...)", which means nothing to a user and
            // exposes the auth provider. The real code still goes to the
            // console below for debugging.
            return `Something went wrong. Please try again, or contact support if it keeps happening.`;
    }
}

/**
 * Shared popup sign-in flow. Google and Microsoft differ only in the provider
 * object and the `source` recorded on the profile, so the surrounding work -
 * new-vs-returning detection, profile write, plan sync, MailerLite, redirect -
 * lives here once.
 * @param {import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").AuthProvider} provider
 * @param {string} source - profile origin tag, e.g. 'web_google' | 'web_microsoft'
 * @param {string} providerName - human-readable name used in error messages
 */
async function loginWithProvider(provider, source, providerName) {
    authFlowInProgress = true;
    try {
        const result = await signInWithPopup(auth, provider);

        // Distinguish a first-time social signup from a returning user, so the
        // profile is created once and signups are counted as signups.
        const isNewUser = getAdditionalUserInfo(result)?.isNewUser === true;

        if (isNewUser) {
            logEvent(analytics, 'user_signup', { method: source });
            await createUserProfile(result.user, source);
        } else {
            logEvent(analytics, 'user_login', { method: source });
            await touchUserProfile(result.user, source);
        }

        // Audit only - see loginUser(). Microsoft work/school accounts can
        // come back without an email, which auditSubscriptionAtLogin ignores.
        await auditSubscriptionAtLogin(result.user);

        redirectAfterAuth();
        return { success: true, user: result.user };
    } catch (error) {
        console.error(`${providerName} sign-in failed:`, error);
        return { success: false, error: friendlyAuthError(error, providerName) };
    } finally {
        authFlowInProgress = false;
    }
}

// Google Login
export async function loginWithGoogle() {
    return loginWithProvider(googleProvider, 'web_google', 'Google');
}

// Microsoft Login
export async function loginWithMicrosoft() {
    return loginWithProvider(microsoftProvider, 'web_microsoft', 'Microsoft');
}

// Logout
export async function logoutUser() {
    try {
        await signOut(auth);
        logEvent(analytics, 'user_logout');
        return { success: true };
    } catch (error) {
        console.error("Logout failed:", error.code, error.message);
        return { success: false, error: friendlyAuthError(error) };
    }
}


/**
 * Read the plan recorded on the user's Firestore profile, with the marker
 * saying whether it was set from Paddle or granted by hand.
 * @param {string} uid
 * @returns {Promise<{plan: string, planSource: string|null}>}
 */
async function getStoredPlan(uid, attempts = 3) {
    let lastError = null;

    // Firestore uses long polling here (see firebase-analytics.js), which can
    // lose the first read on a cold page load. One failed read used to be
    // reported as plan 'free', which is indistinguishable from a genuinely
    // free user - a paying customer would silently see "Free User".
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const snapshot = await getDoc(doc(db, 'users', uid));

            // Absent document is a real answer, not a failure: the profile has
            // not been created yet. Do not retry it.
            if (!snapshot.exists()) {
                return { plan: 'free', planSource: null, planExpiresAt: null, readFailed: false };
            }

            const profile = snapshot.data();
            return {
                plan: profile.plan || 'free',
                planSource: profile.planSource || null,
                planExpiresAt: profile.planExpiresAt || null,
                readFailed: false
            };
        } catch (error) {
            lastError = error;
            console.error(`Failed to read stored plan (attempt ${attempt}/${attempts}):`, error);
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, 400 * attempt));
            }
        }
    }

    // readFailed says "we do not know", NOT "this user is free". Callers must
    // not revoke access on this.
    console.error("Could not read plan after retries - treating as UNKNOWN, not free.", lastError);
    return { plan: 'free', planSource: null, planExpiresAt: null, readFailed: true };
}

/**
 * Check Subscription Status.
 *
 * Pro is granted if EITHER holds:
 *   1. Paddle reports an active subscription, or
 *   2. users/{uid}.plan is 'pro' in Firestore.
 *
 * (2) is a deliberate manual override: setting plan to 'pro' by hand in the
 * Firebase console comps an account with Pro access even though Paddle has no
 * subscription for them. It also doubles as the outage fallback - when
 * check_subscription.php answers isPro:null (Paddle unreachable), a stored
 * 'pro' still grants access.
 *
 * @param {string} email
 * @returns {Promise<{isPro: boolean, planTier: string, grantedBy: string|null, degraded: boolean, status: string, plan?: string, details?: object}>}
 *          grantedBy: 'paddle' = live subscription, 'firestore' = manual grant
 *          or outage fallback. degraded=true means Paddle could not be reached.
 */
export async function checkSubscription(email) {
    let data = null;

    try {
        const response = await fetch('check_subscription.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        data = await response.json();
    } catch (error) {
        console.error("Failed to check subscription:", error);
        data = { isPro: null, status: 'unknown', reason: error.message };
    }

    // An active Paddle subscription settles it.
    if (data && data.isPro === true) {
        return { ...data, planTier: 'pro', grantedBy: 'paddle', degraded: false };
    }

    const paddleUnreachable = !data || data.isPro === null || data.isPro === undefined;
    const user = auth.currentUser;
    const stored = user
        ? await getStoredPlan(user.uid)
        : { plan: 'free', planSource: null, planExpiresAt: null, readFailed: false };

    // The profile read failed, so the plan is unknown. Falling through would
    // report the user as free and strip Pro from a paying customer over what
    // may be a transient network blip. Honour the last known good state
    // instead - the same principle already applied when Paddle is unreachable.
    if (stored.readFailed) {
        const lastKnownPro = localStorage.getItem('isPro') === 'true';
        console.warn(`Plan unknown (profile read failed) - falling back to last known state: ${lastKnownPro ? 'pro' : 'free'}.`);
        return {
            ...(data || {}),
            isPro: lastKnownPro,
            planTier: lastKnownPro ? 'pro' : 'free',
            grantedBy: lastKnownPro ? 'fallback' : null,
            degraded: true
        };
    }

    // Second, independent grant: users/{uid}.plan == 'pro'.
    //
    // This is a SEPARATE channel from Paddle, not a cache of it. It covers
    // Microsoft Store and mobile IAP purchases (written by the desktop/mobile
    // apps) and comped accounts (set by hand in the console). Paddle knows
    // nothing about any of those, so its "no" must never override this.
    if (stored.plan === 'pro') {
        console.log(`Pro granted from Firestore plan (source: ${stored.planSource || 'none'}).`);
        return {
            ...(data || {}),
            isPro: true,
            planTier: 'pro',
            grantedBy: 'firestore',
            degraded: paddleUnreachable
        };
    }

    // Neither channel granted Pro. If Paddle could not be reached we do not
    // actually know it is a "no", so fall back to the last known state rather
    // than locking out a paying subscriber during an outage.
    if (paddleUnreachable) {
        const lastKnownPro = localStorage.getItem('isPro') === 'true';
        console.warn(`Paddle unreachable and no Firestore grant - falling back to last known state: ${lastKnownPro ? 'pro' : 'free'}.`);
        return {
            ...(data || {}),
            isPro: lastKnownPro,
            planTier: lastKnownPro ? 'pro' : 'free',
            grantedBy: lastKnownPro ? 'fallback' : null,
            degraded: true
        };
    }

    return {
        ...(data || {}),
        isPro: false,
        planTier: 'free',
        grantedBy: null,
        degraded: paddleUnreachable
    };
}

// ========================================
// SUBSCRIPTION AUDIT TRAIL
// ========================================

// Value written to planSource for subscriptions bought through this website.
// The desktop and mobile apps use their own markers ('ms_store' and so on).
const PADDLE_SOURCE = 'paddle';

/**
 * Record the Paddle subscription lifecycle on users/{uid}.
 *
 * AUDIT ONLY. These fields are never read to decide access - that is
 * checkSubscription's job, and it asks Paddle directly. Nothing here can
 * grant or revoke Pro, so a failed write costs a log line, not a lockout.
 *
 * Deliberately does NOT write `plan` or `planSource`. Those belong to the
 * desktop/mobile apps and the console; overwriting them from the web is the
 * bug this whole redesign removed.
 *
 * @param {import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").User} user
 * @param {object} status - the result of checkSubscription()
 */
async function recordSubscriptionAudit(user, status) {
    // "Paddle could not be reached" is not "the subscription ended". Never
    // write history on a guess.
    if (!user || !status || status.degraded) return;

    try {
        const userRef = doc(db, 'users', user.uid);
        const snapshot = await getDoc(userRef);
        if (!snapshot.exists()) return;

        const profile = snapshot.data();
        const update = {};

        if (status.grantedBy === 'paddle') {
            // next_billed_at is when Paddle renews, i.e. how far the current
            // paid period runs. Absent on a cancelled-but-still-active
            // subscription, in which case the previous value is left alone.
            const expiresAt = status.details?.next_billed_at
                ? new Date(status.details.next_billed_at).toISOString()
                : null;

            if (expiresAt && profile.planExpiresAt !== expiresAt) {
                update.planExpiresAt = expiresAt;
            }

            // Mark the subscription as Paddle's - but never overwrite another
            // store's marker. A Microsoft Store subscriber has planSource
            // 'ms_store' written by the desktop app, and stamping 'paddle'
            // over it would misattribute their purchase and mislead whatever
            // logic the app runs on that field. Claim the field only when it
            // is unclaimed.
            const ownedElsewhere = profile.planSource && profile.planSource !== PADDLE_SOURCE;

            if (!profile.planSource) {
                update.planSource = PADDLE_SOURCE;
            } else if (ownedElsewhere) {
                console.log(`planSource left as '${profile.planSource}' - not overwriting with paddle.`);
            }

            // proSince marks the START of the current Pro run, so it is
            // stamped once and never overwritten - re-stamping it on every
            // check would destroy the signup-to-paid history.
            if (!profile.proSince) update.proSince = serverTimestamp();

            // They are Pro again, so a previous end date no longer applies.
            if (profile.proEndedAt) update.proEndedAt = null;

        } else {
            // Paddle confirmed there is no subscription.
            //
            // Only close out a run that is actually open, and only when no
            // OTHER channel is still granting Pro. Without that second check
            // this would stamp proEndedAt on a Microsoft Store subscriber
            // every time they visited the site, marking a live subscription
            // as ended purely because Paddle has never heard of them.
            const runIsOpen = profile.proSince && !profile.proEndedAt;
            const stillProElsewhere = (profile.plan || 'free') === 'pro';

            if (runIsOpen && !stillProElsewhere) {
                update.proEndedAt = serverTimestamp();
                update.planExpiresAt = null;

                // Release the marker only if it is ours. Another store's
                // marker is not this site's to clear.
                if (profile.planSource === PADDLE_SOURCE) update.planSource = null;
            }
        }

        // Only stamp planUpdatedAt when something else actually changed, so
        // idle page loads do not churn the document.
        if (Object.keys(update).length === 0) return;

        update.planUpdatedAt = serverTimestamp();
        await updateDoc(userRef, update);
        console.log("Subscription audit recorded:", Object.keys(update).join(', '));

    } catch (error) {
        console.error("Failed to record subscription audit:", error);
    }
}

/**
 * Poll Paddle until a just-completed checkout becomes visible on its API,
 * then write the audit trail for the new subscription.
 *
 * Access itself needs no write - Pro comes from asking Paddle. The polling is
 * so the page can stop showing "Free" the moment the subscription is real,
 * and so proSince/planExpiresAt are stamped against the correct start date.
 *
 * @param {number} attempts - how many times to poll before giving up
 * @param {number} delayMs - wait between attempts
 * @returns {Promise<boolean>} true once Paddle confirms the subscription
 */
export async function refreshPlanAfterCheckout(attempts = 5, delayMs = 2000) {
    const user = auth.currentUser;
    if (!user) {
        console.warn("Cannot refresh plan - no signed-in user.");
        return false;
    }

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const status = await checkSubscription(user.email);

        if (status?.grantedBy === 'paddle') {
            console.log(`Subscription confirmed by Paddle (attempt ${attempt}).`);
            localStorage.setItem('isPro', 'true');
            await recordSubscriptionAudit(user, status);
            return true;
        }

        if (attempt < attempts) {
            console.log(`Subscription not visible on Paddle yet - retrying (${attempt}/${attempts}).`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    // Not fatal: every page load asks Paddle again, so this self-corrects.
    console.warn("Subscription still not visible after checkout - it will appear on the next page load.");
    return false;
}

/**
 * Refresh the audit trail at login.
 *
 * Subscribing is not the only event worth recording - a subscription that
 * lapses or is cancelled never produces a checkout event, so without this
 * proEndedAt would never be written for anyone. Safe to call on every login:
 * recordSubscriptionAudit writes only when a value actually changed.
 *
 * @param {import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").User} user
 */
async function auditSubscriptionAtLogin(user) {
    if (!user?.email) return;
    const status = await checkSubscription(user.email);
    await recordSubscriptionAudit(user, status);
}

// Send a freshly authenticated user on to their destination.
// Only acts on the login/signup pages; returns false anywhere else.
function redirectAfterAuth() {
    if (!window.location.pathname.includes('login.html') && !window.location.pathname.includes('signup.html')) {
        return false;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect');
    const action = urlParams.get('action');
    const plan = urlParams.get('plan');

    if (redirect) {
        let redirectUrl = redirect;
        if (action && plan) {
            redirectUrl += `?action=${action}&plan=${plan}`;
        }
        window.location.href = redirectUrl;
    } else if (action === 'checkout' && plan) {
        window.location.href = `portal.html?action=checkout&plan=${plan}`;
    } else {
        window.location.href = 'portal.html';
    }
    return true;
}

// State Observer
export function monitorAuthState(redirectIfNoUser = false) {
    // Back/forward navigation restores a page from the bfcache with its old DOM
    // intact and does NOT re-run module scripts, so onAuthStateChanged never
    // fires again and the header keeps saying "Login" after a successful login.
    // pageshow with persisted=true is the only signal for that restore.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            updateAuthUI(auth.currentUser);
        }
    });

    onAuthStateChanged(auth, (user) => {
        updateAuthUI(user);

        if (user) {
            console.log("User is logged in:", user.email);

            // A signup/login in flight redirects itself once the Firestore
            // profile write has completed - don't navigate out from under it.
            if (authFlowInProgress) return;

            // If on login/signup page, redirect to target or portal
            if (redirectAfterAuth()) {
                return;
            }

            // Reveal UI
            const portalBody = document.getElementById('portal-body');
            if (portalBody) {
                portalBody.style.visibility = 'visible';
            } else if (document.body) {
                document.body.style.visibility = 'visible';
            }

        } else {
            console.log("User is signed out");
            // Redirect to login if required
            if (redirectIfNoUser) {
                window.location.href = 'login.html';
            } else {
                // If not redirecting, we can show the page (e.g. index.html)
                if (document.body) document.body.style.visibility = 'visible';
            }
        }
    });
}

/**
 * Find the auth link inside `scope`, tolerating the fact that we rewrite its
 * href to "#" when the user logs in.
 *
 * The original selector matched on href^="login.html". After one logged-in
 * render the href is "#", so the element could never be found again to switch
 * it back to "Login" - a logout with no page reload left a dead "Logout"
 * button. Tagging the element the first time we see it makes the lookup
 * stable for the life of the page.
 *
 * @param {string} scope - CSS selector for the container to search
 * @returns {HTMLAnchorElement|null}
 */
function findAuthLink(scope) {
    const tagged = document.querySelector(`${scope} a[data-auth-link]`);
    if (tagged) return tagged;

    const link = document.querySelector(`${scope} a[href^="login.html"]`);
    if (link) {
        link.setAttribute('data-auth-link', '');
        // Remember where "Login" should point, since href gets overwritten.
        link.setAttribute('data-login-href', link.getAttribute('href'));
    }
    return link;
}

function updateAuthUI(user) {
    // Desktop Nav
    const loginLink = findAuthLink('nav');
    if (loginLink) {
        if (user) {
            loginLink.textContent = "Logout";
            loginLink.href = "#";
            loginLink.classList.remove('bg-blue-600', 'text-white');
            loginLink.classList.add('text-red-600', 'font-medium', 'hover:text-red-700', 'border', 'border-red-200');
            loginLink.onclick = (e) => {
                e.preventDefault();
                logoutUser().then(() => window.location.reload());
            };
        } else {
            loginLink.textContent = "Login";
            // Restore the page's own login URL, which carries the ?redirect=
            // param - hardcoding "login.html" used to drop it, sending the user
            // to the portal after login instead of back where they were.
            loginLink.href = loginLink.getAttribute('data-login-href') || "login.html";
            loginLink.classList.add('bg-blue-600', 'text-white');
            loginLink.classList.remove('text-red-600', 'hover:text-red-700', 'border', 'border-red-200');
            loginLink.onclick = null;
        }
    }

    // Mobile Menu
    const mobileLoginLink = findAuthLink('#mobile-menu');
    if (mobileLoginLink) {
        if (user) {
            mobileLoginLink.textContent = "Logout";
            mobileLoginLink.href = "#";
            mobileLoginLink.classList.remove('bg-blue-600', 'text-white');
            mobileLoginLink.classList.add('bg-red-50', 'text-red-600');
            mobileLoginLink.onclick = (e) => {
                e.preventDefault();
                logoutUser().then(() => window.location.reload());
            };
        } else {
            mobileLoginLink.textContent = "Login";
            mobileLoginLink.href = mobileLoginLink.getAttribute('data-login-href') || "login.html";
            mobileLoginLink.classList.add('bg-blue-600', 'text-white');
            mobileLoginLink.classList.remove('bg-red-50', 'text-red-600');
            mobileLoginLink.onclick = null;
        }
    }

    // Portal links: go to portal if logged in, otherwise require login first
    const portalLinks = document.querySelectorAll('a[href="portal.html"]');
    portalLinks.forEach(link => {
        if (auth.currentUser) {
            link.href = "portal.html";
        } else {
            link.href = "login.html?redirect=portal.html";
        }
    });
}
