import { app, auth, db } from '../firebase-analytics.js';
import { collection, addDoc, serverTimestamp, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function seedBlogData() {
    const user = auth.currentUser;
    if (!user) {
        alert('Please log in to the admin panel first to seed data.');
        return;
    }

    try {
        console.log('Starting seed process...');

        // 1. Create Categories if they don't exist
        const categories = [
            { id: 'cat-articles', name: { en: 'Articles', ar: 'مقالات' }, icon: 'fa-file-alt', color: '#3b82f6' },
            { id: 'cat-tutorials', name: { en: 'Tutorials', ar: 'شروحات' }, icon: 'fa-graduation-cap', color: '#10b981' },
            { id: 'cat-news', name: { en: 'News', ar: 'أخبار' }, icon: 'fa-bullhorn', color: '#8b5cf6' }
        ];

        for (const cat of categories) {
            const catRef = collection(db, 'blog_categories');
            const q = query(catRef, where('name.en', '==', cat.name.en));
            const snap = await getDocs(q);
            if (snap.empty) {
                await addDoc(catRef, { ...cat, createdAt: serverTimestamp() });
                console.log(`Category created: ${cat.name.en}`);
            }
        }

        // 2. Create Sample Posts
        const posts = [
            {
                title: {
                    en: 'The Future of Arabic OCR and AI',
                    ar: 'مستقبل استخراج النصوص العربية والذكاء الاصطناعي'
                },
                slug: 'future-of-arabic-ocr',
                excerpt: {
                    en: 'Exploring how deep learning is revolutionizing the way we digitize ancient Arabic manuscripts.',
                    ar: 'استكشاف كيف أحدث التعلم العميق ثورة في طريقة تحويل المخطوطات العربية القديمة إلى نصوص رقمية.'
                },
                content: {
                    en: '<h3>Introduction</h3><p>Arabic OCR has come a long way. With modern AI, we can now reach over 98% accuracy even with complex ligatures...</p>',
                    ar: '<h3>مقدمة</h3><p>لقد قطع استخراج النصوص العربية شوطاً طويلاً. بفضل الذكاء الاصطناعي الحديث، يمكننا الآن الوصول إلى دقة تزيد عن 98%...</p>'
                },
                contentType: 'article',
                status: 'published',
                featuredImage: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=1000',
                categories: ['Articles'],
                tags: ['AI', 'OCR', 'Arabic'],
                views: 124,
                readingTime: 4
            },
            {
                title: {
                    en: 'Tutorial: Digitizing Multi-Page PDFs',
                    ar: 'شرح: تحويل ملفات PDF متعددة الصفحات إلى نصوص'
                },
                slug: 'tutorial-digitizing-pdfs',
                excerpt: {
                    en: 'Learn how to use our PDF Studio to merge documents and extract Arabic text in bulk.',
                    ar: 'تعلم كيفية استخدام استوديو PDF الخاص بنا لدمج المستندات واستخراج النصوص العربية بكميات كبيرة.'
                },
                content: {
                    en: '<p>Standardizing your workflow is key to productivity. In this guide, we show you how to use the batch processing feature...</p>',
                    ar: '<p>يعد توحيد سير العمل هو مفتاح الإنتاجية. في هذا الدليل، نوضح لك كيفية استخدام ميزة المعالجة المجمعة...</p>'
                },
                contentType: 'tutorial',
                status: 'published',
                featuredImage: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&q=80&w=1000',
                categories: ['Tutorials'],
                tags: ['PDF', 'Tutorial', 'Workflow'],
                views: 85,
                readingTime: 6
            },
            {
                title: {
                    en: 'Service Update: Handwriting Support',
                    ar: 'تحديث الخدمة: دعم التعرف على الخط اليدوي'
                },
                slug: 'handwriting-support-update',
                excerpt: {
                    en: 'Our latest engine now supports cursive Arabic handwriting recognition with high precision.',
                    ar: 'يدعم محركنا الأحدث الآن التعرف على الخط اليدوي العربي المتصل بدقة عالية.'
                },
                content: {
                    en: '<p>We are excited to announce that handwriting recognition is now out of beta. Users can now upload notes and get instant text...</p>',
                    ar: '<p>يسعدنا أن نعلن أن ميزة التعرف على الخط اليدوي قد خرجت من المرحلة التجريبية. يمكن للمستخدمين الآن رفع الملاحظات...</p>'
                },
                contentType: 'news',
                status: 'published',
                featuredImage: 'https://images.unsplash.com/photo-1503551723145-6c040742065b?auto=format&fit=crop&q=80&w=1000',
                categories: ['News'],
                tags: ['Update', 'Handwriting', 'AI'],
                views: 210,
                readingTime: 3
            }
        ];

        for (const post of posts) {
            const postData = {
                ...post,
                author: {
                    uid: user.uid,
                    name: 'Admin',
                    email: user.email
                },
                createdAt: serverTimestamp(),
                publishedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                seo: {
                    metaTitle: post.title,
                    metaDescription: post.excerpt
                }
            };
            await addDoc(collection(db, 'blog_posts'), postData);
            console.log(`Post created: ${post.title.en}`);
        }

        alert('Success! 3 Sample Posts and 3 Categories have been created.');
        if (window.location.pathname.includes('blog-admin.html')) {
            window.location.reload();
        }

    } catch (error) {
        console.error('Seed error:', error);
        alert('Error seeding data: ' + error.message);
    }
}

window.seedBlogData = seedBlogData;
