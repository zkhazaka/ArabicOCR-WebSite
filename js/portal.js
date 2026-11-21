import { monitorAuthState, logoutUser } from './auth.js';
import { checkout } from './paddle-payment.js';
import { app, auth, analytics, logEvent, errorReason, errorMessage, fileSizeBucket } from '../firebase-analytics.js';
import { getPagesBalance, useOnePage, getFreeScansRemaining, useOneFreeScan, getUserCreatedAt } from './pages-balance.js';


const GEMINI_OCR_PROXY = "https://arabicocr.zczvwz6pw7.workers.dev";

// ── Brevo Event Tracking ────────────────────────────────────────
function trackBrevoEvent(eventName, extraAttributes = {}) {
    const user = auth.currentUser;
    if (!user?.email) return;
    fetch(`${GEMINI_OCR_PROXY}/brevo/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Token": "ocr_app_2026_kanzati" },
        body: JSON.stringify({ uid: user.uid, email: user.email, event: eventName, attributes: extraAttributes }),
    }).catch(() => {});
}

// ── Feature Gating ──────────────────────────────────────────────
window.isTrialActive = false;
window.trialDaysLeft = 0;

function isFeatureLocked() {
    if (window.isTrialActive) return false;
    return window.userTier === 'free';
}

function showPricingModal() {
    const modal = document.getElementById('pricing-modal');
    if (modal) modal.classList.remove('hidden');
}

function showProNudge() {
    if (sessionStorage.getItem('proNudgeDismissed')) return;
    const sheet = document.getElementById('pro-nudge-sheet');
    if (sheet) {
        setTimeout(() => sheet.classList.add('show'), 500);
    }
}

// Initialize Authentication Guard
monitorAuthState(true); // Redirect to login if user not found


// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const stepUpload = document.getElementById('step-upload');
const stepProcessing = document.getElementById('step-processing');
const stepResult = document.getElementById('step-result');
const resultLoadingOverlay = document.getElementById('result-loading-overlay');
const progressBarResult = document.getElementById('ocr-progress-bar-result');
const progressTextResult = document.getElementById('ocr-progress-text-result');

const imageViewerContainer = document.getElementById('image-viewer-container');
const resultSourceImage = document.getElementById('result-source-image');
const editorContainer = document.getElementById('editor-container');

const step1Indicator = document.getElementById('step1-indicator');
const step2Indicator = document.getElementById('step2-indicator');
const step3Indicator = document.getElementById('step3-indicator');

// Progress Bar
const progressBar = document.getElementById('ocr-progress-bar');
const progressText = document.getElementById('ocr-progress-text');

// Mobile Menu Elements
const btnMobileMenu = document.getElementById('btn-mobile-menu');
const sidebar = document.querySelector('aside');
const mobileHeader = document.querySelector('header');

const sourceImage = document.getElementById('source-image');
const tabTables = document.getElementById('tab-tables');

// Chat bubble & panel elements (declared early to avoid hoisting issues)
const chatBubbleBtn = document.getElementById('chat-bubble-btn');
const chatPanel = document.getElementById('chat-panel');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

// Table extraction elements
const btnExtractTables = document.getElementById('btn-extract-tables');
const tablesViewerContainer = document.getElementById('tables-viewer-container');
const tablesContent = document.getElementById('tables-content');
const btnCopyCsv = document.getElementById('btn-copy-csv');

// Split view
const btnSplitView = document.getElementById('btn-split-view');

// Template dropdown
const templateDropdown = document.getElementById('template-dropdown');

// Diff view
const btnDiffView = document.getElementById('btn-diff-view');
const diffViewerContainer = document.getElementById('diff-viewer-container');

// Share
const btnShare = document.getElementById('btn-share');
const shareModal = document.getElementById('share-modal');
const shareLinkInput = document.getElementById('share-link-input');
const btnCopyShareLink = document.getElementById('btn-copy-share-link');
const btnCloseShareModal = document.getElementById('btn-close-share-modal');

// PDF Modal Elements
const pdfSelectionModal = document.getElementById('pdf-selection-modal');
const pdfPagesGrid = document.getElementById('pdf-pages-grid');
const closePdfModalBtn = document.getElementById('close-pdf-modal');
const cancelPdfSelectionBtn = document.getElementById('cancel-pdf-selection');

// Quill Initialization
const Font = Quill.import('formats/font');
Font.whitelist = [
    'cairo', 'tajawal', 'almarai', 'amiri', 'changa',
    'notosansarabic', 'notokufiarabic', 'notonaskharabic',
    'lalezar', 'arefruqaa', 'reemkufi', 'elmessiri',
    'sans-serif', 'serif', 'monospace'
];
Quill.register(Font, true);

// Quill's built-in Align format omits 'left' from its whitelist — clicking the toolbar's Left
// option just clears the align format rather than setting an explicit one, relying on whatever
// the surrounding CSS default happens to be. That's fine on a plain LTR page, but this editor's
// default is right/RTL for Arabic, so "clearing the format" landed back on right, not left —
// the Left button looked completely broken. Registering an explicit 'left' whitelist entry (plus
// a matching toolbar icon/value below) makes it a real, overriding format like the other three.
const Align = Quill.import('formats/align');
Align.whitelist = ['right', 'center', 'justify', 'left'];
Quill.register(Align, true);

const alignIcons = Quill.import('ui/icons').align;
alignIcons.left = alignIcons[''];

const quill = new Quill('#editor-container', {
    theme: 'snow',
    modules: {
        toolbar: [
            [{ 'font': Font.whitelist }],
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            [{ 'align': ['left', 'center', 'right', 'justify'] }],
            ['clean']
        ]
    }
});
const resultText = quill; // Alias for minimal refactoring impact, but methods need change

// The editor's CSS default is right-aligned/RTL (Arabic-first), which is wrong for pure
// English/Latin results (AI Refine of an English doc, an English translation, etc.). Detect the
// dominant script of whatever content is being loaded and set the editor's base direction to
// match; per-paragraph alignment set via the toolbar still overrides this, since it targets the
// paragraph directly rather than the editor root.
const ARABIC_SCRIPT_PATTERN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
function applyContentDirection(text) {
    const isArabic = ARABIC_SCRIPT_PATTERN.test(text || '');
    quill.root.setAttribute('dir', isArabic ? 'rtl' : 'ltr');
}

const filenameDisplay = document.getElementById('filename-display');

const btnBack = document.getElementById('btn-back');
const btnNewScan = document.getElementById('btn-new-scan');
const btnLogout = document.getElementById('logout-btn');
const btnRefine = document.getElementById('btn-refine');
const btnSummarize = document.getElementById('btn-summarize');
const btnTranslate = document.getElementById('btn-translate');
const btnTranslation = document.getElementById('btn-translate');
const btnCopy = document.getElementById('btn-copy');
const btnDownload = document.getElementById('btn-download');
const btnPrint = document.getElementById('btn-print');
const btnCopyFloating = document.getElementById('btn-copy-floating');
const manageSubLinkSidebar = document.getElementById('manage-sub-link-sidebar');

// Translation Modal Elements
const translationModal = document.getElementById('translation-modal');
const translationLangSelect = document.getElementById('translation-lang-select');
const btnCancelTranslation = document.getElementById('btn-cancel-translation');
const btnConfirmTranslation = document.getElementById('btn-confirm-translation');

const btnAlignLeft = document.getElementById('btn-align-left');
const btnAlignCenter = document.getElementById('btn-align-center');
const btnAlignRight = document.getElementById('btn-align-right');

const userEmailDisplay = document.getElementById('user-email');
const userAvatarDisplay = document.getElementById('user-avatar');

// Update User UI
// Update User UI
auth.onAuthStateChanged(async (user) => {
    if (user) {
        userEmailDisplay.textContent = user.email;
        userAvatarDisplay.textContent = user.email.charAt(0).toUpperCase();

        const statusDisplay = document.getElementById('user-status-display');
        const userInfoBlock = document.querySelector('aside .p-4.border-b');

        // ── Determine user tier: Pro > Pages > Free ──
        // 1. Check Paddle subscription
        let subData = null;
        try {
            const { checkSubscription } = await import('./auth.js');
            subData = await checkSubscription(user.email);
        } catch (e) {
            console.error('Subscription check failed:', e);
        }

        const pagesBalance = await getPagesBalance(user.uid);
        const freeScansLeft = await getFreeScansRemaining(user.uid);

        const tierLine = document.getElementById('tier-status-line');

        if (subData && subData.isPro) {
            // ── PRO user (active subscription) ──
            window.userTier = 'pro';
            window.isProUser = true;
            window.isPagesUser = false;
            window.pagesBalance = Infinity;
            localStorage.setItem('isPro', 'true');

            const badge = document.createElement('span');
            badge.className = 'ml-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider';
            badge.textContent = 'PRO';
            userEmailDisplay.appendChild(badge);

            if (tierLine) {
                tierLine.innerHTML = `<span class="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium"><i class="fas fa-crown text-xs"></i> Pro Plan — Unlimited scans</span>`;
            }

            if (statusDisplay) {
                statusDisplay.textContent = 'Pro · Unlimited';
                statusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-700';
            }

        } else if (pagesBalance > 0) {
            // ── PAGES user (purchased page packs) ──
            window.userTier = 'pages';
            window.isProUser = true;
            window.isPagesUser = true;
            window.pagesBalance = pagesBalance;
            localStorage.setItem('isPro', 'true');

            const badge = document.createElement('span');
            badge.className = 'ml-2 bg-gradient-to-r from-purple-500 to-violet-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider';
            badge.textContent = 'PAGES';
            userEmailDisplay.appendChild(badge);

            if (tierLine) {
                tierLine.innerHTML = `<span class="inline-flex items-center gap-1.5 text-sm text-purple-600 font-medium"><i class="fas fa-layer-group text-xs"></i> <span id="pages-balance-count">${pagesBalance}</span> scans remaining</span>`;
            }

            if (statusDisplay) {
                statusDisplay.textContent = `${pagesBalance} scans remaining`;
                statusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 text-purple-700';
            }

        } else {
            // ── FREE user ──
            window.userTier = 'free';
            window.isProUser = false;
            window.isPagesUser = false;
            window.pagesBalance = 0;
            window.freeScansLeft = freeScansLeft;
            localStorage.setItem('isPro', 'false');

            // ── 3-day trial check ──
            try {
                const createdAt = await getUserCreatedAt(user.uid);
                if (createdAt) {
                    const daysSinceSignup = (Date.now() - createdAt.getTime()) / 86400000;
                    if (daysSinceSignup <= 3 && freeScansLeft > 0) {
                        window.isTrialActive = true;
                        window.trialDaysLeft = Math.ceil(3 - daysSinceSignup);
                    }
                }
            } catch (e) { console.error('Trial check failed:', e); }

            const badge = document.createElement('span');
            badge.className = 'ml-2 bg-gray-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider';
            userEmailDisplay.appendChild(badge);

            if (window.isTrialActive) {
                // ── Active trial: show trial scans remaining ──
                badge.textContent = 'TRIAL';
                badge.className = 'ml-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider';

                if (tierLine) {
                    tierLine.innerHTML = `<span class="inline-flex items-center gap-1.5 text-sm text-amber-600 font-medium"><i class="fas fa-gift text-xs"></i> Trial: <span id="free-scans-count">${freeScansLeft}</span>/10 scans · ${window.trialDaysLeft} day${window.trialDaysLeft !== 1 ? 's' : ''} left</span>`;
                }
                if (statusDisplay) {
                    statusDisplay.textContent = `Trial · ${freeScansLeft} scans`;
                    statusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-700';
                }

                document.body.classList.remove('free-tier');
                document.body.classList.add('trial-active');
                const trialBanner = document.getElementById('trial-banner');
                if (trialBanner) {
                    trialBanner.querySelector('.trial-days').textContent = window.trialDaysLeft;
                    trialBanner.classList.remove('hidden');
                }
            } else {
                // ── Trial expired or scans exhausted: must upgrade ──
                badge.textContent = 'FREE';

                if (tierLine) {
                    tierLine.innerHTML = `<span class="inline-flex items-center gap-1.5 text-sm text-gray-500 font-medium"><i class="fas fa-lock text-xs"></i> Trial ended · <a href="pricing.html" class="text-blue-600 hover:underline font-semibold">Upgrade to continue</a></span>`;
                }
                if (statusDisplay) {
                    statusDisplay.textContent = 'Upgrade';
                    statusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-600 cursor-pointer';
                    statusDisplay.onclick = () => { window.location.href = 'pricing.html'; };
                }

                document.body.classList.add('free-tier');
                document.body.classList.remove('trial-active');
            }
        }

    }
});

// Profile Dropdown Logic
const userMenuBtn = document.getElementById('user-menu-btn');
const userMenuDropdown = document.getElementById('user-menu-dropdown');

if (userMenuBtn && userMenuDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenuDropdown.classList.toggle('hidden');
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!userMenuBtn.contains(e.target) && !userMenuDropdown.contains(e.target)) {
            userMenuDropdown.classList.add('hidden');
        }
    });
}

// Text State Management (Initialized early)
let textContent = {
    original: '',
    refined: '',
    summary: '',
    translation: ''
};

// Debug Log
console.log("PortalJS: Loaded. textContent initialized.");


// Navigation / Steps
function showStep(stepName) {
    stepUpload.classList.add('hidden');
    stepUpload.classList.remove('active');
    stepProcessing.classList.add('hidden');
    stepProcessing.classList.remove('active');
    stepResult.classList.add('hidden');
    stepResult.classList.remove('active');

    if (stepName === 'upload') {
        stepUpload.classList.remove('hidden');
        stepUpload.classList.add('active');
        updateProgress(1);
    } else if (stepName === 'result') {
        stepResult.classList.remove('hidden');
        stepResult.classList.add('active');
        // Ensure overlay is hidden if just showing result
        if (resultLoadingOverlay) resultLoadingOverlay.classList.add('hidden');
        updateProgress(3);
    } else if (stepName === 'result-loading') {
        stepResult.classList.remove('hidden');
        stepResult.classList.add('active');
        if (resultLoadingOverlay) resultLoadingOverlay.classList.remove('hidden');
        updateProgress(3);
    } else if (stepName === 'processing') {
        stepProcessing.classList.remove('hidden');
        stepProcessing.classList.add('active');
        // Optional: Update progress bar if needed, or leave at step 1
        updateProgress(2);
    }
    // Show/hide chat bubble based on result visibility
    if (typeof updateChatBubbleVisibility === 'function') {
        updateChatBubbleVisibility();
    }
}

function updateProgress(step) {
    // Reset all
    step1Indicator.className = 'w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-sm';
    step2Indicator.className = 'w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-sm';
    step3Indicator.className = 'w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-sm';

    // Active Style
    const activeClass = 'bg-blue-600 text-white ring-4 ring-blue-100';
    // Completed Style
    const completedClass = 'bg-blue-600 text-white';

    if (step === 1) {
        step1Indicator.className = 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + activeClass;
    } else if (step === 2) {
        step1Indicator.className = 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + completedClass;
        step2Indicator.className = 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + activeClass;
    } else if (step === 3) {
        step1Indicator.className = 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + completedClass;
        step2Indicator.className = 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + completedClass;
        step3Indicator.className = 'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + activeClass;
    }
}

// File Handling
dropZone.addEventListener('click', () => {
    // If trial ended or no balance, show pricing modal instead of file picker
    if (window.userTier === 'free' && !window.isTrialActive) {
        document.getElementById('pricing-modal')?.classList.remove('hidden');
        return;
    }
    fileInput.click();
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-blue-500'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-blue-500'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500');
    if (window.userTier === 'free' && !window.isTrialActive) {
        document.getElementById('pricing-modal')?.classList.remove('hidden');
        return;
    }
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
    if (window.userTier === 'free' && !window.isTrialActive) {
        document.getElementById('pricing-modal')?.classList.remove('hidden');
        e.target.value = '';
        return;
    }
    if (e.target.files.length) handleFile(e.target.files[0]);
});

// Set when a file is accepted, so OCR completion/failure can report duration.
let ocrStartedAt = 0;
// Tracks whether the current scan came from an image or a pdf page
let currentFileSource = 'image';

async function handleFile(file) {
    console.log("File selected:", file.name);
    filenameDisplay.textContent = file.name;

    ocrStartedAt = Date.now();
    logEvent(analytics, 'file_selected', {
        file_type: file.type,
        file_size_bucket: fileSizeBucket(file.size)
    });

    // PDF Handling
    if (file.type === 'application/pdf') {
        try {
            showPdfSelectionModal(file);
        } catch (error) {
            console.error(error);
            showToast("Error processing PDF: " + error.message, 'error');
            showStep('upload');
        }
    } else if (file.type.startsWith('image/')) {
        // Image Handling
        currentFileSource = 'image';
        const reader = new FileReader();
        reader.onload = (e) => {
            sourceImage.src = e.target.result;
            showStep('processing'); // Show Processing Overlay over Upload step
            processOCR(e.target.result.split(',')[1], true);
            if (resultSourceImage) resultSourceImage.src = e.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        showToast("Unsupported file type. Please upload Image or PDF.", 'warning');
    }
}

// Text State Management (Initialized at top) - Ensure these buttons exist
const statPrecision = document.getElementById('stat-precision');
const statWords = document.getElementById('stat-words');
const statsBar = document.getElementById('ocr-stats-bar');

// Helper: Grayscale Preprocessing
async function preprocessImage(base64Image) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;

            // Draw original image
            ctx.drawImage(img, 0, 0);

            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Convert to grayscale
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = avg;     // Red
                data[i + 1] = avg; // Green
                data[i + 2] = avg; // Blue
            }

            // Put data back
            ctx.putImageData(imageData, 0, 0);

            // Return base64 without prefix
            resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
        };
        img.onerror = reject;
        img.src = "data:image/jpeg;base64," + base64Image;
    });
}

// PDF Modal Elements
// ... (rest of PDF modal imports)

// PDF Modal Controls
if (closePdfModalBtn) {
    closePdfModalBtn.addEventListener('click', () => {
        pdfSelectionModal.classList.add('hidden');
        showStep('upload'); // Go back to upload
    });
}
if (cancelPdfSelectionBtn) {
    cancelPdfSelectionBtn.addEventListener('click', () => {
        pdfSelectionModal.classList.add('hidden');
        showStep('upload'); // Go back to upload
    });
}

function showPdfSelectionModal(file) {
    selectedPages.clear();
    if (pdfSelectAll) pdfSelectAll.checked = false;
    updateBatchSelectionUI();
    pdfSelectionModal.classList.remove('hidden');
    renderAvailablePdfPages(file);
}

async function renderAvailablePdfPages(file) {
    pdfPagesGrid.innerHTML = `
        <div class="col-span-full text-center text-gray-500 py-10">
            <i class="fas fa-circle-notch fa-spin text-3xl text-blue-600 mb-3"></i>
            <p>Loading PDF Pages...</p>
        </div>
    `;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        pdfPagesGrid.innerHTML = ''; // Clear loading spinner
        batchPdfDoc = pdf; // Store for batch processing

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 0.5 }); // Thumbnail scale

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Render page to canvas
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // Create Thumbnail Container
            const pageContainer = document.createElement('div');
            pageContainer.className = "bg-white p-2 rounded-lg shadow cursor-pointer hover:ring-4 hover:ring-blue-500 transition relative group";

            // Image Wrapper
            const imgWrapper = document.createElement('div');
            imgWrapper.className = "overflow-hidden rounded border border-gray-200";
            imgWrapper.appendChild(canvas);
            canvas.className = "w-full h-auto";

            // Page Number Badge
            const badge = document.createElement('div');
            badge.className = "absolute top-4 right-4 bg-black/70 text-white text-xs px-2 py-1 rounded-full";
            badge.innerText = `Page ${i}`;

            // Selection Overlay (on hover)
            const overlay = document.createElement('div');
            overlay.className = "absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/10 transition rounded-lg flex items-center justify-center";
            const selectBtn = document.createElement('button');
            selectBtn.className = "bg-blue-600 text-white px-4 py-2 rounded-full font-bold opacity-0 group-hover:opacity-100 transition transform scale-90 group-hover:scale-100 shadow-lg";
            selectBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Scan';
            overlay.appendChild(selectBtn);

            // Batch selection checkbox
            const checkbox = document.createElement('div');
            checkbox.className = 'pdf-page-checkbox';
            checkbox.dataset.page = i;
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                const pageNum = parseInt(checkbox.dataset.page);
                if (selectedPages.has(pageNum)) {
                    selectedPages.delete(pageNum);
                } else {
                    if (window.userTier === 'free' && !window.isTrialActive && selectedPages.size >= 1) {
                        showToast('Upgrade to Pro for batch scanning', 'warning', 4000);
                        return;
                    }
                    selectedPages.add(pageNum);
                }
                updateBatchSelectionUI();
            });

            pageContainer.appendChild(checkbox);
            pageContainer.appendChild(imgWrapper);
            pageContainer.appendChild(badge);
            pageContainer.appendChild(overlay);

            // Click Handler (single page scan)
            pageContainer.onclick = () => selectPdfPage(pdf, i);

            pdfPagesGrid.appendChild(pageContainer);
        }

    } catch (error) {
        console.error("Error rendering thumbnails:", error);
        pdfPagesGrid.innerHTML = `
            <div class="col-span-full text-center text-red-500 py-10">
                <i class="fas fa-exclamation-circle text-3xl mb-3"></i>
                <p>Error loading PDF pages.</p>
            </div>
        `;
    }
}

async function selectPdfPage(pdfDoc, pageNum) {
    currentFileSource = 'pdf_page';
    pdfSelectionModal.classList.add('hidden'); // Close modal
    showStep('processing'); // Show loading early

    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // High resolution for better OCR

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Render page at high res
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Get high-quality image data
        const base64Image = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
        const fullDataUrl = canvas.toDataURL('image/jpeg', 0.9);

        // Set source image for display in result (will look sharper)
        sourceImage.src = fullDataUrl;
        if (resultSourceImage) resultSourceImage.src = fullDataUrl;

        // Start OCR processing
        processOCR(base64Image, true);
    } catch (error) {
        console.error("Selection error:", error);
        showToast("Error extracting page: " + error.message, 'error');
        showStep('upload');
    }
}


// PDF.js Setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js?v=3';



// OCR Processing (Gemini Vision)

function stripThinkingTags(text) {
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/<think>[\s\S]*/gi, '');
    return text.trim();
}

async function callGeminiOCR(messages) {
    const body = { messages };
    const response = await fetch(GEMINI_OCR_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
    if (result.choices && result.choices[0] && result.choices[0].message) {
        return stripThinkingTags(result.choices[0].message.content);
    }
    throw new Error("No text found or API error.");
}

async function processOCR(base64Image, stepAlreadyShown = false) {
    if (!stepAlreadyShown) showStep('result-loading');

    simulateProgress(); // Start progress bar

    try {
        // Preprocess Image (Grayscale)
        const processedImage = await preprocessImage(base64Image);

        const fullText = await callGeminiOCR([{
            role: "user",
            content: [
                {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${processedImage}` }
                },
                {
                    type: "text",
                    text: "Extract ALL text from this image exactly as it appears. The document may be in Arabic, English, or both. Output only the raw extracted text, preserving line breaks and layout. Do not add any labels, commentary, or explanation."
                }
            ]
        }]);

        // Free tier delay — Pro users get instant results
        if (window.userTier === 'free' && !window.isTrialActive) {
            updateProgressUI(90);
            if (progressText) progressText.innerText = 'Pro users get instant results ⚡';
            await new Promise(r => setTimeout(r, 3000));
        }
        updateProgressUI(100); // Complete
        clearInterval(progressInterval);

        // Analytics: OCR Generated
        logEvent(analytics, 'ocr_generated', {
            source: currentFileSource,
            duration_ms: Date.now() - ocrStartedAt
        });

        {
            // ── Tier-based scan deduction ──
            const tier = window.userTier || 'free';

            if (tier === 'free' && !window.isTrialActive) {
                // Trial expired or scans exhausted — must upgrade
                quill.setText('');
                quill.clipboard.dangerouslyPasteHTML(0,
                    '<p><strong style="color:#dc2626;">Your free trial has ended.</strong></p>' +
                    '<p><br></p><p>Upgrade to Pro for unlimited scans, AI features, and all export formats:</p>' +
                    '<p><br></p><p><a href="pricing.html" style="color:#2563eb;font-weight:700;">View Plans & Pricing →</a></p>'
                );
                textContent.original = '';
                textContent.refined = '';
                setTimeout(() => showProNudge(), 1000);

            } else if (tier === 'free' && window.isTrialActive) {
                // Active trial: deduct from 10 trial scans
                if (window.freeScansLeft <= 0) {
                    window.isTrialActive = false;
                    document.body.classList.add('free-tier');
                    document.body.classList.remove('trial-active');
                    trackBrevoEvent("free_limit_hit");
                    quill.setText('');
                    quill.clipboard.dangerouslyPasteHTML(0,
                        '<p><strong style="color:#dc2626;">You\'ve used all 10 trial scans.</strong></p>' +
                        '<p><br></p><p>Upgrade to Pro for unlimited scans and all features:</p>' +
                        '<p><br></p><p><a href="pricing.html" style="color:#2563eb;font-weight:700;">View Plans & Pricing →</a></p>'
                    );
                    textContent.original = '';
                    textContent.refined = '';
                    setTimeout(() => showProNudge(), 1000);
                } else {
                    quill.setText(fullText);
                    applyContentDirection(fullText);
                    textContent.original = fullText;
                    textContent.refined = '';

                    if (auth.currentUser) {
                        const remaining = await useOneFreeScan(auth.currentUser.uid);
                        window.freeScansLeft = remaining;

                        const countEl = document.getElementById('free-scans-count');
                        if (countEl) countEl.textContent = remaining;

                        const statusDisplay = document.getElementById('user-status-display');
                        if (statusDisplay) statusDisplay.textContent = `Trial · ${remaining} scans`;

                        if (remaining === 0) {
                            trackBrevoEvent("free_limit_hit");
                            setTimeout(() => showToast('That was your last trial scan. Upgrade for unlimited!', 'warning', 5000), 500);
                        } else if (remaining === 5) {
                            setTimeout(() => showToast('5 trial scans remaining. Upgrade for unlimited scanning.', 'info', 5000), 1000);
                        } else if (remaining === 2) {
                            setTimeout(() => showToast('Only 2 trial scans left! Upgrade now.', 'warning', 6000), 1000);
                        }
                    }

                    setTimeout(() => showProNudge(), 2000);
                }

            } else if (tier === 'pages') {
                // Pages user: show full result, deduct one page
                quill.setText(fullText);
                applyContentDirection(fullText);
                textContent.original = fullText;
                textContent.refined = '';

                if (auth.currentUser) {
                    const remaining = await useOnePage(auth.currentUser.uid);
                    window.pagesBalance = remaining;

                    const countEl = document.getElementById('pages-balance-count');
                    if (countEl) countEl.textContent = remaining;

                    const statusDisplay = document.getElementById('user-status-display');
                    if (statusDisplay) statusDisplay.textContent = `Pages · ${remaining} remaining`;

                    if (remaining === 0) {
                        trackBrevoEvent("low_balance", { balance: 0 });
                        window.userTier = 'free';
                        window.isProUser = false;
                        window.isPagesUser = false;
                        localStorage.setItem('isPro', 'false');
                        // Fall back to free tier
                        window.freeScansLeft = await getFreeScansRemaining(auth.currentUser.uid);
                        setTimeout(() => showToast('You\'ve used all your purchased pages. Purchase more or upgrade to Pro for unlimited.', 'warning', 5000), 500);
                    } else if (remaining < 5) {
                        trackBrevoEvent("low_balance", { balance: remaining });
                    }
                }

            } else {
                // Pro user: unlimited, no deduction
                quill.setText(fullText);
                applyContentDirection(fullText);
                textContent.original = fullText;
                textContent.refined = '';
            }

            // Track scan completion for Brevo (activity tracking for inactivity detection)
            trackBrevoEvent("scan_complete");

            // Calculate word count from extracted text
            const totalWords = fullText.trim().split(/\s+/).filter(w => w.length > 0).length;

            // Update Stats UI
            if (statsBar) {
                statsBar.classList.remove('hidden');
                if (statWords) statWords.textContent = totalWords;
                if (statPrecision) statPrecision.textContent = "N/A";
            }

            // Save to History
            try {
                saveToHistory({
                    id: Date.now().toString(),
                    date: new Date().toISOString(),
                    filename: filenameDisplay.textContent || 'Scanned Document',
                    imageSrc: sourceImage.src,
                    text: fullText,
                    stats: { words: totalWords, confidence: 0 }
                });
            } catch (historyError) {
                console.warn("Could not save to history (likely storage limit):", historyError);
            }

            showStep('result');
            // Auto-detect document type and show smart suggestion
            if (typeof showSmartSuggestion === 'function') {
                showSmartSuggestion(fullText);
            }
        }
    } catch (error) {
        console.error("OCR Error", error);
        showToast(`Error: ${error.message || "Unknown error occurred"}`, 'error', 5000);
        showStep('upload');
        clearInterval(progressInterval);
    }
}

// Progress Bar Logic
let progressInterval;
function simulateProgress() {
    let progress = 0;
    updateProgressUI(0);
    clearInterval(progressInterval);

    progressInterval = setInterval(() => {
        if (progress < 90) {
            progress += Math.floor(Math.random() * 5) + 1;
            updateProgressUI(progress);
        }
    }, 300);
}

function updateProgressUI(percent) {
    // Update Processing Step (Step 2)
    if (progressBar) progressBar.style.width = percent + '%';
    if (progressText) progressText.innerText = percent + '%';

    // Update Result Step (Step 3) - kept for consistency
    if (progressBarResult) progressBarResult.style.width = percent + '%';
    if (progressTextResult) progressTextResult.innerText = percent + '%';
}

// Text State Management (Moved to top to avoid hoisting issues)
// let textContent... (Already moved to top)

// Event Listeners
// Re-hide the content-dependent tabs (no result yet for the new/cleared document)
function hideResultTabs() {
    [tabRefine, tabSummary, tabTranslation].forEach(tab => {
        if (tab) {
            tab.disabled = true;
            tab.classList.add('hidden');
        }
    });
    // Also hide tables tab
    if (typeof tabTables !== 'undefined' && tabTables) {
        tabTables.disabled = true;
        tabTables.classList.add('hidden');
    }
    // Hide smart suggestion banner
    const smartSuggestion = document.getElementById('smart-suggestion');
    if (smartSuggestion) smartSuggestion.classList.remove('show');
}

if (btnBack) {
    btnBack.addEventListener('click', () => {
        fileInput.value = '';
        sourceImage.src = '';
        quill.setText('');
        textContent = { original: '', refined: '', summary: '', translation: '' }; // Reset State
        hideResultTabs();
        // Reset chat state
        if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.innerHTML = '';
        // Disable split view if active
        if (typeof disableSplitView === 'function' && splitViewActive) disableSplitView();
        showStep('upload');
    });
}

if (btnNewScan) {
    btnNewScan.addEventListener('click', () => {
        fileInput.value = '';
        sourceImage.src = '';
        quill.setText('');
        textContent = { original: '', refined: '', summary: '', translation: '' }; // Reset State
        hideResultTabs();
        // Reset chat state
        if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
        const chatMessages2 = document.getElementById('chat-messages');
        if (chatMessages2) chatMessages2.innerHTML = '';
        // Disable split view if active
        if (typeof disableSplitView === 'function' && splitViewActive) disableSplitView();
        showStep('upload');
    });
}


// Alignment buttons removed in favor of Quill functionality

if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        await logoutUser();
        window.location.href = 'index.html';
    });
}

// Header Logout Button
const btnLogoutHeader = document.getElementById('logout-btn-header');
const btnLogoutSidebar = document.getElementById('logout-btn-sidebar');

async function handleLogout() {
    console.log("Logging out...");
    const result = await logoutUser();
    if (result.success) {
        window.location.href = 'index.html';
    } else {
        console.error("Logout failed", result.error);
        // Fallback redirect anyway if needed, or alert
        window.location.href = 'index.html';
    }
}

if (btnLogoutHeader) {
    btnLogoutHeader.addEventListener('click', handleLogout);
}

if (btnLogoutSidebar) {
    btnLogoutSidebar.addEventListener('click', handleLogout);
}

if (btnCopy) {
    btnCopy.addEventListener('click', () => {
        const textToCopy = quill.getText();
        navigator.clipboard.writeText(textToCopy).then(() => {
            logEvent(analytics, 'result_copy');
            const originalIcon = btnCopy.innerHTML;
            btnCopy.innerHTML = '<i class="fas fa-check text-green-600"></i>';
            setTimeout(() => btnCopy.innerHTML = originalIcon, 2000);
        });

    });
}

if (btnDownload) {
    btnDownload.addEventListener('click', () => {
        const textToSave = quill.getText();
        if (!textToSave || textToSave.trim().length === 0) {
            showToast("No text to download.", 'warning');
            return;
        }
        logEvent(analytics, 'result_download');
        const blob = new Blob([textToSave], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "result.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    });
}

if (btnPrint) {
    btnPrint.addEventListener('click', () => {
        const textToPrint = quill.root.innerHTML;
        if (!quill.getText().trim().length) {
            showToast("No text to print.", 'warning');
            return;
        }

        logEvent(analytics, 'result_print');
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Print Document</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
                        * { direction: rtl; } /* Quick support for Arabic reading */
                    </style>
                </head>
                <body>
                    ${textToPrint}
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();

    });
}

if (btnCopyFloating) {
    btnCopyFloating.addEventListener('click', () => {
        const textToCopy = quill.getText();
        navigator.clipboard.writeText(textToCopy).then(() => {
            // success
        });

        // feedback
        const originalContent = btnCopyFloating.innerHTML;
        btnCopyFloating.innerHTML = '<i class="fas fa-check"></i> <span>Copied!</span>';
        btnCopyFloating.classList.add('bg-green-50', 'text-green-600', 'border-green-200');
        btnCopyFloating.classList.remove('bg-white/90', 'text-blue-600');

        setTimeout(() => {
            btnCopyFloating.innerHTML = originalContent;
            btnCopyFloating.classList.remove('bg-green-50', 'text-green-600', 'border-green-200');
            btnCopyFloating.classList.add('bg-white/90', 'text-blue-600');
        }, 2000);
    });
}

// Pricing Modal Logic
const pricingModal = document.getElementById('pricing-modal');
const closePricingBtn = document.getElementById('close-pricing');
const upgradeBtnSidebar = document.getElementById('upgrade-btn-sidebar');
const btnSubscribe = document.getElementById('btn-subscribe');
const planMonthly = document.getElementById('plan-monthly');
const planYearly = document.getElementById('plan-yearly');
const manageSubBtnSidebar = document.getElementById('manage-sub-btn-sidebar');

let selectedPlan = 'yearly'; // Default

function openPricing() {
    window.location.href = 'pricing.html';
}

function closePricing() {
    if (pricingModal) pricingModal.classList.add('hidden');
}

// Plan Selection UI
if (planMonthly && planYearly) {
    planMonthly.addEventListener('click', () => selectPlan('monthly'));
    planYearly.addEventListener('click', () => selectPlan('yearly'));
}

function selectPlan(plan) {
    selectedPlan = plan;
    if (plan === 'monthly') {
        if (planMonthly) {
            planMonthly.classList.add('border-blue-600', 'bg-blue-50');
            planMonthly.classList.remove('border-gray-200');
            planMonthly.querySelector('.hidden').classList.remove('hidden'); // Show radio
        }
        if (planYearly) {
            planYearly.classList.remove('border-blue-600', 'bg-blue-50');
            planYearly.classList.add('border-gray-200');
            planYearly.querySelector('.bg-blue-600').parentElement.classList.replace('border-blue-600', 'border-gray-300');
            planYearly.querySelector('.bg-blue-600').classList.add('hidden');
        }
    } else {
        if (planYearly) {
            planYearly.classList.add('border-blue-600', 'bg-blue-50');
            planYearly.classList.remove('border-gray-200');
            planYearly.querySelector('.border-gray-300').classList.replace('border-gray-300', 'border-blue-600');
            planYearly.querySelector('.rounded-full.bg-blue-600').classList.remove('hidden');
        }
        if (planMonthly) {
            planMonthly.classList.remove('border-blue-600', 'bg-blue-50');
            planMonthly.classList.add('border-gray-200');
            planMonthly.querySelector('.bg-blue-600').classList.add('hidden');
        }
    }
}

// Paddle Integration
// (Paddle script is loaded in HTML)

if (btnSubscribe) {
    btnSubscribe.addEventListener('click', async () => {
        console.log("Upgrade button clicked. Plan:", selectedPlan);

        try {
            await checkout(selectedPlan);
        } catch (err) {
            console.error("Checkout failed:", err);
            showToast("Checkout Error: " + err.message, 'error');
        }
    });
}

if (manageSubBtnSidebar) {
    manageSubBtnSidebar.addEventListener('click', () => { window.location.href = 'pricing.html'; });
    manageSubBtnSidebar.classList.remove('hidden');
}

if (manageSubLinkSidebar) {
    manageSubLinkSidebar.addEventListener('click', (e) => {
        // e.preventDefault(); // Default behavior (navigation) is now desired
        if (!window.isProUser) {
            e.preventDefault();
            openPricing(); // Redirect free users to pricing instead of subscription page
        }
    });
}

if (upgradeBtnSidebar) upgradeBtnSidebar.addEventListener('click', openPricing);
if (closePricingBtn) closePricingBtn.addEventListener('click', closePricing);

if (pricingModal) {
    pricingModal.addEventListener('click', (e) => {
        if (e.target === pricingModal) closePricing();
    });
}


// Tab Elements
const tabOriginal = document.getElementById('tab-original');
const tabRefine = document.getElementById('tab-refine');
const tabSummary = document.getElementById('tab-summary');
const tabTranslation = document.getElementById('tab-translation');
const tabImageViewer = document.getElementById('tab-image-viewer');


// --- AUTO-CHECKOUT LOGIC (Post-Signup Redirect) ---
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const plan = urlParams.get('plan');

    if (action === 'checkout' && plan) {
        console.log("Auto-checkout triggered from URL params:", plan);
        // Clear params from URL to prevent loop/re-trigger
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl); // Clean URL

        // Wait slightly for auth to settle (though listener handles UI, checkout needs user)
        // We will retry checkout a few times until user is detected or timeout
        // (Since portal loads, auth listener will run. We can just call openPricing and trigger it or call checkout directly)

        // Better: Open Pricing Modal with correct plan selected, then trigger or let user confirm?
        // User asked "get back to checkout screen". So let's open the modal and ideally trigger it.
        // But trigger implies immediate popup. Let's open modal and maybe click the button for them?

        // Let's rely on auth.onAuthStateChanged to ensure user is set before calling checkout
        // We can set a flag
        window.pendingCheckoutPlan = plan;
    }
});

// Hook into Auth State for Pending Checkout
auth.onAuthStateChanged((user) => {
    if (user && window.pendingCheckoutPlan) {
        console.log("User authenticated. Executing pending checkout for:", window.pendingCheckoutPlan);
        const plan = window.pendingCheckoutPlan;
        window.pendingCheckoutPlan = null; // Clear it

        // Open pricing modal and select plan so UI is consistent
        openPricing();
        selectPlan(plan);

        // Trigger checkout immediately
        checkout(plan).catch(err => console.error(err));
    }
});

// Helper to switch tabs
function switchTab(type) {
    console.log(`Switching tab to: ${type}`);
    // console.log("Current textContent:", textContent); // Verbose

    // Reset styles
    [tabOriginal, tabRefine, tabSummary, tabTranslation, tabTables, tabImageViewer].forEach(tab => {
        if (tab) {
            tab.classList.remove('border-b-2', 'border-blue-600', 'text-blue-600');
            tab.classList.add('text-gray-500');
        }
    });

    // Active style
    let activeTab;
    if (type === 'original') activeTab = tabOriginal;
    else if (type === 'refine') activeTab = tabRefine;
    else if (type === 'summary') activeTab = tabSummary;
    else if (type === 'translation') activeTab = tabTranslation;
    else if (type === 'tables') activeTab = tabTables;
    else if (type === 'image') activeTab = tabImageViewer;

    if (activeTab) {
        activeTab.classList.remove('text-gray-500');
        activeTab.classList.add('border-b-2', 'border-blue-600', 'text-blue-600');
    }

    // Hide all content views
    if (imageViewerContainer) imageViewerContainer.classList.add('hidden');
    if (tablesViewerContainer) tablesViewerContainer.classList.add('hidden');

    // Toggle Content Views
    if (type === 'image') {
        if (editorContainer) editorContainer.classList.add('hidden');
        if (imageViewerContainer) imageViewerContainer.classList.remove('hidden');

        if (sourceImage && resultSourceImage && (!resultSourceImage.src || resultSourceImage.src === window.location.href)) {
            resultSourceImage.src = sourceImage.src;
        }

    } else if (type === 'tables') {
        if (editorContainer) editorContainer.classList.add('hidden');
        if (tablesViewerContainer) tablesViewerContainer.classList.remove('hidden');

    } else {
        if (editorContainer) editorContainer.classList.remove('hidden');

        // Set Editor Text
        if (type === 'original') {
            if (!textContent.original) console.warn("Original text is empty!");
            quill.setText(textContent.original || "");
            applyContentDirection(textContent.original);
        }
        if (type === 'refine') {
            quill.setText('');
            quill.clipboard.dangerouslyPasteHTML(0, textContent.refined || "");
            applyContentDirection(textContent.refined);
        }
        if (type === 'summary') {
            quill.setText('');
            quill.clipboard.dangerouslyPasteHTML(0, textContent.summary || "");
            applyContentDirection(textContent.summary);
        }
        if (type === 'translation') {
            quill.setText('');
            quill.clipboard.dangerouslyPasteHTML(0, textContent.translation || "");
            applyContentDirection(textContent.translation);
        }
    }
}

// Tab Click Listeners (Robust)
if (tabOriginal) {
    tabOriginal.onclick = (e) => {
        e.preventDefault();
        switchTab('original');
    };
}
if (tabRefine) {
    tabRefine.onclick = (e) => {
        e.preventDefault();
        if (tabRefine.disabled) return;
        switchTab('refine');
    };
}
if (tabSummary) {
    tabSummary.onclick = (e) => {
        e.preventDefault();
        switchTab('summary');
    };
}
if (tabTranslation) {
    tabTranslation.onclick = (e) => {
        e.preventDefault();
        switchTab('translation');
    };
}
if (tabImageViewer) {
    tabImageViewer.onclick = (e) => {
        e.preventDefault();
        switchTab('image');
    };
}
if (typeof tabTables !== 'undefined' && tabTables) {
    tabTables.onclick = (e) => {
        e.preventDefault();
        if (tabTables.disabled) return;
        switchTab('tables');
    };
}


// Gemini Configuration
const PROXY_URL = "https://arabicocr.zczvwz6pw7.workers.dev";

async function callGemini(messages) {
    try {
        const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: messages
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "API Request Failed");
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("Gemini Error:", error);
        throw error;
    }
}

// AI Refine Logic
const REFINE_SYSTEM_PROMPT_AR = `أنت خبير في تنسيق وثائق النصوص المستخرجة بتقنية OCR. مهمتك إعادة تنسيق النص الخام ليبدو كوثيقة احترافية منظمة.

قواعد التنسيق:
- استخدم HTML بسيط فقط: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br>
- العناوين الرئيسية → <h1> (عنوان واحد فقط للوثيقة إن وُجد)
- العناوين الفرعية → <h2> أو <h3> حسب المستوى
- كل فكرة أو مقطع مستقل → <p> منفصلة
- القوائم والبنود → <ul> أو <ol> مع <li>
- الكلمات المهمة أو المصطلحات → <strong>
- افصل بين الفقرات والأقسام بشكل واضح
- حافظ على كل كلمة من النص الأصلي دون حذف أو تعديل
- لا تضف أي شرح أو تعليق خارج HTML
- أعد HTML فقط، بدون \`\`\`html أو أي علامات إضافية`;

const REFINE_SYSTEM_PROMPT_EN = `You are an expert at formatting raw OCR-extracted text into clean, professional documents.

Formatting rules:
- Use simple HTML only: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br>
- Main document title → <h1> (only one, if clearly present)
- Section headings → <h2>, subsection headings → <h3>
- Each distinct idea, paragraph or block of text → its own <p>
- Lists, items, bullet points → <ul> or <ol> with <li>
- Key terms, labels, or important phrases → <strong>
- Separate sections clearly with proper heading hierarchy
- Preserve every single word from the original — do not add, remove or rephrase anything
- Return only the HTML output, no explanation, no markdown fences, no commentary`;

if (btnRefine) {
    btnRefine.addEventListener('click', async () => {
        if (isFeatureLocked()) { showPricingModal(); return; }
        const textToRefine = textContent.original || quill.getText().trim();
        if (!textToRefine || textToRefine.length < 10) return showToast("Please extract text first.", 'warning');

        logEvent(analytics, 'ai_refine_start');

        const originalLabel = btnRefine.innerHTML;
        btnRefine.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refining...';
        btnRefine.disabled = true;

        try {
            const isArabic = ARABIC_SCRIPT_PATTERN.test(textToRefine);
            const systemPrompt = (typeof window._getRefinePrompt === 'function')
                ? window._getRefinePrompt(isArabic)
                : (isArabic ? REFINE_SYSTEM_PROMPT_AR : REFINE_SYSTEM_PROMPT_EN);
            const refined = await callGemini([
                { role: "system", content: systemPrompt },
                { role: "user", content: textToRefine.slice(0, 6000) }
            ]);

            textContent.refined = refined;
            if (!textContent.original) textContent.original = textToRefine;

            if (tabRefine) {
                tabRefine.disabled = false;
                tabRefine.classList.remove('opacity-50', 'cursor-not-allowed', 'hidden');
            }
            switchTab('refine');

        } catch (error) {
            console.error("Refine error:", error);
            showToast("AI Refine failed: " + error.message, 'error');
        } finally {
            btnRefine.innerHTML = originalLabel;
            btnRefine.disabled = false;
        }
    });
}

// Convert simple Markdown (bold, italic, headings, bullets) to HTML for Quill
function markdownToQuillHtml(md) {
    if (!md) return '';
    let html = md
        // Escape raw HTML entities first to avoid double-processing
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Headings: ## Heading → <h2>
        .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
        // Bold: **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        // Italic: *text* or _text_
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        // Bullet list items: "- item" → <li>
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        // Wrap consecutive <li> blocks in <ul>
        .replace(/(<li>.*<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`)
        // Paragraphs: blank lines → <p> breaks
        .replace(/\n{2,}/g, '</p><p>')
        // Line breaks within a paragraph
        .replace(/\n/g, '<br>');
    return `<p>${html}</p>`;
}

// Summarize Logic
btnSummarize.addEventListener('click', async () => {
    if (isFeatureLocked()) { showPricingModal(); return; }
    // Ensure we have original text
    if (!textContent.original && quill.getText().trim().length > 0) textContent.original = quill.getText();
    const textToProcess = textContent.original || quill.getText();

    if (!textToProcess || textToProcess.length < 10) return showToast("Please extract text first.", 'warning');

    const originalLabel = btnSummarize.innerHTML;
    btnSummarize.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Summarizing...';
    btnSummarize.disabled = true;

    try {
        const systemPrompt = "You are a helpful assistant. Detect the input language and respond in the same language. Identify the topic, then summarize it clearly using simple Markdown: use **text** to bold the title and key terms, and put each key point on its own line starting with \"- \". Do not use emojis. Return only the summary, with no explanation.";
        const summaryMarkdown = await callGemini([
            { role: "system", content: systemPrompt },
            { role: "user", content: textToProcess }
        ]);

        let summaryHtml = markdownToQuillHtml(summaryMarkdown);

        textContent.summary = summaryHtml;
        logEvent(analytics, 'ai_summarize_complete');

        // Enable tab and switch
        tabSummary.disabled = false;
        tabSummary.classList.remove('opacity-50', 'cursor-not-allowed', 'hidden');
        switchTab('summary');

    } catch (error) {
        console.error(error);
        showToast("Summarization failed: " + error.message, 'error');
    } finally {
        btnSummarize.innerHTML = originalLabel;
        btnSummarize.disabled = false;
    }
});


// Translate Logic
// Translate Logic
if (btnTranslate) {
    btnTranslate.addEventListener('click', () => {
        if (isFeatureLocked()) { showPricingModal(); return; }
        // Ensure we have original text
        if (!textContent.original && quill.getText().trim().length > 0) textContent.original = quill.getText();
        const textToProcess = textContent.original || quill.getText();

        if (!textToProcess || textToProcess.length < 10) return showToast("Please extract text first.", 'warning');

        // Open Modal
        if (translationModal) translationModal.classList.remove('hidden');
    });
}

// Translation Modal Actions
if (btnCancelTranslation) {
    btnCancelTranslation.addEventListener('click', () => {
        translationModal.classList.add('hidden');
    });
}

if (btnConfirmTranslation) {
    btnConfirmTranslation.addEventListener('click', async () => {
        const targetLang = translationLangSelect.value;
        translationModal.classList.add('hidden');
        await performTranslation(targetLang);
    });
}

async function performTranslation(targetLang) {
    const textToProcess = textContent.original || quill.getText();

    const originalLabel = btnTranslate.innerHTML;
    btnTranslate.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Translating...';
    btnTranslate.disabled = true;

    try {
        const systemPrompt = `You are a professional translator. Translate the user's text into ${targetLang} while preserving tone, meaning, and structure. Separate paragraphs with a blank line. If the source has clear headings or list items, express them in simple Markdown (# for a heading, "- " for a list item). Do not include any explanations, code fences, or commentary — return only the translated text.`;
        const translationMarkdown = await callGemini([
            { role: "system", content: systemPrompt },
            { role: "user", content: textToProcess }
        ]);

        let translationHtml = markdownToQuillHtml(translationMarkdown);

        textContent.translation = translationHtml;
        logEvent(analytics, 'ai_translate_complete', { target_lang: targetLang });

        // Enable tab and switch
        tabTranslation.disabled = false;
        tabTranslation.classList.remove('opacity-50', 'cursor-not-allowed', 'hidden');
        switchTab('translation');

    } catch (error) {
        console.error(error);
        showToast("Translation failed: " + error.message, 'error');
    } finally {
        btnTranslate.innerHTML = originalLabel;
        btnTranslate.disabled = false;
    }
}

// Initial
// Initial
showStep('upload');

// Mobile Menu Toggle Logic
if (btnMobileMenu && sidebar) {
    btnMobileMenu.addEventListener('click', () => {
        sidebar.classList.toggle('hidden');
        sidebar.classList.toggle('fixed');
        sidebar.classList.toggle('inset-0');
        sidebar.classList.toggle('z-50');
        sidebar.classList.toggle('w-full');
    });
}


// History Logic
const STORAGE_KEY = 'arabic_ocr_history';
const historyView = document.getElementById('history-view');
const wizardView = document.getElementById('wizard-view');
const historyGrid = document.getElementById('history-grid');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const linkNewScan = document.getElementById('link-new-scan');
const linkHistory = document.getElementById('link-history');

if (linkHistory) {
    linkHistory.addEventListener('click', (e) => {
        e.preventDefault();
        showHistoryView();
    });
}

if (linkNewScan) {
    linkNewScan.addEventListener('click', (e) => {
        e.preventDefault();
        showWizardView();
    });
}

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all history?')) {
            localStorage.removeItem(STORAGE_KEY);
            renderHistory();
        }
    });
}


function showHistoryView() {
    wizardView.classList.add('hidden');
    historyView.classList.remove('hidden');
    renderHistory();
    logEvent(analytics, 'history_opened');
    // Update Sidebar Active State
    linkNewScan.classList.remove('bg-blue-50', 'text-blue-700');
    linkNewScan.classList.add('text-gray-600', 'hover:bg-gray-50');
    linkHistory.classList.add('bg-blue-50', 'text-blue-700');
    linkHistory.classList.remove('text-gray-600', 'hover:bg-gray-50');
}

function showWizardView() {
    historyView.classList.add('hidden');
    wizardView.classList.remove('hidden');
    // Update Sidebar Active State
    linkHistory.classList.remove('bg-blue-50', 'text-blue-700');
    linkHistory.classList.add('text-gray-600', 'hover:bg-gray-50');
    linkNewScan.classList.add('bg-blue-50', 'text-blue-700');
    linkNewScan.classList.remove('text-gray-600', 'hover:bg-gray-50');
}


function saveToHistory(record) {
    // Record = { id, date, filename, imageSrc, text }
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    history.unshift(record); // Add to top
    // Limit to 20 items
    if (history.length > 20) history.pop();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    historyGrid.innerHTML = '';

    if (history.length === 0) {
        historyGrid.innerHTML = `
            <div class="col-span-full text-center py-12 text-gray-400">
                <i class="fas fa-history text-4xl mb-4"></i>
                <p>No history found.</p>
            </div>
        `;
        return;
    }

    history.forEach(item => {
        const card = document.createElement('div');
        card.className = "bg-white rounded-xl shadow-sm hover:shadow-md transition overflow-hidden border border-gray-100 flex flex-col";

        card.innerHTML = `
            <div class="h-40 overflow-hidden bg-gray-100 relative">
                 <img src="${item.imageSrc}" class="w-full h-full object-cover">
                 <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                    <p class="text-white text-xs font-medium truncate">${item.filename}</p>
                 </div>
            </div>
            <div class="p-4 flex-1 flex flex-col">
                <p class="text-xs text-gray-400 mb-2"><i class="far fa-clock mr-1"></i> ${new Date(item.date).toLocaleString()}</p>
                <p class="text-sm text-gray-600 line-clamp-3 mb-4 flex-1">${item.text.substring(0, 100)}...</p>
                <div class="flex items-center justify-between mt-auto">
                    <button class="text-blue-600 text-sm font-bold hover:text-blue-800" onclick="loadHistoryItem('${item.id}')">
                        Open <i class="fas fa-arrow-right ml-1"></i>
                    </button>
                    <button class="text-gray-400 hover:text-red-500 transition" onclick="deleteHistoryItem('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        historyGrid.appendChild(card);
    });
}

// Global functions for inline onclick handlers
window.loadHistoryItem = function (id) {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const item = history.find(i => i.id === id);
    if (item) {
        sourceImage.src = item.imageSrc;
        quill.setText(item.text);
        filenameDisplay.textContent = item.filename;
        textContent = { original: item.text, refined: '', summary: '', translation: '' };
        hideResultTabs();

        switchTab('original');
        showWizardView();
        // Reset chat for new document
        if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.innerHTML = '';
        showStep('result');
        if (typeof showSmartSuggestion === 'function') {
            showSmartSuggestion(item.text);
        }
    }
};

window.deleteHistoryItem = function (id) {
    if (!confirm('Delete this scan?')) return;
    let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    history = history.filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    renderHistory();
};

// ═══════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════════

const TOAST_ICONS = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle',
    warning: 'fa-exclamation-triangle',
};

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${TOAST_ICONS[type] || TOAST_ICONS.info}"></i><span>${message}</span>`;
    toast.addEventListener('click', () => dismissToast(toast));

    container.appendChild(toast);
    // Trigger reflow then animate in
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

    if (duration > 0) {
        setTimeout(() => dismissToast(toast), duration);
    }
    return toast;
}

function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
}

// Make globally available
window.showToast = showToast;

// ═══════════════════════════════════════════════════════════════════
// CLIPBOARD PASTE-TO-SCAN
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('paste', (e) => {
    // Only handle paste when on the upload step (not inside the Quill editor)
    if (document.activeElement && document.activeElement.closest('.ql-editor')) return;
    if (stepResult && !stepResult.classList.contains('hidden') && document.activeElement?.closest('#editor-container')) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                showToast('Image pasted — scanning...', 'info', 2000);
                handleFile(file);
            }
            return;
        }
    }
});

// ═══════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════

const shortcutsModal = document.getElementById('shortcuts-modal');
const closeShortcutsBtn = document.getElementById('close-shortcuts-modal');

if (closeShortcutsBtn) {
    closeShortcutsBtn.addEventListener('click', () => shortcutsModal.classList.add('hidden'));
}
if (shortcutsModal) {
    shortcutsModal.addEventListener('click', (e) => {
        if (e.target === shortcutsModal) shortcutsModal.classList.add('hidden');
    });
}

function isResultVisible() {
    return stepResult && !stepResult.classList.contains('hidden');
}

document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // ? — Show shortcuts help (only when not typing in an input)
    if (e.key === '?' && !inInput && !mod) {
        e.preventDefault();
        if (shortcutsModal) shortcutsModal.classList.toggle('hidden');
        return;
    }

    // Escape — close modals or go back
    if (e.key === 'Escape') {
        if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
            shortcutsModal.classList.add('hidden');
            return;
        }
        if (exportDropdown && exportDropdown.classList.contains('show')) {
            exportDropdown.classList.remove('show');
            return;
        }
        if (isResultVisible() && btnBack) {
            btnBack.click();
            return;
        }
    }

    if (!mod) return;

    // Ctrl+S — Download/export
    if (e.key === 's' && !shift && isResultVisible()) {
        e.preventDefault();
        toggleExportDropdown();
        return;
    }

    // Ctrl+Shift+C — Copy result
    if (e.key === 'C' && shift && isResultVisible()) {
        e.preventDefault();
        if (btnCopy) btnCopy.click();
        return;
    }

    // Ctrl+Shift+R — AI Refine
    if (e.key === 'R' && shift && isResultVisible()) {
        e.preventDefault();
        if (btnRefine) btnRefine.click();
        return;
    }

    // Ctrl+Shift+S — Summarize
    if (e.key === 'S' && shift && isResultVisible()) {
        e.preventDefault();
        if (btnSummarize) btnSummarize.click();
        return;
    }

    // Ctrl+Shift+T — Translate
    if (e.key === 'T' && shift && isResultVisible()) {
        e.preventDefault();
        if (btnTranslate) btnTranslate.click();
        return;
    }
});

// ═══════════════════════════════════════════════════════════════════
// RICH EXPORT FORMATS (TXT, Markdown, DOCX, PDF)
// ═══════════════════════════════════════════════════════════════════

const exportDropdown = document.getElementById('export-dropdown');

function toggleExportDropdown() {
    if (!exportDropdown) return;
    exportDropdown.classList.toggle('show');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (exportDropdown && !e.target.closest('#btn-download') && !e.target.closest('#export-dropdown')) {
        exportDropdown.classList.remove('show');
    }
});

// Override the download button to toggle dropdown instead of direct download
if (btnDownload) {
    // Remove existing listeners by replacing the node
    const newDownloadBtn = btnDownload.cloneNode(true);
    btnDownload.parentNode.replaceChild(newDownloadBtn, btnDownload);
    newDownloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExportDropdown();
    });
}

// Handle export format selection
if (exportDropdown) {
    exportDropdown.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-format]');
        if (!btn) return;

        const format = btn.dataset.format;
        if (format !== 'txt' && isFeatureLocked()) { showPricingModal(); return; }
        const text = quill.getText().trim();
        const html = quill.root.innerHTML;
        const filename = (filenameDisplay?.textContent || 'result').replace(/\.[^.]+$/, '');

        if (!text) {
            showToast('No text to export.', 'warning');
            exportDropdown.classList.remove('show');
            return;
        }

        logEvent(analytics, 'result_download', { format });
        exportDropdown.classList.remove('show');

        try {
            switch (format) {
                case 'txt':
                    let exportText = text;
                    if (window.userTier === 'free' && !window.isTrialActive) {
                        exportText += '\n\n--- Exported with Arabic OCR (Free) | arabic-ocr.com ---';
                    }
                    downloadBlob(new Blob([exportText], { type: 'text/plain' }), `${filename}.txt`);
                    showToast('Downloaded as TXT', 'success');
                    break;

                case 'md':
                    const md = htmlToMarkdown(html);
                    downloadBlob(new Blob([md], { type: 'text/markdown' }), `${filename}.md`);
                    showToast('Downloaded as Markdown', 'success');
                    break;

                case 'docx':
                    await exportAsDocx(html, text, filename);
                    break;

                case 'pdf':
                    exportAsPdf(html, filename);
                    break;
            }
        } catch (err) {
            showToast(`Export failed: ${err.message}`, 'error');
        }
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// HTML → Markdown converter
function htmlToMarkdown(html) {
    const div = document.createElement('div');
    div.innerHTML = html;

    function convert(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const children = Array.from(node.childNodes).map(convert).join('');
        const tag = node.tagName.toLowerCase();

        switch (tag) {
            case 'h1': return `# ${children.trim()}\n\n`;
            case 'h2': return `## ${children.trim()}\n\n`;
            case 'h3': return `### ${children.trim()}\n\n`;
            case 'p': return `${children.trim()}\n\n`;
            case 'br': return '\n';
            case 'strong': case 'b': return `**${children}**`;
            case 'em': case 'i': return `*${children}*`;
            case 'u': return children;
            case 'li': return `- ${children.trim()}\n`;
            case 'ul': case 'ol': return `${children}\n`;
            case 'div': return `${children}\n`;
            default: return children;
        }
    }

    return convert(div).replace(/\n{3,}/g, '\n\n').trim();
}

// Export as DOCX using docx library (lazy-loaded)
async function exportAsDocx(html, plainText, filename) {
    showToast('Generating DOCX...', 'info', 2000);

    // Lazy-load docx library
    if (!window.docx) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/docx@8.5.0/build/index.umd.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load DOCX library'));
            document.head.appendChild(script);
        });
    }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = window.docx;

    // Parse HTML into docx paragraphs
    const div = document.createElement('div');
    div.innerHTML = html;
    const paragraphs = [];

    const isArabic = ARABIC_SCRIPT_PATTERN.test(plainText);

    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text.trim()) {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text, rightToLeft: isArabic, size: 24 })],
                    bidirectional: isArabic,
                    alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                }));
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName.toLowerCase();
        const text = node.textContent.trim();
        if (!text) return;

        if (tag === 'h1') {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text, bold: true, rightToLeft: isArabic, size: 32 })],
                heading: HeadingLevel.HEADING_1,
                bidirectional: isArabic,
            }));
        } else if (tag === 'h2') {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text, bold: true, rightToLeft: isArabic, size: 28 })],
                heading: HeadingLevel.HEADING_2,
                bidirectional: isArabic,
            }));
        } else if (tag === 'h3') {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text, bold: true, rightToLeft: isArabic, size: 24 })],
                heading: HeadingLevel.HEADING_3,
                bidirectional: isArabic,
            }));
        } else if (tag === 'ul' || tag === 'ol') {
            Array.from(node.children).forEach(li => {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: `• ${li.textContent.trim()}`, rightToLeft: isArabic, size: 24 })],
                    bidirectional: isArabic,
                }));
            });
        } else if (tag === 'p' || tag === 'div') {
            const runs = [];
            node.childNodes.forEach(child => {
                if (child.nodeType === Node.TEXT_NODE) {
                    if (child.textContent.trim()) {
                        runs.push(new TextRun({ text: child.textContent, rightToLeft: isArabic, size: 24 }));
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const childTag = child.tagName.toLowerCase();
                    const childText = child.textContent;
                    if (childText.trim()) {
                        runs.push(new TextRun({
                            text: childText,
                            bold: childTag === 'strong' || childTag === 'b',
                            italics: childTag === 'em' || childTag === 'i',
                            rightToLeft: isArabic,
                            size: 24,
                        }));
                    }
                }
            });
            if (runs.length) {
                paragraphs.push(new Paragraph({
                    children: runs,
                    bidirectional: isArabic,
                    alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                }));
            }
        } else {
            Array.from(node.childNodes).forEach(processNode);
        }
    }

    Array.from(div.childNodes).forEach(processNode);

    if (!paragraphs.length) {
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: plainText, rightToLeft: isArabic, size: 24 })],
            bidirectional: isArabic,
        }));
    }

    const doc = new Document({
        sections: [{ properties: {}, children: paragraphs }],
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${filename}.docx`);
    showToast('Downloaded as DOCX', 'success');
}

// ═══════════════════════════════════════════════════════════════════
// MULTI-PAGE BATCH OCR
// ═══════════════════════════════════════════════════════════════════

let batchPdfDoc = null;
let selectedPages = new Set();

const pdfSelectAll = document.getElementById('pdf-select-all');
const pdfSelectedCount = document.getElementById('pdf-selected-count');
const btnScanSelected = document.getElementById('btn-scan-selected');
const scanSelectedCount = document.getElementById('scan-selected-count');

function updateBatchSelectionUI() {
    const count = selectedPages.size;
    if (pdfSelectedCount) pdfSelectedCount.textContent = count > 0 ? `${count} selected` : '';
    if (scanSelectedCount) scanSelectedCount.textContent = count;
    if (btnScanSelected) {
        if (count > 1) {
            btnScanSelected.classList.remove('hidden');
        } else {
            btnScanSelected.classList.add('hidden');
        }
    }
    // Update checkboxes
    document.querySelectorAll('.pdf-page-checkbox').forEach(cb => {
        const pageNum = parseInt(cb.dataset.page);
        if (selectedPages.has(pageNum)) {
            cb.classList.add('checked');
        } else {
            cb.classList.remove('checked');
        }
    });
}

if (pdfSelectAll) {
    pdfSelectAll.addEventListener('change', () => {
        if (!batchPdfDoc) return;
        if (window.userTier === 'free' && !window.isTrialActive) {
            pdfSelectAll.checked = false;
            showToast('Upgrade to Pro for batch scanning', 'warning', 4000);
            return;
        }
        if (pdfSelectAll.checked) {
            for (let i = 1; i <= batchPdfDoc.numPages; i++) selectedPages.add(i);
        } else {
            selectedPages.clear();
        }
        updateBatchSelectionUI();
    });
}

if (btnScanSelected) {
    btnScanSelected.addEventListener('click', () => {
        if (selectedPages.size < 2 || !batchPdfDoc) return;
        processBatchOCR(batchPdfDoc, Array.from(selectedPages).sort((a, b) => a - b));
    });
}

async function processBatchOCR(pdfDoc, pageNumbers) {
    pdfSelectionModal.classList.add('hidden');
    currentFileSource = 'pdf_page';
    showStep('processing');

    const totalPages = pageNumbers.length;
    let allText = '';
    let processedCount = 0;

    // Update progress display for batch
    updateProgressUI(0);
    if (progressText) progressText.textContent = `Page 0/${totalPages}`;

    try {
        for (const pageNum of pageNumbers) {
            // Update progress text
            if (progressText) progressText.textContent = `Page ${processedCount + 1}/${totalPages}`;
            if (progressBar) progressBar.style.width = `${(processedCount / totalPages) * 90}%`;

            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;

            const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
            const processed = await preprocessImage(base64);

            const pageText = await callGeminiOCR([{
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${processed}` } },
                    { type: "text", text: "Extract ALL text from this image exactly as it appears. The document may be in Arabic, English, or both. Output only the raw extracted text, preserving line breaks and layout. Do not add any labels, commentary, or explanation." }
                ]
            }]);

            allText += (processedCount > 0 ? `\n\n--- Page ${pageNum} ---\n\n` : '') + pageText;
            processedCount++;

            // Set first page as source image
            if (processedCount === 1) {
                const fullUrl = canvas.toDataURL('image/jpeg', 0.9);
                sourceImage.src = fullUrl;
                if (resultSourceImage) resultSourceImage.src = fullUrl;
            }
        }

        updateProgressUI(100);
        filenameDisplay.textContent = `${filenameDisplay.textContent} (${totalPages} pages)`;

        logEvent(analytics, 'ocr_generated', {
            source: 'pdf_batch',
            duration_ms: Date.now() - ocrStartedAt,
            pages: totalPages,
        });

        // Apply text (use same tier deduction logic — deduct totalPages)
        quill.setText(allText);
        applyContentDirection(allText);
        textContent.original = allText;
        textContent.refined = '';

        // Deduct pages based on tier
        const tier = window.userTier || 'free';
        if (tier === 'pages' && auth.currentUser) {
            for (let i = 0; i < totalPages; i++) {
                const remaining = await useOnePage(auth.currentUser.uid);
                window.pagesBalance = remaining;
                if (remaining === 0) {
                    window.userTier = 'free';
                    window.isProUser = false;
                    window.isPagesUser = false;
                    break;
                }
            }
        } else if (tier === 'free' && window.isTrialActive && auth.currentUser) {
            // Trial user: deduct from 10 trial scans
            for (let i = 0; i < totalPages; i++) {
                if (window.freeScansLeft <= 0) break;
                const remaining = await useOneFreeScan(auth.currentUser.uid);
                window.freeScansLeft = remaining;
            }
        }

        const totalWords = allText.trim().split(/\s+/).filter(w => w.length > 0).length;
        if (statsBar) {
            statsBar.classList.remove('hidden');
            if (statWords) statWords.textContent = totalWords;
        }

        try {
            saveToHistory({
                id: Date.now().toString(),
                date: new Date().toISOString(),
                filename: filenameDisplay.textContent || 'Batch Scan',
                imageSrc: sourceImage.src,
                text: allText,
                stats: { words: totalWords, confidence: 0 }
            });
        } catch (e) { console.warn("History save failed:", e); }

        showStep('result');
        showToast(`Batch OCR complete — ${totalPages} pages processed`, 'success');
        if (typeof showSmartSuggestion === 'function') {
            showSmartSuggestion(allText);
        }

    } catch (error) {
        console.error("Batch OCR Error:", error);
        showToast(`Batch OCR failed: ${error.message}`, 'error', 5000);
        showStep('upload');
    }
}

// ═══════════════════════════════════════════════════════════════════
// DOCUMENT Q&A CHAT
// ═══════════════════════════════════════════════════════════════════

const chatCloseBtn = document.getElementById('chat-close-btn');
const chatMessages = document.getElementById('chat-messages');

let chatHistory = [];

if (chatBubbleBtn) {
    chatBubbleBtn.addEventListener('click', () => {
        chatPanel.classList.toggle('show');
        if (chatPanel.classList.contains('show')) {
            chatInput.focus();
        }
    });
}

if (chatCloseBtn) {
    chatCloseBtn.addEventListener('click', () => chatPanel.classList.remove('show'));
}

function appendChatMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}`;
    msg.innerHTML = text.replace(/\n/g, '<br>');
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatQuestion() {
    if (isFeatureLocked()) { showPricingModal(); return; }
    const question = chatInput.value.trim();
    if (!question) return;

    const docText = textContent.original || quill.getText().trim();
    if (!docText) {
        showToast('No document text to query.', 'warning');
        return;
    }

    chatInput.value = '';
    chatSendBtn.disabled = true;
    appendChatMessage('user', question);

    // Add thinking indicator
    const thinkingMsg = document.createElement('div');
    thinkingMsg.className = 'chat-msg assistant';
    thinkingMsg.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Thinking...';
    chatMessages.appendChild(thinkingMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatHistory.push({ role: 'user', content: question });

    try {
        const messages = [
            {
                role: 'system',
                content: `You are a document assistant. The user has scanned a document with OCR. Answer questions about the document content below. Be concise and accurate. If the document is in Arabic, respond in Arabic. If in English, respond in English.\n\n--- DOCUMENT TEXT ---\n${docText.slice(0, 8000)}\n--- END ---`
            },
            ...chatHistory
        ];

        const response = await fetch(GEMINI_OCR_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages })
        });

        const result = await response.json();
        thinkingMsg.remove();

        if (result.choices?.[0]?.message?.content) {
            const answer = stripThinkingTags(result.choices[0].message.content);
            chatHistory.push({ role: 'assistant', content: answer });
            appendChatMessage('assistant', answer);
        } else {
            appendChatMessage('assistant', 'Sorry, I couldn\'t process that question. Please try again.');
        }
    } catch (err) {
        thinkingMsg.remove();
        appendChatMessage('assistant', `Error: ${err.message}`);
    } finally {
        chatSendBtn.disabled = false;
        chatInput.focus();
    }
}

if (chatSendBtn) {
    chatSendBtn.addEventListener('click', sendChatQuestion);
}

if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatQuestion();
        }
    });
}

// Show/hide chat bubble based on whether result is visible
function updateChatBubbleVisibility() {
    if (chatBubbleBtn) {
        if (isResultVisible()) {
            chatBubbleBtn.style.display = 'flex';
        } else {
            chatBubbleBtn.style.display = 'none';
            if (chatPanel) chatPanel.classList.remove('show');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// AI TABLE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

let extractedTablesHtml = '';

if (btnExtractTables) {
    btnExtractTables.addEventListener('click', async () => {
        if (isFeatureLocked()) { showPricingModal(); return; }
        const docText = textContent.original || quill.getText().trim();
        if (!docText || docText.length < 10) {
            return showToast('Please extract text first.', 'warning');
        }

        // Use the source image if available for better table detection
        const imgSrc = sourceImage?.src;
        const hasImage = imgSrc && imgSrc.startsWith('data:');

        resultLoadingOverlay.classList.remove('hidden');

        try {
            logEvent(analytics, 'ai_table_extract_start');

            let result;
            if (hasImage) {
                const base64 = imgSrc.split(',')[1];
                result = await callGeminiOCR([{
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: imgSrc } },
                        { type: "text", text: "Extract ALL tables from this image. Return each table as valid HTML using <table>, <thead>, <tbody>, <tr>, <th>, <td> elements. Preserve the original language (Arabic or English). If there are no tables, respond with exactly: NO_TABLES_FOUND. Do not add any commentary or explanation outside the HTML table tags." }
                    ]
                }]);
            } else {
                result = await callGeminiOCR([{
                    role: "user",
                    content: [{ type: "text", text: `Extract ALL tables from the following text. Return each table as valid HTML using <table>, <thead>, <tbody>, <tr>, <th>, <td> elements. Preserve the original language. If there are no tables, respond with exactly: NO_TABLES_FOUND.\n\n${docText.slice(0, 8000)}` }]
                }]);
            }

            resultLoadingOverlay.classList.add('hidden');

            if (result.includes('NO_TABLES_FOUND') || !result.includes('<table')) {
                showToast('No tables found in this document.', 'info');
                return;
            }

            extractedTablesHtml = result;
            if (tablesContent) tablesContent.innerHTML = result;

            // Show and enable the tab
            if (tabTables) {
                tabTables.classList.remove('hidden');
                tabTables.disabled = false;
            }

            switchTab('tables');
            logEvent(analytics, 'ai_table_extract_complete');
            showToast('Tables extracted successfully!', 'success');

        } catch (error) {
            resultLoadingOverlay.classList.add('hidden');
            showToast('Table extraction failed: ' + error.message, 'error');
        }
    });
}

if (btnCopyCsv) {
    btnCopyCsv.addEventListener('click', () => {
        if (!tablesContent) return;
        const tables = tablesContent.querySelectorAll('table');
        if (!tables.length) {
            showToast('No tables to copy.', 'warning');
            return;
        }

        let csv = '';
        tables.forEach((table, idx) => {
            if (idx > 0) csv += '\n\n';
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                csv += Array.from(cells).map(c => `"${c.textContent.trim().replace(/"/g, '""')}"`).join(',') + '\n';
            });
        });

        navigator.clipboard.writeText(csv).then(() => {
            showToast('Tables copied as CSV!', 'success');
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-DETECT DOCUMENT TYPE + SMART SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════

const smartSuggestion = document.getElementById('smart-suggestion');
const smartSuggestionText = document.getElementById('smart-suggestion-text');
const smartSuggestionAction = document.getElementById('smart-suggestion-action');
const smartSuggestionDismiss = document.getElementById('smart-suggestion-dismiss');

if (smartSuggestionDismiss) {
    smartSuggestionDismiss.addEventListener('click', () => {
        if (smartSuggestion) smartSuggestion.classList.remove('show');
    });
}

function detectDocumentType(text) {
    if (!text || text.length < 20) return null;

    const lower = text.toLowerCase();
    const arabic = ARABIC_SCRIPT_PATTERN.test(text);

    // Table detection
    const hasTableKeywords = /total|المجموع|amount|المبلغ|price|السعر|qty|الكمية|invoice|فاتورة|receipt|إيصال/.test(lower);
    const hasNumberColumns = (text.match(/\d+[\.,]\d{2}/g) || []).length >= 3;
    const hasTabularLayout = (text.match(/\t/g) || []).length >= 4 || (text.match(/\s{3,}/g) || []).length >= 6;

    if (hasTableKeywords && (hasNumberColumns || hasTabularLayout)) {
        return { type: 'invoice', label: arabic ? 'فاتورة / جدول' : 'Invoice / Table', action: 'Extract Tables', handler: () => btnExtractTables?.click() };
    }

    // Letter/contract detection
    const hasLetterKeywords = /dear|عزيزي|subject|الموضوع|sincerely|تحياتي|regarding|بخصوص|contract|عقد|agreement|اتفاقية/.test(lower);
    if (hasLetterKeywords) {
        return { type: 'letter', label: arabic ? 'خطاب / عقد' : 'Letter / Contract', action: 'AI Refine', handler: () => btnRefine?.click() };
    }

    // Handwriting detection (short text, few special chars)
    const lineCount = text.split('\n').filter(l => l.trim()).length;
    if (lineCount <= 10 && text.length < 500) {
        return { type: 'handwritten', label: arabic ? 'نص مكتوب بخط اليد' : 'Handwritten Note', action: 'AI Refine', handler: () => btnRefine?.click() };
    }

    // Long document → suggest summarize
    if (text.length > 1500) {
        return { type: 'document', label: arabic ? 'مستند طويل' : 'Long Document', action: 'Summarize', handler: () => btnSummarize?.click() };
    }

    return null;
}

function showSmartSuggestion(text) {
    const detection = detectDocumentType(text);
    if (!detection || !smartSuggestion || !smartSuggestionText || !smartSuggestionAction) return;

    // Detect language for badge
    const isArabic = ARABIC_SCRIPT_PATTERN.test(text);
    const isEnglish = /[a-zA-Z]{3,}/.test(text);
    let langBadge = '';
    if (isArabic && isEnglish) langBadge = '<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-right:6px;">AR+EN</span>';
    else if (isArabic) langBadge = '<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-right:6px;">AR</span>';
    else if (isEnglish) langBadge = '<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-right:6px;">EN</span>';

    smartSuggestionText.innerHTML = `${langBadge}Detected: <strong>${detection.label}</strong> — try`;
    smartSuggestionAction.textContent = detection.action;
    smartSuggestionAction.onclick = () => {
        detection.handler();
        smartSuggestion.classList.remove('show');
    };
    smartSuggestion.classList.add('show');
}

// Export as PDF via print
function exportAsPdf(html, filename) {
    const isArabic = ARABIC_SCRIPT_PATTERN.test(quill.getText());
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>${filename}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Amiri&family=Inter:wght@400;700&display=swap');
                    body {
                        font-family: ${isArabic ? "'Amiri', serif" : "'Inter', sans-serif"};
                        padding: 40px;
                        line-height: 1.8;
                        direction: ${isArabic ? 'rtl' : 'ltr'};
                        color: #1e293b;
                    }
                    h1 { font-size: 1.6rem; font-weight: 800; margin: 1.2rem 0 0.6rem; border-bottom: 2px solid #2563eb; padding-bottom: 0.4rem; }
                    h2 { font-size: 1.2rem; font-weight: 700; color: #1e3a8a; margin: 1rem 0 0.4rem; }
                    h3 { font-size: 1rem; font-weight: 600; color: #1d4ed8; margin: 0.8rem 0 0.3rem; }
                    p { margin: 0.5rem 0; }
                    li { margin: 0.3rem 0; }
                    strong { font-weight: 700; }
                </style>
            </head>
            <body>${html}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        showToast('PDF print dialog opened', 'success');
    }, 500);
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3.1: SIDE-BY-SIDE SPLIT VIEW
// ═══════════════════════════════════════════════════════════════════

let splitViewActive = false;

function enableSplitView() {
    const editorWrapper = document.querySelector('#step-result .relative.flex-1.flex.flex-col.overflow-hidden');
    if (!editorWrapper || splitViewActive) return;

    splitViewActive = true;
    btnSplitView.classList.add('bg-blue-100', 'text-blue-700');
    btnSplitView.title = 'Exit Split View';

    // Store original classes
    editorWrapper.dataset.originalClass = editorWrapper.className;

    // Create split layout
    editorWrapper.className = 'split-view-container';

    // Image pane
    const imagePane = document.createElement('div');
    imagePane.className = 'split-pane-image';
    imagePane.id = 'split-image-pane';
    const img = document.createElement('img');
    img.src = sourceImage.src;
    img.alt = 'Source document';
    imagePane.appendChild(img);

    // Draggable divider
    const divider = document.createElement('div');
    divider.className = 'split-divider';
    divider.id = 'split-divider';

    // Editor pane — wraps existing children
    const editorPane = document.createElement('div');
    editorPane.className = 'split-pane-editor';
    editorPane.id = 'split-editor-pane';

    // Move existing children into editor pane
    while (editorWrapper.firstChild) {
        editorPane.appendChild(editorWrapper.firstChild);
    }

    editorWrapper.appendChild(imagePane);
    editorWrapper.appendChild(divider);
    editorWrapper.appendChild(editorPane);

    // Hide the Image Viewer tab (redundant in split view)
    if (tabImageViewer) tabImageViewer.classList.add('opacity-50');

    // If currently on image tab, switch to original
    const activeTabEl = document.querySelector('.result-tab.active-tab');
    if (activeTabEl && activeTabEl.id === 'tab-image-viewer') {
        switchTab('original');
    }

    // Draggable divider logic
    let isDragging = false;
    const onMouseDown = (e) => {
        isDragging = true;
        divider.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    };
    const onMouseMove = (e) => {
        if (!isDragging) return;
        const rect = editorWrapper.getBoundingClientRect();
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            const pct = ((e.clientY - rect.top) / rect.height) * 100;
            imagePane.style.flex = `0 0 ${Math.max(20, Math.min(80, pct))}%`;
        } else {
            const pct = ((e.clientX - rect.left) / rect.width) * 100;
            imagePane.style.flex = `0 0 ${Math.max(20, Math.min(80, pct))}%`;
        }
    };
    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        divider.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    divider.addEventListener('mousedown', onMouseDown);
    divider.addEventListener('touchstart', (e) => { onMouseDown(e.touches[0]); });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('touchmove', (e) => { onMouseMove(e.touches[0]); });
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onMouseUp);

    // Store cleanup references
    editorWrapper._splitCleanup = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchend', onMouseUp);
    };
}

function disableSplitView() {
    const editorWrapper = document.querySelector('.split-view-container');
    if (!editorWrapper || !splitViewActive) return;

    splitViewActive = false;
    btnSplitView.classList.remove('bg-blue-100', 'text-blue-700');
    btnSplitView.title = 'Toggle Split View';

    // Clean up event listeners
    if (editorWrapper._splitCleanup) editorWrapper._splitCleanup();

    // Move editor pane children back
    const editorPane = document.getElementById('split-editor-pane');
    const imagePane = document.getElementById('split-image-pane');
    const dividerEl = document.getElementById('split-divider');

    if (editorPane) {
        while (editorPane.firstChild) {
            editorWrapper.appendChild(editorPane.firstChild);
        }
    }

    // Remove split elements
    if (imagePane) imagePane.remove();
    if (dividerEl) dividerEl.remove();
    if (editorPane) editorPane.remove();

    // Restore original classes
    editorWrapper.className = editorWrapper.dataset.originalClass || 'relative flex-1 flex flex-col overflow-hidden';

    // Restore Image Viewer tab
    if (tabImageViewer) tabImageViewer.classList.remove('opacity-50');
}

if (btnSplitView) {
    btnSplitView.addEventListener('click', () => {
        if (!sourceImage.src) return showToast('No image to display', 'warning');
        if (splitViewActive) {
            disableSplitView();
        } else {
            enableSplitView();
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3.2: AI PROMPT TEMPLATE SYSTEM
// ═══════════════════════════════════════════════════════════════════

const TEMPLATE_STORAGE_KEY = 'ocrActiveTemplate';
const CUSTOM_PROMPT_KEY = 'ocrCustomTemplate';

const TEMPLATE_PROMPTS = {
    none: null, // Uses default refine prompt
    legal: {
        en: `You are a legal document specialist formatting OCR-extracted legal text.

Formatting rules:
- Use HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br>
- Identify and bold all party names, dates, case numbers, and legal references
- Use numbered lists (<ol>) for clauses and articles
- Clearly separate preamble, body, and signature sections with headings
- Preserve legal terminology exactly — do not paraphrase
- Format monetary amounts and dates consistently
- Return only HTML, no commentary`,
        ar: `أنت متخصص في تنسيق المستندات القانونية المستخرجة بتقنية OCR.

قواعد التنسيق:
- استخدم HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br>
- حدد وعرّض بالخط العريض جميع أسماء الأطراف والتواريخ وأرقام القضايا والمراجع القانونية
- استخدم القوائم المرقمة (<ol>) للبنود والمواد
- افصل بوضوح بين الديباجة والمتن وقسم التوقيعات بعناوين
- حافظ على المصطلحات القانونية كما هي دون إعادة صياغة
- نسّق المبالغ المالية والتواريخ بشكل موحد
- أعد HTML فقط، بدون تعليقات`
    },
    academic: {
        en: `You are an academic paper formatting specialist for OCR-extracted scholarly text.

Formatting rules:
- Use HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br> <blockquote>
- Main paper title → <h1>, section headings (Abstract, Introduction, etc.) → <h2>
- Use <blockquote> for quoted passages or citations
- Bold author names, journal titles, and key terms
- Use numbered references where detected
- Format mathematical expressions and figures references clearly
- Preserve all citation numbers [1], [2] etc.
- Return only HTML, no commentary`,
        ar: `أنت متخصص في تنسيق الأوراق الأكاديمية المستخرجة بتقنية OCR.

قواعد التنسيق:
- استخدم HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br> <blockquote>
- عنوان البحث → <h1>، عناوين الأقسام (الملخص، المقدمة، إلخ) → <h2>
- استخدم <blockquote> للاقتباسات
- عرّض بالخط العريض أسماء المؤلفين والمجلات والمصطلحات الرئيسية
- حافظ على أرقام المراجع [1]، [2] إلخ
- أعد HTML فقط، بدون تعليقات`
    },
    invoice: {
        en: `You are an invoice/receipt formatting specialist for OCR-extracted financial documents.

Formatting rules:
- Use HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br> <table> <tr> <td> <th>
- Format as a structured invoice: header info, line items, totals
- Use <table> for line items with columns: Description, Qty, Unit Price, Total
- Bold the company name, invoice number, date, and total amount
- Clearly separate: Vendor info, Bill-to, Line items, Subtotal/Tax/Total
- Format currency consistently (keep original currency symbol)
- Return only HTML, no commentary`,
        ar: `أنت متخصص في تنسيق الفواتير والإيصالات المستخرجة بتقنية OCR.

قواعد التنسيق:
- استخدم HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br> <table> <tr> <td> <th>
- نسّق كفاتورة منظمة: معلومات الرأس، البنود، الإجماليات
- استخدم <table> لبنود الفاتورة مع أعمدة: الوصف، الكمية، سعر الوحدة، الإجمالي
- عرّض اسم الشركة ورقم الفاتورة والتاريخ والمبلغ الإجمالي بالخط العريض
- افصل بوضوح: معلومات البائع، العميل، البنود، المجموع/الضريبة/الإجمالي
- أعد HTML فقط، بدون تعليقات`
    },
    handwritten: {
        en: `You are a handwriting OCR specialist. The text was extracted from handwritten notes and may contain errors.

Formatting rules:
- Use HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br>
- Fix obvious OCR errors from handwriting (misread letters, joined words)
- Identify and format: headings, bullet points, numbered lists, underlined text
- If text has arrows or connections, use nested lists to show hierarchy
- Mark uncertain/illegible portions with [?] after the best guess
- Separate distinct sections or note blocks with headings
- Preserve the original structure and intent of the handwritten notes
- Return only HTML, no commentary`,
        ar: `أنت متخصص في OCR للنصوص المكتوبة بخط اليد. النص مستخرج من ملاحظات مكتوبة يدوياً وقد يحتوي على أخطاء.

قواعد التنسيق:
- استخدم HTML: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <br>
- صحح أخطاء OCR الواضحة من الكتابة اليدوية (أحرف مقروءة خطأ، كلمات ملتصقة)
- حدد ونسّق: العناوين، النقاط، القوائم المرقمة، النص المُسطّر
- ضع علامة [؟] بعد أفضل تخمين للأجزاء غير المقروءة
- افصل الأقسام المختلفة بعناوين
- حافظ على البنية الأصلية للملاحظات
- أعد HTML فقط، بدون تعليقات`
    }
};

let activeTemplate = localStorage.getItem(TEMPLATE_STORAGE_KEY) || 'none';
let customTemplatePrompt = localStorage.getItem(CUSTOM_PROMPT_KEY) || '';

const btnTemplatePicker = document.getElementById('btn-template-picker');

function updateTemplateUI() {
    if (!templateDropdown) return;
    templateDropdown.querySelectorAll('button[data-template]').forEach(btn => {
        btn.classList.toggle('active-template', btn.dataset.template === activeTemplate);
    });
    // Update button label
    if (btnTemplatePicker) {
        const label = btnTemplatePicker.querySelector('span');
        if (label) {
            const names = { none: 'Template', legal: 'Legal', academic: 'Academic', invoice: 'Invoice', handwritten: 'Handwritten', custom: 'Custom' };
            label.textContent = names[activeTemplate] || 'Template';
        }
        btnTemplatePicker.classList.toggle('bg-violet-200', activeTemplate !== 'none');
    }
}

function getTemplatePrompt(isArabic) {
    if (activeTemplate === 'none' || !activeTemplate) return null;
    if (activeTemplate === 'custom') return customTemplatePrompt || null;
    const tmpl = TEMPLATE_PROMPTS[activeTemplate];
    if (!tmpl) return null;
    return isArabic ? tmpl.ar : tmpl.en;
}

if (btnTemplatePicker) {
    btnTemplatePicker.addEventListener('click', (e) => {
        if (isFeatureLocked()) { showPricingModal(); return; }
        e.stopPropagation();
        templateDropdown.classList.toggle('show');
    });
}

if (templateDropdown) {
    templateDropdown.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-template]');
        if (!btn) return;

        const tmpl = btn.dataset.template;

        if (tmpl === 'custom') {
            const current = customTemplatePrompt || '';
            const prompt = window.prompt('Enter your custom AI refine prompt:\n\n(This will be used as the system instruction when you click AI Refine)', current);
            if (prompt === null) return; // Cancelled
            customTemplatePrompt = prompt.trim();
            localStorage.setItem(CUSTOM_PROMPT_KEY, customTemplatePrompt);
            if (!customTemplatePrompt) {
                activeTemplate = 'none';
            } else {
                activeTemplate = 'custom';
            }
        } else {
            activeTemplate = tmpl;
        }

        localStorage.setItem(TEMPLATE_STORAGE_KEY, activeTemplate);
        updateTemplateUI();
        templateDropdown.classList.remove('show');
        showToast(activeTemplate === 'none' ? 'Template cleared' : `Template set: ${activeTemplate}`, 'info', 2000);

        // Auto-refine with the new template if there's text
        if (activeTemplate !== 'none' && textContent.original && btnRefine && !btnRefine.disabled) {
            btnRefine.click();
        }
    });
}

// Close template dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (templateDropdown && !templateDropdown.contains(e.target) && e.target !== btnTemplatePicker && !btnTemplatePicker?.contains(e.target)) {
        templateDropdown.classList.remove('show');
    }
});

updateTemplateUI();

// Template-aware refine prompt getter (used by the original btnRefine handler)
// We override the prompt constants dynamically via a getter function
window._getRefinePrompt = function(isArabic) {
    const templatePrompt = getTemplatePrompt(isArabic);
    return templatePrompt || (isArabic ? REFINE_SYSTEM_PROMPT_AR : REFINE_SYSTEM_PROMPT_EN);
};

// ═══════════════════════════════════════════════════════════════════
// PHASE 4.1: OCR COMPARISON / DIFF VIEW
// ═══════════════════════════════════════════════════════════════════

const diffOriginal = document.getElementById('diff-original');
const diffRefined = document.getElementById('diff-refined');
const btnCloseDiff = document.getElementById('btn-close-diff');

// Simple word-level diff algorithm
function computeDiff(oldText, newText) {
    const oldWords = oldText.split(/(\s+)/);
    const newWords = newText.split(/(\s+)/);

    // LCS-based diff for reasonable-length texts
    const m = oldWords.length, n = newWords.length;

    // For very long texts, fall back to simple display
    if (m * n > 500000) {
        return {
            oldHtml: oldText,
            newHtml: newText
        };
    }

    // Build LCS table
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldWords[i - 1] === newWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find diff
    const oldResult = [];
    const newResult = [];
    let i = m, j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
            oldResult.unshift(escapeHtml(oldWords[i - 1]));
            newResult.unshift(escapeHtml(newWords[j - 1]));
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            newResult.unshift(`<span class="diff-add">${escapeHtml(newWords[j - 1])}</span>`);
            j--;
        } else {
            oldResult.unshift(`<span class="diff-remove">${escapeHtml(oldWords[i - 1])}</span>`);
            i--;
        }
    }

    return {
        oldHtml: oldResult.join(''),
        newHtml: newResult.join('')
    };
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showDiffView() {
    const original = textContent.original || '';
    const refined = textContent.refined || '';

    if (!refined) {
        return showToast('Run AI Refine first to compare texts', 'warning');
    }

    // Strip HTML tags for plain text comparison
    const plainOriginal = original.replace(/<[^>]*>/g, '').trim();
    const plainRefined = refined.replace(/<[^>]*>/g, '').trim();

    const diff = computeDiff(plainOriginal, plainRefined);

    if (diffOriginal) diffOriginal.innerHTML = diff.oldHtml;
    if (diffRefined) diffRefined.innerHTML = diff.newHtml;

    // Set direction based on content
    const isArabic = ARABIC_SCRIPT_PATTERN.test(plainOriginal);
    if (diffOriginal) diffOriginal.style.direction = isArabic ? 'rtl' : 'ltr';
    if (diffRefined) diffRefined.style.direction = isArabic ? 'rtl' : 'ltr';

    if (diffViewerContainer) diffViewerContainer.classList.add('show');

    // Hide editor and other viewers
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) editorContainer.style.display = 'none';
    const imageViewer = document.getElementById('image-viewer-container');
    if (imageViewer) imageViewer.classList.add('hidden');
    const tablesViewer = document.getElementById('tables-viewer-container');
    if (tablesViewer) tablesViewer.classList.add('hidden');
}

function hideDiffView() {
    if (diffViewerContainer) diffViewerContainer.classList.remove('show');
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) editorContainer.style.display = '';
}

if (btnDiffView) {
    btnDiffView.addEventListener('click', showDiffView);
}

if (btnCloseDiff) {
    btnCloseDiff.addEventListener('click', hideDiffView);
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 4.2: SHARE DOCUMENT LINK
// ═══════════════════════════════════════════════════════════════════

function compressText(text) {
    // Use base64 encoding of the text for URL sharing
    // For longer texts, truncate to keep URL reasonable
    const maxLen = 4000; // ~5.3KB base64
    const truncated = text.length > maxLen ? text.slice(0, maxLen) + '\n\n[... truncated for sharing]' : text;
    return btoa(unescape(encodeURIComponent(truncated)));
}

function decompressText(encoded) {
    try {
        return decodeURIComponent(escape(atob(encoded)));
    } catch {
        return null;
    }
}

function generateShareLink() {
    const text = textContent.original || quill.getText().trim();
    if (!text || text.length < 5) {
        return showToast('No text to share', 'warning');
    }

    const filename = filenameDisplay?.textContent || 'Document';
    const payload = JSON.stringify({ t: text, f: filename });
    const encoded = compressText(payload);
    const url = `${window.location.origin}${window.location.pathname}?shared=${encoded}`;

    if (shareLinkInput) shareLinkInput.value = url;
    if (shareModal) shareModal.classList.add('show');
}

if (btnShare) {
    btnShare.addEventListener('click', generateShareLink);
}

if (btnCopyShareLink) {
    btnCopyShareLink.addEventListener('click', () => {
        if (shareLinkInput) {
            shareLinkInput.select();
            navigator.clipboard.writeText(shareLinkInput.value).then(() => {
                showToast('Link copied to clipboard!', 'success');
            }).catch(() => {
                document.execCommand('copy');
                showToast('Link copied!', 'success');
            });
        }
    });
}

if (btnCloseShareModal) {
    btnCloseShareModal.addEventListener('click', () => {
        if (shareModal) shareModal.classList.remove('show');
    });
}

// Close share modal on backdrop click
if (shareModal) {
    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) shareModal.classList.remove('show');
    });
}

// Check for shared document on page load
(function checkSharedDocument() {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('shared');
    if (!shared) return;

    const decoded = decompressText(shared);
    if (!decoded) return;

    try {
        const data = JSON.parse(decoded);
        if (!data.t) return;

        // Wait for page to initialize, then load the shared text
        setTimeout(() => {
            textContent = { original: data.t, refined: '', summary: '', translation: '' };
            quill.setText('');
            quill.clipboard.dangerouslyPasteHTML(0, data.t.replace(/\n/g, '<br>'));
            applyContentDirection(data.t);

            if (filenameDisplay) filenameDisplay.textContent = data.f || 'Shared Document';
            switchTab('original');

            // Show wizard and result
            if (typeof showWizardView === 'function') showWizardView();
            showStep('result');
            showToast('Shared document loaded', 'info');

            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
        }, 1000);
    } catch (e) {
        console.warn('Failed to load shared document:', e);
    }
})();
