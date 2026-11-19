import { app, auth, analytics, logEvent, db } from '../firebase-analytics.js';
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc, addDoc, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


// Configuration
const POSTS_PER_PAGE = 9;
let currentPage = 1;
let lastVisible = null;
let currentCategory = null;
let currentContentType = 'all';
let currentLanguage = localStorage.getItem('language') || 'en';

// ========================================
// BLOG LISTING PAGE
// ========================================

export async function loadBlogPosts(categoryFilter = null, contentTypeFilter = null, loadMore = false) {
    try {
        const postsContainer = document.getElementById('blog-posts-grid');

        if (categoryFilter !== null) currentCategory = categoryFilter;
        if (contentTypeFilter !== null) currentContentType = contentTypeFilter;

        if (!loadMore) {
            postsContainer.innerHTML = '<div class="col-span-full text-center py-12"><i class="fas fa-spinner fa-spin text-4xl text-amber-600"></i></div>';
            lastVisible = null;
            currentPage = 1;
        }

        // Build query
        let q = query(
            collection(db, 'blog_posts'),
            where('status', '==', 'published')
        );

        // Add category filter
        if (currentCategory && currentCategory !== 'all') {
            q = query(q, where('categories', 'array-contains', currentCategory));
        }

        // Add content type filter
        if (currentContentType && currentContentType !== 'all') {
            q = query(q, where('contentType', '==', currentContentType));
        }

        // Add ordering and limit
        q = query(q, orderBy('publishedAt', 'desc'), limit(POSTS_PER_PAGE));

        // Pagination
        if (loadMore && lastVisible) {
            q = query(q, startAfter(lastVisible));
        }

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty && !loadMore) {
            postsContainer.innerHTML = `
                <div class="col-span-full text-center py-12">
                    <i class="fas fa-inbox text-6xl text-gray-300 mb-4"></i>
                    <p class="text-gray-500">No blog posts found.</p>
                </div>
            `;
            return;
        }

        if (!loadMore) {
            postsContainer.innerHTML = '';
        }

        querySnapshot.forEach((doc) => {
            const post = doc.data();
            post.id = doc.id;
            postsContainer.innerHTML += createPostCard(post);
        });

        // Update pagination
        lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];

        // Show/hide load more button
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = querySnapshot.docs.length === POSTS_PER_PAGE ? 'block' : 'none';
        }

    } catch (error) {
        console.error('Error loading posts:', error);
        let errorMessage = 'Error loading posts. Please try again.';

        if (error.code === 'failed-precondition' || error.message.includes('requires an index')) {
            errorMessage = '<strong>Database Setup Required:</strong> This query requires a Firestore index. Check the browser console (Press F12) and click the provided Firebase link to create it.';
        }

        document.getElementById('blog-posts-grid').innerHTML = `
            <div class="col-span-full text-center py-12 text-red-600 bg-red-50 rounded-2xl border border-red-100 p-8">
                <i class="fas fa-exclamation-triangle text-4xl mb-4"></i>
                <p class="text-lg">${errorMessage}</p>
                <button onclick="location.reload()" class="mt-4 px-6 py-2 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700 transition">
                    Retry After Setup
                </button>
            </div>
        `;
    }
}

export function createPostCard(post) {
    const title = post.title[currentLanguage] || post.title.en;
    const excerpt = post.excerpt[currentLanguage] || post.excerpt.en;
    const date = post.publishedAt?.toDate().toLocaleDateString(currentLanguage === 'ar' ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const contentTypeColors = {
        article: 'bg-amber-100 text-amber-700',
        tutorial: 'bg-green-100 text-green-700',
        news: 'bg-purple-100 text-purple-700'
    };

    const contentTypeIcons = {
        article: 'fa-newspaper',
        tutorial: 'fa-graduation-cap',
        news: 'fa-bullhorn'
    };

    return `
        <article class="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-xl transition-shadow duration-300 group">
            <a href="/blog/${post.slug}" class="block">
                <div class="relative h-48 bg-gray-200 overflow-hidden">
                    ${post.featuredImage ?
            `<img src="${post.featuredImage}" alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">` :
            `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-500 to-purple-600">
                            <i class="fas ${contentTypeIcons[post.contentType]} text-6xl text-white opacity-50"></i>
                        </div>`
        }
                    <div class="absolute top-3 right-3">
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${contentTypeColors[post.contentType]} backdrop-blur-sm">
                            ${post.contentType.toUpperCase()}
                        </span>
                    </div>
                </div>
                <div class="p-6">
                    <div class="flex items-center text-sm text-gray-500 mb-3">
                        <i class="far fa-calendar mr-2"></i>
                        <span>${date}</span>
                        <span class="mx-2">•</span>
                        <i class="far fa-clock mr-2"></i>
                        <span>${post.readingTime} min read</span>
                    </div>
                    <h3 class="text-xl font-bold text-gray-900 mb-2 group-hover:text-amber-600 transition-colors line-clamp-2">
                        ${title}
                    </h3>
                    <p class="text-gray-600 mb-4 line-clamp-3">
                        ${excerpt}
                    </p>
                    <div class="flex items-center justify-between">
                        <div class="flex items-center text-gray-500 text-sm">
                            <i class="far fa-eye mr-2"></i>
                            <span>${post.views || 0} views</span>
                        </div>
                        <span class="text-amber-600 font-medium group-hover:translate-x-1 transition-transform inline-flex items-center">
                            Read More <i class="fas fa-arrow-right ml-2"></i>
                        </span>
                    </div>
                </div>
            </a>
        </article>
    `;
}

// ========================================
// INDIVIDUAL POST PAGE
// ========================================

// Accepts either a Firestore document id (legacy ?id= links) or a slug
// (/blog/<slug> pretty URLs, which is what the sitemap and internal links use).
export async function loadBlogPost(postRef, { bySlug = false } = {}) {
    try {
        let postDoc;

        if (bySlug) {
            const snap = await getDocs(query(
                collection(db, 'blog_posts'),
                where('slug', '==', postRef),
                limit(1)
            ));
            if (snap.empty) {
                showPostError('Post not found');
                return;
            }
            postDoc = snap.docs[0];
        } else {
            postDoc = await getDoc(doc(db, 'blog_posts', postRef));
        }

        if (!postDoc.exists()) {
            showPostError('Post not found');
            return;
        }

        const post = postDoc.data();
        post.id = postDoc.id;
        const postId = postDoc.id;
        // Comment submission needs the real document id even when the page was
        // reached by slug, where the URL carries no id.
        window.currentPostId = postId;

        // Check if published
        if (post.status !== 'published' && !auth.currentUser) {
            showPostError('This post is not available');
            return;
        }

        // Increment view count
        await updateDoc(doc(db, 'blog_posts', postId), {
            views: increment(1)
        });

        // Render post
        renderPost(post);

        // Load comments
        loadComments(postId);

        // Load related posts
        loadRelatedPosts(post.categories, postId);

    } catch (error) {
        console.error('Error loading post:', error);
        let msg = 'Error loading post';
        if (error.code === 'failed-precondition' || error.message.includes('requires an index')) {
            msg = 'Database index building. Please try again in 2-3 minutes.';
        }
        showPostError(msg);
    }
}

function renderPost(post) {
    const title = post.title[currentLanguage] || post.title.en;
    const content = post.content[currentLanguage] || post.content.en;
    const date = post.publishedAt?.toDate().toLocaleDateString(currentLanguage === 'ar' ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    document.getElementById('post-title').textContent = title;
    document.getElementById('post-date').textContent = date;
    document.getElementById('post-reading-time').textContent = `${post.readingTime} min read`;
    document.getElementById('post-views').textContent = `${post.views || 0} views`;
    document.getElementById('post-author-name').textContent = post.author.name;
    document.getElementById('post-content').innerHTML = content;

    if (post.featuredImage) {
        document.getElementById('post-featured-image').src = post.featuredImage;
        document.getElementById('post-featured-image').alt = title;
    }

    // Update meta tags for SEO.
    // Every post is served from the same blog-post.html shell, so without this the
    // whole blog shares one title/description/canonical and Google collapses it as
    // duplicate content. The canonical points at the pretty /blog/<slug> URL, which
    // is also what the sitemap lists.
    const description = post.seo?.metaDescription?.[currentLanguage] || post.excerpt?.[currentLanguage] || '';
    document.title = post.seo?.metaTitle?.[currentLanguage] || title;
    updateMetaTag('description', description);
    updateMetaTag('keywords', post.seo?.keywords?.join(', ') || '');

    const canonicalUrl = `https://arabic-ocr.com/blog/${post.slug}`;
    updateLinkTag('canonical', canonicalUrl);

    updateMetaProperty('og:title', document.title);
    updateMetaProperty('og:description', description);
    updateMetaProperty('og:url', canonicalUrl);
    updateMetaProperty('og:type', 'article');
    updateMetaTag('twitter:card', 'summary_large_image');
    updateMetaTag('twitter:title', document.title);
    updateMetaTag('twitter:description', description);
    if (post.featuredImage) {
        updateMetaProperty('og:image', post.featuredImage);
        updateMetaTag('twitter:image', post.featuredImage);
    }

    updateArticleSchema(post, title, description, canonicalUrl, date);

    // Social sharing
    setupSocialSharing(post);
}

function updateMetaTag(name, content) {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
    }
    meta.content = content;
}

function updateMetaProperty(property, content) {
    let meta = document.querySelector(`meta[property="${property}"]`);
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
    }
    meta.content = content;
}

function updateLinkTag(rel, href) {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
    }
    link.href = href;
}

// BlogPosting schema, built per post so each article is eligible for article
// rich results instead of every post sharing the shell page's markup.
function updateArticleSchema(post, title, description, canonicalUrl, dateText) {
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: title,
        description: description,
        url: canonicalUrl,
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
        inLanguage: currentLanguage === 'ar' ? 'ar' : 'en',
        author: { '@type': 'Person', name: post.author?.name || 'Ziad Khazzaka' },
        publisher: { '@id': 'https://www.kanzati.com' }
    };
    if (post.featuredImage) schema.image = post.featuredImage;
    const published = post.publishedAt?.toDate?.();
    if (published) schema.datePublished = published.toISOString();
    const updated = post.updatedAt?.toDate?.();
    if (updated) schema.dateModified = updated.toISOString();

    let el = document.getElementById('post-schema');
    if (!el) {
        el = document.createElement('script');
        el.type = 'application/ld+json';
        el.id = 'post-schema';
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(schema, null, 2);
}

function setupSocialSharing(post) {
    const url = window.location.href;
    const title = post.title[currentLanguage] || post.title.en;

    document.getElementById('share-twitter').href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
    document.getElementById('share-facebook').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    document.getElementById('share-linkedin').href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    document.getElementById('share-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`;
}

function showPostError(message) {
    document.getElementById('post-container').innerHTML = `
        <div class="text-center py-12">
            <i class="fas fa-exclamation-triangle text-6xl text-red-500 mb-4"></i>
            <h2 class="text-2xl font-bold text-gray-900 mb-2">${message}</h2>
            <a href="blog.html" class="text-amber-600 hover:underline">← Back to Blog</a>
        </div>
    `;
}

// ========================================
// COMMENTS
// ========================================

async function loadComments(postId) {
    try {
        const q = query(
            collection(db, 'blog_comments'),
            where('postId', '==', postId),
            where('status', '==', 'approved'),
            orderBy('createdAt', 'desc')
        );

        const querySnapshot = await getDocs(q);
        const commentsContainer = document.getElementById('comments-list');

        if (querySnapshot.empty) {
            commentsContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No comments yet. Be the first to comment!</p>';
            return;
        }

        commentsContainer.innerHTML = '';
        querySnapshot.forEach((doc) => {
            const comment = doc.data();
            commentsContainer.innerHTML += createCommentHTML(comment);
        });

    } catch (error) {
        console.error('Error loading comments:', error);
    }
}

function createCommentHTML(comment) {
    const date = comment.createdAt?.toDate().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    return `
        <div class="border-b border-gray-200 pb-4 mb-4 last:border-0">
            <div class="flex items-start">
                <div class="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold">
                    ${comment.author.name.charAt(0).toUpperCase()}
                </div>
                <div class="ml-4 flex-1">
                    <div class="flex items-center justify-between">
                        <h4 class="font-bold text-gray-900">${comment.author.name}</h4>
                        <span class="text-sm text-gray-500">${date}</span>
                    </div>
                    <p class="text-gray-700 mt-2">${comment.content}</p>
                </div>
            </div>
        </div>
    `;
}

export async function submitComment(postId, content) {
    try {
        const user = auth.currentUser;
        if (!user) {
            alert('Please log in to comment');
            return;
        }

        await addDoc(collection(db, 'blog_comments'), {
            postId: postId,
            author: {
                uid: user.uid,
                name: user.displayName || user.email.split('@')[0],
                email: user.email
            },
            content: content,
            status: 'pending', // Requires approval
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        alert('Comment submitted! It will appear after approval.');
        document.getElementById('comment-form').reset();

    } catch (error) {
        console.error('Error submitting comment:', error);
        alert('Error submitting comment. Please try again.');
    }
}

// ========================================
// NEWSLETTER
// ========================================

export async function subscribeNewsletter(email, language = 'en') {
    try {
        await addDoc(collection(db, 'newsletter_subscribers'), {
            email: email,
            language: language,
            subscribedAt: serverTimestamp(),
            status: 'active'
        });

        return true;
    } catch (error) {
        console.error('Error subscribing:', error);
        return false;
    }
}

// ========================================
// SEARCH & FILTER
// ========================================

export async function searchPosts(searchQuery) {
    // Note: Firestore doesn't support full-text search natively
    // For production, consider using Algolia or similar
    // This is a simple client-side filter

    try {
        const q = query(
            collection(db, 'blog_posts'),
            where('status', '==', 'published'),
            orderBy('publishedAt', 'desc')
        );

        const querySnapshot = await getDocs(q);
        const results = [];

        querySnapshot.forEach((doc) => {
            const post = doc.data();
            post.id = doc.id;

            const searchLower = searchQuery.toLowerCase();
            const titleMatch = post.title.en.toLowerCase().includes(searchLower) ||
                post.title.ar.toLowerCase().includes(searchLower);
            const excerptMatch = post.excerpt.en.toLowerCase().includes(searchLower) ||
                post.excerpt.ar.toLowerCase().includes(searchLower);

            if (titleMatch || excerptMatch) {
                results.push(post);
            }
        });

        return results;

    } catch (error) {
        console.error('Error searching:', error);
        return [];
    }
}

// ========================================
// FILTERING & PAGINATION HELPERS
// ========================================

export function filterByType(type) {
    currentContentType = type;

    // Update active UI state
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('bg-gray-900', 'text-white', 'shadow-md');
        btn.classList.add('bg-white', 'text-gray-600', 'hover:bg-amber-50');
    });

    const activeBtn = document.getElementById(`filter-${type}`);
    if (activeBtn) {
        activeBtn.classList.add('bg-gray-900', 'text-white', 'shadow-md');
        activeBtn.classList.remove('bg-white', 'text-gray-600', 'hover:bg-amber-50');
    }

    loadBlogPosts(currentCategory, type, false);
}

export function filterByCategory(catId) {
    currentCategory = catId;
    loadBlogPosts(catId, currentContentType, false);
}

export function loadMorePosts() {
    loadBlogPosts(currentCategory, currentContentType, true);
}

// ========================================
// RELATED POSTS
// ========================================

async function loadRelatedPosts(categories, currentPostId) {
    try {
        if (!categories || categories.length === 0) return;

        const q = query(
            collection(db, 'blog_posts'),
            where('status', '==', 'published'),
            where('categories', 'array-contains-any', categories.slice(0, 10)),
            orderBy('publishedAt', 'desc'),
            limit(4)
        );

        const querySnapshot = await getDocs(q);
        const relatedContainer = document.getElementById('related-posts');

        if (!relatedContainer) return;

        relatedContainer.innerHTML = '';
        let count = 0;

        querySnapshot.forEach((doc) => {
            if (doc.id !== currentPostId && count < 3) {
                const post = doc.data();
                post.id = doc.id;
                relatedContainer.innerHTML += createPostCard(post);
                count++;
            }
        });

        if (count === 0) {
            relatedContainer.parentElement.style.display = 'none';
        }

    } catch (error) {
        console.error('Error loading related posts:', error);
    }
}

// ========================================
// CATEGORIES
// ========================================

export async function loadCategories() {
    try {
        const querySnapshot = await getDocs(collection(db, 'blog_categories'));
        const categoriesContainer = document.getElementById('categories-list');

        if (!categoriesContainer) return;

        categoriesContainer.innerHTML = '';

        querySnapshot.forEach((doc) => {
            const category = doc.data();
            category.id = doc.id;

            const name = category.name[currentLanguage] || category.name.en;

            categoriesContainer.innerHTML += `
                <button 
                    onclick="filterByCategory('${category.id}')" 
                    class="flex items-center justify-between w-full px-4 py-2 text-left hover:bg-gray-50 rounded-lg transition"
                    data-category="${category.id}">
                    <span class="flex items-center">
                        <i class="fas ${category.icon} mr-3" style="color: ${category.color}"></i>
                        <span class="font-medium">${name}</span>
                    </span>
                </button>
            `;
        });

    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// ========================================
// HOMEPAGE WIDGET
// ========================================

export async function loadHomepagePosts() {
    try {
        const homepageGrid = document.getElementById('homepage-blog-grid');
        if (!homepageGrid) return;

        const q = query(
            collection(db, 'blog_posts'),
            where('status', '==', 'published'),
            orderBy('publishedAt', 'desc'),
            limit(3)
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            homepageGrid.innerHTML = '<div class="col-span-full text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm"><i class="fas fa-newspaper text-6xl text-gray-200 mb-4 block"></i><p class="text-gray-500 font-medium">Coming soon!!!!</p></div>';
            return;
        }

        homepageGrid.innerHTML = '';
        querySnapshot.forEach((doc) => {
            const post = doc.data();
            post.id = doc.id;
            homepageGrid.innerHTML += createPostCard(post);
        });

    } catch (error) {
        console.error('Error loading homepage posts:', error);
        if (error.code === 'failed-precondition' || error.message.includes('requires an index')) {
            homepageGrid.innerHTML = '<div class="col-span-full text-center py-8 text-red-500 font-medium bg-red-50 rounded-xl">Database Setup in Progress...</div>';
        }
    }
}

// Export for global use
window.loadBlogPosts = loadBlogPosts;
window.loadBlogPost = loadBlogPost;
window.submitComment = submitComment;
window.subscribeNewsletter = subscribeNewsletter;
window.searchPosts = searchPosts;
window.loadCategories = loadCategories;
window.loadHomepagePosts = loadHomepagePosts;
window.createPostCard = createPostCard;
window.filterByType = filterByType;
window.filterByCategory = filterByCategory;
window.loadMorePosts = loadMorePosts;
