import { app, auth, analytics, logEvent } from '../firebase-analytics.js';
import { addPages, setProUser } from './pages-balance.js';

// PADDLE CONFIGURATION (Billing V2)
export const PADDLE_TOKEN = 'live_6e50998a925aac493ccf8bfc790'; // Client-side token

export const PLANS = {
    pages100:   'pri_01kzkf3facgaxhht2t856vts11',  // $4.99  — 100 pages
    pages1000:  'pri_01kxqmfvpbe73srtt97bvsafer',  // $19.99 — 1,000 pages
    monthly:    'pri_01m1kg1q6x5tvajs5xap2ms0xe',  // $9.99/mo — Monthly Subscription
    yearly:     'pri_01kg5by6qyxm19wb79rhrjmgt8',  // $49.99/yr — Yearly Subscription
};

const PAGES_MAP = {
    [PLANS.pages100]:   100,
    [PLANS.pages1000]:  1000,
};

const SUBSCRIPTION_PRICES = {
    'pri_01m1kg1q6x5tvajs5xap2ms0xe': 'monthly',
    'pri_01kg5by6qyxm19wb79rhrjmgt8': 'yearly',
};

// Initialize Paddle
if (window.Paddle) {
    Paddle.Initialize({
        token: PADDLE_TOKEN,
        eventCallback: async function (data) {
            console.log('Paddle Event:', data);

            if (data.name === 'checkout.completed') {
                const items = data.data?.items || [];
                const purchasedPriceId = items[0]?.price_id || items[0]?.priceId;

                const pagesToCredit = PAGES_MAP[purchasedPriceId];
                const subscriptionPlan = SUBSCRIPTION_PRICES[purchasedPriceId];

                // Extract transaction details from Paddle event
                const transactionId = data.data?.transaction_id || data.data?.id || '';
                const totalAmount = data.data?.totals?.total ? (parseFloat(data.data.totals.total) / 100) : 0;
                const currencyCode = data.data?.currency_code || 'USD';

                if (pagesToCredit) {
                    // Pages pack purchase (GA4 ecommerce structure)
                    logEvent(analytics, 'purchase', {
                        transaction_id: transactionId,
                        value: totalAmount || (pagesToCredit === 100 ? 4.99 : 19.99),
                        currency: currencyCode,
                        items: [{
                            item_id: purchasedPriceId,
                            item_name: pagesToCredit + ' Pages Pack',
                            item_category: 'pages',
                            price: totalAmount || (pagesToCredit === 100 ? 4.99 : 19.99),
                            quantity: 1
                        }]
                    });
                    const user = auth.currentUser;
                    if (user) {
                        const success = await addPages(user.uid, pagesToCredit);
                        if (success) console.log(pagesToCredit + ' OCR pages credited.');
                    }
                } else if (subscriptionPlan) {
                    // Subscription purchase (GA4 ecommerce structure)
                    logEvent(analytics, 'purchase', {
                        transaction_id: transactionId,
                        value: totalAmount || (subscriptionPlan === 'yearly' ? 49.99 : 9.99),
                        currency: currencyCode,
                        items: [{
                            item_id: purchasedPriceId,
                            item_name: 'Pro ' + subscriptionPlan.charAt(0).toUpperCase() + subscriptionPlan.slice(1) + ' Subscription',
                            item_category: 'subscription',
                            item_variant: subscriptionPlan,
                            price: totalAmount || (subscriptionPlan === 'yearly' ? 49.99 : 9.99),
                            quantity: 1
                        }]
                    });
                    const user = auth.currentUser;
                    if (user) {
                        await setProUser(user.uid);
                    }
                    console.log('Subscription purchase logged:', subscriptionPlan);
                } else {
                    console.warn('Unknown price ID in checkout.completed:', purchasedPriceId);
                }

                // Wait for analytics beacon before redirecting
                setTimeout(function() {
                    window.location.href = window.location.origin + '/portal.html';
                }, 1500);
            }
        }
    });
} else {
    console.error("Paddle.js library not loaded!");
}

export function checkout(planType, customerEmail = null, discountCode = null, discountId = null) {
    const user = auth.currentUser;
    const emailToUse = customerEmail || (user ? user.email : "");
    const uidToUse = user ? user.uid : "guest";

    const priceId = PLANS[planType];
    if (!priceId) {
        alert("Invalid plan selected.");
        return;
    }

    logEvent(analytics, 'begin_checkout', {
        currency: 'USD',
        value: planType === 'pages100' ? 4.99 : planType === 'pages1000' ? 19.99 : planType === 'yearly' ? 49.99 : 9.99,
        items: [{
            item_id: priceId,
            item_name: planType,
            item_category: planType.startsWith('pages') ? 'pages' : 'subscription',
            quantity: 1
        }]
    });

    const checkoutConfig = {
        items: [{ priceId: priceId, quantity: 1 }],
        customData: {
            uid: uidToUse,
            planType: planType
        },
        settings: {
            displayMode: 'overlay',
        }
    };

    // Pre-fill email if user is logged in
    if (emailToUse) {
        checkoutConfig.customer = { email: emailToUse };
    }

    // Apply discount if provided (promo banner, URL param like ?discount=CODE, or an explicit Paddle discount ID)
    let urlDiscount = null;
    try { urlDiscount = new URLSearchParams(window.location.search).get('discount'); } catch (e) { /* ignore */ }
    const code = (discountCode || urlDiscount || '').trim().toUpperCase();

    if (discountId) {
        checkoutConfig.discountId = discountId;            // e.g. 'dsc_01gv5kpg05xp104ek2fmgjwttf'
    } else if (code && /^[A-Z0-9]{3,32}$/.test(code)) {
        checkoutConfig.discountCode = code;
    }

    Paddle.Checkout.open(checkoutConfig);
}

