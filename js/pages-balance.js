import { db } from '../firebase-analytics.js';
import { doc, getDoc, setDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const PAGES_PER_PURCHASE = 1000;

/**
 * Get current OCR pages balance for a user.
 * @param {string} uid - Firebase UID
 * @returns {Promise<number>} remaining pages
 */
export async function getPagesBalance(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return userSnap.data().ocrPagesBalance || 0;
        }
        return 0;
    } catch (error) {
        console.error('Error getting pages balance:', error);
        return 0;
    }
}

/**
 * Add pages to a user's balance (called after successful one-time purchase).
 * @param {string} uid - Firebase UID
 * @param {number} amount - pages to add (default 1000)
 * @returns {Promise<boolean>} success
 */
export async function addPages(uid, amount = PAGES_PER_PURCHASE) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            await updateDoc(userRef, {
                ocrPagesBalance: increment(amount),
                ocrPagesTotal: increment(amount),
                lastPurchase: new Date().toISOString()
            });
        } else {
            await setDoc(userRef, {
                ocrPagesBalance: amount,
                ocrPagesTotal: amount,
                lastPurchase: new Date().toISOString()
            });
        }
        console.log(`Added ${amount} OCR pages for user ${uid}`);
        return true;
    } catch (error) {
        console.error('Error adding pages:', error);
        return false;
    }
}

/**
 * Get total OCR pages ever purchased by a user.
 * @param {string} uid - Firebase UID
 * @returns {Promise<number>} total pages purchased
 */
export async function getPagesTotal(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return userSnap.data().ocrPagesTotal || 0;
        }
        return 0;
    } catch (error) {
        console.error('Error getting pages total:', error);
        return 0;
    }
}

/**
 * Set user as Pro (called after successful monthly subscription).
 * @param {string} uid - Firebase UID
 * @returns {Promise<boolean>} success
 */
export async function setProUser(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        const data = { plan: 'pro', proSince: new Date().toISOString() };
        if (userSnap.exists()) {
            await updateDoc(userRef, data);
        } else {
            await setDoc(userRef, { ocrPagesBalance: 0, ocrPagesTotal: 0, ...data });
        }
        console.log(`User ${uid} upgraded to Pro`);
        return true;
    } catch (error) {
        console.error('Error setting pro user:', error);
        return false;
    }
}

/**
 * Deduct one page from a user's balance after an OCR scan.
 * @param {string} uid - Firebase UID
 * @returns {Promise<number>} remaining balance after deduction (-1 if failed)
 */
export async function useOnePage(uid) {
    try {
        const balance = await getPagesBalance(uid);
        if (balance <= 0) return 0;

        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
            ocrPagesBalance: increment(-1)
        });

        const newBalance = balance - 1;
        console.log(`OCR page used. Remaining balance: ${newBalance}`);
        return newBalance;
    } catch (error) {
        console.error('Error using page:', error);
        return -1;
    }
}

// ─── Free Trial: 10 scans one-time during 3-day trial ──────────────

const FREE_TRIAL_SCANS = 10;

/**
 * Get remaining trial scans. One-time allowance, never resets.
 * @param {string} uid - Firebase UID
 * @returns {Promise<number>} remaining trial scans (0–10)
 */
export async function getFreeScansRemaining(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return FREE_TRIAL_SCANS;

        const data = userSnap.data();
        const used = data.trialScansUsed || 0;
        return Math.max(0, FREE_TRIAL_SCANS - used);
    } catch (error) {
        console.error('Error getting trial scans:', error);
        return 0;
    }
}

/**
 * Use one trial scan. Returns remaining scans after deduction.
 * Only works during active trial period.
 * @param {string} uid - Firebase UID
 * @returns {Promise<number>} remaining trial scans (-1 if failed)
 */
export async function useOneFreeScan(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);

        let used = 0;
        if (userSnap.exists()) {
            used = userSnap.data().trialScansUsed || 0;
        }

        if (used >= FREE_TRIAL_SCANS) return 0;

        const updateData = {
            trialScansUsed: used + 1,
        };

        if (userSnap.exists()) {
            await updateDoc(userRef, updateData);
        } else {
            await setDoc(userRef, { ocrPagesBalance: 0, ocrPagesTotal: 0, ...updateData });
        }

        const remaining = FREE_TRIAL_SCANS - (used + 1);
        console.log(`Trial scan used. Remaining: ${remaining}`);
        return remaining;
    } catch (error) {
        console.error('Error using trial scan:', error);
        return -1;
    }
}

/**
 * Get user account creation date from Firestore.
 * @param {string} uid - Firebase UID
 * @returns {Promise<Date|null>} creation date or null
 */
export async function getUserCreatedAt(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.createdAt?.toDate) return data.createdAt.toDate();
            if (data.createdAt) return new Date(data.createdAt);
        }
        return null;
    } catch (error) {
        console.error('Error getting user createdAt:', error);
        return null;
    }
}
