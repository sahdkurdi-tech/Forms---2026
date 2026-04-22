// js/auth.js

firebase.auth().onAuthStateChanged(async (user) => {
    const path = window.location.pathname;
    const isPublicPage = path.includes("login.html") || path.includes("view.html");

    if (!user) {
        if (!isPublicPage) window.location.href = "login.html";
        return;
    }

    // --- ئەم بەشە نوێیە زیاد کرا ---
    // ئەگەر بەکارهێنەر لۆگین بووە و ئێستا لە پەڕەی لۆگینە، ڕاستەوخۆ بیبە بۆ پەڕەی سەرەکی
    if (path.includes("login.html")) {
        window.location.href = "index.html";
        return; 
    }
    // -------------------------------

    // لێرەدا دەچین زانیاری بەکارهێنەر لە داتابەیس دەهێنین
    // بەکارهێنانی toLowerCase() بۆ دڵنیابوون لە نەبوونی کێشەی پیتی گەورە و بچووک
    const userEmail = user.email.toLowerCase();
    const userDoc = await db.collection("users").doc(userEmail).get();

    if (!userDoc.exists) {
        // ئەگەر ئەم کەسە لە داتابەیس نەبوو، واتە هیچ دەسەڵاتێکی نییە
        alert("تۆ تۆمار نەکراویت!");
        firebase.auth().signOut();
        window.location.href = "login.html";
        return;
    }

    const userData = userDoc.data();
// ==========================================
    // زیادکراو بۆ پیشاندانی دوگمەی چاودێری بۆ ئەدمین
    // ==========================================
    if (userData.role === 'owner') {
        // لێرەدا دەگەڕێت بەدوای هەموو ئەو دوگمانەی ئەم کلاسەیان هەیە لە هەر شوێنێکی پەڕەکە بن
        const adminLinks = document.querySelectorAll('.admin-only-link');
        
        adminLinks.forEach(link => {
            // ١. سڕینەوەی کڵاسی شاردنەوە
            link.classList.remove('d-none');
            
            // ٢. پێدانی شێوازی دەرکەوتن بەپێی جۆری تاگەکە بۆ ئەوەی دیزاینی مینیۆکان تێک نەچێت
            if (link.tagName.toUpperCase() === 'LI') {
                // بۆ مینیۆی مۆبایل کە بە <li> دروستکراوە
                link.style.setProperty('display', 'block', 'important');
            } else if (link.tagName.toUpperCase() === 'A') {
                // بۆ سایدباری کۆمپیوتەر کە بە <a> دروستکراوە
                link.style.setProperty('display', 'flex', 'important');
            } else {
                link.style.setProperty('display', 'block', 'important');
            }
        });
    }
    // ==========================================
    //     // پاراستنی پەڕە هەستیارەکان (Settings & Builder)
    // تەنها ئەوانە دەتوانن بچن کە ڕۆڵیان 'owner'ـە
    if (path.includes("settings.html") || path.includes("builder.html")) {
        if (userData.role !== 'owner') {
            alert("تۆ دەسەڵاتی چوونە ناو سێتینگت نییە!");
            window.location.href = "index.html";
        }
    }
});

function logout() {
    firebase.auth().signOut().then(() => {
        window.location.href = "login.html";
    });
}