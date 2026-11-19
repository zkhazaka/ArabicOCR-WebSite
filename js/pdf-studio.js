import { app, auth, analytics, logEvent, errorReason, errorMessage, fileSizeBucket } from '../firebase-analytics.js';

import { monitorAuthState, logoutUser, checkSubscription } from './auth.js';
import { getPagesBalance, useOnePage } from './pages-balance.js';

// PDF Studio Core Logic (Updated: Undo/Redo System)

// Page count of the open document, for analytics params. Safe before a PDF loads.
function currentPageCount() {
    try {
        return pdfDoc ? pdfDoc.getPageCount() : 0;
    } catch (e) {
        return 0;
    }
}

// DOM Elements
const pdfRenderContainer = document.getElementById('pdf-render-container');
const thumbnailSidebar = document.getElementById('thumbnail-sidebar');
const fileInput = document.getElementById('pdf-upload');
const zoomLevelSpan = document.getElementById('zoom-level');
const emptyState = document.getElementById('empty-state');
const saveBtn = document.getElementById('save-btn');
const fileNameDisplay = document.getElementById('file-name-display');

// Auth UI Elements
const userProfileContainer = document.getElementById('user-profile-container');
const userMenuBtn = document.getElementById('user-menu-btn');
const userMenuDropdown = document.getElementById('user-menu-dropdown');
const userAvatar = document.getElementById('user-avatar');
const userEmail = document.getElementById('user-email');
const loginBtnHeader = document.getElementById('login-btn-header');
const logoutBtnHeader = document.getElementById('logout-btn-header');

const userStatusDisplay = document.getElementById('user-status-display');
const subscribeBtnSidebar = document.getElementById('subscribe-btn-sidebar');
const manageSubBtnSidebar = document.getElementById('manage-sub-btn-sidebar');

// Pricing Modal Elements
const pricingModal = document.getElementById('pricing-modal');
const closePricingBtn = document.getElementById('close-pricing');
const btnSubscribe = document.getElementById('btn-subscribe');
const planMonthly = document.getElementById('plan-monthly');
const planYearly = document.getElementById('plan-yearly');

// Global State
let pdfDoc = null;
let pdfBytes = null;
let currentScale = 1.0;
let currentPageIndex = 0;
let isDrawingMode = false;
let isDrawing = false;
let currentPath = [];
let drawingColor = { r: 59, g: 130, b: 246 };
let activeCanvas = null;
let rotationState = {};
let pinList = [];
let currentViewMode = 'single'; // 'single' or 'double'

// Subscription State
window.isProUser = false;
let selectedPlan = 'yearly';

// History State
let historyStack = [];
let redoStack = [];
let allDrawings = []; // Stores { id, pageIndex, path, width, color, opacity, type: 'drawing' }

// Tool State
let activeTool = null;
let brushSize = 2;
let brushOpacity = 1.0;
let defaultFontSize = 20;

// Selection & Clipboard
let selectionStart = null;
let currentFreeSelectionPath = null;
let currentSelection = null;
let clipboard = null;
let floatingItems = [];
let selectedFloatingItem = null;
let selectionOverlay = null;

// Interaction State for Undo
let interactionStartItemState = null;

const COLORS = [
    { name: 'Red', rgb: { r: 239, g: 68, b: 68 }, hex: '#ef4444' },
    { name: 'Blue', rgb: { r: 59, g: 130, b: 246 }, hex: '#3b82f6' },
    { name: 'Green', rgb: { r: 34, g: 197, b: 94 }, hex: '#22c55e' },
    { name: 'Yellow', rgb: { r: 234, g: 179, b: 8 }, hex: '#eab308' },
    { name: 'Orange', rgb: { r: 249, g: 115, b: 22 }, hex: '#f97316' },
    { name: 'Purple', rgb: { r: 168, g: 85, b: 247 }, hex: '#a855f7' },
    { name: 'Black', rgb: { r: 0, g: 0, b: 0 }, hex: '#000000' },
    { name: 'White', rgb: { r: 255, g: 255, b: 255 }, hex: '#ffffff' },
    { name: 'Gray', rgb: { r: 107, g: 114, b: 128 }, hex: '#6b7280' },
    { name: 'Pink', rgb: { r: 236, g: 72, b: 153 }, hex: '#ec4899' },
    { name: 'Indigo', rgb: { r: 99, g: 102, b: 241 }, hex: '#6366f1' },
    { name: 'Cyan', rgb: { r: 6, g: 182, b: 212 }, hex: '#06b6d4' }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {

    // --- AUTHENTICATION & BALANCE LOGIC ---
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("PDF Studio: User logged in:", user.email);

            // UI: Logged In State
            if (loginBtnHeader) loginBtnHeader.classList.add('hidden');
            if (userProfileContainer) userProfileContainer.classList.remove('hidden');
            if (userEmail) userEmail.textContent = user.email;
            if (userAvatar) userAvatar.textContent = user.email.charAt(0).toUpperCase();

            // Load OCR pages balance + subscription status
            const [pagesBalance, subStatus] = await Promise.all([
                getPagesBalance(user.uid),
                checkSubscription(user.email),
            ]);

            window.pagesBalance = pagesBalance;
            window.isProUser = subStatus.isPro === true;
            window.isPagesUser = !window.isProUser && pagesBalance > 0;
            localStorage.setItem('isPro', window.isProUser ? 'true' : 'false');

            if (window.isProUser) {
                if (userStatusDisplay) {
                    userStatusDisplay.textContent = 'Pro';
                    userStatusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-green-100 text-green-700';
                    userStatusDisplay.onclick = null;
                }
            } else if (pagesBalance > 0) {
                if (userStatusDisplay) {
                    userStatusDisplay.textContent = `${pagesBalance} pages remaining`;
                    userStatusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 text-purple-700';
                    userStatusDisplay.onclick = null;
                }
            } else {
                if (userStatusDisplay) {
                    userStatusDisplay.textContent = 'No pages — Buy a pack';
                    userStatusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-100 text-red-600 cursor-pointer';
                    userStatusDisplay.onclick = () => { window.location.href = 'pricing.html'; };
                }
            }
            if (subscribeBtnSidebar) subscribeBtnSidebar.classList.add('hidden');
            if (manageSubBtnSidebar) manageSubBtnSidebar.classList.add('hidden');

        } else {
            console.log("PDF Studio: No user (Guest Mode)");
            window.isProUser = false;
            window.isPagesUser = false;
            window.pagesBalance = 0;
            localStorage.setItem('isPro', 'false');

            // UI: Logged Out State
            if (loginBtnHeader) loginBtnHeader.classList.remove('hidden');
            if (userProfileContainer) userProfileContainer.classList.add('hidden');

            // Sidebar UI: Guest
            if (userStatusDisplay) {
                userStatusDisplay.textContent = 'Guest';
                userStatusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-500';
            }
            if (subscribeBtnSidebar) subscribeBtnSidebar.classList.add('hidden');
            if (manageSubBtnSidebar) manageSubBtnSidebar.classList.add('hidden');
        }
    });

    // --- AUTH ACTIONS ---
    if (logoutBtnHeader) {
        logoutBtnHeader.addEventListener('click', async () => {
            await logoutUser();
            window.location.reload();
        });
    }

    if (userMenuBtn) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userMenuDropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (userMenuDropdown && !userMenuBtn.contains(e.target) && !userMenuDropdown.contains(e.target)) {
                userMenuDropdown.classList.add('hidden');
            }
        });
    }

    // --- PRICING MODAL LOGIC ---
    if (planMonthly && planYearly) {
        planMonthly.addEventListener('click', () => selectPlan('monthly'));
        planYearly.addEventListener('click', () => selectPlan('yearly'));
        // Initial selection UI
        selectPlan('yearly');
    }

    if (closePricingBtn) {
        closePricingBtn.addEventListener('click', closePricing);
    }

    if (btnSubscribe) {
        btnSubscribe.addEventListener('click', () => {
            checkout(selectedPlan, auth.currentUser?.email);
        });
    }

    // Make global for onclick handlers
    window.openPricing = openPricing;
    window.closePricing = closePricing;
    window.manageSubscription = manageSubscription;
    window.selectPlan = selectPlan;
    window.selectTool = selectTool;
    window.deleteFloatingItem = deleteFloatingItem;
    window.duplicateFloatingItem = duplicateFloatingItem;


    if (typeof PDFLib === 'undefined' || typeof pdfjsLib === 'undefined') {
        alert("Critical Error: Libraries failed to load. Please refresh.");
        return;
    }

    if (fileInput) fileInput.addEventListener('change', handleFileUpload);

    document.getElementById('zoom-in')?.addEventListener('click', () => adjustZoom(0.1));
    document.getElementById('zoom-out')?.addEventListener('click', () => adjustZoom(-0.1));
    document.getElementById('view-single')?.addEventListener('click', () => setViewMode('single'));
    document.getElementById('view-double')?.addEventListener('click', () => setViewMode('double'));
    document.getElementById('tool-rotate')?.addEventListener('click', () => {
        rotateCurrentPage();
    });
    document.getElementById('tool-delete')?.addEventListener('click', () => {
        deleteCurrentPage();
    });
    document.getElementById('save-btn')?.addEventListener('click', () => {
        savePDF();
    });
    document.getElementById('tool-extract')?.addEventListener('click', () => {
        extractPageAsImage();
    });
    document.getElementById('tool-compress')?.addEventListener('click', () => {
        compressPDF();
    });

    // --- DARK MODE LOGIC ---
    const toggleBtn = document.getElementById('dark-mode-toggle');
    const body = document.body;

    function updateIcons(isDark) {
        const iconMoon = document.getElementById('icon-moon');
        const iconSun = document.getElementById('icon-sun');
        if (isDark) {
            iconMoon?.classList.add('hidden');
            iconSun?.classList.remove('hidden');
        } else {
            iconMoon?.classList.remove('hidden');
            iconSun?.classList.add('hidden');
        }
    }

    function toggleTheme() {
        body.classList.toggle('dark-mode');
        const isDark = body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateIcons(isDark);
    }

    // Init Theme
    if (localStorage.getItem('theme') === 'dark') {
        body.classList.add('dark-mode');
        updateIcons(true);
    } else {
        updateIcons(false);
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleTheme);
    }

    // Initial UI State: Disabled
    updateUIState(false);

    // Undo/Redo Listeners
    document.getElementById('tool-undo')?.addEventListener('click', undo);
    document.getElementById('tool-redo')?.addEventListener('click', redo);

    // Tool listeners are handled via onclick attributes in HTML to ensure correct parameters (force=true for masks)

    document.getElementById('pdf-merge-upload')?.addEventListener('change', handleMergeUpload);
    document.getElementById('export-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExportMenu();
    });

    // Global Window Click
    window.addEventListener('click', (e) => {
        const exportMenu = document.getElementById('export-menu');
        if (exportMenu && !exportMenu.contains(e.target) && e.target.id !== 'export-btn') {
            exportMenu.classList.remove('show');
        }
        document.getElementById('context-menu').style.display = 'none';

        const overlay = document.getElementById('text-input-overlay');
        const isTool = e.target.closest('#tool-text');
        const isOverlay = e.target.closest('#text-input-overlay');

        if (overlay && !overlay.classList.contains('hidden') && !isTool && !isOverlay) {
            overlay.classList.add('hidden');
        }

        const isFloatingItem = e.target.closest('.floating-wrapper');
        const isToolbar = e.target.closest('.toolbar-container') || e.target.closest('.header-container') || e.target.closest('#thumbnail-sidebar');

        if (selectedFloatingItem && !isFloatingItem && !isToolbar) {
            deselectAllFloatingItems();
        }
    });

    // Color Palette
    const palette = document.getElementById('color-palette');
    if (palette) {
        COLORS.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            if (color.rgb.r === drawingColor.r && color.rgb.g === drawingColor.g && color.rgb.b === drawingColor.b) swatch.classList.add('active');
            swatch.style.backgroundColor = color.hex;
            swatch.onclick = () => {
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                drawingColor = color.rgb;
            };
            palette.appendChild(swatch);
        });
    }

    document.querySelectorAll('.thickness-option').forEach(opt => {
        opt.onclick = () => {
            document.querySelectorAll('.thickness-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            const val = parseInt(opt.getAttribute('data-value'));
            brushSize = val;
            defaultFontSize = 10 + (val * 5);
        };
    });
    document.getElementById('opacity-slider')?.addEventListener('input', (e) => brushOpacity = parseFloat(e.target.value));

    createSelectionBox();

    document.getElementById('ctx-copy')?.addEventListener('click', (e) => { e.stopPropagation(); copySelection(); });
    document.getElementById('ctx-duplicate')?.addEventListener('click', (e) => { e.stopPropagation(); duplicateFloatingItem(); });
    document.getElementById('ctx-delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteFloatingItem(); });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey)) {
            if (e.key === 'z') { e.preventDefault(); undo(); }
            if (e.key === 'y') { e.preventDefault(); redo(); }
            if (e.key === 'c') {
                if (selectionOverlay && selectionOverlay.style.display !== 'none') {
                    e.preventDefault();
                    copySelection();
                }
            }
            if (e.key === 'v') {
                e.preventDefault();
                pasteSelection();
            }
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFloatingItem) {
            e.preventDefault();
            deleteFloatingItem();
        }
    });

    document.getElementById('tool-move')?.addEventListener('click', () => {
        if (pdfDoc && pdfDoc.getPageCount() > 1) {
            alert('Wait update... Drag and drop thumbnails to move pages.');
        } else {
            alert('Need more than 1 page to move.');
        }
    });

    loadPinList();
    updateUndoRedoUI();

    // Action Menu Listeners
    setupActionMenu();

    // Global Selection Listener
    document.addEventListener('selectionchange', handleTextSelection);
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#action-menu')) {
            hideActionMenu();
        }
    });
});

// --- TEXT SELECTION & ACTIONS ---

function handleTextSelection() {
    if (activeTool !== 'select-text') return;

    const selection = window.getSelection();
    if (selection.rangeCount > 0 && !selection.isCollapsed) {
        const text = selection.toString().trim();
        if (text.length > 0) {
            // Show menu near selection
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            showActionMenu(rect.left + (rect.width / 2), rect.bottom + 10, text);
        }
    }
}

function showActionMenu(x, y, text) {
    const menu = document.getElementById('action-menu');
    if (!menu) return;

    // adjust for scroll
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    menu.style.left = `${x + scrollX}px`;
    menu.style.top = `${y + scrollY}px`;
    menu.style.display = 'flex';
    menu.setAttribute('data-text', text);
}

function hideActionMenu() {
    const menu = document.getElementById('action-menu');
    if (menu) {
        menu.style.display = 'none';
        menu.removeAttribute('data-text');
    }
}

function setupActionMenu() {
    document.getElementById('action-translate')?.addEventListener('click', () => {
        const menu = document.getElementById('action-menu');
        const text = menu.getAttribute('data-text');
        if (text) {
            const url = `https://translate.google.com/?sl=auto&text=${encodeURIComponent(text)}`;
            window.open(url, '_blank');
        }
        hideActionMenu();
    });

    document.getElementById('action-ocr')?.addEventListener('click', () => {
        const menu = document.getElementById('action-menu');
        const text = menu.getAttribute('data-text');
        alert(`Selected Text: "${text}"\n\n(Re-OCR or Image OCR features coming soon)`);
        hideActionMenu();
    });

    document.getElementById('action-copy-text')?.addEventListener('click', () => {
        const menu = document.getElementById('action-menu');
        const text = menu.getAttribute('data-text');
        if (text) {
            navigator.clipboard.writeText(text).then(() => {
                // alert('Copied to clipboard'); // optional feedback
            });
        }
        hideActionMenu();
    });
}

// --- HISTORY SYSTEM ---

function pushAction(action) {
    historyStack.push(action);
    redoStack = []; // Clear redo on new action
    updateUndoRedoUI();
}

function undo() {
    if (historyStack.length === 0) return;
    const action = historyStack.pop();
    redoStack.push(action);

    switch (action.type) {
        case 'ADD_FLOATING_ITEM':
            removeExampleItem(action.data);
            break;
        case 'DELETE_FLOATING_ITEM':
            restoreExampleItem(action.data);
            break;
        case 'MODIFY_FLOATING_ITEM':
            applyItemState(action.data.id, action.data.before);
            break;
        case 'ADD_DRAWING':
            removeDrawing(action.data.id);
            break;
    }
    updateUndoRedoUI();
}

function redo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();
    historyStack.push(action);

    switch (action.type) {
        case 'ADD_FLOATING_ITEM':
            restoreExampleItem(action.data);
            break;
        case 'DELETE_FLOATING_ITEM':
            removeExampleItem(action.data);
            break;
        case 'MODIFY_FLOATING_ITEM':
            applyItemState(action.data.id, action.data.after);
            break;
        case 'ADD_DRAWING':
            restoreDrawing(action.data);
            break;
    }
    updateUndoRedoUI();
}

function updateUndoRedoUI() {
    const uBtn = document.getElementById('tool-undo');
    const rBtn = document.getElementById('tool-redo');
    if (uBtn) uBtn.disabled = historyStack.length === 0;
    if (rBtn) rBtn.disabled = redoStack.length === 0;
}

// Helpers for Undo/Redo
function removeExampleItem(itemData) {
    const item = floatingItems.find(i => i.id === itemData.id);
    if (!item) return;
    floatingItems = floatingItems.filter(i => i.id !== itemData.id);
    const el = document.getElementById(itemData.id);
    if (el) el.remove();
    deselectAllFloatingItems();
}

function restoreExampleItem(itemData) {
    floatingItems.push(itemData);
    const container = document.querySelector(`.pdf-page-container[data-page-index="${itemData.pageIndex}"]`);
    if (container) createFloatingItemDOM(itemData, container);
}

function applyItemState(id, state) {
    let item = floatingItems.find(i => i.id === id);
    const el = document.getElementById(id);
    if (item && el) {
        Object.assign(item, state);
        el.style.left = item.x + 'px';
        el.style.top = item.y + 'px';
        el.style.width = item.width + 'px';
        el.style.height = item.height + 'px';
        if (item.rotation !== undefined) el.style.transform = `rotate(${item.rotation}deg)`;

        if (item.type === 'text') {
            const span = el.querySelector('span');
            if (span) span.style.fontSize = item.fontSize + 'px';
        }
    }
}

function removeDrawing(id) {
    allDrawings = allDrawings.filter(d => d.id !== id);
    // Find touched page and redraw
    // Just redraw all drawing layers or find the specific one?
    // Optimization: find PageIndex
    // For now simple:
    document.querySelectorAll('.annotation-layer').forEach(c => {
        const pIndex = c.getAttribute('data-page-index');
        if (pIndex) redrawCanvas(pIndex);
    });
}

function restoreDrawing(drawingData) {
    allDrawings.push(drawingData);
    redrawCanvas(drawingData.pageIndex);
}

function redrawCanvas(pageIndex) {
    const canvas = document.querySelector(`.annotation-layer[data-page-index="${pageIndex}"]`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageDrawings = allDrawings.filter(d => d.pageIndex == pageIndex);
    // Note: Temporary selection dashes are cleared here too
    pageDrawings.forEach(d => {
        ctx.beginPath();
        ctx.lineWidth = d.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = d.opacity;
        if (d.mode === 'multiply') {
            ctx.globalCompositeOperation = 'multiply';
            ctx.strokeStyle = `rgba(${d.color.r},${d.color.g},${d.color.b}, 1)`;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = `rgb(${d.color.r},${d.color.g},${d.color.b})`;
        }
        if (d.path.length > 0) {
            ctx.moveTo(d.path[0].x, d.path[0].y);
            for (let i = 1; i < d.path.length; i++) {
                ctx.lineTo(d.path[i].x, d.path[i].y);
            }
        }
        ctx.stroke();
    });
}
// ----------------

function createSelectionBox() {
    selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'selection-box';
    document.body.appendChild(selectionOverlay);

    // Create Copy Button Dynamically
    let btn = document.getElementById('selection-copy-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'selection-copy-btn';
        btn.className = 'absolute hidden z-50 bg-blue-600 text-white px-3 py-1 rounded shadow-lg text-sm font-bold hover:bg-blue-700 transition transform hover:scale-105';
        btn.innerHTML = '<i class="fas fa-thumbtack mr-2"></i> Pin Selection';
        document.body.appendChild(btn);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToPinList();
    });
}

// --- FILE LOADING ---
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        fileNameDisplay.textContent = file.name;
        if (emptyState) {
            emptyState.innerHTML = '<i class="fas fa-spinner fa-spin text-6xl mb-4"></i><p class="text-xl">Processing File...</p>';
            emptyState.classList.remove('opacity-50');
        }

        let bytes;
        if (file.type.startsWith('image/')) {
            bytes = await convertImageToPDFBytes(file);
        } else {
            bytes = await file.arrayBuffer();
        }

        pdfBytes = bytes;
        await loadPDF(pdfBytes);
    } catch (err) {
        console.error("File upload error:", err);
        alert("Error reading file: " + err.message);
        if (emptyState) {
            emptyState.innerHTML = '<i class="fas fa-file-pdf text-6xl mb-4"></i><p class="text-xl">Open a PDF or Image to start editing</p>';
            emptyState.classList.add('opacity-50');
            emptyState.classList.remove('hidden');
        }
    }
}

async function convertImageToPDFBytes(file) {
    const imgBuffer = await file.arrayBuffer();
    const tempPdfDoc = await PDFLib.PDFDocument.create();
    let image;

    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
        image = await tempPdfDoc.embedJpg(imgBuffer);
    } else if (file.type === 'image/png') {
        image = await tempPdfDoc.embedPng(imgBuffer);
    } else {
        try {
            image = await tempPdfDoc.embedPng(imgBuffer);
        } catch (e) {
            throw new Error("Unsupported image format. Please use JPG or PNG.");
        }
    }

    // Normalize size: Standard PDF page width is ~595 pts (A4). 
    // We'll scale the image to fit within a max dimension to avoid oversized pages.
    const maxDim = 800;
    let width = image.width;
    let height = image.height;

    if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width *= ratio;
        height *= ratio;
    }

    const page = tempPdfDoc.addPage([width, height]);
    page.drawImage(image, {
        x: 0,
        y: 0,
        width: width,
        height: height,
    });

    return await tempPdfDoc.save();
}

/**
 * Automatically adjusts the zoom scale to fit the document within the viewport width.
 */
function fitToWidth() {
    if (!pdfDoc) return;
    const container = document.getElementById('pdf-render-container');
    if (!container) return;

    // Use a small delay to ensure container width is calculated correctly if it was hidden
    setTimeout(() => {
        const containerWidth = container.clientWidth - 80; // account for padding/margins
        if (containerWidth <= 0) return;

        const firstPage = pdfDoc.getPage(0);
        const { width } = firstPage.getSize();

        // Target about 95% of container width for a snug fit
        const targetScale = (containerWidth * 0.95) / width;

        // Update global scale within reasonable bounds
        currentScale = Math.max(0.3, Math.min(1.5, targetScale));

        updateZoomDisplay();
        renderMainView();
    }, 100);
}

async function loadPDF(bytes) {
    try {
        pdfDoc = await PDFLib.PDFDocument.load(bytes);
        const pages = pdfDoc.getPages();
        rotationState = {};
        pages.forEach((p, i) => rotationState[i] = p.getRotation().angle);

        if (emptyState) emptyState.classList.add('hidden');

        updateUIState(true);

        floatingItems = [];
        allDrawings = [];
        historyStack = [];
        redoStack = [];
        updateUndoRedoUI();
        await renderAll();

        // Automatically fit to screen on initial load
        fitToWidth();

    } catch (err) {
        console.error("Error parsing PDF", err);
        alert("Failed to load PDF.");
    }
}

// --- RENDERING ---
async function renderAll() {
    try {
        if (thumbnailSidebar) thumbnailSidebar.innerHTML = '';
        const loadingTask = pdfjsLib.getDocument({ data: await pdfDoc.save() });
        const pdf = await loadingTask.promise;

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 0.2 });
            const div = document.createElement('div');
            div.className = `thumbnail-page p-2 mb-2 rounded bg-white ${i - 1 === currentPageIndex ? 'active' : ''}`;
            div.onclick = () => scrollToPage(i - 1);

            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.className = "mx-auto shadow-sm";
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

            const label = document.createElement('div');
            label.className = "text-xs text-gray-500 mt-1";
            label.textContent = `Page ${i}`;

            div.appendChild(canvas);
            div.appendChild(label);

            // --- DRAG AND DROP LOGIC (Persistent) ---
            div.setAttribute('draggable', 'true');
            div.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', i - 1); // Index 0-based
                div.classList.add('dragging');
            };
            div.ondragend = () => {
                div.classList.remove('dragging');
                document.querySelectorAll('.thumbnail-drop-indicator').forEach(i => i.remove());
            };
            div.ondragover = (e) => {
                e.preventDefault();
                if (!div.previousElementSibling?.classList.contains('thumbnail-drop-indicator')) {
                    document.querySelectorAll('.thumbnail-drop-indicator').forEach(i => i.remove());
                    const indicator = document.createElement('div');
                    indicator.className = 'thumbnail-drop-indicator';
                    div.before(indicator);
                }
            };
            div.ondrop = async (e) => {
                e.preventDefault();
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = i - 1;
                if (fromIndex !== toIndex && !isNaN(fromIndex)) await movePage(fromIndex, toIndex);
            };
            if (thumbnailSidebar) thumbnailSidebar.appendChild(div);
        }


        // Reset container classes for rendering
        if (pdfRenderContainer) {
            // Apply current view mode classes
            setViewMode(currentViewMode);
        }
        await renderMainView();
    } catch (err) {
        console.error("Rendering error:", err);
    }
}

async function renderMainView() {
    if (pdfRenderContainer) pdfRenderContainer.innerHTML = '';
    const loadingTask = pdfjsLib.getDocument({ data: await pdfDoc.save() });
    const pdf = await loadingTask.promise;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: currentScale });
        const pageIndex = i - 1;

        const div = document.createElement('div');
        div.className = "pdf-page-container relative";
        div.setAttribute('data-page-index', pageIndex);
        div.style.width = `${viewport.width}px`;
        div.style.height = `${viewport.height}px`;

        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.className = "pdf-canvas";
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;
        await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: viewport }).promise;

        const annCanvas = document.createElement('canvas');
        annCanvas.className = `annotation-layer ${isDrawingMode ? '' : 'inactive'}`;
        Object.assign(annCanvas.style, { position: 'absolute', top: '0', left: '0', zIndex: '10' });
        if (!isDrawingMode) annCanvas.style.pointerEvents = 'none';

        annCanvas.height = viewport.height;
        annCanvas.width = viewport.width;
        annCanvas.setAttribute('data-page-index', pageIndex);

        annCanvas.addEventListener('mousedown', handleMouseDown);
        // mousemove and mouseup are now handled globally via handleMouseDown attachment
        annCanvas.addEventListener('click', handleCanvasClick); // New Click Handler
        annCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); if (e.touches) handleMouseDown(e.touches[0]); });
        annCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (e.touches) handleMouseMove(e.touches[0]); });
        annCanvas.addEventListener('touchend', (e) => { e.preventDefault(); handleMouseUp(); });

        div.appendChild(pdfCanvas);
        div.appendChild(annCanvas);

        // --- Text Layer ---
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        div.appendChild(textLayerDiv);

        // Render Text Layer
        page.getTextContent().then(function (textContent) {
            if (pdfjsLib.renderTextLayer) {
                pdfjsLib.renderTextLayer({
                    textContent: textContent,
                    container: textLayerDiv,
                    viewport: viewport,
                    textDivs: []
                });
            } else {
                console.warn("pdfjsLib.renderTextLayer not found. Text selection might use basic fallback or fail.");
            }
        });


        const pageItems = floatingItems.filter(item => item.pageIndex === pageIndex);
        pageItems.forEach(item => {
            createFloatingItemDOM(item, div);
        });

        if (pdfRenderContainer) pdfRenderContainer.appendChild(div);

        // Redraw virtual drawings
        redrawCanvas(pageIndex);
    }

    setupInteract();
    setupPageDropZones();
    updateZoomDisplay();
}

// --- TOOLS & INTERACTIONS ---
function selectTool(tool, force = false) {
    try {
        console.log("Selecting tool:", tool, "Force:", force);
        // Toggle logic
        if (force) {
            activeTool = tool;
        } else {
            activeTool = activeTool === tool ? null : tool;
        }
        isDrawingMode = !!activeTool;

        // Valid tools check
        const validTools = ['select', 'select-free', 'text', 'draw', 'highlight'];
        if (activeTool && !validTools.includes(activeTool) && !tool.startsWith('eraser')) {
            console.warn("Unknown tool:", activeTool);
        }

        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.classList.remove('bg-blue-100', 'text-blue-600');
            btn.style.backgroundColor = ''; // Reset inline style
        });
        if (activeTool) {
            const btn = document.getElementById(`tool-${activeTool}`);
            console.log(`Ref: profound button for tool-${activeTool}:`, btn);
            if (btn) {
                btn.classList.add('bg-blue-100', 'text-blue-600');
                btn.style.backgroundColor = '#dbeafe'; // Force bg-blue-100 equivalent
            } else {
                console.error(`Ref: Button tool-${activeTool} NOT FOUND`);
            }
        }

        hideToolProperties();
        if (activeTool && activeTool !== 'select' && activeTool !== 'select-free') {
            showToolProperties(activeTool);
        }

        const layers = document.querySelectorAll('.annotation-layer');
        layers.forEach(l => {
            if (isDrawingMode) {
                l.classList.remove('inactive');
                l.style.pointerEvents = 'auto'; // Force auto
                l.style.cursor = (activeTool === 'select' || activeTool === 'select-free') ? 'crosshair' : (activeTool === 'text' ? 'text' : 'crosshair');
            } else {
                l.classList.add('inactive');
                l.style.pointerEvents = 'none';
                l.style.cursor = 'default';
            }
        });

        if (activeTool !== 'select') {
            if (selectionOverlay) selectionOverlay.style.display = 'none';

            if (activeTool !== 'select-free') {
                document.getElementById('selection-copy-btn')?.classList.add('hidden');
                currentFreeSelectionPath = null;
            }
        }
        document.getElementById('context-menu').style.display = 'none';

    } catch (e) {
        console.error("Error in selectTool:", e);
        alert("Error selecting tool: " + e.message);
    }
}

function handleMouseDown(e) {
    console.log("Ref: handleMouseDown fired on:", e.target, "Classes:", e.target.className);

    deselectAllFloatingItems();

    document.getElementById('export-menu')?.classList.remove('show');
    document.getElementById('context-menu').style.display = 'none';

    if (!activeTool) {
        console.log("Ref: No active tool, returning.");
        return;
    }

    // IMPORTANT: Ensure we start on the annotation layer
    if (!e.target.classList.contains('annotation-layer')) {
        console.log("Ref: Clicked element is NOT annotation-layer. Ignoring.");
        return;
    }

    activeCanvas = e.target; // Cache active canvas
    const rect = activeCanvas.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (activeTool === 'select') {
        console.log("Ref: handleMouseDown: select tool active. Starting selection.");
        console.log("Ref: selectionOverlay:", selectionOverlay);
        if (!selectionOverlay) {
            console.error("Ref: selectionOverlay is MISSING!");
            createSelectionBox(); // Try to recreate
        }

        const pageX = e.pageX ?? e.touches?.[0]?.pageX;
        const pageY = e.pageY ?? e.touches?.[0]?.pageY;

        selectionStart = { x: pageX, y: pageY, canvasX: x, canvasY: y, canvas: activeCanvas };
        selectionOverlay.style.display = 'block';
        selectionOverlay.style.left = `${pageX}px`;
        selectionOverlay.style.top = `${pageY}px`;
        selectionOverlay.style.width = '0px';
        selectionOverlay.style.height = '0px';
        console.log("Ref: selectionOverlay displayed at", pageX, pageY);
    } else if (activeTool === 'select-free') {
        selectionStart = { canvas: activeCanvas, canvasX: x, canvasY: y };
        currentFreeSelectionPath = [{ x: x, y: y }];
    } else if (activeTool === 'draw' || activeTool === 'highlight') {
        startDrawing(e, x, y);
    }

    // Attach global listeners for drag/release
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    // Touch support hooks could be added here similarly if needed, but existing touch listeners in renderMainView call these handlers.
    // For purity, we should handle window touchmove/touchend too, but let's stick to mouse for the regression fix first.
}

function handleMouseMove(e) {
    if (!activeTool) return;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;

    if (activeTool === 'select' && selectionStart) {
        const pageX = e.pageX ?? e.touches?.[0]?.pageX;
        const pageY = e.pageY ?? e.touches?.[0]?.pageY;

        const width = Math.abs(pageX - selectionStart.x);
        const height = Math.abs(pageY - selectionStart.y);
        const left = Math.min(pageX, selectionStart.x);
        const top = Math.min(pageY, selectionStart.y);

        selectionOverlay.style.width = `${width}px`;
        selectionOverlay.style.height = `${height}px`;
        selectionOverlay.style.left = `${left}px`;
        selectionOverlay.style.top = `${top}px`;
    } else if (activeTool === 'select-free' && currentFreeSelectionPath) {
        // Use cached canvas
        const targetCanvas = selectionStart?.canvas || activeCanvas;
        if (!targetCanvas) return;

        const rect = targetCanvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        currentFreeSelectionPath.push({ x: x, y: y });

        let ctx = targetCanvas.getContext('2d');
        if (!ctx) return;

        const lastPt = currentFreeSelectionPath[currentFreeSelectionPath.length - 2];
        ctx.beginPath();
        ctx.strokeStyle = '#2563eb';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(lastPt.x, lastPt.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
    } else if ((activeTool === 'draw' || activeTool === 'highlight') && isDrawing) {
        // Use activeCanvas set in startDrawing
        if (!activeCanvas) return;

        const rect = activeCanvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        draw(e, x, y);
    }
}

function handleMouseUp(e) {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);

    if (activeTool === 'select' && selectionStart) {
        const width = parseFloat(selectionOverlay.style.width);
        const height = parseFloat(selectionOverlay.style.height);

        if (width > 5 && height > 5) {
            const rect = selectionOverlay.getBoundingClientRect();
            // Safety check
            if (!selectionStart.canvas) return;
            const canvasRect = selectionStart.canvas.getBoundingClientRect();

            currentSelection = {
                canvas: selectionStart.canvas,
                x: rect.left - canvasRect.left,
                y: rect.top - canvasRect.top,
                width: width,
                height: height,
                pageIndex: parseInt(selectionStart.canvas.getAttribute('data-page-index'))
            };

            const copyBtn = document.getElementById('selection-copy-btn');
            if (copyBtn) {
                copyBtn.style.display = 'flex';
                copyBtn.style.left = `${rect.left + width / 2}px`;
                copyBtn.style.top = `${rect.top - 10}px`;
                copyBtn.classList.remove('hidden');
            }

            const ctxMenu = document.getElementById('context-menu');
            ctxMenu.style.left = `${rect.right + 5}px`;
            ctxMenu.style.top = `${rect.top}px`;
            ctxMenu.style.display = 'flex';
        } else {
            selectionOverlay.style.display = 'none';
            document.getElementById('selection-copy-btn')?.classList.add('hidden');
        }
    } else if (activeTool === 'select-free' && currentFreeSelectionPath && currentFreeSelectionPath.length > 2) {
        // Finish free selection
        if (!selectionStart || !selectionStart.canvas) return;
        const ctx = selectionStart.canvas.getContext('2d');
        // Close path visuals
        const first = currentFreeSelectionPath[0];
        const last = currentFreeSelectionPath[currentFreeSelectionPath.length - 1];
        ctx.beginPath();
        ctx.strokeStyle = '#2563eb';
        ctx.setLineDash([5, 5]);
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(first.x, first.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        currentFreeSelectionPath.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });

        // Show Copy Button at center of bbox
        const rect = selectionStart.canvas.getBoundingClientRect();
        const width = maxX - minX;
        const height = maxY - minY;

        if (width > 5 && height > 5) {
            currentSelection = {
                type: 'free',
                path: currentFreeSelectionPath,
                canvas: selectionStart.canvas,
                x: minX,
                y: minY,
                width: width,
                height: height,
                pageIndex: parseInt(selectionStart.canvas.getAttribute('data-page-index'))
            };

            const copyBtn = document.getElementById('selection-copy-btn');
            if (copyBtn) {
                copyBtn.style.display = 'flex';
                copyBtn.style.left = `${rect.left + minX + width / 2}px`;
                copyBtn.style.top = `${rect.top + minY - 10}px`;
                copyBtn.classList.remove('hidden');
            }
            const ctxMenu = document.getElementById('context-menu'); // Also enable context menu
            ctxMenu.style.left = `${rect.left + minX + width}px`;
            ctxMenu.style.top = `${rect.top + minY}px`;
            ctxMenu.style.display = 'flex';

        }
    }
    currentFreeSelectionPath = null;
    selectionStart = null;
    if (activeTool === 'draw' || activeTool === 'highlight') {
        stopDrawing();
    }
}

function handleCanvasClick(e) {
    if (activeTool === 'text') {
        e.stopPropagation(); // Prevent window.click from hiding the overlay
        handleTextClick(e);
    }
}

// --- TEXT TOOL ---
function handleTextClick(e) {
    const canvas = e.target;
    const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX;
    const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY;

    if (!clientX || !clientY) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const overlay = document.getElementById('text-input-overlay');
    const input = document.getElementById('annotation-text-input');

    overlay.style.left = `${clientX}px`;
    overlay.style.top = `${clientY}px`;
    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();

    input.onkeydown = async (ev) => {
        if (ev.key === 'Enter' && input.value.trim()) {
            const pageIndex = parseInt(canvas.getAttribute('data-page-index'));
            const id = 'text-' + Date.now();
            const newItem = {
                id: id,
                pageIndex: pageIndex,
                x: x,
                y: y,
                width: null,
                height: null,
                type: 'text',
                text: input.value,
                fontSize: defaultFontSize,
                color: drawingColor,
                rotation: 0
            };

            // PUSH ACTION
            pushAction({
                type: 'ADD_FLOATING_ITEM',
                data: { ...newItem }
            });

            floatingItems.push(newItem);
            const container = document.querySelector(`.pdf-page-container[data-page-index="${pageIndex}"]`);
            createFloatingItemDOM(newItem, container);

            overlay.classList.add('hidden');
        } else if (ev.key === 'Escape') {
            overlay.classList.add('hidden');
        }
    };
}


// --- SELECT / COPY / PASTE LOGIC ---

function copySelection() {
    if (!currentSelection) return;

    const pdfCanvas = currentSelection.canvas.previousElementSibling;
    if (!pdfCanvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = currentSelection.width;
    tempCanvas.height = currentSelection.height;
    const tCtx = tempCanvas.getContext('2d');

    tCtx.drawImage(pdfCanvas,
        currentSelection.x, currentSelection.y, currentSelection.width, currentSelection.height,
        0, 0, currentSelection.width, currentSelection.height
    );

    clipboard = {
        width: currentSelection.width,
        height: currentSelection.height,
        dataURL: tempCanvas.toDataURL(),
        type: 'image'
    };

    selectionOverlay.style.display = 'none';
    const copyBtn = document.getElementById('selection-copy-btn');
    if (copyBtn) {
        copyBtn.style.display = 'none';
        copyBtn.classList.add('hidden');
    }
    document.getElementById('context-menu').style.display = 'none';
}

function pasteSelection() {
    if (!clipboard) return;

    const containers = document.querySelectorAll('.pdf-page-container');
    const targetContainer = containers[currentPageIndex] || containers[0];
    if (!targetContainer) return;

    const pageIndex = parseInt(targetContainer.getAttribute('data-page-index'));
    const id = 'float-' + Date.now();

    let newItem;
    if (clipboard.type === 'text') {
        return;
    } else {
        newItem = {
            id: id,
            pageIndex: pageIndex,
            x: 50,
            y: 50,
            width: clipboard.width,
            height: clipboard.height,
            dataURL: clipboard.dataURL,
            type: 'image',
            rotation: 0
        };
    }

    pushAction({ type: 'ADD_FLOATING_ITEM', data: { ...newItem } });
    floatingItems.push(newItem);
    createFloatingItemDOM(newItem, targetContainer);
}

// Helper to Create Floating Item DOM with Handles
function createFloatingItemDOM(item, container) {
    const wrapper = document.createElement('div');
    wrapper.id = item.id;
    wrapper.className = 'absolute group'; // Removed bg-white to manage via JS/style
    Object.assign(wrapper.style, {
        left: `${item.x}px`, top: `${item.y}px`,
        width: `${item.width}px`, height: `${item.height}px`,
        position: 'absolute', // Explicitly set position
        zIndex: '40', // Use original zIndex
        touchAction: 'none',
        userSelect: 'none', // Added userSelect from instruction
        background: item.overlay ? 'transparent' : 'white' // Initialize background based on overlay
    });
    if (item.rotation) wrapper.style.transform = `rotate(${item.rotation}deg)`;

    if (item.type === 'text') {
        const span = document.createElement('span');
        span.textContent = item.text;
        span.style.fontSize = `${item.fontSize}px`;
        span.style.color = `rgb(${item.color.r},${item.color.g},${item.color.b})`;
        span.style.fontFamily = 'Arial';
        span.style.whiteSpace = 'nowrap';
        span.style.userSelect = 'none';
        span.style.cursor = 'move';
        wrapper.appendChild(span);
        setTimeout(() => {
            const rect = span.getBoundingClientRect();
            item.width = rect.width;
            item.height = rect.height;
            wrapper.style.width = `${rect.width}px`;
            wrapper.style.height = `${rect.height}px`;
        }, 0);
    } else if (item.type === 'drawing') {
        // SVG Container
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', `0 0 ${item.width} ${item.height}`);
        svg.style.overflow = 'visible';
        svg.style.pointerEvents = 'none'; // Click through to wrapper

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        // Construct path data
        let d = `M ${item.path[0].x - item.x} ${item.path[0].y - item.y}`;
        for (let i = 1; i < item.path.length; i++) {
            d += ` L ${item.path[i].x - item.x} ${item.path[i].y - item.y}`;
        }
        path.setAttribute('d', d);
        path.setAttribute('stroke', `rgb(${item.color.r},${item.color.g},${item.color.b})`);
        path.setAttribute('stroke-width', item.lineWidth);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('opacity', item.opacity);

        svg.appendChild(path);
        wrapper.appendChild(svg);

    } else {
        wrapper.style.width = `${item.width}px`;
        wrapper.style.height = `${item.height}px`;
        const img = document.createElement('img');
        img.src = item.dataURL;
        img.className = 'w-full h-full object-fill';
        img.style.pointerEvents = 'none';
        wrapper.appendChild(img);
    }

    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'rotate-handle hidden';
    rotateHandle.innerHTML = '<i class="fas fa-sync-alt text-xs"></i>';
    Object.assign(rotateHandle.style, {
        position: 'absolute', top: '-25px', left: '50%', transform: 'translateX(-50%)',
        width: '24px', height: '24px', background: 'white', border: '1px solid #2563eb',
        borderRadius: '50%', alignItems: 'center', justifyContent: 'center',
        cursor: 'grab', zIndex: '50', color: '#2563eb', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    });

    // Overlay Handle (New)
    const overlayHandle = document.createElement('div');
    overlayHandle.className = 'overlay-handle hidden flex'; // Use flex to center icon
    overlayHandle.innerHTML = '<i class="fas fa-layer-group text-xs"></i>';
    overlayHandle.title = "Toggle Overlay Mode (Multiply)";
    Object.assign(overlayHandle.style, {
        position: 'absolute', top: '-25px', left: '20px', // Positioned left of center
        width: '24px', height: '24px', background: 'white', border: '1px solid #10b981', // Green border
        borderRadius: '50%', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: '50', color: '#10b981', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    });

    if (item.overlay) {
        wrapper.style.mixBlendMode = 'multiply'; // Apply to wrapper
        wrapper.style.background = 'transparent';
        overlayHandle.style.background = '#10b981';
        overlayHandle.style.color = 'white';
    } else if (item.type === 'drawing') {
        wrapper.style.background = 'transparent'; // Drawings are always transparent background
        if (item.overlay) {
            wrapper.style.mixBlendMode = 'multiply';
            overlayHandle.style.background = '#10b981';
            overlayHandle.style.color = 'white';
        }
    }

    overlayHandle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Overlay clicked. Current state:", item.overlay);
        const img = wrapper.querySelector('img');
        if (!item.overlay) {
            item.overlay = true;
            wrapper.style.mixBlendMode = 'multiply'; // Apply to wrapper
            if (item.type !== 'drawing') {
                wrapper.querySelector('img').style.mixBlendMode = 'multiply';
                wrapper.style.background = 'transparent';
            }
            overlayHandle.style.background = '#10b981';
            overlayHandle.style.color = 'white';
        } else {
            item.overlay = false;
            wrapper.style.mixBlendMode = 'normal'; // Reset wrapper
            if (item.type !== 'drawing') {
                wrapper.querySelector('img').style.mixBlendMode = 'normal';
                wrapper.style.background = 'white';
            } else {
                wrapper.style.background = 'transparent';
            }
            overlayHandle.style.background = 'white';
            overlayHandle.style.color = '#10b981';
        }
        // Force re-apply selection to ensure handles stay visible
        selectFloatingItem(wrapper);

        pushAction({
            type: 'MODIFY_FLOATING_ITEM',
            data: { id: item.id, before: { ...item, overlay: !item.overlay }, after: { ...item } }
        });
    });


    const deleteHandle = document.createElement('div');
    deleteHandle.className = 'delete-handle hidden';
    deleteHandle.innerHTML = '<i class="fas fa-times text-xs"></i>';
    Object.assign(deleteHandle.style, {
        position: 'absolute', top: '-12px', right: '-12px',
        width: '24px', height: '24px', background: 'white', border: '1px solid #ef4444',
        borderRadius: '50%', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: '50', color: '#ef4444', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    });
    deleteHandle.onclick = (e) => {
        e.stopPropagation();
        pushAction({ type: 'DELETE_FLOATING_ITEM', data: { ...item } });
        floatingItems = floatingItems.filter(i => i.id !== item.id);
        wrapper.remove();
        if (selectedFloatingItem === wrapper) selectedFloatingItem = null;
    };

    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(pos => {
        const h = document.createElement('div');
        h.className = `resize-handle resize-handle-${pos} hidden`;
        Object.assign(h.style, {
            position: 'absolute', width: '10px', height: '10px',
            background: '#3b82f6', border: '1px solid white',
            zIndex: '45', pointerEvents: 'auto'
        });

        if (pos.includes('n')) h.style.top = '-5px'; else h.style.bottom = '-5px';
        if (pos.includes('w')) h.style.left = '-5px'; else h.style.right = '-5px';
        if (pos === 'nw' || pos === 'se') h.style.cursor = 'nwse-resize'; else h.style.cursor = 'nesw-resize';

        wrapper.appendChild(h);
    });


    wrapper.appendChild(rotateHandle);
    wrapper.appendChild(overlayHandle);
    const imgContent = wrapper.querySelector('img');

    wrapper.appendChild(deleteHandle);
    container.appendChild(wrapper);

    // Add selection handler
    wrapper.onclick = (e) => {
        e.stopPropagation();
        selectFloatingItem(wrapper);
    };

    attachInteract(wrapper);
    selectFloatingItem(wrapper);
}

function selectFloatingItem(element) {
    if (selectedFloatingItem && selectedFloatingItem !== element) {
        selectedFloatingItem.classList.remove('ring-2', 'ring-blue-500');
        selectedFloatingItem.querySelectorAll('.resize-handle, .rotate-handle, .delete-handle, .overlay-handle').forEach(el => el.classList.add('hidden'));
    }
    selectedFloatingItem = element;
    selectedFloatingItem.classList.add('ring-2', 'ring-blue-500');
    selectedFloatingItem.querySelectorAll('.resize-handle, .rotate-handle, .delete-handle, .overlay-handle').forEach(el => {
        el.classList.remove('hidden');
        if (el.classList.contains('resize-handle')) {
            el.style.display = 'block';
        } else {
            el.style.display = 'flex';
        }
    });
}

function deselectAllFloatingItems() {
    if (selectedFloatingItem) {
        selectedFloatingItem.classList.remove('ring-2', 'ring-blue-500');
        selectedFloatingItem.querySelectorAll('.rotate-handle, .delete-handle, .resize-handle, .overlay-handle').forEach(el => {
            el.classList.add('hidden');
            el.style.display = 'none';
        });
    }
    selectedFloatingItem = null;
}

function deleteFloatingItem() {
    if (selectedFloatingItem) {
        const item = floatingItems.find(i => i.id === selectedFloatingItem.id);
        if (item) pushAction({ type: 'DELETE_FLOATING_ITEM', data: { ...item } });

        floatingItems = floatingItems.filter(i => i.id !== selectedFloatingItem.id);
        selectedFloatingItem.remove();
        selectedFloatingItem = null;
    }
}

function duplicateFloatingItem() {
    if (selectedFloatingItem) {
        const item = floatingItems.find(i => i.id === selectedFloatingItem.id);
        if (item) {
            const id = 'float-' + Date.now();
            const newItem = { ...item, id: id, x: item.x + 20, y: item.y + 20 };
            pushAction({ type: 'ADD_FLOATING_ITEM', data: { ...newItem } });
            floatingItems.push(newItem);
            const container = document.querySelector(`.pdf-page-container[data-page-index="${newItem.pageIndex}"]`);
            createFloatingItemDOM(newItem, container);
        }
    }
}

// ... original functions ...
function addToPinList() { /* ... */
    if (!currentSelection) return;
    const pdfCanvas = currentSelection.canvas.previousElementSibling;
    if (!pdfCanvas) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = currentSelection.width;
    tempCanvas.height = currentSelection.height;
    const tCtx = tempCanvas.getContext('2d');

    if (currentSelection.type === 'free') {
        // Free-hand clipping
        tCtx.beginPath();
        currentSelection.path.forEach((p, i) => {
            // Adjust points relative to the bounding box (0,0 of tempCanvas)
            if (i === 0) tCtx.moveTo(p.x - currentSelection.x, p.y - currentSelection.y);
            else tCtx.lineTo(p.x - currentSelection.x, p.y - currentSelection.y);
        });
        tCtx.closePath();
        tCtx.clip();

        tCtx.drawImage(pdfCanvas,
            currentSelection.x, currentSelection.y, currentSelection.width, currentSelection.height,
            0, 0, currentSelection.width, currentSelection.height
        );
        // Force redraw to clear the dashed lines from the page canvas...
        // Ideally we would redraw the page, but that might be heavy.
        // For now, the dashed lines remain until the user changes tool or zooms.
        // We can trigger a quick redraw of the annotation layer if we tracked it better.
        redrawCanvas(currentSelection.pageIndex); // This clears the annotation layer (dashed lines)
    } else {
        // Rectangle
        tCtx.drawImage(pdfCanvas,
            currentSelection.x, currentSelection.y, currentSelection.width, currentSelection.height,
            0, 0, currentSelection.width, currentSelection.height
        );
    }
    const dataURL = tempCanvas.toDataURL();
    const item = {
        id: 'pin-' + Date.now(),
        dataURL: dataURL,
        width: currentSelection.width, // Assuming rect is not defined here, using currentSelection as in original
        height: currentSelection.height, // Assuming rect is not defined here, using currentSelection as in original
        aspectRatio: currentSelection.width / currentSelection.height // Added aspectRatio
    };

    // Add to beginning of list (Newest first)
    pinList.unshift(item);
    savePinList();
    renderPinList();
    selectionOverlay.style.display = 'none';
    const copyBtn = document.getElementById('selection-copy-btn');
    if (copyBtn) {
        copyBtn.style.display = 'none';
        copyBtn.classList.add('hidden');
    }
    document.getElementById('context-menu').style.display = 'none';
}

function renderPinList() {
    const container = document.getElementById('pin-list-container');
    const emptyState = document.getElementById('pin-empty-state');
    const countSpan = document.getElementById('pin-count');
    if (!container) return;
    container.innerHTML = '';
    if (pinList.length === 0) {
        if (emptyState) container.appendChild(emptyState);
    } else {
        pinList.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'bg-gray-50 p-2 rounded border border-gray-200 relative group hover:shadow-md transition';
            div.draggable = true;
            div.ondragstart = (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify(item));
                e.dataTransfer.effectAllowed = 'copy';
                div.classList.add('opacity-50');
            };
            div.ondragend = () => { div.classList.remove('opacity-50'); };
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'absolute top-1 right-1 text-red-500 bg-white rounded-full p-1 shadow-sm opacity-0 group-hover:opacity-100 transition text-xs';
            deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                pinList.splice(index, 1);
                savePinList();
                renderPinList();
            };
            const img = document.createElement('img');
            img.src = item.dataURL;
            img.className = 'w-full h-auto object-contain bg-white border border-gray-100';
            img.style.maxHeight = '100px';
            const sizeLabel = document.createElement('div');
            sizeLabel.textContent = `${Math.round(item.width)} x ${Math.round(item.height)}`;
            sizeLabel.className = 'text-[10px] text-gray-500 mt-1 text-center';
            div.appendChild(deleteBtn);
            div.appendChild(img);
            div.appendChild(sizeLabel);
            container.appendChild(div);
        });
    }
    if (countSpan) countSpan.textContent = pinList.length;
}

function savePinList() {
    try { localStorage.setItem('pdfStudioPinList', JSON.stringify(pinList)); }
    catch (e) { console.error(e); alert("Storage full"); }
}
function loadPinList() {
    const data = localStorage.getItem('pdfStudioPinList');
    if (data) { try { pinList = JSON.parse(data); renderPinList(); } catch (e) { } }
}

function setupPageDropZones() {
    const containers = document.querySelectorAll('.pdf-page-container');
    containers.forEach(container => {
        container.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            container.classList.add('bg-blue-50');
        };
        container.ondragleave = () => { container.classList.remove('bg-blue-50'); };
        container.ondrop = (e) => {
            e.preventDefault();
            container.classList.remove('bg-blue-50');
            const data = e.dataTransfer.getData('application/json');
            if (!data) return;
            try {
                const item = JSON.parse(data);
                const rect = container.getBoundingClientRect();
                const x = e.clientX - rect.left - (item.width / 2);
                const y = e.clientY - rect.top - (item.height / 2);
                const pageIndex = parseInt(container.getAttribute('data-page-index'));
                addFloatingItem(pageIndex, x, y, item);
            } catch (err) { console.error("Drop error", err); }
        };
    });
}

function addFloatingItem(pageIndex, x, y, sourceItem) {
    const id = 'float-' + Date.now();
    const newItem = {
        id: id,
        pageIndex: pageIndex,
        x: x,
        y: y,
        width: sourceItem.width,
        height: sourceItem.height,
        dataURL: sourceItem.dataURL,
        type: 'image',
        rotation: 0,

    };

    pushAction({ type: 'ADD_FLOATING_ITEM', data: { ...newItem } });
    floatingItems.push(newItem);
    const container = document.querySelector(`.pdf-page-container[data-page-index="${pageIndex}"]`);
    if (container) {
        createFloatingItemDOM(newItem, container);
    }
}

function setupInteract() {
    document.querySelectorAll('.floating-wrapper').forEach(el => attachInteract(el));
}

function attachInteract(element) {
    if (typeof interact === 'undefined' || !element) {
        console.warn("InteractJS library not found or element invalid. Dragging disabled.");
        return;
    }

    element.style.touchAction = 'none';
    element.style.userSelect = 'none';
    element.style.position = 'absolute';
    element.style.zIndex = '40';

    interact(element).unset();

    interact(element).draggable({
        inertia: true,
        modifiers: [interact.modifiers.restrictRect({ restriction: 'parent', endOnly: false })],
        autoScroll: true,
        listeners: {
            start(event) {
                selectFloatingItem(event.target);
                // Capture State
                const item = floatingItems.find(i => i.id === event.target.id);
                if (item) interactionStartItemState = { ...item };
            },
            move(event) {
                const target = event.target;
                const id = target.id;
                const item = floatingItems.find(i => i.id === id);
                if (item) {
                    item.x += event.dx;
                    item.y += event.dy;
                    target.style.left = item.x + 'px';
                    target.style.top = item.y + 'px';
                }
            },
            end(event) {
                const item = floatingItems.find(i => i.id === event.target.id);
                if (item && interactionStartItemState) {
                    // Check if changed
                    if (item.x !== interactionStartItemState.x || item.y !== interactionStartItemState.y) {
                        pushAction({
                            type: 'MODIFY_FLOATING_ITEM',
                            data: { id: item.id, before: interactionStartItemState, after: { ...item } }
                        });
                    }
                }
            }
        }
    }).resizable({
        edges: {
            left: '.resize-handle-sw, .resize-handle-nw',
            right: '.resize-handle-se, .resize-handle-ne',
            bottom: '.resize-handle-se, .resize-handle-sw',
            top: '.resize-handle-ne, .resize-handle-nw'
        },
        inertia: true,
        modifiers: [
            interact.modifiers.restrictEdges({
                outer: 'parent'
            }),
            interact.modifiers.restrictSize({
                min: { width: 20, height: 20 }
            })
        ],
        listeners: {
            start(event) {
                selectFloatingItem(event.target);
                const item = floatingItems.find(i => i.id === event.target.id);
                if (item) interactionStartItemState = { ...item };
            },
            move(event) {
                const target = event.target;
                const id = target.id;
                const item = floatingItems.find(i => i.id === id);
                if (item) {
                    item.width = event.rect.width;
                    item.height = event.rect.height;
                    item.x += event.deltaRect.left;
                    item.y += event.deltaRect.top;

                    target.style.width = `${event.rect.width}px`;
                    target.style.height = `${event.rect.height}px`;
                    target.style.left = `${item.x}px`;
                    target.style.top = `${item.y}px`;

                    if (item.type === 'text') {
                        const span = target.querySelector('span');
                        if (span) {
                            const newSize = item.height * 0.8;
                            item.fontSize = newSize;
                            span.style.fontSize = `${newSize}px`;
                        }
                    }
                }
            },
            end(event) {
                const item = floatingItems.find(i => i.id === event.target.id);
                if (item && interactionStartItemState) {
                    if (item.width !== interactionStartItemState.width || item.height !== interactionStartItemState.height) {
                        pushAction({
                            type: 'MODIFY_FLOATING_ITEM',
                            data: { id: item.id, before: interactionStartItemState, after: { ...item } }
                        });
                    }
                }
            }
        }
    }).on('tap', function (event) {
        event.stopPropagation();
        selectFloatingItem(event.target);
    });

    const rotateHandle = element.querySelector('.rotate-handle');
    if (rotateHandle) {
        rotateHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const id = element.id;
            const item = floatingItems.find(i => i.id === id);

            if (item) interactionStartItemState = { ...item };

            const rect = element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            function rotateMove(ev) {
                const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
                const deg = angle * (180 / Math.PI) + 90;
                if (item) {
                    item.rotation = deg;
                    element.style.transform = `rotate(${deg}deg)`;
                }
            }
            function stopRotate() {
                window.removeEventListener('mousemove', rotateMove);
                window.removeEventListener('mouseup', stopRotate);
                if (item && interactionStartItemState && item.rotation !== interactionStartItemState.rotation) {
                    pushAction({
                        type: 'MODIFY_FLOATING_ITEM',
                        data: { id: item.id, before: interactionStartItemState, after: { ...item } }
                    });
                }
            }
            window.addEventListener('mousemove', rotateMove);
            window.addEventListener('mouseup', stopRotate);
        });
    }

}

// ... original functions ...

async function movePage(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;

    try {
        // PDF-Lib is 0-indexed for getPage but we need to manage the order
        const pdfPages = pdfDoc.getPages();
        if (fromIndex < 0 || fromIndex >= pdfPages.length || toIndex < 0 || toIndex >= pdfPages.length) return;

        // Get Reference First
        const page = pdfPages[fromIndex];

        // Remove page
        pdfDoc.removePage(fromIndex);

        // Insert at toIndex
        pdfDoc.insertPage(toIndex, page);

        // Update Rotation State Map - shifting values
        // This is complex because we need to shift keys in rotationState
        // Easier to just re-read rotation states after re-rendering or just invalidate it?
        // Let's just reset rotation state from the new page order
        const newPages = pdfDoc.getPages();
        rotationState = {};
        newPages.forEach((p, i) => rotationState[i] = p.getRotation().angle);

        // Update floating items pageIndex
        // If we move page 2 to 0:
        // Page 2 becomes 0.
        // Page 0 becomes 1.
        // Page 1 becomes 2.
        // Implementation:
        // Update all items: their pageIndex must track the new page index.
        // Easier: floating items are tied to "Page Index". If we move the page, the item theoretically should stay with the page content?
        // Yes, "Pin List" items are separate, but "Floating Items" (pasted/dropped on page) belong to that page.
        // So we need to map old index to new index.

        // Strategy:
        // If moving from -> to
        // We need to shift everything between from and to.

        floatingItems.forEach(item => {
            if (item.pageIndex === fromIndex) {
                item.pageIndex = toIndex;
            } else if (fromIndex < toIndex) {
                // Moving down (0 -> 2)
                // Items at 1->0, 2->1.
                // Indices between from+1 and to need -1
                if (item.pageIndex > fromIndex && item.pageIndex <= toIndex) {
                    item.pageIndex--;
                }
            } else if (fromIndex > toIndex) {
                // Moving up (2 -> 0)
                // Items at 0->1, 1->2.
                // Indices between to and from-1 need +1
                if (item.pageIndex >= toIndex && item.pageIndex < fromIndex) {
                    item.pageIndex++;
                }
            }
        });

        // Same for drawings
        allDrawings.forEach(d => {
            if (d.pageIndex == fromIndex) {
                d.pageIndex = toIndex;
            } else if (fromIndex < toIndex) {
                if (d.pageIndex > fromIndex && d.pageIndex <= toIndex) {
                    d.pageIndex--;
                }
            } else if (fromIndex > toIndex) {
                if (d.pageIndex >= toIndex && d.pageIndex < fromIndex) {
                    d.pageIndex++;
                }
            }
        });


        await renderAll();

    } catch (e) {
        console.error("Move Page Error:", e);
        alert("Failed to move page: " + e.message);
    }
}
async function extractPageAsImage() {
    if (!auth.currentUser) {
        window.location.href = 'login.html?redirect=pdf-studio.html';
        return;
    }

    try {
        const containers = document.querySelectorAll('.pdf-page-container');
        const currentContainer = containers[currentPageIndex];
        if (!currentContainer) return;

        const pdfCanvas = currentContainer.querySelector('.pdf-canvas');
        const annCanvas = currentContainer.querySelector('.annotation-layer');

        // Create a temporary canvas to merge both
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pdfCanvas.width;
        tempCanvas.height = pdfCanvas.height;
        const ctx = tempCanvas.getContext('2d');

        ctx.drawImage(pdfCanvas, 0, 0);
        ctx.drawImage(annCanvas, 0, 0);

        const link = document.createElement('a');
        link.download = `page_${currentPageIndex + 1}_${new Date().getTime()}.png`;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    } catch (e) {
        console.error("Export Image Error:", e);
        alert("Failed to export as image.");
    }
}

async function handleMergeUpload(e) {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    if (!pdfDoc) {
        // If no PDF is loaded yet, just load the first one
        e.target.id = 'pdf-upload'; // Trick the handler
        handleFileUpload({ target: e.target });
        return;
    }

    try {
        alert(`Adding ${files.length} document(s)...`);

        for (const file of files) {
            let bytes;
            if (file.type.startsWith('image/')) {
                bytes = await convertImageToPDFBytes(file);
            } else {
                bytes = await file.arrayBuffer();
            }

            const externalDoc = await PDFLib.PDFDocument.load(bytes);
            const externalPages = await pdfDoc.copyPages(externalDoc, externalDoc.getPageIndices());
            externalPages.forEach(page => pdfDoc.addPage(page));
        }

        await renderAll();
    } catch (err) {
        console.error("Merge error:", err);
        alert("Failed to add files: " + err.message);
    }
}

function startDrawing(e, x, y) {
    isDrawing = true;
    activeCanvas = e.target;
    currentPath = [{ x, y }];
    const ctx = activeCanvas.getContext('2d');
    ctx.beginPath();
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = brushOpacity;
    // Updated Highlight Logic (included in reset)
    if (activeTool === 'highlight') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = `rgba(${drawingColor.r},${drawingColor.g},${drawingColor.b}, 1)`;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgb(${drawingColor.r},${drawingColor.g},${drawingColor.b})`;
    }
    ctx.moveTo(x, y);
}
function draw(e, x, y) {
    if (!isDrawing) return;
    currentPath.push({ x, y });
    const ctx = activeCanvas.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
}
async function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentPath.length > 1 && activeCanvas) {
        // IMPORTANT: DO NOT BURN TO PDF. STORE IN ARRAY.
        // Calculate Bounding Box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        currentPath.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });

        // Add padding equal to half brush size to avoid clipping
        const padding = brushSize / 2 + 2;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const width = maxX - minX;
        const height = maxY - minY;

        // Create Floating Item
        const pageIndex = parseInt(activeCanvas.getAttribute('data-page-index'));
        const id = 'drawing-' + Date.now();
        const newItem = {
            id: id,
            pageIndex: pageIndex,
            x: minX,
            y: minY,
            width: width,
            height: height,
            type: 'drawing',
            path: currentPath, // Store raw path (will be normalized in rendering)
            lineWidth: brushSize,
            color: drawingColor,
            opacity: brushOpacity,
            overlay: activeTool === 'highlight', // Auto-set overlay for highlight
            rotation: 0
        };

        pushAction({ type: 'ADD_FLOATING_ITEM', data: { ...newItem } });
        floatingItems.push(newItem);

        const container = document.querySelector(`.pdf-page-container[data-page-index="${pageIndex}"]`);
        if (container) {
            createFloatingItemDOM(newItem, container);
        }

        // Clear the temporary canvas trace
        const ctx = activeCanvas.getContext('2d');
        ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);

        currentPath = [];

        // FIX: Auto-deselect the drawing tool after creation
        // This allows the user to immediately click and interact with the created drawing
        selectTool(null);
    }
}

// OLD burnDrawingsToPDF is replaced by logic in savePDF and redrawCanvas
// Keeping helper for savePDF
async function burnDrawingToPage(page, d, scaleX, scaleY, height) {
    const color = PDFLib.rgb(d.color.r / 255, d.color.g / 255, d.color.b / 255);
    for (let i = 0; i < d.path.length - 1; i++) {
        const p1 = d.path[i];
        const p2 = d.path[i + 1];
        page.drawLine({
            start: { x: p1.x * scaleX, y: height - (p1.y * scaleY) },
            end: { x: p2.x * scaleX, y: height - (p2.y * scaleY) },
            thickness: d.width * scaleX,
            color: color,
            opacity: d.opacity,
        });
    }
}


async function rotateCurrentPage() {
    if (!pdfDoc) return;
    const page = pdfDoc.getPages()[currentPageIndex];
    if (page) {
        page.setRotation(PDFLib.degrees(page.getRotation().angle + 90));
        await renderAll();
    }
}
async function deleteCurrentPage() {
    if (pdfDoc && pdfDoc.getPageCount() > 1 && confirm("Delete page?")) {
        pdfDoc.removePage(currentPageIndex);
        currentPageIndex = Math.max(0, currentPageIndex - 1);
        await renderAll();
    }
}
function adjustZoom(delta) {
    currentScale = Math.max(0.5, Math.min(3.0, currentScale + delta));
    renderMainView();
}

function setViewMode(mode) {
    currentViewMode = mode;
    const container = document.getElementById('pdf-render-container');
    const btnSingle = document.getElementById('view-single');
    const btnDouble = document.getElementById('view-double');

    if (mode === 'single') {
        container.className = 'flex-1 grid grid-cols-1 justify-items-center content-start gap-8 p-8 overflow-auto bg-[#525659]';

        btnSingle?.classList.remove('text-gray-600', 'hover:text-blue-600');
        btnSingle?.classList.add('text-blue-600', 'bg-white', 'shadow-sm');

        btnDouble?.classList.add('text-gray-600', 'hover:text-blue-600');
        btnDouble?.classList.remove('text-blue-600', 'bg-white', 'shadow-sm');
    } else {
        container.className = 'flex-1 grid grid-cols-2 justify-items-center content-start gap-4 p-8 overflow-auto bg-[#525659]';

        btnDouble?.classList.remove('text-gray-600', 'hover:text-blue-600');
        btnDouble?.classList.add('text-blue-600', 'bg-white', 'shadow-sm');

        btnSingle?.classList.add('text-gray-600', 'hover:text-blue-600');
        btnSingle?.classList.remove('text-blue-600', 'bg-white', 'shadow-sm');
    }
}

function updateZoomDisplay() { if (zoomLevelSpan) zoomLevelSpan.textContent = `${Math.round(currentScale * 100)}%`; }
function scrollToPage(index) {
    currentPageIndex = index;
    const pages = document.querySelectorAll('.pdf-page-container');
    if (pages[index]) {
        pages[index].scrollIntoView({ behavior: 'smooth' });
        document.querySelectorAll('.thumbnail-page').forEach((t, i) => t.classList.toggle('active', i === index));
    }
}

// UPDATE SAVEPDF to include Drawings
async function generateFinalPDF(options = {}) {
    if (!pdfDoc) return null;

    // 1. Save current doc state to bytes (clean, without floating items)
    const currentBytes = await pdfDoc.save();

    // 2. Load a COPY to work on (non-destructive)
    const finalDoc = await PDFLib.PDFDocument.load(currentBytes);

    // 3. Burn items into finalDoc
    const pages = finalDoc.getPages();

    // Burn legacy drawings (likely empty but kept for safety)
    for (const drawing of allDrawings) {
        if (drawing.pageIndex >= pages.length) continue;
        const page = pages[drawing.pageIndex];
        const { width, height } = page.getSize();

        // We need container dims. This is DOM dependent.
        // Assuming page rendered matches container index.
        const containers = document.querySelectorAll('.pdf-page-container');
        const container = containers[drawing.pageIndex];
        if (!container) continue;

        const containerWidth = parseFloat(container.style.width);
        const containerHeight = parseFloat(container.style.height);
        const scaleX = width / containerWidth;
        const scaleY = height / containerHeight;

        await burnDrawingToPage(page, drawing, scaleX, scaleY, height);
    }

    // Burn floating items
    for (const item of floatingItems) {
        if (item.pageIndex >= pages.length) continue;
        const page = pages[item.pageIndex];
        const { width, height } = page.getSize();

        const containers = document.querySelectorAll('.pdf-page-container');
        const container = containers[item.pageIndex];
        if (!container) continue;

        const containerWidth = parseFloat(container.style.width);
        const containerHeight = parseFloat(container.style.height);

        const scaleX = width / containerWidth;
        const scaleY = height / containerHeight;

        const itemX = item.x * scaleX;
        const itemY = height - ((item.y + item.height) * scaleY);

        if (item.type === 'text') {
            page.drawText(item.text, {
                x: itemX,
                y: itemY + (item.fontSize * scaleY * 0.2), // Adjustment for baseline
                size: item.fontSize * scaleY,
                color: PDFLib.rgb(item.color.r / 255, item.color.g / 255, item.color.b / 255),
                rotate: PDFLib.degrees(item.rotation || 0)
            });
        } else if (item.type === 'drawing') {
            // Draw SVG Path
            let d = `M ${item.path[0].x - item.x} ${item.path[0].y - item.y}`;
            for (let i = 1; i < item.path.length; i++) {
                d += ` L ${item.path[i].x - item.x} ${item.path[i].y - item.y}`;
            }

            let origMinX = Infinity, origMinY = Infinity;
            item.path.forEach(p => {
                if (p.x < origMinX) origMinX = p.x;
                if (p.y < origMinY) origMinY = p.y;
            });

            const color = PDFLib.rgb(item.color.r / 255, item.color.g / 255, item.color.b / 255);

            let origMaxX = -Infinity, origMaxY = -Infinity;
            item.path.forEach(p => {
                if (p.x > origMaxX) origMaxX = p.x;
                if (p.y > origMaxY) origMaxY = p.y;
            });

            const pMinX = origMinX - ((item.lineWidth / 2) + 2);
            const pMinY = origMinY - ((item.lineWidth / 2) + 2);
            const pMaxX = origMaxX + ((item.lineWidth / 2) + 2);
            const pMaxY = origMaxY + ((item.lineWidth / 2) + 2);
            const oW = pMaxX - pMinX;
            const oH = pMaxY - pMinY;

            const scaleW = item.width / oW;
            const scaleH = item.height / oH;

            const angleRad = (item.rotation || 0) * (Math.PI / 180);
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);

            const lcx = item.width / 2;
            const lcy = item.height / 2;

            for (let i = 0; i < item.path.length - 1; i++) {
                const p1 = item.path[i];
                const p2 = item.path[i + 1];

                const relX1 = p1.x - origMinX;
                const relY1 = p1.y - origMinY;

                const pt1_local_x = (relX1 + ((item.lineWidth / 2) + 2)) * scaleW;
                const pt1_local_y = (relY1 + ((item.lineWidth / 2) + 2)) * scaleH;

                const pt2_local_x = ((p2.x - origMinX) + ((item.lineWidth / 2) + 2)) * scaleW;
                const pt2_local_y = ((p2.y - origMinY) + ((item.lineWidth / 2) + 2)) * scaleH;

                const dx1 = pt1_local_x - lcx;
                const dy1 = pt1_local_y - lcy;
                const rotX1 = dx1 * cos - dy1 * sin;
                const rotY1 = dx1 * sin + dy1 * cos;
                const finX1 = rotX1 + lcx;
                const finY1 = rotY1 + lcy;

                const dx2 = pt2_local_x - lcx;
                const dy2 = pt2_local_y - lcy;
                const rotX2 = dx2 * cos - dy2 * sin;
                const rotY2 = dx2 * sin + dy2 * cos;
                const finX2 = rotX2 + lcx;
                const finY2 = rotY2 + lcy;

                page.drawLine({
                    start: { x: itemX + (finX1 * scaleX), y: itemY + ((item.height - finY1) * scaleY) },
                    end: { x: itemX + (finX2 * scaleX), y: itemY + ((item.height - finY2) * scaleY) },
                    thickness: item.lineWidth * scaleX * scaleW,
                    color: color,
                    opacity: item.opacity,
                });
            }
        } else {
            let image;
            if (item.dataURL.startsWith('data:image/png')) {
                image = await finalDoc.embedPng(item.dataURL);
            } else {
                image = await finalDoc.embedJpg(item.dataURL);
            }
            const imgWidth = item.width * scaleX;
            const imgHeight = item.height * scaleY;

            page.drawImage(image, {
                x: itemX,
                y: itemY,
                width: imgWidth,
                height: imgHeight,
                rotate: PDFLib.degrees(item.rotation || 0)
            });
        }
    }


    // Use object streams for compression if requested
    const saveOptions = {
        useObjectStreams: options.compress || false,
        addDefaultSubset: false
    };

    return await finalDoc.save(saveOptions);
}

async function savePDF() {
    if (!auth.currentUser) {
        window.location.href = 'login.html?redirect=pdf-studio.html';
        return;
    }
    if (!pdfDoc) return;

    try {
        const pdfBytes = await generateFinalPDF();
        if (!pdfBytes) return;

        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `modified_${new Date().getTime()}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        console.error("Save Error:", e);
        alert("Failed to save PDF: " + e.message);
    }
}

async function printPDF() {
    if (!auth.currentUser) {
        window.location.href = 'login.html?redirect=pdf-studio.html';
        return;
    }
    if (!pdfDoc) return;

    try {
        const pdfBytes = await generateFinalPDF();
        if (!pdfBytes) return;

        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        // Create an iframe to print (Must be visible for some browsers to allow printing)
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.src = blobUrl;
        document.body.appendChild(iframe);

        iframe.onload = function () {
            setTimeout(function () {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                } catch (e) {
                    console.error("Iframe print error:", e);
                    // Fallback
                    window.open(blobUrl, '_blank');
                }

                // Cleanup after a delay to allow print dialog to open
                setTimeout(() => {
                    document.body.removeChild(iframe);
                    URL.revokeObjectURL(blobUrl);
                }, 60000); // 1 minute delay
            }, 500);
        };
    } catch (e) {
        console.error("Print Error:", e);
        alert("Failed to print PDF: " + e.message);
    }
}
function toggleExportMenu() { document.getElementById('export-menu')?.classList.toggle('show'); }
function showToolProperties(tool) {
    document.getElementById('tool-properties-overlay').classList.add('show');
    document.getElementById('overlay-title').textContent = tool.toUpperCase() + ' Settings';
    if (activeTool === 'highlight') {
        document.getElementById('opacity-control').classList.remove('hidden');
        brushOpacity = 0.5;
        brushSize = 15;
        document.querySelectorAll('.thickness-option').forEach(o => o.classList.remove('active'));
    } else {
        document.getElementById('opacity-control').classList.add('hidden');
        brushOpacity = 1.0;
        if (brushSize === 15) brushSize = 2;
    }
}
function hideToolProperties() {
    document.getElementById('tool-properties-overlay')?.classList.remove('show');
}
async function compressPDF() {
    if (!auth.currentUser) {
        window.location.href = 'login.html?redirect=pdf-studio.html';
        return;
    }

    if (!pdfDoc) return;

    try {
        console.log("V2: Starting aggressive compression...");
        if (emptyState) {
            emptyState.innerHTML = '<div class="text-center"><i class="fas fa-circle-notch fa-spin text-3xl text-blue-600 mb-3"></i><p class="text-gray-600 font-bold">MODE: Aggressive Rasterization (V2)</p><p class="text-gray-500 text-sm">Reducing image quality and optimizing structure...</p></div>';
            emptyState.classList.remove('hidden');
        }

        // 1. Get current bytes
        const currentBytes = await pdfDoc.save();
        console.log("V2: Original Size:", (currentBytes.length / 1024 / 1024).toFixed(2), "MB");

        // 2. Load with PDF.js for rasterization
        const loadingTask = pdfjsLib.getDocument({ data: currentBytes });
        const pdf = await loadingTask.promise;

        // 3. Create a fresh PDF-Lib document
        const compressedDoc = await PDFLib.PDFDocument.create();

        // 4. Rasterize each page
        for (let i = 1; i <= pdf.numPages; i++) {
            console.log(`V2: Rasterizing page ${i}/${pdf.numPages}...`);
            const page = await pdf.getPage(i);

            // Render at a fixed lower resolution (scale 1.2 for more aggressive compression)
            const viewport = page.getViewport({ scale: 1.2 });

            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: canvas.getContext('2d'),
                viewport: viewport
            };

            await page.render(renderContext).promise;

            // Convert to optimized JPEG (0.5 quality for very aggressive compression)
            const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.5);

            // Robust conversion from dataURL to Uint8Array (Avoid fetch for data URLs)
            const base64Data = jpegDataUrl.split(',')[1];
            const binaryString = atob(base64Data);
            const jpegBytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
                jpegBytes[j] = binaryString.charCodeAt(j);
            }

            // Embed into the new doc
            const image = await compressedDoc.embedJpg(jpegBytes);
            const compressedPage = compressedDoc.addPage([image.width, image.height]);

            compressedPage.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
            });
        }

        // 5. Re-apply annotations
        const compressedPages = compressedDoc.getPages();
        for (const item of floatingItems) {
            if (item.pageIndex >= compressedPages.length) continue;
            const targetPage = compressedPages[item.pageIndex];
            const { width: pW, height: pH } = targetPage.getSize();

            const containers = document.querySelectorAll('.pdf-page-container');
            const container = containers[item.pageIndex];
            if (!container) continue;

            const cW = parseFloat(container.style.width);
            const cH = parseFloat(container.style.height);
            const sX = pW / cW;
            const sY = pH / cH;

            const x = item.x * sX;
            const y = pH - ((item.y + item.height) * sY);

            if (item.type === 'text') {
                targetPage.drawText(item.text, {
                    x: x,
                    y: y + (item.fontSize * sY * 0.2),
                    size: item.fontSize * sY,
                    color: PDFLib.rgb(item.color.r / 255, item.color.g / 255, item.color.b / 255),
                    rotate: PDFLib.degrees(item.rotation || 0)
                });
            }
        }

        const finalBytes = await compressedDoc.save({ useObjectStreams: true });
        console.log("V2: Compressed Size:", (finalBytes.length / 1024 / 1024).toFixed(2), "MB");

        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `compressed_v2_${new Date().getTime()}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (emptyState) emptyState.classList.add('hidden');
        alert("Aggressive Compression complete (V2)!\nOriginal: " + (currentBytes.length / 1024).toFixed(0) + "KB\nCompressed: " + (finalBytes.length / 1024).toFixed(0) + "KB");
    } catch (e) {
        console.error("Compression Error:", e);
        alert("Failed to compress PDF: " + e.message);
        if (emptyState) emptyState.classList.add('hidden');
    }
}

// --- OCR EXTRACTION ---
const GEMINI_OCR_PROXY = "https://arabicocr.zczvwz6pw7.workers.dev";
let extractedOCRText = "";

// Preprocess image: grayscale + compress (matches portal.js behavior)
async function preprocessImage(base64Image) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = avg;
                data[i + 1] = avg;
                data[i + 2] = avg;
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
        };
        img.onerror = reject;
        img.src = "data:image/jpeg;base64," + base64Image;
    });
}

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

async function extractCurrentPageOCR() {
    // Check login
    if (!auth.currentUser) {
        window.location.href = 'login.html?redirect=pdf-studio.html';
        return;
    }

    // Check if PDF is loaded
    if (!pdfDoc) {
        alert("Please load a PDF first.");
        return;
    }

    // Gate: must be Pro or have pages remaining
    if (!window.isProUser && !(window.pagesBalance > 0)) {
        alert("You have no pages remaining. Please buy a page pack or upgrade to Pro to continue scanning.");
        window.location.href = 'pricing.html';
        return;
    }

    try {
        // Show modal with loading state
        const ocrModal = document.getElementById('ocr-modal');
        const ocrResultContent = document.getElementById('ocr-result-content');
        ocrResultContent.innerHTML = '<div class="text-center"><i class="fas fa-circle-notch fa-spin text-3xl text-blue-600 mb-3"></i><p class="text-gray-600">Extracting text from current page...</p></div>';
        ocrModal.classList.remove('hidden');

        // Get current page canvas
        const containers = document.querySelectorAll('.pdf-page-container');
        const currentContainer = containers[currentPageIndex];
        if (!currentContainer) {
            throw new Error("Current page not found");
        }

        const pdfCanvas = currentContainer.querySelector('.pdf-canvas');
        if (!pdfCanvas) {
            throw new Error("PDF canvas not found");
        }

        // Scale down canvas to max 2000px wide for OCR, then preprocess
        const maxWidth = 2000;
        let ocrCanvas = pdfCanvas;
        if (pdfCanvas.width > maxWidth) {
            const scale = maxWidth / pdfCanvas.width;
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = maxWidth;
            tmpCanvas.height = Math.round(pdfCanvas.height * scale);
            const tmpCtx = tmpCanvas.getContext('2d');
            tmpCtx.drawImage(pdfCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height);
            ocrCanvas = tmpCanvas;
        }
        const rawBase64 = ocrCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        const base64Image = await preprocessImage(rawBase64);

        // Call Gemini Vision via proxy
        extractedOCRText = await callGeminiOCR([{
            role: "user",
            content: [
                {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                },
                {
                    type: "text",
                    text: "Extract ALL text from this image exactly as it appears. The document may be in Arabic, English, or both. Output only the raw extracted text, preserving line breaks and layout. Do not add any labels, commentary, or explanation."
                }
            ]
        }]);

        // Deduct one page from balance (pages-plan users only, not subscribers)
        if (window.isPagesUser && window.pagesBalance > 0 && auth.currentUser) {
            const newBalance = await useOnePage(auth.currentUser.uid);
            if (newBalance >= 0) {
                window.pagesBalance = newBalance;
                if (userStatusDisplay) {
                    if (newBalance > 0) {
                        userStatusDisplay.textContent = `${newBalance} pages remaining`;
                        userStatusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 text-purple-700';
                    } else {
                        userStatusDisplay.textContent = 'No pages — Buy a pack';
                        userStatusDisplay.className = 'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-100 text-red-600 cursor-pointer';
                        userStatusDisplay.onclick = () => { window.location.href = 'pricing.html'; };
                    }
                }
            }
        }

        ocrResultContent.textContent = extractedOCRText;

        // Analytics
        logEvent(analytics, 'ocr_generated', {
            source: 'pdf'
        });

        // Detect if text is Arabic and set RTL
        const arabicPattern = /[\u0600-\u06FF]/;
        if (arabicPattern.test(extractedOCRText)) {
            ocrResultContent.style.direction = 'rtl';
            ocrResultContent.style.textAlign = 'right';
        } else {
            ocrResultContent.style.direction = 'ltr';
            ocrResultContent.style.textAlign = 'left';
        }

    } catch (error) {
        console.error("OCR Error:", error);
        const ocrResultContent = document.getElementById('ocr-result-content');
        ocrResultContent.innerHTML = `<p class="text-red-600 text-center"><i class="fas fa-exclamation-circle mr-2"></i>Error: ${error.message}</p>`;
    }
}

function closeOCRModal() {
    const ocrModal = document.getElementById('ocr-modal');
    ocrModal.classList.add('hidden');
}

function copyOCRText() {
    if (!extractedOCRText) {
        alert("No text to copy.");
        return;
    }
    navigator.clipboard.writeText(extractedOCRText).then(() => {
        const btn = document.getElementById('copy-ocr-text');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Copied!';
        btn.classList.add('bg-green-600');
        btn.classList.remove('bg-blue-600');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('bg-green-600');
            btn.classList.add('bg-blue-600');
        }, 2000);
    });
}

function downloadOCRText() {
    if (!extractedOCRText) {
        alert("No text to download.");
        return;
    }
    const blob = new Blob([extractedOCRText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ocr_result.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// OCR Modal Event Listeners
document.getElementById('close-ocr-modal')?.addEventListener('click', closeOCRModal);
document.getElementById('copy-ocr-text')?.addEventListener('click', copyOCRText);
document.getElementById('download-ocr-text')?.addEventListener('click', downloadOCRText);
document.getElementById('ocr-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'ocr-modal') closeOCRModal();
});

// Make OCR function global
window.extractCurrentPageOCR = extractCurrentPageOCR;


// --- DROPDOWN LOGIC ---
document.getElementById('tool-select-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('select-menu').classList.toggle('hidden');
});
// Global click to close
document.addEventListener('click', (e) => {
    if (!e.target.closest('#select-dropdown-container')) {
        document.getElementById('select-menu')?.classList.add('hidden');
    }
});

function updateUIState(hasPDF) {
    const idsToToggle = [
        'zoom-out', 'zoom-in',
        'view-single', 'view-double',
        'tool-undo', 'tool-redo',
        'tool-rotate', 'tool-delete',
        'tool-select', 'tool-select-free', // Mask buttons
        'tool-text', 'tool-draw', 'tool-highlight', 'tool-ocr',
        'export-btn',
        'merge-btn', 'save-btn', 'print-btn' // Header buttons
    ];


    idsToToggle.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !hasPDF;
            if (!hasPDF) {
                el.classList.add('opacity-50', 'cursor-not-allowed');
                // Also disable pointer events for safety mostly for divs acting as buttons if any, 
                // but standard disabled attr works for buttons.
                // For non-button elements (like maybe dropdown toggles if they were divs), we'd need pointer-events.
                // Our toolbar-btn are buttons, so disabled attribute is good.
                // However, let's be thorough with classes.
            } else {
                el.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    });

    // Special handling for Pin Sidebar
    const pinSidebar = document.getElementById('pin-sidebar');
    if (pinSidebar) {
        if (!hasPDF) {
            pinSidebar.classList.add('opacity-50', 'pointer-events-none');
        } else {
            pinSidebar.classList.remove('opacity-50', 'pointer-events-none');
        }
    }
}

// --- SUBSCRIPTION HELPERS ---

function openPricing() {
    console.log("Opening pricing modal...");
    if (pricingModal) {
        pricingModal.classList.remove('hidden');
    }
}

function closePricing() {
    if (pricingModal) pricingModal.classList.add('hidden');
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
            // Reset yearly border
            const radioContainer = planYearly.querySelector('.border-gray-300');
            if (radioContainer) radioContainer.classList.replace('border-gray-300', 'border-blue-600');
            planYearly.querySelector('.bg-blue-600').classList.remove('hidden');
        }
        if (planMonthly) {
            planMonthly.classList.remove('border-blue-600', 'bg-blue-50');
            planMonthly.classList.add('border-gray-200');
            planMonthly.querySelector('.hidden').classList.add('hidden');
        }
    }
}
function manageSubscription() {
    window.location.href = 'subscription.html';
}

window.printPDF = printPDF;
window.savePDF = savePDF;
window.openPricing = openPricing;
window.closePricing = closePricing;
window.selectPlan = selectPlan;
window.selectTool = selectTool;
window.manageSubscription = manageSubscription;

// Initialize file upload listener
if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
}

