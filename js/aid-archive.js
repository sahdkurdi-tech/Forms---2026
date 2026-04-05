// js/aid-archive.js

let formFieldsCache = [];
let allArchivedCases = []; 
let categoriesCache = {}; 

// گۆڕاوە نوێیەکان بۆ سیستەمی Load More
let lastVisibleDoc = null; 
const PAGE_SIZE = 30; 
let isFetching = false; 
let hasMoreData = true; 

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        const userDoc = await db.collection("users").doc(user.email.toLowerCase()).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.role !== 'owner' && !userData.canViewArchive) {
                alert("تۆ دەسەڵاتی چوونەژوورەوەت نییە بۆ بەشی ئەرشیف!");
                window.location.href = "index.html"; 
                return; 
            }
            if (userData.role !== 'owner') {
                const settingsLink = document.querySelector('a[href="settings.html"]');
                if (settingsLink) settingsLink.style.display = 'none';
            }
            initArchive();
        } else {
            alert("تۆ ڕێگەپێدراو نیت!");
            window.location.href = "login.html";
        }
    } else {
        window.location.href = "login.html";
    }
});

// ==========================================
// فەنکشنەکانی کات و حیسابات
// ==========================================
function formatDateTime(timestamp) {
    if (!timestamp) return '<span class="text-muted opacity-50">نەزانراو</span>';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '<span class="text-muted opacity-50">نەزانراو</span>';
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const dateString = date.toLocaleDateString('ku-IQ', options);
    const timeString = date.toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dateString} <span class="mx-1 text-muted">|</span> ${timeString}`;
}

function getDaysBetween(startStamp, endStamp) {
    if (!startStamp || !endStamp) return 0;
    const start = startStamp.toDate ? startStamp.toDate() : new Date(startStamp);
    const end = endStamp.toDate ? endStamp.toDate() : new Date(endStamp);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diffTime = endDay - startDay;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

// ==========================================
// فەنکشنەکانی گەڕانی زیرەک
// ==========================================
function convertToEnglishNumbers(str) {
    if (!str) return '';
    const arabicNumbers = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
    let result = String(str);
    for (let i = 0; i < 10; i++) {
        result = result.replace(arabicNumbers[i], i);
    }
    return result.toLowerCase();
}

function smartSearchMatch(caseData, query) {
    if (!query) return true;
    query = convertToEnglishNumbers(query);
    for (let key in caseData) {
        if (typeof caseData[key] === 'string' || typeof caseData[key] === 'number') {
            let val = convertToEnglishNumbers(caseData[key]);
            if (val.includes(query)) return true;
        }
    }
    return false;
}

// ==========================================
// دەستپێکردنی ئەرشیف
// ==========================================
function initArchive() {
    loadCategoriesForFilter(); 
    
    db.collection("aid_fields").doc("main_form").get().then(doc => {
        formFieldsCache = [];
        if (doc.exists && doc.data().fields) {
            flattenFieldsCache(doc.data().fields);
        }
        getTotalArchiveCount();
        loadArchivedCasesPage(true); 
    });

    document.getElementById('searchInput').addEventListener('input', () => { debounceSearch() });
    document.getElementById('categoryFilter').addEventListener('change', () => { loadArchivedCasesPage(true) });
    document.getElementById('statusFilter').addEventListener('change', () => { loadArchivedCasesPage(true) });

    // سکڕۆڵی زیرەک
    window.addEventListener('scroll', () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 200) {
            if (!isFetching && hasMoreData) {
                loadArchivedCasesPage(false);
            }
        }
    });
}

let searchTimeout;
function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadArchivedCasesPage(true);
    }, 500); 
}

// فەنکشنی هێنانی کۆی گشتی کەیسەکان (بۆ ڤێرژنی 9.6.1)
async function getTotalArchiveCount() {
    try {
        const snapshot = await db.collection("aid_cases").where("stage", "==", "archived").get();
        document.getElementById('totalCount').innerText = `کۆی گشتی: ${snapshot.size}`;
    } catch (error) {
        console.error("هەڵە لە ژماردن:", error);
    }
}

function loadCategoriesForFilter() {
    db.collection("aid_categories").onSnapshot(snapshot => {
        const filterSelect = document.getElementById('categoryFilter');
        filterSelect.innerHTML = '<option value="">هەموو بەشەکان</option>';
        categoriesCache = {};
        snapshot.forEach(doc => {
            categoriesCache[doc.id] = doc.data().name;
            filterSelect.innerHTML += `<option value="${doc.id}">${doc.data().name}</option>`;
        });
    });
}

function flattenFieldsCache(fields) {
    fields.forEach(f => {
        formFieldsCache.push({ id: f.id, label: f.label, type: f.type });
        if (f.children && f.children.length > 0) {
            flattenFieldsCache(f.children);
        }
    });
}

// ==========================================
// هێنانی داتاکان بە شێوەی پەڕە پەڕە (Pagination)
// ==========================================
async function loadArchivedCasesPage(isFirstPage = false) {
    if (isFetching) return;
    isFetching = true;

    const list = document.getElementById('archivedCasesList');
    const searchQuery = document.getElementById('searchInput').value.trim();
    const selectedCategory = document.getElementById('categoryFilter').value;
    const selectedStatus = document.getElementById('statusFilter').value;

    if (isFirstPage) {
        list.innerHTML = '<div class="col-12 text-center text-muted mt-5"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>';
        allArchivedCases = [];
        lastVisibleDoc = null;
        hasMoreData = true;
    } else {
        list.innerHTML += '<div id="loadingMore" class="col-12 text-center text-muted my-4"><i class="fa-solid fa-spinner fa-spin fa-lg"></i></div>';
    }

    try {
        let query = db.collection("aid_cases").where("stage", "==", "archived");

        if (selectedCategory) {
            query = query.where("categoryId", "==", selectedCategory);
        }
        if (selectedStatus && selectedStatus !== 'all') {
            query = query.where("status", "==", selectedStatus);
        }

        query = query.orderBy("completedAt", "desc").limit(PAGE_SIZE);

        if (lastVisibleDoc) {
            query = query.startAfter(lastVisibleDoc);
        }

        const snapshot = await query.get();

        const loadingMsg = document.getElementById('loadingMore');
        if (loadingMsg) loadingMsg.remove();

        if (snapshot.empty) {
            hasMoreData = false;
            if (isFirstPage) {
                list.innerHTML = '<div class="col-12 text-center text-muted mt-5"><i class="fa-solid fa-folder-open fa-3x mb-3 opacity-25"></i><p>هیچ کەیسێک نەدۆزرایەوە!</p></div>';
            } else {
                list.innerHTML += '<div class="col-12 text-center text-muted my-3 small">کۆتایی لیستەکە</div>';
            }
            isFetching = false;
            return;
        }

        lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];

        if (isFirstPage) list.innerHTML = '';

        snapshot.forEach(doc => {
            const data = doc.data();
            if (!searchQuery || smartSearchMatch(data, searchQuery)) {
                allArchivedCases.push({ id: doc.id, data: data });
                renderSingleCase(doc.id, data, list);
            }
        });

        if (snapshot.docs.length < PAGE_SIZE) {
            hasMoreData = false;
        }

    } catch (error) {
        console.error("Error loading cases:", error);
        list.innerHTML = '<div class="col-12 text-center text-danger mt-5">هەڵەیەک ڕوویدا لە هێنانی داتاکان! تکایە پەڕەکە نوێ بکەرەوە.</div>';
    }

    isFetching = false;
}

// ==========================================
// دروستکردنی کارتی کەیسەکان
// ==========================================
function renderSingleCase(docId, data, listContainer) {
    const primaryText = getPrimaryText(data);
    const detailsHtml = generateDetailsHtml(data);
    const badgeClass = getBadgeClass(data.status);
    const catName = categoriesCache[data.categoryId] || 'نەزانراو';

    const distEndStamp = data.assignedAt || data.completedAt || data.createdAt;
    const distDays = getDaysBetween(data.createdAt, distEndStamp);
    
    const catDays = data.assignedAt ? getDaysBetween(data.assignedAt, data.completedAt || data.assignedAt) : 0;
    
    const isDelayed = (distDays >= 7 || catDays >= 7);
    const cardBorderClass = isDelayed ? 'case-delayed-border' : '';
    const warningBadge = isDelayed ? `<div class="case-delayed-badge fw-bold"><i class="fa-solid fa-triangle-exclamation ms-1"></i> ئەم کەیسە زیاتر لە ٧ ڕۆژی پێچووە!</div>` : '';

    const html = `
        <div class="col-md-6 col-lg-4 mb-4">
            <div class="archive-card ${cardBorderClass}" style="position: relative;">
                ${warningBadge}
                
                <div class="status-badge ${badgeClass}" style="${isDelayed ? 'position: relative; top: 0; left: 0; margin-bottom: 15px; display: inline-block;' : ''}">${data.status || 'نەزانراو'}</div>
                
                <h6 class="fw-bold mb-3 text-primary ${isDelayed ? '' : 'mt-4'}"><i class="fa-solid fa-file-invoice text-secondary me-2"></i> ${primaryText}</h6>
                
                <div class="mb-3 text-muted" style="font-size: 0.85rem;">
                    <i class="fa-solid fa-layer-group me-1"></i> بەش: <strong class="text-dark">${catName}</strong>
                </div>

                <div class="time-tracking-box">
                    <div class="d-flex justify-content-between mb-2 pb-2 border-bottom">
                        <span class="text-muted"><i class="fa-solid fa-box-archive me-1"></i> کاتی بڕیار:</span>
                        <span class="text-dark fw-bold" dir="ltr" style="font-size: 0.8rem;">${formatDateTime(data.completedAt)}</span>
                    </div>
                    <div class="d-flex justify-content-between mb-1">
                        <span class="text-muted" style="font-size: 0.8rem;"><i class="fa-solid fa-share-nodes me-1"></i> لە دابەشکردن مایەوە:</span>
                        <span class="${distDays >= 7 ? 'text-danger fw-bold' : 'text-primary fw-bold'}" style="font-size: 0.8rem;">${distDays === 0 ? 'کەمتر لە ڕۆژێک' : distDays + ' ڕۆژ'}</span>
                    </div>
                    <div class="d-flex justify-content-between">
                        <span class="text-muted" style="font-size: 0.8rem;"><i class="fa-regular fa-calendar-days me-1"></i> لە بەشەکان مایەوە:</span>
                        <span class="${catDays >= 7 ? 'text-danger fw-bold' : 'text-primary fw-bold'}" style="font-size: 0.8rem;">${catDays === 0 ? 'کەمتر لە ڕۆژێک' : catDays + ' ڕۆژ'}</span>
                    </div>
                </div>

                ${detailsHtml}
                
                <div class="pt-2 text-center mt-3 border-top pt-3">
                    <button class="btn btn-sm btn-outline-warning w-100 rounded-pill" onclick="restoreCase('${docId}')" title="گەڕاندنەوە بۆ بەشی دابەشکردن">
                        <i class="fa-solid fa-rotate-left"></i> گەڕاندنەوە بۆ تەختە
                    </button>
                </div>
            </div>
        </div>
    `;
    listContainer.insertAdjacentHTML('beforeend', html);
}

function generateDetailsHtml(data) {
    let html = '<div class="mt-3 mb-3 p-2 border rounded shadow-sm bg-light" style="font-size: 0.85rem; max-height: 150px; overflow-y: auto;">';
    const isDarkMode = document.body.classList.contains('dark-mode');
    if (isDarkMode) html = html.replace('bg-light', '');

    formFieldsCache.forEach(field => {
        const key = field.label;
        if (data[key] !== undefined && data[key] !== '') {
            html += `
                <div class="d-flex justify-content-between mb-1 border-bottom pb-1">
                    <span class="text-muted"><i class="fa-solid fa-angle-left me-1" style="font-size: 0.6rem;"></i> ${key}:</span>
                    <strong class="ms-2 text-start" style="max-width: 65%; word-wrap: break-word;">${data[key]}</strong>
                </div>
            `;
        }
    });
    html += '</div>';
    return html;
}

function getPrimaryText(data) {
    const firstFieldLabel = formFieldsCache.length > 0 ? formFieldsCache[0].label : null;
    return firstFieldLabel && data[firstFieldLabel] ? data[firstFieldLabel] : 'بێ ناو';
}

function getBadgeClass(status) {
    switch (status) {
        case 'سەردانی کراوان': return 'badge-success';
        case 'بەردەست نەبوو': return 'badge-danger';
        case 'پێویستی بە سەردان نەبوو': return 'badge-secondary';
        case 'پێشتر سەردانی کراوە': return 'badge-info';
        default: return 'badge-secondary';
    }
}

async function restoreCase(id) {
    if (confirm("دڵنیایت کە دەتەوێت ئەم کەیسە بگەڕێنیتەوە بۆ ناو بەشەکان؟ (بۆ ئەوەی دووبارە بڕیاری لەسەر بدرێتەوە)")) {
        await db.collection("aid_cases").doc(id).update({
            stage: 'category',
            status: 'pending'
        });
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'کەیسەکە گەڕێندرایەوە', showConfirmButton: false, timer: 1500 });
        loadArchivedCasesPage(true);
    }
}