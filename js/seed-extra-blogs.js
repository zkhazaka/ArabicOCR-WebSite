import { app, auth, db } from '../firebase-analytics.js';
import { collection, addDoc, serverTimestamp, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


export async function seedExtraBlogs() {
    const user = auth.currentUser;
    if (!user) {
        alert('Please log in to the admin panel first to seed data.');
        return;
    }

    try {
        console.log('Starting extra blog seed process...');

        const posts = [
            {
                title: {
                    en: 'Mastering the ArabicOCR Web Portal',
                    ar: 'احتراف البوابة الإلكترونية لـ ArabicOCR'
                },
                slug: 'mastering-web-portal',
                excerpt: {
                    en: 'A comprehensive guide to managing your documents and subscriptions through our intuitive web portal.',
                    ar: 'دليل شامل لإدارة مستنداتك واشتراكاتك من خلال بوابتنا الإلكترونية سهلة الاستخدام.'
                },
                content: {
                    en: '<h3>Streamline Your Workflow</h3><p>The ArabicOCR Web Portal is designed to be your central hub for document processing. From uploading batch files to managing team permissions, the portal offers a seamless experience...</p>',
                    ar: '<h3>تبسيط سير عملك</h3><p>تم تصميم بوابة ArabicOCR الإلكترونية لتكون مركزك الأساسي لمعالجة المستندات. من رفع الملفات المجمعة إلى إدارة أذونات الفريق، توفر البوابة تجربة سلسة...</p>'
                },
                contentType: 'tutorial',
                status: 'published',
                featuredImage: 'web1.png',
                categories: ['Tutorials'],
                tags: ['Web Portal', 'Management', 'Cloud'],
                views: 45,
                readingTime: 5
            },
            {
                title: {
                    en: 'The Ultimate PDF Editor for Arabic Users',
                    ar: 'محرر PDF المثالي للمستخدمين العرب'
                },
                slug: 'ultimate-pdf-editor',
                excerpt: {
                    en: 'Why our PDF Studio is the best choice for editing, merging, and annotating Arabic documents.',
                    ar: 'لماذا يعد استوديو PDF الخاص بنا الخيار الأفضل لتحرير ودمج وتدوين الملاحظات على المستندات العربية.'
                },
                content: {
                    en: '<h3>Editing Arabic PDFs Made Easy</h3><p>Most PDF editors struggle with RTL (Right-to-Left) text. Our PDF Studio is built from the ground up to handle Arabic fonts, ligatures, and layouts perfectly...</p>',
                    ar: '<h3>تحرير ملفات PDF العربية أصبح سهلاً</h3><p>تعاني معظم محررات PDF مع النصوص التي تكتب من اليمين إلى اليسار. تم بناء استوديو PDF الخاص بنا من الصفر للتعامل مع الخطوط العربية والتنسيقات بشكل مثالي...</p>'
                },
                contentType: 'article',
                status: 'published',
                featuredImage: 'ocr1200.jpg',
                categories: ['Articles'],
                tags: ['PDF Editor', 'Productivity', 'Arabic Support'],
                views: 112,
                readingTime: 4
            },
            {
                title: {
                    en: 'How Arabic OCR Recognizes Handwriting with AI',
                    ar: 'كيف يتعرف Arabic OCR على الخط اليدوي باستخدام الذكاء الاصطناعي'
                },
                slug: 'arabic-handwriting-ocr-ai',
                excerpt: {
                    en: 'Diving deep into the neural networks that power our cursive Arabic handwriting recognition.',
                    ar: 'تعمق في الشبكات العصبية التي تدعم ميزة التعرف على الخط العربي اليدوي المتصل.'
                },
                content: {
                    en: '<h3>The Complexity of Arabic Script</h3><p>Arabic handwriting presents unique challenges due to its cursive nature and varying styles. Our AI models use deep learning to understand the context of each stroke...</p>',
                    ar: '<h3>تعقيد الخط العربي</h3><p>يمثل الخط العربي اليدوي تحديات فريدة بسبب طبيعته المتصلة وأنماطه المتنوعة. تستخدم نماذج الذكاء الاصطناعي لدينا التعلم العميق لفهم سياق كل ضربة قلم...</p>'
                },
                contentType: 'article',
                status: 'published',
                featuredImage: 'ocr.jpg',
                categories: ['Articles'],
                tags: ['Handwriting', 'AI', 'Machine Learning'],
                views: 320,
                readingTime: 7
            },
            {
                title: {
                    en: 'Exploring Google Vision SDK Features',
                    ar: 'استكشاف ميزات Google Vision SDK'
                },
                slug: 'google-vision-sdk-features',
                excerpt: {
                    en: 'Understanding how we leverage Google Cloud Vision to provide industry-leading OCR accuracy.',
                    ar: 'فهم كيفية استفادتنا من Google Cloud Vision لتوفير دقة استخراج نصوص رائدة في الصناعة.'
                },
                content: {
                    en: '<h3>Powering Accuracy</h3><p>Google Vision SDK offers powerful tools for image analysis. By integrating these features, ArabicOCR can detect landmards, logos, and intricate text structures with ease...</p>',
                    ar: '<h3>تعزيز الدقة</h3><p>يوفر Google Vision SDK أدوات قوية لتحليل الصور. من خلال دمج هذه الميزات، يمكن لـ ArabicOCR اكتشاف المعالم والشعارات وهياكل النصوص المعقدة بسهولة...</p>'
                },
                contentType: 'article',
                status: 'published',
                featuredImage: 'googleai.svg',
                categories: ['Articles'],
                tags: ['Google Vision', 'SDK', 'Technology'],
                views: 156,
                readingTime: 5
            },
            {
                title: {
                    en: 'Apple LLM Vision: Innovation and Privacy',
                    ar: 'رؤية Apple LLM: الابتكار والخصوصية'
                },
                slug: 'apple-llm-vision-privacy',
                excerpt: {
                    en: 'How Apple is revolutionizing on-device AI vision while maintaining strict user privacy.',
                    ar: 'كيف تُحدث Apple ثورة في رؤية الذكاء الاصطناعي على الجهاز مع الحفاظ على خصوصية المستخدم الصارمة.'
                },
                content: {
                    en: '<h3>Privacy First AI</h3><p>Apple’s approach to LLM Vision focuses on on-device processing. This ensures that your sensitive documents never leave your hardware, providing a secure OCR environment...</p>',
                    ar: '<h3>ذكاء اصطناعي يراعي الخصوصية أولاً</h3><p>يركز نهج Apple في رؤية LLM على المعالجة على الجهاز. يضمن ذلك عدم خروج مستنداتك الحساسة أبداً من جهازك، مما يوفر بيئة آمنة لاستخراج النصوص...</p>'
                },
                contentType: 'news',
                status: 'published',
                featuredImage: 'mac1.webp',
                categories: ['News'],
                tags: ['Apple', 'LLM', 'Privacy', 'AI'],
                views: 289,
                readingTime: 6
            },
            {
                title: {
                    en: 'ArabicOCR: Now Available on iOS and Android',
                    ar: 'ArabicOCR: متوفر الآن على iOS و Android'
                },
                slug: 'apps-available-ios-android',
                excerpt: {
                    en: 'Take the power of Arabic OCR wherever you go with our official mobile applications.',
                    ar: 'خذ قوة Arabic OCR معك أينما ذهبت من خلال تطبيقاتنا الرسمية للهواتف المحمولة.'
                },
                content: {
                    en: '<h3>OCR in Your Pocket</h3><p>We are thrilled to announce that our mobile apps are now live on both the App Store and Google Play. Scan documents on the fly and sync them with your web portal account...</p>',
                    ar: '<h3>استخراج النصوص في جيبك</h3><p>يسعدنا أن نعلن أن تطبيقاتنا للهواتف المحمولة متوفرة الآن على متجري App Store و Google Play. امسح المستندات ضوئياً أثناء التنقل وقم بمزامنتها مع حساب البوابة الإلكترونية الخاص بك...</p>'
                },
                contentType: 'news',
                status: 'published',
                featuredImage: 'sc1.webp',
                categories: ['News'],
                tags: ['Mobile Apps', 'iOS', 'Android', 'App Store'],
                views: 432,
                readingTime: 3
            },
            {
                title: {
                    en: 'macOS & Apple LLM: Fast and Easy OCR',
                    ar: 'نظام macOS و Apple LLM: استخراج نصوص سريع وسهل'
                },
                slug: 'macos-apple-llm-fast-ocr',
                excerpt: {
                    en: 'Experience lightning-fast Arabic text recognition on your Mac using the latest Apple Vision technologies.',
                    ar: 'اختبر التعرف السريع على النصوص العربية على جهاز Mac الخاص بك باستخدام أحدث تقنيات Apple Vision.'
                },
                content: {
                    en: '<h3>The Best Desktop Experience</h3><p>Using the power of Apple M-series chips and the latest macOS updates, ArabicOCR delivers instant results. The integration with Apple LLM makes it faster than ever before...</p>',
                    ar: '<h3>أفضل تجربة سطح مكتب</h3><p>باستخدام قوة رقائق Apple M وتحديثات macOS الأخيرة، يقدم ArabicOCR نتائج فورية. إن التكامل مع Apple LLM يجعله أسرع من أي وقت مضى...</p>'
                },
                contentType: 'article',
                status: 'published',
                featuredImage: 'mac2.webp',
                categories: ['Articles'],
                tags: ['macOS', 'Apple Silicon', 'Speed', 'AI'],
                views: 215,
                readingTime: 4
            }
        ];

        for (const post of posts) {
            const postData = {
                ...post,
                author: {
                    uid: user.uid,
                    name: user.displayName || 'Admin',
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

        alert('Success! 7 New Blog Posts have been created.');
        if (window.location.pathname.includes('blog-admin.html')) {
            window.location.reload();
        }

    } catch (error) {
        console.error('Seed error:', error);
        alert('Error seeding extra blogs: ' + error.message);
    }
}

window.seedExtraBlogs = seedExtraBlogs;
