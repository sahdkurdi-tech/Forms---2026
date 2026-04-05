// js/dashboard.js

// بەکارهێنانی orderBy بۆ هێنان بەپێی ڕیزبەندی دیاریکراو
db.collection("forms").orderBy("order", "asc").onSnapshot(async (snapshot) => {
    const container = document.getElementById('formsContainer');
    const loadingSpinner = document.getElementById('loadingSpinner');

    if (loadingSpinner) loadingSpinner.style.display = 'none';
    container.innerHTML = "";

    // --- بەشی گرنگ: چارەسەرکردنی کێشەی دیارنەمان ---
    if (snapshot.empty) {
        // پشکنین دەکەین بزانین ئایا بەڕاستی هیچ فۆڕمێک نییە، یان تەنها Orderیان نییە؟
        // تێبینی: ئەمە یەکجار ڕوودەدات بۆ چاککردنی داتاکانی کۆن
        const checkSnapshot = await db.collection("forms").get();

        if (!checkSnapshot.empty) {
            // واتە: فۆڕم هەیە، بەڵام چونکە orderـیان نییە دەرناکەون
            console.log("Detecting old forms without order. Fixing...");

            const batch = db.batch();
            checkSnapshot.docs.forEach((doc, index) => {
                // ئەگەر orderی نەبوو، بۆی دادەنێین
                if (doc.data().order === undefined) {
                    batch.update(doc.ref, { order: index });
                }
            });
            await batch.commit();
            // لێرەدا کۆدەکە خۆی Refresh دەبێتەوە چونکە onSnapshot گوێی گرتووە
            return;
        }

        // ئەگەر بەڕاستی هیچ فۆڕمێک نەبوو:
        container.innerHTML = `
            <div class="col-12 text-center mt-5">
                <div class="opacity-50 mb-3"><i class="fa-solid fa-folder-open fa-4x"></i></div>
                <h4>هیچ فۆڕمێک نەدۆزرایەوە</h4>
                <p class="text-muted">لەرێگەی دوگمەی "فۆڕمی نوێ" یەکەم فۆڕمت دروست بکە</p>
            </div>`;
        return;
    }
    // --------------------------------------------------

    snapshot.forEach((doc) => {
        const data = doc.data();
        const id = doc.id;
        const viewLink = `${window.location.origin}/view.html?id=${id}`;
        const isActive = data.active !== false;

        container.innerHTML += `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="project-card-advanced">
                    <div class="project-header">
                        <div class="project-icon-wrapper">
                            <i class="fa-solid fa-layer-group"></i>
                        </div>
                        <span class="project-status ${isActive ? 'status-active' : 'status-paused'}">
                            <i class="fa-solid ${isActive ? 'fa-check-circle' : 'fa-pause-circle'} ms-1"></i> 
                            ${isActive ? 'چالاکە' : 'ڕاگیراوە'}
                        </span>
                    </div>
                    
                    <h3 class="project-title text-truncate" title="${data.title || 'بێ ناو'}">${data.title || 'بێ ناو'}</h3>
                    <div class="project-meta">
                        <span>
                            <i class="fa-regular fa-clock"></i> 
                            ${data.createdAt ? new Date(data.createdAt.toDate()).toLocaleDateString('ku-IQ') : 'نوێ'}
                        </span>
                    </div>

                    <div class="project-actions">
                        <a href="${viewLink}" target="_blank" class="btn-fill-adv">
                            <i class="fa-solid fa-pen-to-square"></i> پڕکردنەوە
                        </a>
                        <a href="builder.html?id=${id}" class="btn-design-adv" title="دەستکاری دیزاین">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                        </a>
                    </div>

                    <div class="project-footer">
                        <a href="data.html?id=${id}" class="btn-data-adv">
                            داتاکان <i class="fa-solid fa-arrow-left"></i>
                        </a>
                        <div class="util-btn-group">
                            <button onclick="copyLink('${viewLink}')" class="util-btn-adv" title="کۆپی لینک">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                            <button onclick="toggleProjectStatus('${id}', ${isActive})" class="util-btn-adv" title="${isActive ? 'ڕاگرتن' : 'چالاککردن'}">
                                <i class="fa-solid ${isActive ? 'fa-pause' : 'fa-play'}"></i>
                            </button>
                            <button onclick="deleteForm('${id}')" class="util-btn-adv delete" title="سڕینەوە">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
});