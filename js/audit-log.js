// js/audit-log.js

let lastVisibleLog = null;
const PAGE_SIZE = 50;

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        const userDoc = await db.collection("users").doc(user.email.toLowerCase()).get();
        if (userDoc.exists && userDoc.data().role === 'owner') {
            fetchLogs();
            loadUsersForFilter(); 
        } else {
            alert("تۆ دەسەڵاتی بینینی ئەم پەڕەیەت نییە!");
            window.location.href = "index.html";
        }
    }
});

document.getElementById('filterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    lastVisibleLog = null; 
    fetchLogs();
});

document.getElementById('resetFilter').addEventListener('click', () => {
    document.getElementById('filterForm').reset();
    lastVisibleLog = null;
    fetchLogs();
});

async function fetchLogs(isLoadMore = false) {
    const container = document.getElementById('logsContainer');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    if (!isLoadMore) {
        container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary mb-3"></div><p>خەریکی هێنانی زانیارییەکان...</p></div>';
    }

    let query = db.collection("audit_logs").orderBy("timestamp", "desc");

    const userEmail = document.getElementById('filterUser').value.trim();
    const action = document.getElementById('filterAction').value;
    const startDate = document.getElementById('filterStartDate').value;
    const endDate = document.getElementById('filterEndDate').value;

    if (userEmail) query = query.where("user", "==", userEmail.toLowerCase());
    if (action) query = query.where("actionType", "==", action);
    
    if (startDate) query = query.where("timestamp", ">=", new Date(startDate + "T00:00:00"));
    if (endDate) query = query.where("timestamp", "<=", new Date(endDate + "T23:59:59"));

    if (isLoadMore && lastVisibleLog) query = query.startAfter(lastVisibleLog);

    query = query.limit(PAGE_SIZE);

    try {
        const snapshot = await query.get();
        
        if (!isLoadMore) container.innerHTML = '';
        
        if (snapshot.empty && !isLoadMore) {
            container.innerHTML = '<div class="text-center py-5 text-muted"><i class="fa-solid fa-folder-open fa-3x mb-3 opacity-50"></i><p>هیچ تۆمارێک نەدۆزرایەوە</p></div>';
            loadMoreBtn.classList.add('d-none');
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            container.insertAdjacentHTML('beforeend', renderLogCard(data));
        });

        lastVisibleLog = snapshot.docs[snapshot.docs.length - 1];

        if (snapshot.docs.length < PAGE_SIZE) {
            loadMoreBtn.classList.add('d-none');
        } else {
            loadMoreBtn.classList.remove('d-none');
        }
        
    } catch (error) {
        console.error("Error fetching logs: ", error);
        if(error.message.includes("requires an index")) {
            container.innerHTML = `<div class="alert alert-danger"><i class="fa-solid fa-triangle-exclamation"></i> پێویستە Index دروست بکەیت لە فایەربەیس. کۆنسۆڵ (F12) بکەرەوە بۆ بینینی لینکەکە.</div>`;
        }
    }
}

// فەنکشنی سەرەکی بۆ دروستکردنی کارتی گۆڕانکارییەکان
function renderLogCard(log) {
    const time = log.timestamp ? log.timestamp.toDate().toLocaleString('ku-IQ') : '-';
    let actionBadge = '';
    let borderClass = '';
    let icon = '';

    switch(log.actionType) {
        case 'CREATE': 
            actionBadge = '<span class="badge bg-success bg-opacity-10 text-success border border-success px-3 py-2"><i class="fa-solid fa-plus me-1"></i> زیادکردن</span>'; 
            borderClass = 'border-start border-4 border-success';
            icon = '<div class="bg-success text-white rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width: 45px; height: 45px; font-size: 1.2rem;"><i class="fa-solid fa-file-circle-plus"></i></div>';
            break;
        case 'UPDATE': 
            actionBadge = '<span class="badge bg-warning bg-opacity-10 text-warning border border-warning px-3 py-2"><i class="fa-solid fa-pen me-1"></i> دەستکاری</span>'; 
            borderClass = 'border-start border-4 border-warning';
            icon = '<div class="bg-warning text-dark rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width: 45px; height: 45px; font-size: 1.2rem;"><i class="fa-solid fa-pen-to-square"></i></div>';
            break;
        case 'DELETE': 
            actionBadge = '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-3 py-2"><i class="fa-solid fa-trash me-1"></i> سڕینەوە</span>'; 
            borderClass = 'border-start border-4 border-danger';
            icon = '<div class="bg-danger text-white rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width: 45px; height: 45px; font-size: 1.2rem;"><i class="fa-solid fa-trash-can"></i></div>';
            break;
    }

    let detailsHtml = '';
    if (log.actionType === 'UPDATE' && log.changes) {
        detailsHtml = `<div class="bg-light rounded-3 p-3 mt-3 border diff-container">
                        <div class="text-muted small fw-bold mb-3 border-bottom pb-2">وردەکاری گۆڕانکارییەکان:</div>
                        <ul class="list-unstyled m-0 gap-3 d-flex flex-column">`;
        log.changes.forEach(change => {
            detailsHtml += `<li>
                                <div class="fw-bold text-primary mb-2"><i class="fa-solid fa-caret-left ms-1"></i> ${change.field}</div>
                                <div class="d-flex flex-column gap-2 pe-3 border-end border-2 border-primary border-opacity-25">
                                    <div class="d-flex align-items-start gap-2">
                                        <span class="badge bg-secondary opacity-75">پێشتر:</span> 
                                        <del class="text-danger bg-danger bg-opacity-10 px-2 rounded small text-break w-100">${change.old}</del>
                                    </div>
                                    <div class="d-flex align-items-start gap-2">
                                        <span class="badge bg-primary">نوێ:</span> 
                                        <ins class="text-success text-decoration-none bg-success bg-opacity-10 px-2 rounded small text-break w-100">${change.new}</ins>
                                    </div>
                                </div>
                            </li>`;
        });
        detailsHtml += `</ul></div>`;
    } else if (log.actionType === 'DELETE') {
        detailsHtml = `<div class="bg-light rounded p-3 mt-3 border diff-container text-muted"><i class="fa-solid fa-info-circle ms-1"></i> داتای کەیسەکە بەتەواوی سڕدرایەوە.</div>`;
    } else {
        detailsHtml = `<div class="bg-light rounded p-3 mt-3 border diff-container text-muted"><i class="fa-solid fa-info-circle ms-1"></i> داتای نوێ دروستکرا.</div>`;
    }

    // دیاریکردنی ناوی کەسەکە (ئەگەر نەیبوو ئایدییەکەی پیشان دەدات)
    let targetNameDisplay = log.caseName ? log.caseName : `ID: ${log.documentId.substring(0,6).toUpperCase()}`;

    return `
        <div class="card shadow-sm border-0 rounded-4 audit-card ${borderClass} bg-white">
            <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-3">
                    <div class="d-flex align-items-center gap-3">
                        ${icon}
                        <div>
                            <h6 class="mb-1 fw-bold text-dark fs-5">${log.user}</h6>
                            <div class="d-flex flex-wrap gap-2 mt-2">
                                <span class="badge bg-secondary bg-opacity-10 text-secondary border"><i class="fa-solid fa-folder-open ms-1"></i> ${log.collection}</span>
                                <span class="badge bg-primary bg-opacity-10 text-primary border"><i class="fa-solid fa-user ms-1"></i> داتای: ${targetNameDisplay}</span>
                            </div>
                        </div>
                    </div>
                    <div class="text-end text-sm-start mt-2 mt-sm-0">
                        <div class="mb-2">${actionBadge}</div>
                        <div class="text-muted small fw-bold" dir="ltr"><i class="fa-regular fa-clock me-1"></i> ${time}</div>
                    </div>
                </div>
                
                <div class="details-section">
                    ${detailsHtml}
                </div>
                
                <div class="mt-4 text-end border-top pt-3">
                    <span class="text-muted small"><i class="fa-solid fa-network-wired ms-1"></i> ئایپی: <span dir="ltr" class="fw-bold">${log.ipAddress || 'نەزانراو'}</span></span>
                </div>
            </div>
        </div>
    `;
}

// هێنانی لیستی کارمەندەکان بۆ ناو فلتەرەکە
async function loadUsersForFilter() {
    try {
        const userSelect = document.getElementById('filterUser');
        const snapshot = await db.collection("users").get();
        snapshot.forEach(doc => {
            const email = doc.id;
            userSelect.innerHTML += `<option value="${email}">${email}</option>`;
        });
    } catch (error) {
        console.error("Error loading users: ", error);
    }
}

function loadMoreLogs() {
    fetchLogs(true);
}