import { monitorAuthState, checkSubscription } from './auth.js';
import { getPagesBalance, getPagesTotal } from './pages-balance.js';

import { app, auth } from '../firebase-analytics.js';

const loadingEl = document.getElementById('loading');
const noSubEl = document.getElementById('no-sub');
const subDetailsEl = document.getElementById('sub-details');
const pagesBalanceSectionEl = document.getElementById('pages-balance-section');

// UI Elements
const planNameEl = document.getElementById('plan-name');
const nextBillingEl = document.getElementById('next-billing-date');
const paymentMethodEl = document.getElementById('payment-method');
const lastAmountEl = document.getElementById('last-amount');
const lastDateEl = document.getElementById('last-date');
const invoiceIdEl = document.getElementById('invoice-id');
const statusBadgeEl = document.getElementById('plan-status-badge');
const btnCancelSub = document.getElementById('btn-cancel-sub');

// Monitor Auth
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'login.html?redirect=subscription.html';
        return;
    }

    try {
        const [subData, pagesBalance, pagesTotal] = await Promise.all([
            checkSubscription(user.email),
            getPagesBalance(user.uid),
            getPagesTotal(user.uid)
        ]);
        loadingEl.classList.add('hidden');

        // Show pages balance section if user has any pages
        if (pagesBalance > 0 && pagesBalanceSectionEl) {
            pagesBalanceSectionEl.classList.remove('hidden');
            const totalPages = pagesTotal || 1000;
            const pagesUsed = totalPages - pagesBalance;
            const usedPct = Math.max(0, Math.min(100, (pagesUsed / totalPages) * 100));
            document.getElementById('pages-balance-count').textContent = pagesBalance;
            document.getElementById('pages-used-count').textContent = pagesUsed;
            document.getElementById('pages-total-count').textContent = totalPages;
            document.getElementById('pages-progress-bar').style.width = usedPct + '%';
        }

        if (subData.isPro && subData.details) {
            // Show Details
            subDetailsEl.classList.remove('hidden');

            // Populate Data
            const d = subData.details;

            // Plan Name (Simple mapping based on ID, could be cleaner)
            const isYearly = subData.plan && subData.plan.includes('yearly') || subData.plan.includes('year');
            planNameEl.textContent = isYearly ? 'Pro Plan (Yearly)' : 'Pro Plan (Monthly)';

            // Status
            statusBadgeEl.textContent = d.status.toUpperCase();
            if (d.status === 'active') {
                statusBadgeEl.className = 'bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded uppercase';
            } else {
                statusBadgeEl.className = 'bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-1 rounded uppercase';
            }

            // Next Billing
            nextBillingEl.textContent = d.next_billed_at ? new Date(d.next_billed_at).toLocaleDateString() : 'N/A';

            // Payment Method
            paymentMethodEl.textContent = d.payment_method || 'N/A';

            // Last Payment
            // Last Payment & Invoice
            let amount = d.last_amount || '0.00';
            const currency = d.currency_code || 'USD';

            // Paddle returns amounts as strings like "4999" (cents) or "49.99" (dollars)
            // If no decimal and value > 100, treat as cents
            if (!String(amount).includes('.') && parseFloat(amount) > 100) {
                amount = (parseFloat(amount) / 100).toFixed(2);
            }

            lastAmountEl.textContent = `${amount} ${currency}`;
            lastDateEl.textContent = d.last_payment_date ? new Date(d.last_payment_date).toLocaleDateString() : '';
            if (invoiceIdEl) invoiceIdEl.textContent = d.invoice_id || 'N/A';

            // Cancel Button Handler
            if (btnCancelSub) {
                if (d.status === 'past_due' || d.status === 'paused') {
                    btnCancelSub.disabled = true;
                    btnCancelSub.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    btnCancelSub.onclick = () => handleCancelSubscription(user.email);
                }
            }

        } else if (pagesBalance <= 0) {
            // No Subscription and no pages balance
            noSubEl.classList.remove('hidden');
        }
        // If user has pages balance but no subscription, pages section already shown above

    } catch (e) {
        console.error(e);
        loadingEl.innerHTML = '<p class="text-red-500">Failed to load subscription details. Please try again later.</p>';
    }
});

async function handleCancelSubscription(email) {
    if (!confirm("Are you sure you want to cancel your subscription? You will lose auto-renewal but keep access until the end of the current period.")) {
        return;
    }

    const btn = document.getElementById('btn-cancel-sub');
    if (btn) {
        btn.textContent = "Cancelling...";
        btn.disabled = true;
    }

    try {
        const response = await fetch('cancel_subscription.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        const result = await response.json();

        if (result.success) {
            alert("Subscription cancelled successfully.");
            window.location.reload();
        } else {
            alert("Error cancelling: " + (result.error || "Unknown error"));
            if (btn) {
                btn.textContent = "Cancel Subscription";
                btn.disabled = false;
            }
        }
    } catch (error) {
        console.error("Cancel API Error:", error);
        alert("Network error. Please try again.");
        if (btn) {
            btn.textContent = "Cancel Subscription";
            btn.disabled = false;
        }
    }
}
