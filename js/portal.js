import { monitorAuthState, logoutUser } from './auth.js';
import { checkout } from './paddle-payment.js';
import { app, auth, analytics, logEvent, errorReason, errorMessage, fileSizeBucket } from '../firebase-analytics.js';
import { getPagesBalance, useOnePage, getFreeScansRemaining, useOneFreeScan } from './pages-balance.js';


const GEMINI_OCR_PROXY = "https://arabicocr.zczvwz6pw7.workers.dev";

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
            // ── FREE user (10 scans/month) ──
            window.userTier = 'free';
            window.isProUser = false;
            window.isPagesUser = false;
            window.pagesBalance = 0;
            window.freeScansLeft = freeScansLeft;
            localStorage.setItem('isPro', 'false');

            const badge = document.createElement('span');
            badge.className = 'ml-2 bg-gray-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider';
            badge.textContent = 'FREE';
            userEmailDisplay.appendChild(badge);

            if (tierLine) {
                tierLine.innerHTML = `<span class="inline-flex items-center gap-1.5 text-sm text-gray-500 font-medium"><i class="fas fa-bolt text-amber-500 text-xs"></i> <span id="free-scans-count">${freeScansLeft}</span>/10 free scans this month · <a href="pricing.html" class="text-blue-600 hover:underline font-semibold">Upgrade</a></span>`;
            }

            if (statusDisplay) {
                statusDisplay.textContent = `${freeScansLeft}/10 scans`;
                statusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-600 cursor-pointer';
                statusDisplay.onclick = () => { window.location.href = 'pricing.html'; };
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
    fileInput.click();
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-blue-500'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-blue-500'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
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
            alert("Error processing PDF: " + error.message);
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
        alert("Unsupported file type. Please upload Image or PDF.");
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

            pageContainer.appendChild(imgWrapper);
            pageContainer.appendChild(badge);
            pageContainer.appendChild(overlay);

            // Click Handler
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
        alert("Error extracting page: " + error.message);
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

            if (tier === 'free') {
                // Free user: check if they have scans left
                if (window.freeScansLeft <= 0) {
                    quill.setText('');
                    quill.clipboard.dangerouslyPasteHTML(0,
                        '<p><strong style="color:#dc2626;">You\'ve used all 10 free scans this month.</strong></p>' +
                        '<p><br></p><p>Your free scans reset on the 1st of each month, or upgrade now for more:</p>' +
                        '<p><br></p><p><a href="pricing.html" style="color:#2563eb;font-weight:700;">View Plans & Pricing →</a></p>'
                    );
                    textContent.original = '';
                    textContent.refined = '';
                } else {
                    // Show full result, deduct one free scan
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
                        if (statusDisplay) statusDisplay.textContent = `Free · ${remaining}/10 scans`;

                        if (remaining === 0) {
                            setTimeout(() => alert('That was your last free scan this month. Upgrade or come back next month!'), 500);
                        }
                    }
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
                        window.userTier = 'free';
                        window.isProUser = false;
                        window.isPagesUser = false;
                        localStorage.setItem('isPro', 'false');
                        // Fall back to free tier
                        window.freeScansLeft = await getFreeScansRemaining(auth.currentUser.uid);
                        setTimeout(() => alert('You\'ve used all your purchased pages. You now have ' + window.freeScansLeft + ' free scans left this month.'), 500);
                    }
                }

            } else {
                // Pro user: unlimited, no deduction
                quill.setText(fullText);
                applyContentDirection(fullText);
                textContent.original = fullText;
                textContent.refined = '';
            }

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
        }
    } catch (error) {
        console.error("OCR Error", error);
        alert(`Error: ${error.message || "Unknown error occurred"}`);
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
}

if (btnBack) {
    btnBack.addEventListener('click', () => {
        fileInput.value = '';
        sourceImage.src = '';
        quill.setText('');
        textContent = { original: '', refined: '', summary: '', translation: '' }; // Reset State
        hideResultTabs();
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
            alert("No text to download.");
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
            alert("No text to print.");
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
            alert("Checkout Error: " + err.message);
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
    [tabOriginal, tabRefine, tabSummary, tabTranslation, tabImageViewer].forEach(tab => {
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
    else if (type === 'image') activeTab = tabImageViewer;

    if (activeTab) {
        activeTab.classList.remove('text-gray-500');
        activeTab.classList.add('border-b-2', 'border-blue-600', 'text-blue-600');
    }

    // Toggle Content Views
    if (type === 'image') {
        if (editorContainer) editorContainer.classList.add('hidden');
        if (imageViewerContainer) imageViewerContainer.classList.remove('hidden');

        // Sync Image Source if needed (it should be set during OCR process, but let's be safe)
        if (sourceImage && resultSourceImage && (!resultSourceImage.src || resultSourceImage.src === window.location.href)) {
            resultSourceImage.src = sourceImage.src;
        }

    } else {
        if (imageViewerContainer) imageViewerContainer.classList.add('hidden');
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
        const textToRefine = textContent.original || quill.getText().trim();
        if (!textToRefine || textToRefine.length < 10) return alert("Please extract text first.");

        logEvent(analytics, 'ai_refine_start');

        const originalLabel = btnRefine.innerHTML;
        btnRefine.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refining...';
        btnRefine.disabled = true;

        try {
            const isArabic = ARABIC_SCRIPT_PATTERN.test(textToRefine);
            const systemPrompt = isArabic ? REFINE_SYSTEM_PROMPT_AR : REFINE_SYSTEM_PROMPT_EN;
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
            alert("AI Refine failed: " + error.message);
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
    // Ensure we have original text
    if (!textContent.original && quill.getText().trim().length > 0) textContent.original = quill.getText();
    const textToProcess = textContent.original || quill.getText();

    if (!textToProcess || textToProcess.length < 10) return alert("Please extract text first.");

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
        alert("Summarization failed: " + error.message);
    } finally {
        btnSummarize.innerHTML = originalLabel;
        btnSummarize.disabled = false;
    }
});


// Translate Logic
// Translate Logic
if (btnTranslate) {
    btnTranslate.addEventListener('click', () => {
        // Ensure we have original text
        if (!textContent.original && quill.getText().trim().length > 0) textContent.original = quill.getText();
        const textToProcess = textContent.original || quill.getText();

        if (!textToProcess || textToProcess.length < 10) return alert("Please extract text first.");

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
        alert("Translation failed: " + error.message);
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
        showStep('result');
    }
};

window.deleteHistoryItem = function (id) {
    if (!confirm('Delete this scan?')) return;
    let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    history = history.filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    renderHistory();
};
