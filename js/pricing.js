import { PADDLE_TOKEN, PLANS, checkout } from './paddle-payment.js';
import { app, auth } from '../firebase-analytics.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// DOM Elements
const pricePages100   = document.getElementById('price-pages100');
const priceMonthly    = document.getElementById('price-monthly');
const priceYearly     = document.getElementById('price-yearly');
const btnPages100     = document.getElementById('btn-pages100');
const btnMonthly      = document.getElementById('btn-monthly');
const btnYearly       = document.getElementById('btn-yearly');
const saveBadge       = document.getElementById('badge-yearly-save');

async function fetchPrices() {
    try {
        const result = await Paddle.PricePreview({
            items: [
                { quantity: 1, priceId: PLANS.pages100 },
                { quantity: 1, priceId: PLANS.monthly },
                { quantity: 1, priceId: PLANS.yearly },
            ]
        });

        let monthlyRaw = 0;
        let yearlyRaw  = 0;

        result.data.details.lineItems.forEach(item => {
            const formatted = item.formattedTotals.subtotal;
            if (item.priceId === PLANS.pages100  && pricePages100)  pricePages100.textContent  = formatted;
            if (item.priceId === PLANS.monthly   && priceMonthly) {
                priceMonthly.textContent = formatted;
                monthlyRaw = item.totals.subtotal; // in cents
            }
            if (item.priceId === PLANS.yearly && priceYearly) {
                priceYearly.textContent = formatted;
                yearlyRaw = item.totals.subtotal; // in cents
            }
        });

        // Dynamically compute and display the yearly savings %
        if (saveBadge && monthlyRaw > 0 && yearlyRaw > 0) {
            const annualIfMonthly = monthlyRaw * 12;
            const savePct = Math.round((1 - yearlyRaw / annualIfMonthly) * 100);
            if (savePct > 0) {
                saveBadge.textContent = `Pro Plan · Save ~${savePct}%`;
            }
        }
    } catch (error) {
        console.error("Failed to fetch localized prices:", error);
        // Prices remain at HTML defaults — no visual break
    }
}

// Paddle.js loads async; wait until it's initialized before calling PricePreview
function waitForPaddleAndFetch(retries = 10, delay = 300) {
    if (window.Paddle && window.Paddle.PricePreview) {
        fetchPrices();
        return;
    }
    if (retries <= 0) return;
    setTimeout(() => waitForPaddleAndFetch(retries - 1, delay), delay);
}

onAuthStateChanged(auth, (user) => {
    console.log("Pricing Page: User state updated", user ? user.email : "Logged out");
});

// Honour ?promo=CODE in the URL — auto-applies the discount at checkout
const promoCode = new URLSearchParams(window.location.search).get('promo') || null;

if (btnPages100)  btnPages100.addEventListener('click',  (e) => { e.preventDefault(); checkout('pages100', null, promoCode); });
if (btnMonthly)   btnMonthly.addEventListener('click',   (e) => { e.preventDefault(); checkout('monthly',  null, promoCode); });
if (btnYearly)    btnYearly.addEventListener('click',    (e) => { e.preventDefault(); checkout('yearly',   null, promoCode); });

document.addEventListener('DOMContentLoaded', () => waitForPaddleAndFetch());
