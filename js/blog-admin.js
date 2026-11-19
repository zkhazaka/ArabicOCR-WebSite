import { app, auth, analytics, logEvent, db } from '../firebase-analytics.js';
import { collection, query, orderBy, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let quillEn, quillAr;
let currentPostId = null;
let featuredImageUrl = '';

// ========================================
// AUTHENTICATION GUARD
// ========================================

onAuthStateChanged(auth, (user) => {
    if (!user) {
        // Redirect if not logged in
        window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname);
    } else {
        // Logged in, initialize dashboard or editor
        initPage();
    }
});

function initPage() {
    const path = window.location.pathname;

    if (path.includes('blog-admin.html')) {
        initDashboard();
    } else if (path.includes('blog-editor.html')) {
        initEditor();
    }

    // Logout button
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).then(() => {
                window.location.href = 'index.html';
            });
        });
    }

    // Seed Data buttons
    const seedBtn = document.getElementById('seed-data-btn');
    if (seedBtn) {
        seedBtn.addEventListener('click', async () => {
            if (confirm('Create 3 sample posts and categories?')) {
                try {
                    const { seedBlogData } = await import('./seed-data.js');
                    await seedBlogData();
                } catch (err) {
                    console.error('Seed error:', err);
                    alert('Error loading seed-data.js: ' + err.message);
                }
            }
        });
    }

    const seedExtraBtn = document.getElementById('seed-extra-btn');
    if (seedExtraBtn) {
        seedExtraBtn.addEventListener('click', async () => {
            if (confirm('Create 7 new blog posts covering various AI topics?')) {
                try {
                    const { seedExtraBlogs } = await import('./seed-extra-blogs.js');
                    await seedExtraBlogs();
                } catch (err) {
                    console.error('Seed extra error:', err);
                    alert('Error loading seed-extra-blogs.js: ' + err.message);
                }
            }
        });
    }
}

// ========================================
// DASHBOARD LOGIC
// ========================================

async function initDashboard() {
    loadDashboardPosts();
    updateStats();
}

async function loadDashboardPosts() {
    const tableBody = document.getElementById('admin-posts-table');
    if (!tableBody) return;

    try {
        // Removed orderBy('createdAt', 'desc') to prevent missing index errors 
        // if Firebase indexes haven't been built yet for the admin panel.
        const q = query(collection(db, 'blog_posts'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-gray-500">No posts yet. Click "Create New Post" to start.</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        querySnapshot.forEach((docSnap) => {
            const post = docSnap.data();
            const id = docSnap.id;

            const date = post.createdAt?.toDate().toLocaleDateString();
            const statusClass = post.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700';

            tableBody.innerHTML += `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-6 py-4">
                        <p class="font-bold text-gray-900">${post.title.en || 'Untitled'}</p>
                        <p class="text-xs text-gray-400">/${post.slug || id}</p>
                    </td>
                    <td class="px-6 py-4">
                        <span class="px-2 py-1 rounded-full text-xs font-bold ${statusClass}">${post.status.toUpperCase()}</span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500">${post.contentType || 'Article'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${date || 'Just now'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${post.views || 0}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <a href="blog-editor.html?id=${id}" class="text-blue-600 hover:text-blue-800 transition"><i class="fas fa-edit"></i></a>
                        <button onclick="deletePost('${id}')" class="text-red-500 hover:text-red-700 transition"><i class="fas fa-trash-alt"></i></button>
                        <a href="blog-post.html?id=${id}" target="_blank" class="text-gray-400 hover:text-gray-600 transition"><i class="fas fa-external-link-alt"></i></a>
                    </td>
                </tr>
            `;
        });

    } catch (error) {
        console.error('Error loading posts:', error);
        tableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-red-500">Error loading posts: ${error.message} <br> If this mentions an index, please open the developer console (F12) and click the Firebase link to generate it.</td></tr>`;
    }
}

async function updateStats() {
    try {
        const postsDocs = await getDocs(collection(db, 'blog_posts'));
        const subscribersDocs = await getDocs(collection(db, 'newsletter_subscribers'));
        const commentsDocs = await getDocs(query(collection(db, 'blog_comments'), where('status', '==', 'pending')));

        let totalViews = 0;
        postsDocs.forEach(doc => {
            totalViews += (doc.data().views || 0);
        });

        document.getElementById('stat-total-posts').textContent = postsDocs.size;
        document.getElementById('stat-total-views').textContent = totalViews;
        document.getElementById('stat-pending-comments').textContent = commentsDocs.size;
        document.getElementById('stat-subscribers').textContent = subscribersDocs.size;

    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

window.deletePost = async function (id) {
    if (confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
        try {
            await deleteDoc(doc(db, 'blog_posts', id));
            loadDashboardPosts();
            updateStats();
        } catch (error) {
            console.error('Error deleting post:', error);
            alert('Error deleting post.');
        }
    }
};

// ========================================
// EDITOR LOGIC
// ========================================

async function initEditor() {
    // Initialize Quill
    quillEn = new Quill('#editor-en', { theme: 'snow', modules: { toolbar: true } });
    quillAr = new Quill('#editor-ar', { theme: 'snow', modules: { toolbar: true } });

    // Handle Language Toggles
    const btnEn = document.getElementById('lang-btn-en');
    const btnAr = document.getElementById('lang-btn-ar');
    const secEn = document.getElementById('section-en');
    const secAr = document.getElementById('section-ar');

    btnEn.onclick = () => {
        btnEn.classList.add('bg-blue-100', 'text-blue-700');
        btnEn.classList.remove('bg-gray-100', 'text-gray-600');
        btnAr.classList.add('bg-gray-100', 'text-gray-600');
        btnAr.classList.remove('bg-blue-100', 'text-blue-700');
        secEn.classList.remove('hidden');
        secAr.classList.add('hidden');
    };

    btnAr.onclick = () => {
        btnAr.classList.add('bg-blue-100', 'text-blue-700');
        btnAr.classList.remove('bg-gray-100', 'text-gray-600');
        btnEn.classList.add('bg-gray-100', 'text-gray-600');
        btnEn.classList.remove('bg-blue-100', 'text-blue-700');
        secAr.classList.remove('hidden');
        secEn.classList.add('hidden');
    };

    // Slug generation
    document.getElementById('title-en').oninput = (e) => {
        const slugInput = document.getElementById('post-slug');
        if (slugInput.dataset.manual !== 'true') {
            slugInput.value = e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
        }
    };
    document.getElementById('post-slug').oninput = (e) => {
        e.target.dataset.manual = 'true';
    };

    // Image Upload
    const uploadArea = document.getElementById('image-upload-area');
    const fileInput = document.getElementById('featured-image-file');

    uploadArea.onclick = () => fileInput.click();
    fileInput.onchange = (e) => handleFileUpload(e.target.files[0]);

    // Save/Publish
    document.getElementById('save-draft-btn').onclick = () => savePost('draft');
    document.getElementById('publish-btn').onclick = () => savePost('published');

    // Load existing post if ID exists
    const urlParams = new URLSearchParams(window.location.search);
    currentPostId = urlParams.get('id');
    if (currentPostId) {
        loadPostToEditor(currentPostId);
    }

    loadCategoriesToList();
}

async function handleFileUpload(file) {
    if (!file) return;

    const preview = document.getElementById('image-preview');
    const placeholder = document.getElementById('upload-placeholder');
    const status = document.getElementById('save-status');

    status.textContent = 'Uploading image...';

    try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch('/upload.php', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `HTTP Error ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Upload failed');
        }

        featuredImageUrl = data.url;

        preview.querySelector('img').src = featuredImageUrl;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        status.textContent = 'Image uploaded successfully';
    } catch (error) {
        console.error('Upload failed:', error);
        status.textContent = 'Upload failed: ' + error.message;
    }
}

async function savePost(statusValue) {
    const saveStatus = document.getElementById('save-status');
    saveStatus.textContent = 'Saving...';

    const postData = {
        title: {
            en: document.getElementById('title-en').value,
            ar: document.getElementById('title-ar').value
        },
        slug: document.getElementById('post-slug').value,
        excerpt: {
            en: document.getElementById('excerpt-en').value,
            ar: document.getElementById('excerpt-ar').value
        },
        content: {
            en: quillEn.root.innerHTML,
            ar: quillAr.root.innerHTML
        },
        contentType: document.getElementById('post-type').value,
        status: statusValue,
        featuredImage: featuredImageUrl,
        categories: getSelectedCategories(),
        tags: document.getElementById('post-tags').value.split(',').map(t => t.trim()).filter(t => t),
        updatedAt: serverTimestamp(),
        readingTime: calculateReadingTime(quillEn.root.innerText),
        seo: {
            metaTitle: {
                en: document.getElementById('meta-title').value || document.getElementById('title-en').value,
                ar: document.getElementById('meta-title').value || document.getElementById('title-ar').value
            },
            metaDescription: {
                en: document.getElementById('meta-description').value || document.getElementById('excerpt-en').value,
                ar: document.getElementById('meta-description').value || document.getElementById('excerpt-ar').value
            }
        }
    };

    try {
        if (currentPostId) {
            await updateDoc(doc(db, 'blog_posts', currentPostId), postData);
        } else {
            postData.createdAt = serverTimestamp();
            postData.publishedAt = statusValue === 'published' ? serverTimestamp() : null;
            postData.author = {
                uid: auth.currentUser.uid,
                name: auth.currentUser.displayName || auth.currentUser.email,
                email: auth.currentUser.email
            };
            postData.views = 0;
            const newDoc = await addDoc(collection(db, 'blog_posts'), postData);
            currentPostId = newDoc.id;
            // Update URL without reload
            window.history.pushState({}, '', `blog-editor.html?id=${currentPostId}`);
        }

        if (statusValue === 'published') {
            postData.publishedAt = serverTimestamp();
            await updateDoc(doc(db, 'blog_posts', currentPostId), { publishedAt: serverTimestamp() });
        }

        saveStatus.textContent = 'All changes saved (' + new Date().toLocaleTimeString() + ')';
        if (statusValue === 'published') {
            alert('Post published successfully!');
            window.location.href = 'blog-admin.html';
        }
    } catch (error) {
        console.error('Save failed:', error);
        saveStatus.textContent = 'Save failed';
        alert('Error saving post.');
    }
}

async function loadPostToEditor(id) {
    try {
        const postDoc = await getDoc(doc(db, 'blog_posts', id));
        if (postDoc.exists()) {
            const post = postDoc.data();

            document.getElementById('editor-page-title').textContent = 'Editing Post: ' + post.title.en;
            document.getElementById('title-en').value = post.title.en || '';
            document.getElementById('title-ar').value = post.title.ar || '';
            document.getElementById('post-slug').value = post.slug || '';
            document.getElementById('excerpt-en').value = post.excerpt.en || '';
            document.getElementById('excerpt-ar').value = post.excerpt.ar || '';
            quillEn.root.innerHTML = post.content.en || '';
            quillAr.root.innerHTML = post.content.ar || '';
            document.getElementById('post-type').value = post.contentType || 'article';
            document.getElementById('post-tags').value = post.tags?.join(', ') || '';
            document.getElementById('meta-title').value = post.seo?.metaTitle?.en || '';
            document.getElementById('meta-description').value = post.seo?.metaDescription?.en || '';

            if (post.featuredImage) {
                featuredImageUrl = post.featuredImage;
                const preview = document.getElementById('image-preview');
                const placeholder = document.getElementById('upload-placeholder');
                preview.querySelector('img').src = featuredImageUrl;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
            }

            // Mark categories
            setCategoriesUI(post.categories);
        }
    } catch (error) {
        console.error('Error loading post:', error);
    }
}

function calculateReadingTime(text) {
    const wordsPerMinute = 200;
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
}

async function loadCategoriesToList() {
    const list = document.getElementById('categories-select-list');
    if (!list) return;

    try {
        const querySnapshot = await getDocs(collection(db, 'blog_categories'));
        list.innerHTML = '';
        querySnapshot.forEach(doc => {
            const cat = doc.data();
            list.innerHTML += `
                <label class="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                    <input type="checkbox" name="category" value="${doc.id}" class="rounded text-blue-600">
                    <span class="text-sm">${cat.name.en}</span>
                </label>
            `;
        });
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

function getSelectedCategories() {
    return Array.from(document.querySelectorAll('input[name="category"]:checked')).map(cb => cb.value);
}

function setCategoriesUI(selectedIds) {
    if (!selectedIds) return;
    document.querySelectorAll('input[name="category"]').forEach(cb => {
        cb.checked = selectedIds.includes(cb.value);
    });
}
