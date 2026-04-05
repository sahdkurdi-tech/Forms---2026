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

    // پاراستنی پەڕە هەستیارەکان (Settings & Builder)
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