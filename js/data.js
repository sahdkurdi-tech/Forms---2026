// js/data.js

// Service Worker Cleanup
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister()));
}

// Global Variables
const urlParams = new URLSearchParams(window.location.search);
const formId = urlParams.get('id');

let totalDatabaseCount = 0; 
let formFields = []; 
let allSubmissions = []; 
let currentRenderIndex = 0; 
const BATCH_SIZE = 50; 
let isRendering = false;
let currentUserPermissions = { canDelete: false, canEdit: false, canExport: false };
let selectedIds = new Set();
let editPhotosStore = {}; 

// Pagination Variables
let lastVisibleDoc = null; 
const PAGE_SIZE = 50; 
let isFetching = false;

// Search Variables
let isAllDataLoaded = false; 
let searchDebounceTimer;
let currentSearchResults = [];
let currentSearchPage = 1;
const SEARCH_PAGE_SIZE = 50;

// ============================================================
// فەنکشنی زیرەک بۆ خوێندنەوەی داتا 
// ============================================================
function getFieldValue(dataObj, fieldDef) {
    if (!dataObj || !fieldDef) return undefined;
    
    // ئەگەر خانەکە چەند ئایدییەکی هەبوو (واتە لەناو چەند لقێکدا هەمان ناوی هەبوو وەک "ناونیشان")
    if (fieldDef.ids && fieldDef.ids.length > 0) {
        for (let id of fieldDef.ids) {
            if (dataObj[id] !== undefined && dataObj[id] !== null && dataObj[id] !== "") {
                return dataObj[id]; // یەکەم وەڵام کە دۆزییەوە بیهێنەوە
            }
        }
    } 
    // ئەگەر تەنیا یەک ئایدی بوو (بۆ کاتی مۆدال و پیشاندانی ئاسایی)
    else if (fieldDef.id && dataObj[fieldDef.id] !== undefined && dataObj[fieldDef.id] !== "") {
        return dataObj[fieldDef.id];
    }
    
    // بۆ داتا کۆنەکان
    if (dataObj[fieldDef.label] !== undefined && dataObj[fieldDef.label] !== "") {
        return dataObj[fieldDef.label];
    }
    
    return undefined;
}

// ============================================================
// فەنکشنی زیرەک بۆ چارەسەری هەموو جۆرە وێنە و واژۆیەک (سیحری کێشەکە لێرەدایە)
// ============================================================
function parseImageUrls(val) {
    if (!val) return [];
    
    let urls = [];
    if (Array.isArray(val)) {
        urls = val;
    } else if (typeof val === 'string') {
        let str = val.trim();
        if (str === '' || str === '-') return []; // ئەگەر تەنیا هێمای - بوو وازی لێ بهێنە

        if (str.startsWith('data:image')) {
            return [str];
        }
        urls = str.split(/[،,\n\s]+/);
    }
    
    // پاککردنەوەی هەموو لینکەکان لە بۆشایی و هێمای هەڵە
    return urls.map(u => typeof u === 'string' ? u.trim() : '')
               .filter(u => u !== '' && u !== '-');
}
// ============================================================
// 1. AUTHENTICATION & PERMISSIONS
// ============================================================
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const userDoc = await db.collection("users").doc(user.email).get();
            if(userDoc.exists) {
                const data = userDoc.data();
                if (data.role === 'owner') {
                    currentUserPermissions = { canDelete: true, canEdit: true, canExport: true };
                } else {
                    currentUserPermissions = {
                        canDelete: data.canDelete || false,
                        canEdit: data.canEdit || false,
                        canExport: data.canExport || false
                    };
                }
            }
            
            const excelBtn = document.getElementById('excelExportBtn');
            const importBtn = document.getElementById('importExcelBtn');
            
            if (currentUserPermissions.canExport) {
                if(excelBtn) excelBtn.classList.remove('d-none');
                if(importBtn) importBtn.classList.remove('d-none');
            } else {
                if(excelBtn) excelBtn.classList.add('d-none');
                if(importBtn) importBtn.classList.add('d-none');
            }
            
            loadInitialData();

        } catch (error) { console.error("Auth Error:", error); }
    } else {
        window.location.href = "login.html";
    }
});

function logout() {
    firebase.auth().signOut().then(() => {
        window.location.href = "login.html";
    });
}

async function loadInitialData() {
    if(!formId) return;

    const tableBody = document.getElementById('tableBody');
    const spinner = document.getElementById('loadingIndicator');
    const countElement = document.getElementById('displayedCount');
    
    // لێرەدا دیزاینە مۆدێرنەکەمان (Skeleton) داناوە لەبری ئەوەی خشتەکە سپی بێت
    tableBody.innerHTML = `
        <tr id="initialLoader">
            <td colspan="100%" class="text-center border-0" style="padding-top: 60px; padding-bottom: 30px;">
                <div class="d-flex flex-column align-items-center justify-content-center">
                    <div class="position-relative mb-4">
                        <div class="spinner-grow text-primary opacity-25" style="width: 4rem; height: 4rem;" role="status"></div>
                        <div class="spinner-grow text-info position-absolute top-50 start-50 translate-middle" style="width: 2.5rem; height: 2.5rem; animation-delay: 0.3s;" role="status"></div>
                        <i class="fa-solid fa-cloud-arrow-down text-primary position-absolute top-50 start-50 translate-middle fs-5 z-3"></i>
                    </div>
                    <h5 class="fw-bold text-dark mb-1" style="font-size: 1.1rem;">خەریکە داتاکان دەهێنرێن...</h5>
                    <p class="text-muted small">تکایە چەند چرکەیەک چاوەڕێ بە تا خشتەکە پڕ دەبێتەوە</p>
                </div>
            </td>
        </tr>
        <tr class="placeholder-glow border-0"><td class="py-3 border-0"><span class="placeholder col-4 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-7 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-5 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-8 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-4 rounded bg-secondary opacity-25"></span></td></tr>
        <tr class="placeholder-glow border-0"><td class="py-3 border-0"><span class="placeholder col-6 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-5 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-8 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-6 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-5 rounded bg-secondary opacity-25"></span></td></tr>
        <tr class="placeholder-glow border-0"><td class="py-3 border-0"><span class="placeholder col-5 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-8 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-6 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-4 rounded bg-secondary opacity-25"></span></td><td class="border-0"><span class="placeholder col-7 rounded bg-secondary opacity-25"></span></td></tr>
    `;
    
    allSubmissions = [];
    currentRenderIndex = 0;
    
    if(countElement) countElement.innerText = "چاوەڕێ بکە..."; 

    if(spinner) spinner.style.display = 'block';
    if(document.getElementById('loadMoreBtn')) document.getElementById('loadMoreBtn').classList.add('d-none');

    try {
        const formDoc = await db.collection("forms").doc(formId).get();
        if(!formDoc.exists) return alert("فۆرمەکە نەدۆزرایەوە");
        
        const formData = formDoc.data();
        document.getElementById('formTitle').innerText = formData.title;
        formFields = getUniqueFields(formData.fields || []);
        setupHeaders(); 

        window.originalFormStructure = formData.fields || [];

        const fullSnapshot = await db.collection("forms").doc(formId).collection("submissions").get();

        let tempAllData = [];
        fullSnapshot.forEach(doc => {
            let data = doc.data();
            data.id = doc.id;
            tempAllData.push(data);
        });

        tempAllData.sort((a, b) => {
            const timeA = normalizeDate(a.submittedAt);
            const timeB = normalizeDate(b.submittedAt);
            return timeB - timeA; 
        });

        allSubmissions = tempAllData;
        totalDatabaseCount = allSubmissions.length;
        
        if(countElement) {
            countElement.innerText = totalDatabaseCount;
        }

        // خشتەکە خاوێن دەکەینەوە لە دیزاینە کاتییەکە، پاشان داتاکان دادەنێین
        tableBody.innerHTML = '';
        renderNextBatch();
        
        if(spinner) spinner.style.display = 'none';

    } catch (error) {
        console.error("Load Error:", error);
        alert("هەڵە: " + error.message);
        if(spinner) spinner.style.display = 'none';
    }
}

function renderNextBatch() {
    if (isRendering) return;
    isRendering = true;

    const tableBody = document.getElementById('tableBody');
    const loadBtn = document.getElementById('loadMoreBtn');
    
    const nextData = allSubmissions.slice(currentRenderIndex, currentRenderIndex + BATCH_SIZE);
    
    if (nextData.length === 0) {
        if(loadBtn) loadBtn.classList.add('d-none');
        isRendering = false;
        return;
    }

    let rowsHTML = '';
    nextData.forEach((sub, index) => {
        const realIndex = currentRenderIndex + index + 1;
        rowsHTML += createRowHTML(sub, realIndex);
    });

    tableBody.insertAdjacentHTML('beforeend', rowsHTML);
    currentRenderIndex += nextData.length;
    
    if (currentRenderIndex < allSubmissions.length) {
        if(loadBtn) {
            loadBtn.classList.remove('d-none');
            loadBtn.innerText = `پیشاندانی زیاتر (${allSubmissions.length - currentRenderIndex} ماوە)`;
            loadBtn.onclick = renderNextBatch; 
        }
    } else {
        if(loadBtn) loadBtn.classList.add('d-none');
        tableBody.insertAdjacentHTML('beforeend', '<tr id="endMsg"><td colspan="100%" class="text-center text-muted small py-2">هەموو داتاکان پیشاندراون</td></tr>');
    }

    isRendering = false;
}

// فەنکشنی نوێ بۆ ڕێکخستنی کات (وادەکات فۆڕمە بێ کاتەکان بێنە لووتکە)
function normalizeDate(val) {
    // ئەگەر کاتی نەبوو یان نەخوێندراوە، گەورەترین ژمارەی پێ دەدەین بۆ ئەوەی بێتە لووتکە
    if (!val) return Number.MAX_SAFE_INTEGER; 
    
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    if (val.getTime) return val.getTime();
    
    const parsed = new Date(val).getTime();
    // ئەگەر دەق بوو بەڵام نەبوو بە کات (وەک وشە بوو)، دیسان گەورەترین ژمارەی دەدەینێ
    return isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function renderRows(docs, customStartIndex = null) {
    const tbody = document.getElementById('tableBody');
    let startIndex = (customStartIndex !== null) ? customStartIndex : (allSubmissions.length + 1);
    let batchHTML = '';

    docs.forEach((doc) => {
        let sub = typeof doc.data === 'function' ? { ...doc.data(), id: doc.id } : doc;
        if (!allSubmissions.find(s => s.id === sub.id)) allSubmissions.push(sub);
        batchHTML += createRowHTML(sub, startIndex++);
    });

    tbody.insertAdjacentHTML('beforeend', batchHTML);
    if(totalDatabaseCount > 0) document.getElementById('displayedCount').innerText = totalDatabaseCount;
}

function createRowHTML(sub, index) {
    // چارەسەری کێشەی ڕێکەوتەکان
    let displayDate = '-';
    if (sub.submittedAt) {
        const timeNum = normalizeDate(sub.submittedAt);
        if (timeNum > 0) {
            displayDate = new Date(timeNum).toLocaleString('ckb');
        }
    }
    
    let htmlParts = [`<tr id="row_${sub.id}" class="animate-up">`, `<td>`];

    if(currentUserPermissions.canDelete) {
        const isChecked = selectedIds.has(sub.id) ? 'checked' : '';
        htmlParts.push(`<input type="checkbox" class="form-check-input row-checkbox" value="${sub.id}" ${isChecked} onchange="toggleSelection('${sub.id}')">`);
    } else {
        htmlParts.push(`${index}`);
    }
    htmlParts.push(`</td>`);

    let colIndex = 1;
    formFields.forEach(f => {
        if(f.type === 'note' || f.type === 'line') return;
        
        const header = document.querySelector(`th[data-col="${colIndex}"]`);
        const style = (header && header.style.display === 'none') ? 'style="display:none"' : '';
        
        let val = getFieldValue(sub.data, f); 
        if(val === undefined || val === null || val === '') val = '-';

        if(f.type === 'photo' || f.type === 'fingerprint') {
            let urls = parseImageUrls(val);

            if (urls.length > 0) {
                const imgSrc = urls[0];
                const countBadge = urls.length > 1 ? `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${urls.length}</span>` : '';
                
                htmlParts.push(`<td onclick="openDetailModal('${sub.id}')" class="clickable-row" ${style}>
                    <div class="position-relative d-inline-block">
                        <img src="${imgSrc}" class="data-img" style="width: 45px; height: 45px; object-fit: cover; border-radius: 5px;" onerror="this.src='https://via.placeholder.com/45?text=Img'" loading="lazy">
                        ${countBadge}
                    </div>
                </td>`);
            } else {
                htmlParts.push(`<td onclick="openDetailModal('${sub.id}')" class="clickable-row" ${style}>-</td>`);
            }
        } else {
            if (Array.isArray(val)) val = val.join('، ');
            let displayVal = String(val);
            if(displayVal.length > 30) displayVal = displayVal.substring(0, 30) + '...';
            htmlParts.push(`<td onclick="openDetailModal('${sub.id}')" class="clickable-row" ${style}>${displayVal}</td>`);
        }
        colIndex++; 
    });

    // لێرەدا ناوەکەمان گۆڕی بۆ displayDate
    htmlParts.push(`<td class="text-muted small" style="direction: ltr;">${displayDate}</td>`);
    
    htmlParts.push(`<td><div class="d-flex gap-2">`);
    if(currentUserPermissions.canEdit) htmlParts.push(`<button onclick="openEditModal('${sub.id}')" class="btn btn-sm btn-outline-primary"><i class="fa-solid fa-pen"></i></button>`);
    if(currentUserPermissions.canDelete) htmlParts.push(`<button onclick="deleteSingle('${sub.id}')" class="btn btn-sm btn-outline-danger"><i class="fa-solid fa-trash"></i></button>`);
    htmlParts.push(`</div></td></tr>`);
    
    return htmlParts.join('');
}

function getUniqueFields(rawFields) {
    let uniqueMap = new Map();
    function traverse(nodes) {
        nodes.forEach(f => {
            if (!f.id) f.id = f.label;
            if (f.type !== 'line') {
                if (!uniqueMap.has(f.label)) {
                    // پاراستنی داتا ئەسڵییەکە و زیادکردنی ئەڕەیەک بۆ کۆکردنەوەی هەموو ئایدییەکان
                    uniqueMap.set(f.label, { ...f, ids: [f.id] });
                } else {
                    // ئەگەر خانەکە هەمان ناوی هەبوو (وەک ناونیشان)، ئایدییەکەشی خەزن بکە
                    uniqueMap.get(f.label).ids.push(f.id);
                }
            }
            if (f.branches) Object.values(f.branches).forEach(c => traverse(c));
            if (f.children) traverse(f.children);
        });
    }
    traverse(rawFields);
    return Array.from(uniqueMap.values());
}

function setupHeaders() {
    const headRow = document.getElementById('tableHead');
    let searchRow = document.getElementById('searchRow');
    if(!searchRow) {
        searchRow = document.createElement('tr');
        searchRow.id = 'searchRow';
        searchRow.className = 'bg-light';
        headRow.parentNode.insertBefore(searchRow, headRow.nextSibling);
    }
    
    let headHTML = '<th><i class="fa-solid fa-check-double"></i></th>';
    let searchHTML = '<th></th>'; 
    let toggleHTML = '';
    let colIndex = 1;

    const storageKey = "hidden_cols_" + formId;
    const savedHidden = JSON.parse(localStorage.getItem(storageKey)); 

    formFields.forEach((f) => {
        if(f.type === 'note' || f.type === 'line') return;
        
        let isVisible = savedHidden !== null ? !savedHidden.includes(colIndex) : colIndex <= 5;
        const style = isVisible ? '' : 'style="display:none"';
        const checked = isVisible ? 'checked' : '';

        headHTML += `<th data-col="${colIndex}" data-field-id="${f.id}" ${style}>${f.label}</th>`;
        searchHTML += `<th data-col="${colIndex}" data-field-id="${f.id}" ${style}><input type="text" class="form-control form-control-sm column-search" placeholder="گەڕان..." onkeyup="filterTable()"></th>`;
        toggleHTML += `<div class="form-check px-3 py-1"><input class="form-check-input column-toggle-checkbox" type="checkbox" ${checked} onchange="toggleColumn(${colIndex}, this.checked)" id="toggle_${colIndex}" data-index="${colIndex}"><label class="form-check-label" for="toggle_${colIndex}">${f.label}</label></div>`;
        colIndex++; 
    });

    headHTML += '<th>کاتی ناردن</th><th>کردارەکان</th>';
    searchHTML += '<th></th><th></th>';
    
    headRow.innerHTML = headHTML;
    searchRow.innerHTML = searchHTML;
    document.getElementById('columnToggleMenu').innerHTML = toggleHTML;
}

// ============================================================
// ============================================================
// 3. EDIT MODAL
// ============================================================

// --- فەنکشنی نوێ بۆ گۆڕینی ژمارەی کوردی/عەرەبی بە ئینگلیزی ---
window.convertAllNumerals = function(input) {
    if (!input || input.type === 'date' || input.type === 'checkbox' || input.type === 'radio' || input.type === 'file') return;

    const numbers = {
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
        '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
        '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
    };
    
    let val = input.value;
    if (!val) return;

    let converted = val.replace(/[٠-٩۰-۹]/g, function(match) {
        return numbers[match];
    });
    
    if (input.getAttribute('inputmode') === 'numeric' || input.type === 'number') {
        converted = converted.replace(/[^0-9.]/g, ''); 
    }
    
    if (val !== converted) {
        let start = input.selectionStart;
        let end = input.selectionEnd;
        input.value = converted;
        try {
            input.setSelectionRange(start, end);
        } catch(e) {}
    }
};

function openEditModal(docId) {
    const data = allSubmissions.find(d => d.id === docId);
    if (!data) return;

    document.getElementById('editDocId').value = data.id;
    const container = document.getElementById('editFieldsContainer');
    container.innerHTML = ''; 
    editPhotosStore = {}; 

    renderEditFieldsRecursive(window.originalFormStructure || [], data.data, container);
    new bootstrap.Modal(document.getElementById('editModal')).show();
}

function renderEditFieldsRecursive(fields, currentData, container) {
    fields.forEach(f => {
        if(f.type === 'line') return;

        const fieldWrapper = document.createElement('div');
        fieldWrapper.className = 'mb-3 field-wrapper';
        
        const label = document.createElement('label');
        label.className = 'form-label fw-bold';
        label.innerText = f.label;
        fieldWrapper.appendChild(label);

        let currentVal = getFieldValue(currentData, f);
        if(currentVal === undefined || currentVal === null) currentVal = '';

        let inputEl;
        let branchEls = {}; 

        if (f.type === 'select_one') {
            inputEl = document.createElement('select');
            inputEl.className = 'form-select';
            inputEl.name = f.id; 
            
            let defOpt = document.createElement('option');
            defOpt.value = ""; defOpt.innerText = "هەڵبژێرە...";
            inputEl.appendChild(defOpt);

            if(f.options) {
                f.options.forEach(opt => {
                    let option = document.createElement('option');
                    option.value = opt; option.innerText = opt;
                    if(currentVal === opt) option.selected = true;
                    inputEl.appendChild(option);
                });
            }
            fieldWrapper.appendChild(inputEl);

            if(f.branches) {
                const branchContainer = document.createElement('div');
                branchContainer.className = 'mt-2 ps-3 border-start border-3 border-warning bg-light rounded-end';
                
                for(const [optName, childFields] of Object.entries(f.branches)) {
                    const branchDiv = document.createElement('div');
                    branchDiv.style.display = 'none';
                    branchDiv.className = 'p-2';
                    renderEditFieldsRecursive(childFields, currentData, branchDiv);
                    branchContainer.appendChild(branchDiv);
                    branchEls[optName] = branchDiv;
                }
                fieldWrapper.appendChild(branchContainer);

                inputEl.addEventListener('change', () => {
                    const val = inputEl.value;
                    Object.values(branchEls).forEach(el => el.style.display = 'none');
                    if(branchEls[val]) branchEls[val].style.display = 'block';
                });

                if(currentVal && branchEls[currentVal]) branchEls[currentVal].style.display = 'block';
            }
        }
        else if (f.type === 'select_many') {
            const checkboxGroup = document.createElement('div');
            checkboxGroup.className = 'd-flex flex-wrap gap-3 border p-2 rounded bg-light';
            const currentArr = Array.isArray(currentVal) ? currentVal : [];
            
            let branchesContainer;
            if(f.branches) {
                branchesContainer = document.createElement('div');
                branchesContainer.className = 'mt-2 ps-3 border-start border-3 border-warning bg-light rounded-end';
            }

            if(f.options) {
                f.options.forEach(opt => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'form-check';
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'form-check-input';
                    cb.name = f.id + '[]'; 
                    cb.value = opt;
                    cb.id = `edit_${f.id}_${opt.replace(/\s/g, '')}`;
                    if(currentArr.includes(opt)) cb.checked = true;

                    const lbl = document.createElement('label');
                    lbl.className = 'form-check-label';
                    lbl.htmlFor = cb.id;
                    lbl.innerText = opt;

                    wrapper.appendChild(cb);
                    wrapper.appendChild(lbl);
                    checkboxGroup.appendChild(wrapper);

                    if(f.branches && f.branches[opt]) {
                        const branchDiv = document.createElement('div');
                        branchDiv.style.display = 'none';
                        branchDiv.className = 'p-2';
                        renderEditFieldsRecursive(f.branches[opt], currentData, branchDiv);
                        branchesContainer.appendChild(branchDiv);
                        branchEls[opt] = branchDiv;

                        cb.addEventListener('change', () => {
                            if(branchEls[opt]) branchEls[opt].style.display = cb.checked ? 'block' : 'none';
                        });
                        if(cb.checked && branchEls[opt]) branchEls[opt].style.display = 'block';
                    }
                });
            }
            fieldWrapper.appendChild(checkboxGroup);
            if(branchesContainer) fieldWrapper.appendChild(branchesContainer);
        }
        else if (f.type === 'photo' || f.type === 'fingerprint') {
            let existingUrls = parseImageUrls(currentVal);
            
            editPhotosStore[f.id] = { existing: [...existingUrls], new: [] }; 
            
            const photoContainer = document.createElement('div');
            photoContainer.className = 'photo-edit-container p-3 border rounded bg-light';
            photoContainer.innerHTML = `
                <div class="d-flex flex-wrap gap-2 mb-2" id="edit_existing_preview_${f.id}"></div>
                <div class="mt-2">
                     <label class="btn btn-sm btn-outline-primary cursor-pointer">
                        <i class="fa-solid fa-plus"></i> زیادکردنی وێنە
                        <input type="file" hidden accept="image/*" multiple onchange="handleEditPhotoAdd(this, '${f.id}')">
                     </label>
                </div>`;
            
            fieldWrapper.appendChild(photoContainer);
            setTimeout(() => renderEditPhotos(f.id), 0);
        }
        else if(f.type === 'note') {
            inputEl = document.createElement('textarea');
            inputEl.className = 'form-control';
            inputEl.rows = 3; inputEl.name = f.id; inputEl.value = currentVal; 
            inputEl.oninput = function() { window.convertAllNumerals(this); }; // <--- بۆ گۆڕینی ژمارە زیادکرا
            fieldWrapper.appendChild(inputEl);
        } else if(f.type === 'date') {
            inputEl = document.createElement('input');
            inputEl.type = 'date';
            inputEl.className = 'form-control';
            inputEl.name = f.id; 
            if(currentVal && currentVal.includes('/')) {
                let parts = currentVal.split('/');
                if(parts.length === 3) inputEl.value = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            } else {
                inputEl.value = currentVal;
            }
            fieldWrapper.appendChild(inputEl);
        } else {
            inputEl = document.createElement('input');
            if (f.type === 'number') {
                inputEl.type = 'text'; // <--- بۆ کارکردنی کیبۆردی کوردی
                inputEl.setAttribute('inputmode', 'numeric');
            } else {
                inputEl.type = 'text';
            }
            inputEl.className = 'form-control';
            inputEl.name = f.id; inputEl.value = currentVal; 
            inputEl.oninput = function() { window.convertAllNumerals(this); }; // <--- بۆ گۆڕینی ژمارە زیادکرا
            fieldWrapper.appendChild(inputEl);
        }
        container.appendChild(fieldWrapper);
    });
}

function handleEditPhotoAdd(input, fieldId) {
    if(input.files && input.files.length > 0) {
        Array.from(input.files).forEach(file => editPhotosStore[fieldId].new.push(file));
        renderEditPhotos(fieldId);
    }
    input.value = ''; 
}

function renderEditPhotos(fieldId) {
    const container = document.getElementById(`edit_existing_preview_${fieldId}`);
    if(!container) return;
    container.innerHTML = '';
    
    editPhotosStore[fieldId].existing.forEach((url, idx) => {
        container.innerHTML += `
            <div class="position-relative" style="width: 80px; height: 80px;">
                <img src="${url}" class="rounded border shadow-sm w-100 h-100" style="object-fit: cover;">
                <button type="button" class="btn btn-danger btn-sm position-absolute top-0 end-0 p-0 d-flex justify-content-center align-items-center" 
                        style="width: 20px; height: 20px;" onclick="removeEditPhoto('${fieldId}', 'existing', ${idx})">
                    <i class="fa-solid fa-times" style="font-size: 10px;"></i>
                </button>
            </div>`;
    });
    editPhotosStore[fieldId].new.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = "position-relative"; div.style.width = "80px"; div.style.height = "80px";
            div.innerHTML = `
                <img src="${e.target.result}" class="rounded border border-primary shadow-sm w-100 h-100" style="object-fit: cover;">
                <button type="button" class="btn btn-danger btn-sm position-absolute top-0 end-0 p-0 d-flex justify-content-center align-items-center" 
                        style="width: 20px; height: 20px;" onclick="removeEditPhoto('${fieldId}', 'new', ${idx})">
                    <i class="fa-solid fa-times" style="font-size: 10px;"></i>
                </button>`;
            container.appendChild(div);
        };
        reader.readAsDataURL(file);
    });
}

window.removeEditPhoto = function(fieldId, type, index) {
    if(type === 'existing') editPhotosStore[fieldId].existing.splice(index, 1);
    else editPhotosStore[fieldId].new.splice(index, 1);
    renderEditPhotos(fieldId);
}

async function saveEditedData() {
    const docId = document.getElementById('editDocId').value;
    const submitBtn = document.querySelector('#editModal .btn-primary');
    const originalBtnText = submitBtn.innerHTML;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner-border spinner-border-sm"></div> خەزن دەکرێت...';
    
    let newData = {};
    const targetIndex = allSubmissions.findIndex(sub => sub.id === docId);
let oldDataForAudit = {}; // <--- ئەمەمان زیادکرد
    if(targetIndex !== -1 && allSubmissions[targetIndex].data) {
        newData = { ...allSubmissions[targetIndex].data };
        oldDataForAudit = JSON.parse(JSON.stringify(newData)); // <--- ئەمەمان زیادکرد بۆ پاراستنی داتای کۆن
    }

    // پشکنین بۆ ئەو وێنانەی لەناو پەنجەرەی دەستکاریکردن سڕاونەتەوە
    let urlsToDelete = [];
    if(targetIndex !== -1 && allSubmissions[targetIndex].data) {
        const oldData = allSubmissions[targetIndex].data;
        for (const [fieldId, store] of Object.entries(editPhotosStore)) {
            const fieldDef = formFields.find(f => f.id === fieldId);
            if (fieldDef && (fieldDef.type === 'photo' || fieldDef.type === 'fingerprint')) {
                let oldUrls = parseImageUrls(getFieldValue(oldData, fieldDef));
                let keptUrls = store.existing;
                oldUrls.forEach(url => {
                    if (!keptUrls.includes(url)) urlsToDelete.push(url); // ئەگەر وێنە کۆنەکە لەناو نوێیەکاندا نەما، بیخە لیستی سڕینەوە
                });
            }
        }
    }

    try {
        const checkboxGroups = document.querySelectorAll('#editFieldsContainer input[type="checkbox"]');
        let processedCheckboxes = new Set();
        checkboxGroups.forEach(cb => {
            const name = cb.name.replace('[]', ''); 
            if(processedCheckboxes.has(name)) return;
            const checkedBoxes = document.querySelectorAll(`input[name="${cb.name}"]:checked`);
            let values = Array.from(checkedBoxes).map(c => c.value);
            if(values.length > 0) newData[name] = values; else newData[name] = [];
            processedCheckboxes.add(name);
            
            const fieldDef = formFields.find(f => f.id === name);
            if (fieldDef && fieldDef.label && newData[fieldDef.label]) delete newData[fieldDef.label];
        });

        const inputs = document.querySelectorAll('#editFieldsContainer input:not([type="checkbox"]):not([type="file"]), #editFieldsContainer select, #editFieldsContainer textarea');
        inputs.forEach(input => { 
            if(input.name) {
                newData[input.name] = input.value; 
                
                const fieldDef = formFields.find(f => f.id === input.name);
                if (fieldDef && fieldDef.label && newData[fieldDef.label]) delete newData[fieldDef.label];
            }
        });

        for (const [fieldId, store] of Object.entries(editPhotosStore)) {
            let finalUrls = [...store.existing];
            if (store.new.length > 0) {
                submitBtn.innerHTML = `<div class="spinner-border spinner-border-sm"></div> وێنە...`;
                for (const file of store.new) {
                    const url = await uploadImageToFirebase(file);
                    if(url) finalUrls.push(url);
                }
            }
            newData[fieldId] = finalUrls; 
            
            const fieldDef = formFields.find(f => f.id === fieldId);
            if (fieldDef && fieldDef.label && newData[fieldDef.label]) delete newData[fieldDef.label];
        }

        await db.collection("forms").doc(formId).collection("submissions").doc(docId).update({ data: newData });
        // --- تۆمارکردن لە Audit Log ---
        if (typeof window.logAuditAction === 'function') {
            window.logAuditAction('UPDATE', 'submissions', docId, oldDataForAudit, newData);
        }
        
        // سڕینەوەی وێنە لا براوەکان لە Firebase Storage بە شێوەی ئۆتۆماتیکی
        for (const url of urlsToDelete) {
            await deleteImageFromFirebase(url);
        }

        if(targetIndex !== -1) {
            allSubmissions[targetIndex].data = newData;
        }

        alert("زانیارییەکان بە سەرکەوتوویی نوێکرانەوە!");
        bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
        
        document.getElementById('tableBody').innerHTML = '';
        currentRenderIndex = 0;
        renderNextBatch();
        
    } catch(e) { 
        console.error(e); 
        alert("هەڵە ڕوویدا: " + e.message); 
    } finally { 
        submitBtn.disabled = false; 
        submitBtn.innerHTML = originalBtnText; 
    }
}

// ئەمە دابنێ لە جێگەی
async function uploadImageToFirebase(file) {
    if (!file) return null;
    
    // دروستکردنی ناوێکی تایبەت بۆ وێنەکە بۆ ئەوەی تێکەڵ نەبن
    const uniqueFileName = 'form_photos/' + Date.now() + '_' + file.name;
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(uniqueFileName);
    
    try {
        // بەرزکردنەوەی وێنەکە بۆ Firebase Storage
        const snapshot = await fileRef.put(file);
        // وەرگرتنی لینکی وێنەکە
        const downloadURL = await snapshot.ref.getDownloadURL();
        return downloadURL;
    } catch (error) { 
        console.error("Firebase Upload Error: ", error); 
        return null; 
    }
}

// فەنکشن بۆ سڕینەوەی ڕاستەوخۆی وێنە لە Firebase Storage
async function deleteImageFromFirebase(imageUrl) {
    if (!imageUrl || !imageUrl.includes('firebasestorage')) return;
    try {
        const fileRef = firebase.storage().refFromURL(imageUrl);
        await fileRef.delete();
        console.log("وێنەکە لە سێرڤەر سڕایەوە:", imageUrl);
    } catch (error) {
        console.error("هەڵە لە سڕینەوەی وێنەی سێرڤەر: ", error);
    }
}

// فەنکشن بۆ هێنانی هەموو لینکەکانی ناو کەیسێک
function extractAllImageUrlsFromData(dataObj) {
    let urls = [];
    formFields.forEach(f => {
        if (f.type === 'photo' || f.type === 'fingerprint') {
            let val = getFieldValue(dataObj, f);
            let parsedUrls = parseImageUrls(val);
            urls = urls.concat(parsedUrls);
        }
    });
    return urls;
}

// ============================================================
// 4. DETAIL MODAL (NEW MODERN DESIGN & HIDE EMPTY FIELDS)
// ============================================================
function openDetailModal(docId) {
    const data = allSubmissions.find(d => d.id === docId);
    if (!data) return;

    const container = document.getElementById('modalContent');
    container.innerHTML = '';
    
    let date = data.submittedAt ? new Date(data.submittedAt.seconds * 1000).toLocaleString('ckb') : '-';
    
    // تەنیا کارتی زانیارییەکان بەبێ زیادکردنی دوگمەی داخستنی ناوەکی
    container.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-4 p-3 rounded-4 shadow-sm print-row" style="background: linear-gradient(135deg, rgba(3, 182, 247, 0.1) 0%, rgba(3, 182, 247, 0.05) 100%); border: 1px solid rgba(3, 182, 247, 0.2);">
            <div class="d-flex align-items-center gap-3">
                <div class="bg-white rounded-circle d-flex justify-content-center align-items-center shadow-sm" style="width: 48px; height: 48px;">
                    <i class="fa-solid fa-file-invoice text-primary fs-4"></i>
                </div>
                <div>
                    <h5 class="mb-0 fw-bold text-dark">زانیارییەکانی تۆمار</h5>
                    <small class="text-muted"><i class="fa-regular fa-clock me-1"></i> ${date}</small>
                </div>
            </div>
            <div class="text-end">
                <span class="badge bg-white text-primary rounded-pill px-3 py-2 border shadow-sm fs-6" style="letter-spacing: 1px; font-family: monospace;">#${docId.substring(0, 6).toUpperCase()}</span>
            </div>
        </div>
        
        <div class="row g-3" id="detailGrid_${docId}"></div>
    `;
    
    const gridContainer = container.querySelector(`#detailGrid_${docId}`);
    renderDetailFieldsRecursive(window.originalFormStructure || [], data.data, gridContainer, false);
    
    // شاردنەوەی هێڵی ژێرەوەی مۆدال هێدەرەکە بۆ ئەوەی دیزاینەکە پاکتر بێت
    const modalHeader = document.querySelector('#detailModal .modal-header');
    if(modalHeader) {
        modalHeader.style.borderBottom = 'none';
    }

    // چارەسەری دوگمەی "×"ی ئەسڵی خۆی (لە Header)
    const headerCloseBtn = document.querySelector('#detailModal .modal-header .btn-close') || document.querySelector('#detailModal .modal-header button[data-bs-dismiss="modal"]');
    
    if(headerCloseBtn) {
        // سڕینەوەی کڵاسی بنەڕەتی بووتستراپ بۆ ئەوەی کێشەی باکگراوندە سپییەکە دروست نەکات
        headerCloseBtn.classList.remove('btn-close');
        
        // دانانی ئایکۆنی ناوەکی و کڵاسی سوور بە شێوازی مۆدێرن
        headerCloseBtn.innerHTML = '<i class="fa-solid fa-xmark fs-5"></i>';
        headerCloseBtn.className = 'btn btn-danger rounded-circle shadow-sm d-flex justify-content-center align-items-center position-absolute';
        
        // بردنە سەرەوەی لای چەپ بە تەواوی وەک وێنەکە
        headerCloseBtn.style.left = '20px';
        headerCloseBtn.style.top = '20px';
        headerCloseBtn.style.width = '35px';
        headerCloseBtn.style.height = '35px';
        headerCloseBtn.style.padding = '0';
        headerCloseBtn.style.zIndex = '1050'; // بۆ ئەوەی هەمیشە لە پێشەوە بێت
        
        // ئەنیمەیشنی جووڵە لە کاتی چوونە سەری
        headerCloseBtn.style.transition = 'transform 0.2s';
        headerCloseBtn.onmouseover = () => headerCloseBtn.style.transform = 'scale(1.1)';
        headerCloseBtn.onmouseout = () => headerCloseBtn.style.transform = 'scale(1)';
    }

    // چارەسەری دوگمەی داخستنەکەی خوارەوە بەبێ ئەوەی دەست لە پرێنت بدرێت
    const footerCloseBtn = document.querySelector('#detailModal .modal-footer button[data-bs-dismiss="modal"]');
    if(footerCloseBtn) {
        footerCloseBtn.className = "btn btn-outline-danger rounded-pill px-4 fw-bold shadow-sm";
        footerCloseBtn.innerHTML = '<i class="fa-solid fa-xmark me-2"></i> داخستن';
    }
    
    new bootstrap.Modal(document.getElementById('detailModal')).show();
}

function renderDetailFieldsRecursive(fields, values, container, isNested = false) {
    const fieldIcons = {
        'text': '<i class="fa-solid fa-align-right text-primary"></i>',
        'number': '<i class="fa-solid fa-hashtag text-success"></i>',
        'date': '<i class="fa-regular fa-calendar-alt text-warning"></i>',
        'note': '<i class="fa-solid fa-paragraph text-secondary"></i>',
        'select_one': '<i class="fa-regular fa-check-circle text-info"></i>',
        'select_many': '<i class="fa-solid fa-list-check text-info"></i>',
        'photo': '<i class="fa-regular fa-images text-danger"></i>',
        'fingerprint': '<i class="fa-solid fa-fingerprint text-dark"></i>'
    };

    fields.forEach(f => {
        if(f.type === 'line') return;
        
        let rawVal = getFieldValue(values, f);
        let isEmpty = (rawVal === undefined || rawVal === null || rawVal === "" || rawVal === "-");
        let urls = [];

        if(f.type === 'photo' || f.type === 'fingerprint') {
            urls = parseImageUrls(rawVal);
            if (urls.length === 0) isEmpty = true;
        }

        // =========================================
        // گۆڕانکارییەکە لێرەدایە: لێرەدا ڕێگری لە دروستبوونی ناکەین (return ناکەین)،
        // بۆ ئەوەی لە کاتی پرێنت دەرکەونەوە.
        // =========================================

        let content = '';
        let colClass = isNested ? "col-12" : ((f.type === 'note' || f.type === 'photo' || f.type === 'fingerprint' || f.type === 'select_many') ? "col-12" : "col-md-6");

        if (isEmpty) {
            // گەڕاندنەوەی شێوازی بۆشایی لە جیاتی 'بەتاڵە' بۆ ئەوەی لە کاغەزەکەدا دیار بێت و خاوێن بێت
            content = `<span class="badge bg-light text-muted border px-2 py-1 mt-1 fw-normal">&nbsp;</span>`;
        } else if(f.type === 'photo' || f.type === 'fingerprint') {
            const safeUrls = encodeURIComponent(JSON.stringify(urls));
            let galleryHtml = `
                <div class="mb-3 text-start d-print-none">
                    <button onclick="shareImagesAsPDF('${safeUrls}')" class="btn btn-sm btn-outline-success rounded-pill px-3 shadow-sm border-2 fw-bold">
                        <i class="fa-brands fa-whatsapp me-1"></i> شەیرکردنی وێنەکان (PDF)
                    </button>
                </div>
                <div class="d-flex flex-wrap gap-2 justify-content-start mt-2">`;
            
            urls.forEach(url => { 
                galleryHtml += `<a href="${url}" target="_blank" class="d-inline-block" style="transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <img src="${url}" class="rounded-3 shadow-sm" style="width: 90px; height: 90px; object-fit: cover; border: 2px solid #fff;">
                </a>`; 
            });
            galleryHtml += `</div>`;
            content = `<div>${galleryHtml}</div>`;
        }
        else if(f.type === 'note') {
            content = `<div class="p-3 bg-light rounded-4 text-dark mt-2" style="white-space: pre-wrap; font-size: 1rem; line-height: 1.7; border: 1px solid #f1f5f9;">${rawVal}</div>`;
        } else {
            let displayVal = Array.isArray(rawVal) ? rawVal.join('، ') : rawVal;
            content = `<div class="fw-bold text-dark mt-2 fs-5" style="word-break: break-word;">${displayVal}</div>`;
        }

        const icon = fieldIcons[f.type] || '<i class="fa-solid fa-asterisk text-muted"></i>';

        // سیحری شاردنەوەکە:
        // d-none = لەسەر شاشە دەیشارێتەوە
        // d-print-block = لە کاتی پرێنت دەیدەخاتەوە
        // empty-field-element = ناوێکی تایبەت بۆ ئەوەی لە PDF ئاسانتر مامەڵەی لەگەڵ بکەین
        let displayClass = isEmpty ? "d-none d-print-block empty-field-element" : "";

        const fieldWrapper = document.createElement('div');
        fieldWrapper.className = `${colClass} print-row ${displayClass}`;
        fieldWrapper.innerHTML = `
            <div class="p-3 bg-white rounded-4 h-100 position-relative shadow-sm" style="border: 1px solid #f8fafc; transition: all 0.2s;" onmouseover="this.style.borderColor='#e2e8f0'" onmouseout="this.style.borderColor='#f8fafc'">
                <div class="text-muted small fw-bold mb-1 d-flex align-items-center opacity-75 print-label">
                    <span class="me-2 fs-6">${icon}</span> <span>${f.label}</span>
                </div>
                <div class="print-value ms-1">
                    ${content}
                </div>
                <div class="branches-container mt-2"></div>
            </div>
        `;
        
        container.appendChild(fieldWrapper);

        // ڕێکخستنی لقەکان
        if ((f.type === 'select_one' || f.type === 'select_many') && f.branches && !isEmpty) {
            const selections = Array.isArray(rawVal) ? rawVal : [rawVal];
            const branchesContainer = fieldWrapper.querySelector('.branches-container');
            
            selections.forEach(sel => {
                if(f.branches[sel]) {
                    const branchOuter = document.createElement('div');
                    branchOuter.className = "mt-3 p-3 bg-light rounded-4 shadow-sm branch-wrapper";
                    branchOuter.style.borderRight = "4px solid #03b6f7";
                    branchOuter.innerHTML = `<div class="small text-muted mb-3 fw-bold"><i class="fa-solid fa-arrow-turn-down ms-1 text-primary"></i> پەیوەست بە: <span class="text-dark bg-white px-2 py-1 rounded shadow-sm ms-1">${sel}</span></div>`;
                    
                    const nestedGrid = document.createElement('div');
                    nestedGrid.className = "row g-3";
                    branchOuter.appendChild(nestedGrid);

                    renderDetailFieldsRecursive(f.branches[sel], values, nestedGrid, true);
                    
                    if(nestedGrid.children.length > 0) {
                        // ئەگەر هەموو خانەکانی ناو لقێک بەتاڵ بوون، ئەوا بۆکسی لقەکەش دەشارینەوە بۆ شاشە
                        let allChildrenHidden = Array.from(nestedGrid.children).every(child => child.classList.contains('empty-field-element'));
                        
                        if (allChildrenHidden) {
                            branchOuter.classList.add('d-none', 'd-print-block', 'empty-field-element');
                        }
                        
                        branchesContainer.appendChild(branchOuter);
                    }
                }
            });
        }
    });
}

// ============================================================
// 5. EXCEL & UTILITIES 
// ============================================================
function excelDateToJSDate(serial) {
   var utc_days  = Math.floor(serial - 25569);
   var utc_value = utc_days * 86400;
   var date_info = new Date(utc_value * 1000);
   return date_info.toISOString().split('T')[0];
}

async function handleExcelImport(input) {
    if(!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const btn = document.getElementById('importExcelBtn');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';

    try {
        const data = await readExcelFile(file);
        if (data.length === 0) throw new Error("فایلەکە بەتاڵە!");

        let validRows = [];
        let skippedCount = 0;

        data.forEach(row => {
            let rowData = {};
            let hasMatch = false;
            
            formFields.forEach(field => {
                const excelVal = row[field.label] || row[field.label.trim()];
                if (excelVal !== undefined && excelVal !== null && excelVal !== "") {
                    let finalVal = String(excelVal);
                    if (field.type === 'date' && typeof excelVal === 'number' && excelVal > 20000) {
                        finalVal = excelDateToJSDate(excelVal);
                    }
                    
                    // چارەسەری کێشەی خانەکانی ناو لقەکان (Branches)
                    // زانیارییەکە دەخاتە سەر هەموو ئایدییەکانی ئەو ناونیشانە بۆ ئەوەی لە هەر کوێیەک بێت بیدۆزێتەوە
                    if (field.ids && field.ids.length > 0) {
                        field.ids.forEach(id => {
                            rowData[id] = finalVal;
                        });
                    } else {
                        rowData[field.id] = finalVal;
                    }
                    
                    hasMatch = true;
                }
            });

            if(hasMatch) {
                validRows.push({
                    data: rowData,
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                skippedCount++;
            }
        });

        if (validRows.length === 0) throw new Error("هیچ ستوونێک هاوتا نییە!");

        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ناردن (${validRows.length})...`;
        const batchSize = 450;
        const chunks = [];
        for (let i = 0; i < validRows.length; i += batchSize) chunks.push(validRows.slice(i, i + batchSize));

        for (const chunk of chunks) {
            const batch = db.batch();
            chunk.forEach(record => {
                const docRef = db.collection("forms").doc(formId).collection("submissions").doc();
                batch.set(docRef, record);
            });
            await batch.commit();
        }

        alert(`سەرکەوتوو: ${validRows.length}\nفەرامۆشکراو: ${skippedCount}`);
        input.value = ""; 
        loadInitialData(); 

    } catch (error) {
        console.error("Import Error:", error);
        alert("هەڵە: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: false }); 
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { raw: true });
                resolve(json);
            } catch (err) { reject(err); }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
}

async function exportToExcel() {
    const exportBtn = document.getElementById('excelExportBtn');
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
    exportBtn.disabled = true;

    try {
        // ١. پشکنین دەکەین بزانین ئایا گەڕان کراوە یان نا؟
        const searchInputs = document.querySelectorAll('.column-search');
        let hasSearchTerm = false;
        searchInputs.forEach(input => {
            if (input.value.trim() !== "") hasSearchTerm = true;
        });

        let dataToExport = [];

        // ٢. ئەگەر گەڕان کرابوو، تەنها ئەنجامی گەڕانەکە دەبەین
        if (hasSearchTerm) {
            if (currentSearchResults.length === 0) throw new Error("هیچ داتایەک نەدۆزرایەوە بۆ دابەزاندن!");
            dataToExport = currentSearchResults;
        } 
        // ٣. ئەگەر گەڕان نەکرابوو، هەموو داتاکان لە داتابەیس دەهێنین
        else {
            const snapshot = await db.collection("forms").doc(formId).collection("submissions").orderBy("submittedAt", "desc").get();
            if (snapshot.empty) throw new Error("هیچ داتایەک نییە!");
            
            snapshot.docs.forEach(doc => {
                dataToExport.push(doc.data());
            });
        }

        let allKeys = new Set(["#", "کات"]);
        const fullData = [];

        // ٤. ڕێکخستنی داتاکان بۆ ناو فایلی ئەکسڵ
        dataToExport.forEach((sub, index) => {
            const record = {
                "#": index + 1,
                "کات": sub.submittedAt ? new Date(sub.submittedAt.seconds * 1000).toLocaleString('ckb') : '-'
            };
            
            formFields.forEach(f => {
                if(f.type === 'note' || f.type === 'line') return;
                let val = getFieldValue(sub.data, f);
                if (Array.isArray(val)) val = val.join('، ');
                record[f.label] = (val !== undefined && val !== null && val !== "") ? val : '-';
                allKeys.add(f.label);
            });
            
            fullData.push(record);
        });

        // ٥. دروستکردنی پەڕەی ئەکسڵەکە
        const worksheet = XLSX.utils.json_to_sheet(fullData);
        const colWidths = Array.from(allKeys).map(() => ({ wch: 20 })); 
        worksheet['!cols'] = colWidths;
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
        
        const formTitle = document.getElementById('formTitle').innerText || "Export";
        
        // ئەگەر گەڕان کرابوو، با ناوی فایلەکە وشەی (گەڕان)ـی لەگەڵ بێت بۆ ئەوەی جیاکرێتەوە
        const fileName = hasSearchTerm ? `${formTitle} (ئەنجامی گەڕان).xlsx` : `${formTitle}.xlsx`;
        
        XLSX.writeFile(workbook, fileName);

    } catch (error) { 
        console.error("Excel Error:", error); 
        alert("هەڵە لە دابەزاندن: " + error.message); 
    } finally { 
        exportBtn.innerHTML = originalText; 
        exportBtn.disabled = false; 
    }
}
async function generateMultiPagePDF(imageUrls, title) {
    if (!window.jspdf) return alert("PDF Library not loaded!");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    const btn = document.getElementById('pdfBtn_' + title.replace(/\s/g, ''));
    if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true; }

    try {
        const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        for (let i = 0; i < urls.length; i++) {
            if (i > 0) doc.addPage();
            const img = await loadImage(urls[i]);
            const imgRatio = img.width / img.height;
            const availWidth = pageWidth - 20; 
            const availHeight = pageHeight - 30; 

            let finalWidth, finalHeight;
            if (imgRatio > (availWidth / availHeight)) {
                finalWidth = availWidth;
                finalHeight = finalWidth / imgRatio;
            } else {
                finalHeight = availHeight;
                finalWidth = finalHeight * imgRatio;
            }
            const x = (pageWidth - finalWidth) / 2;
            const y = (pageHeight - finalHeight) / 2;

            doc.addImage(img, 'JPEG', x, y, finalWidth, finalHeight);
            doc.setFontSize(10);
            doc.text(`Page ${i + 1} of ${urls.length} - ${title}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        }
        doc.save(`${title}.pdf`);
    } catch (error) { console.error(error); alert("هەڵە لە PDF: " + error.message); } 
    finally { if(btn) { btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> دابەزاندن وەک PDF'; btn.disabled = false; } }
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous"; 
        img.src = url;
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("نەتوانرا وێنە باربکرێت"));
    });
}

async function filterTable() {
    const searchInputs = document.querySelectorAll('.column-search');
    const countElement = document.getElementById('displayedCount');
    const tbody = document.getElementById('tableBody');
    const loadMoreBtn = document.getElementById('loadMoreBtn'); 
    const noMoreMsg = document.getElementById('noMoreDataMsg');

    let hasSearchTerm = false;
    searchInputs.forEach(input => {
        if (input.value.trim() !== "") hasSearchTerm = true;
    });

    if (!hasSearchTerm) {
        tbody.innerHTML = '';
        const initialData = allSubmissions.length > 0 ? allSubmissions.slice(0, PAGE_SIZE) : [];
        renderRows(initialData, 1); 
        
        if(countElement) countElement.innerText = totalDatabaseCount > 0 ? totalDatabaseCount : allSubmissions.length;
        
        if(loadMoreBtn) {
            loadMoreBtn.onclick = loadMoreSearchResults; 
            loadMoreBtn.classList.remove('d-none');
            loadMoreBtn.innerText = "بارکردنی زیاتر";
        }
        if(noMoreMsg) noMoreMsg.classList.add('d-none');
        return;
    }

    if (!isAllDataLoaded) {
        // دیزاینە نوێیەکە بۆ کاتی گەڕان
        tbody.innerHTML = `
            <tr>
                <td colspan="100%" class="text-center border-0 py-5">
                    <div class="d-flex flex-column align-items-center justify-content-center">
                        <div class="spinner-border text-primary mb-3" style="width: 2.5rem; height: 2.5rem; border-width: 0.2em;" role="status"></div>
                        <h6 class="fw-bold text-dark mb-1">ئامادەکردنی داتاکان بۆ گەڕان...</h6>
                        <span class="text-muted small">تکایە کەمێک چاوەڕێ بە</span>
                    </div>
                </td>
            </tr>
        `;
        
        await new Promise(r => setTimeout(r, 50)); 

        try {
            const snapshot = await db.collection("forms").doc(formId).collection("submissions")
                .orderBy("submittedAt", "desc")
                .get();
            
            allSubmissions = [];
            snapshot.forEach(doc => {
                const sub = doc.data();
                sub.id = doc.id;
                allSubmissions.push(sub);
            });
            isAllDataLoaded = true;
        } catch (error) {
            console.error(error);
            tbody.innerHTML = `<tr><td colspan="100%" class="text-danger text-center">هەڵە: ${error.message}</td></tr>`;
            return;
        }
    }

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        
        const filteredData = allSubmissions.filter(item => {
            let isMatch = true;
            for (const input of searchInputs) {
                if (input.offsetParent === null) continue;
                
                const val = input.value.trim().toLowerCase();
                if (!val) continue;

                const fieldId = input.parentElement.getAttribute('data-field-id');
                const fieldDef = formFields.find(f => f.id === fieldId);
                
                if(fieldDef && item.data) {
                    let cellValue = getFieldValue(item.data, fieldDef);
                    if (Array.isArray(cellValue)) cellValue = cellValue.join(' ');
                    cellValue = String(cellValue || '').toLowerCase();
                    
                    if (!cellValue.includes(val)) {
                        isMatch = false;
                        break; 
                    }
                }
            }
            return isMatch;
        });

        currentSearchResults = filteredData;
        currentSearchPage = 1;

        if (filteredData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="100%" class="text-center py-4 text-muted">هیچ ئەنجامێک نەدۆزرایەوە</td></tr>`;
            if(countElement) countElement.innerText = "0";
            if(loadMoreBtn) loadMoreBtn.classList.add('d-none');
        } else {
            tbody.innerHTML = '';
            renderRows(filteredData.slice(0, SEARCH_PAGE_SIZE), 1);
            
            if(countElement) countElement.innerText = filteredData.length;

            if (filteredData.length > SEARCH_PAGE_SIZE) {
                if(loadMoreBtn) {
                    loadMoreBtn.classList.remove('d-none');
                    loadMoreBtn.innerText = `بینینی ئەنجامی زیاتر (${filteredData.length - SEARCH_PAGE_SIZE} ماوە)`;
                    loadMoreBtn.onclick = loadMoreSearchResults; 
                }
                if(noMoreMsg) noMoreMsg.classList.add('d-none');
            } else {
                if(loadMoreBtn) loadMoreBtn.classList.add('d-none');
                if(noMoreMsg) noMoreMsg.classList.remove('d-none');
            }
        }

    }, 300);
}

function loadMoreSearchResults() {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    const start = currentSearchPage * SEARCH_PAGE_SIZE;
    const end = start + SEARCH_PAGE_SIZE;
    const nextBatch = currentSearchResults.slice(start, end);

    if (nextBatch.length > 0) {
        renderRows(nextBatch, start + 1);
        currentSearchPage++;
    }

    const remaining = currentSearchResults.length - (currentSearchPage * SEARCH_PAGE_SIZE);
    if (remaining <= 0) {
        loadMoreBtn.classList.add('d-none');
        const noMoreMsg = document.getElementById('noMoreDataMsg');
        if(noMoreMsg) noMoreMsg.classList.remove('d-none');
    } else {
        loadMoreBtn.innerText = `بینینی ئەنجامی زیاتر (${remaining} ماوە)`;
    }
}

function toggleSelection(id) { if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); updateBulkDeleteBtn(); }
function updateBulkDeleteBtn() { const btn = document.getElementById('bulkDeleteBtn'); const countSpan = document.getElementById('selectedCount'); if(selectedIds.size > 0) { btn.classList.remove('d-none'); countSpan.innerText = selectedIds.size; } else { btn.classList.add('d-none'); } }
async function deleteSelected() { 
    if(!confirm(`دڵنیایت لە سڕینەوەی ${selectedIds.size} داتا؟`)) return; 
    
    // کۆکردنەوەی هەموو ئەو وێنانەی کە دەبێت بسڕێنەوە
    let urlsToDelete = [];
    selectedIds.forEach(id => {
        const targetDoc = allSubmissions.find(sub => sub.id === id);
        if (targetDoc && targetDoc.data) {
            urlsToDelete = urlsToDelete.concat(extractAllImageUrlsFromData(targetDoc.data));
        }
    });

    const batch = db.batch(); 
    selectedIds.forEach(id => { 
        const ref = db.collection("forms").doc(formId).collection("submissions").doc(id); 
        batch.delete(ref); 
    }); 
    
    try { 
        await batch.commit(); 
        // --- تۆمارکردنی هەموو سڕینەوەکان لە Audit Log ---
        if (typeof window.logAuditAction === 'function') {
            selectedIds.forEach(deletedId => {
                window.logAuditAction('DELETE', 'submissions', deletedId);
            });
        }
        
        // سڕینەوەی وێنەکان لە ستۆرج دوای ئەوەی کەیسەکە سڕایەوە
        for (const url of urlsToDelete) {
            await deleteImageFromFirebase(url);
        }

        alert("سڕایەوە!"); 
        selectedIds.clear(); 
        updateBulkDeleteBtn(); 
        loadInitialData(); 
    } catch(e) { alert("هەڵە: " + e.message); } 
}

async function deleteSingle(id) { 
    if(confirm("دڵنیایت؟")) { 
        const targetDoc = allSubmissions.find(sub => sub.id === id);
        let urlsToDelete = [];
        if (targetDoc && targetDoc.data) {
            urlsToDelete = extractAllImageUrlsFromData(targetDoc.data);
        }
        
        await db.collection("forms").doc(formId).collection("submissions").doc(id).delete(); 
        // --- تۆمارکردن لە Audit Log ---
        if (typeof window.logAuditAction === 'function') {
            window.logAuditAction('DELETE', 'submissions', id);
        }
        
        // سڕینەوەی وێنەکان
        for (const url of urlsToDelete) {
            await deleteImageFromFirebase(url);
        }
        loadInitialData(); 
    } 
}

function toggleColumn(index, isVisible) {
    const table = document.getElementById('dataTable');
    const th = table.querySelector(`th[data-col="${index}"]`);
    const searchTh = document.querySelector(`#searchRow th[data-col="${index}"]`);
    
    if(th) th.style.display = isVisible ? '' : 'none';
    if(searchTh) searchTh.style.display = isVisible ? '' : 'none';
    
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if(cells[index]) cells[index].style.display = isVisible ? '' : 'none';
    });

    const checkboxes = document.querySelectorAll('.column-toggle-checkbox');
    let hiddenCols = [];
    
    checkboxes.forEach(box => {
        if (!box.checked) {
            hiddenCols.push(parseInt(box.getAttribute('data-index')));
        }
    });

    const storageKey = "hidden_cols_" + formId;
    localStorage.setItem(storageKey, JSON.stringify(hiddenCols));
}

// فەنکشنی نوێ بۆ شەیرکردنی وێنەکان وەک PDF
async function shareImagesAsPDF(imageUrlsStr) {
    let imageUrls = [];
    try {
        // گۆڕینی تێکستەکە بۆ ئارەی
        imageUrls = typeof imageUrlsStr === 'string' ? JSON.parse(decodeURIComponent(imageUrlsStr)) : imageUrlsStr;
    } catch(e) { console.error(e); }

    if (!imageUrls || imageUrls.length === 0) {
        Swal.fire('ئاگاداری', 'هیچ وێنەیەک نییە بۆ ناردن!', 'warning');
        return;
    }

    Swal.fire({
        title: 'ئامادەکردنی PDF...',
        text: 'تکایە چاوەڕێ بە',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        for (let i = 0; i < imageUrls.length; i++) {
            const url = imageUrls[i];
            
            // هێنانی وێنەکە و گۆڕینی بۆ Base64 (بۆ ئەوەی کێشەی لەگەڵ PDF نەبێت)
            const response = await fetch(url);
            const blob = await response.blob();
            const base64data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });

            // زیادکردنی پەڕەی نوێ ئەگەر وێنەی یەکەم نەبوو
            if (i > 0) doc.addPage();

            // ڕێکخستنی قەبارەی وێنەکە بۆ ناو پەڕەی A4
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            
            // وێنەکە لە ناوەڕاست و بەقەبارەی گونجاو دادەنێت
            doc.addImage(base64data, 'JPEG', 5, 5, pageWidth - 10, pageHeight - 10, undefined, 'FAST');
        }

        // دروستکردنی فایلی PDF
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], "Case_Images.pdf", { type: "application/pdf" });

        Swal.close();

        // ناردنی فایلەکە بە بەکارهێنانی Web Share API (بۆ مۆبایل)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: 'وێنەکانی کەیس',
                files: [file]
            });
        } else {
            // بۆ کۆمپیوتەر یان ئەو براوزەرانەی پشتگیری شەیر ناکەن، فایلەکە ڕاستەوخۆ دادەبەزێت
            doc.save("Case_Images.pdf");
            Swal.fire('سەرکەوتوو', 'لەبەر ئەوەی براوزەرەکەت پشتگیری شەیر ناکات، فایلەکە داگیرا.', 'success');
        }

    } catch (error) {
        console.error("Error creating PDF:", error);
        Swal.fire('هەڵە', 'کێشەیەک ڕوویدا لە کاتی ئامادەکردنی وێنەکان.', 'error');
    }
}