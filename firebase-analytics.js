import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { initializeFirestore, CACHE_SIZE_UNLIMITED } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCJ0q5MqGGM0iH9HP0qZRPaAsmN4ANov3A",
    authDomain: "arabic-ocr-a89ec.firebaseapp.com",
    projectId: "arabic-ocr-a89ec",
    storageBucket: "arabic-ocr-a89ec.firebasestorage.app",
    messagingSenderId: "232022179291",
    appId: "1:232022179291:web:65902e4cb1685b78217bfe",
    measurementId: "G-YJ3SGJZ4BH"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);

// Initialize Firestore with reliable connectivity settings
export const db = initializeFirestore(app, {
    experimentalForceLongPolling: true, // Use long-polling instead of WebSockets for better stability
});

// Initialize Auth explicitly to avoid IndexedDB timeout hangs in some browsers
export const auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
    popupRedirectResolver: browserPopupRedirectResolver
});

export { logEvent };

// --- Analytics helpers ---

// Maps a thrown error onto a small, fixed set of reason codes. GA4 reports get
// unusable if a param has thousands of distinct values, so the raw message is
// kept separate (and truncated) rather than used as the grouping key.
export function errorReason(error) {
    const msg = (error && error.message ? error.message : String(error || '')).toLowerCase();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) return 'network';
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
    if (msg.includes('no text found')) return 'no_text';
    if (msg.includes('api')) return 'api';
    return 'unknown';
}

// GA4 truncates event parameter values at 100 characters.
export function errorMessage(error) {
    const msg = error && error.message ? error.message : String(error || '');
    return msg.slice(0, 100);
}

// Buckets a file size into ranges, so size is reportable without being a
// high-cardinality number.
export function fileSizeBucket(bytes) {
    const mb = (bytes || 0) / (1024 * 1024);
    if (mb < 1) return 'under_1mb';
    if (mb < 5) return '1_5mb';
    if (mb < 20) return '5_20mb';
    return 'over_20mb';
}
