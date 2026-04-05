// js/aid-board.js

let formFieldsCache = [];
let categoriesCache = [];
let isBoardInitialized = false;
let currentUserPerms = {};

let currentCategoryListener = null;

// گۆڕاوی نوێ بۆ هەڵگرتنی ژمارەی کەیسەکانی هەر بەشێک
let categoryCountsMap = {};

// گۆڕاوی نوێ بۆ هەڵگرتنی کەیسەکانی ناو بەشێک بە مەبەستی گەڕان تێیاندا
let currentCategoryCases = [];

window.convertAllNumerals = function(input) {
    if (input.type === 'date' || input.type === 'checkbox' || input.type === 'radio') return;

    const numbers = {
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
        '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
        '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
    };
    
    let val = input.value;
    let converted = val.replace(/[٠-٩۰-۹]/g, function(match) {
        return numbers[match];
    });
    
    if (input.getAttribute('inputmode') === 'numeric') {
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

function formatDateTime(timestamp) {
    if (!timestamp) return '<span class="text-danger opacity-50">نەزانراو</span>';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '<span class="text-danger opacity-50">نەزانراو</span>';
    
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const dateString = date.toLocaleDateString('ku-IQ', options);
    const timeString = date.toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dateString} <span class="mx-1 text-muted">|</span> ${timeString}`;
}

function calculateDaysPassed(timestamp) {
    if (!timestamp) return 0;
    const pastDate = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(pastDate.getTime())) return 0;
    
    const today = new Date();
    const pastDay = new Date(pastDate.getFullYear(), pastDate.getMonth(), pastDate.getDate());
    const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const diffTime = currentDay - pastDay;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function generateDaysTrackerHtml(daysPassed) {
    let remainingDays = Math.max(0, 7 - daysPassed);
    let linesHtml = '';
    
    let colorClass = remainingDays <= 2 ? 'warning' : 'active';
    
    for (let i = 0; i < 7; i++) {
        if (i < remainingDays) {
            linesHtml += `<div class="tracker-line ${colorClass}"></div>`;
        } else {
            linesHtml += `<div class="tracker-line"></div>`;
        }
    }
    
    return `
        <div class="mt-2 pt-2 border-top">
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-muted" style="font-size: 0.75rem;"><i class="fa-solid fa-hourglass-half me-1"></i> مـاوە:</span>
                <div class="d-flex gap-1" dir="ltr">
                    ${linesHtml}
                </div>
            </div>
        </div>
    `;
}

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        const userDoc = await db.collection("users").doc(user.email).get();
        if (userDoc.exists) {
            currentUserPerms = userDoc.data();

            if (currentUserPerms.role === 'owner') {
                const settingSidebar = document.getElementById('navSettingsSidebar');
                const settingMobile = document.getElementById('navSettingsMobileLi');
                if (settingSidebar) settingSidebar.classList.remove('d-none');
                if (settingMobile) settingMobile.classList.remove('d-none');
            }

            if (currentUserPerms.role !== 'owner' && !currentUserPerms.canDistribute) {
                const distributeTabLi = document.getElementById('distribute-tab');
                if (distributeTabLi) {
                    distributeTabLi.parentElement.style.display = 'none';
                }
            }

            if (currentUserPerms.role !== 'owner' && !currentUserPerms.canViewArchive) {
                const archiveLinks = document.querySelectorAll('a[href="aid-archive.html"]');
                archiveLinks.forEach(link => {
                    link.style.display = 'none';
                });
            }

            initBoard();
        } else {
            alert("تۆ ڕێگەپێدراو نیت!");
            window.location.href = "login.html";
        }
    } else {
        window.location.href = "login.html";
    }
});

function initBoard() {
    db.collection("aid_fields").doc("main_form").onSnapshot(doc => {
        const container = document.getElementById('dynamicFormFields');
        formFieldsCache = [];
        container.innerHTML = '';

        if (!doc.exists || !doc.data().fields || doc.data().fields.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">هیچ خانەیەک دروست نەکراوە. لە سێتینگ دروستی بکە.</div>';
        } else {
            const fieldsTree = doc.data().fields;
            flattenFieldsCache(fieldsTree);
            renderFieldsTree(fieldsTree, container);
        }

        if (!isBoardInitialized) {
            startCategoryCountsListener(); 
            loadCategories();
            if (currentUserPerms.role === 'owner' || currentUserPerms.canDistribute) {
                loadDistributionCases();
            }
            isBoardInitialized = true;
        } else {
            if (currentUserPerms.role === 'owner' || currentUserPerms.canDistribute) {
                loadDistributionCases();
            }
        }
    });
}

function startCategoryCountsListener() {
    db.collection("aid_cases")
        .where("stage", "==", "category")
        .where("status", "==", "pending")
        .onSnapshot(snapshot => {
            categoryCountsMap = {}; 
            snapshot.forEach(doc => {
                let catId = doc.data().categoryId;
                if(catId) {
                    categoryCountsMap[catId] = (categoryCountsMap[catId] || 0) + 1;
                }
            });
            updateCategoryCountsUI();
        });
}

function updateCategoryCountsUI() {
    categoriesCache.forEach(cat => {
        let el = document.getElementById('countText-' + cat.id);
        if (el) {
            let count = categoryCountsMap[cat.id] || 0;
            
            if (count > 0) {
                el.className = "mt-3 badge bg-danger text-white border-0 p-2 w-75 rounded-pill shadow-sm fw-bold";
                // لێرەدا ڕاستەوخۆ count بەکاردێنین بۆ ئەوەی بە ئینگلیزی بێت
                el.innerHTML = `<i class="fa-solid fa-file-circle-exclamation me-1"></i> ${count} کەیس هەیە`;
            } else {
                el.className = "mt-3 badge bg-light text-secondary border p-2 w-75 rounded-pill fw-bold";
                if(document.body.classList.contains('dark-mode')) {
                    el.classList.replace('bg-light', 'bg-dark');
                }
                el.innerHTML = `<i class="fa-solid fa-check-double me-1"></i> هیچ نییە`;
            }
        }
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

function renderFieldsTree(fields, container, isHidden = false) {
    const wrapper = document.createElement('div');
    if (isHidden) wrapper.style.display = 'none';

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = isHidden ? 'mb-3 p-3 bg-light rounded border border-info' : 'mb-3';
        if (isHidden && document.body.classList.contains('dark-mode')) div.classList.remove('bg-light');

        let inputHtml = '';
        if (field.type === 'textarea') {
            inputHtml = `<textarea class="form-control" name="${field.id}" data-label="${field.label}" rows="3" oninput="convertAllNumerals(this)" ${!isHidden ? 'required' : ''}></textarea>`;
        } else if (field.type === 'select_one') {
            let optionsHtml = '<option value="">هەڵبژێرە...</option>';
            if (field.options) {
                field.options.forEach(opt => {
                    optionsHtml += `<option value="${opt}">${opt}</option>`;
                });
            }
            inputHtml = `<select class="form-select" name="${field.id}" data-label="${field.label}" ${!isHidden ? 'required' : ''}>${optionsHtml}</select>`;
        } else if (field.type === 'select_multiple') {
            let optionsHtml = '<div class="d-flex flex-wrap gap-3 mt-2">';
            if (field.options) {
                field.options.forEach((opt, index) => {
                    const uniqueId = `cb_${field.id}_${index}`;
                    optionsHtml += `
                        <div class="form-check custom-checkbox">
                            <input class="form-check-input select-multiple-input" type="checkbox" name="${field.id}" value="${opt}" id="${uniqueId}" data-label="${field.label}">
                            <label class="form-check-label" for="${uniqueId}">${opt}</label>
                        </div>
                    `;
                });
            }
            optionsHtml += '</div>';
            inputHtml = optionsHtml;
        } else if (field.type === 'number') {
            inputHtml = `<input type="text" inputmode="numeric" class="form-control" name="${field.id}" data-label="${field.label}" oninput="convertAllNumerals(this)" ${!isHidden ? 'required' : ''}>`;
        } else {
            let inputType = field.type === 'date' ? 'date' : 'text';
            inputHtml = `<input type="${inputType}" class="form-control" name="${field.id}" data-label="${field.label}" oninput="convertAllNumerals(this)" ${!isHidden ? 'required' : ''}>`;
        }

        div.innerHTML = `<label class="form-label fw-bold ${isHidden ? 'text-info' : ''}">${field.label}</label>${inputHtml}`;
        wrapper.appendChild(div);

        if (field.type === 'select_one' && field.children && field.children.length > 0) {
            const childContainer = renderFieldsTree(field.children, div, true);

            setTimeout(() => {
                const selectEl = div.querySelector(`select[name="${field.id}"]`);
                if (selectEl) {
                    selectEl.addEventListener('change', (e) => {
                        if (e.target.value !== "") {
                            childContainer.style.display = 'block';
                            childContainer.querySelectorAll('input, select, textarea').forEach(el => {
                                if(el.type !== 'checkbox') el.required = true;
                            });
                        } else {
                            childContainer.style.display = 'none';
                            childContainer.querySelectorAll('input, select, textarea').forEach(el => {
                                el.required = false;
                                if(el.type === 'checkbox') el.checked = false;
                                else el.value = '';
                            });
                        }
                    });
                }
            }, 50);
        }
    });

    container.appendChild(wrapper);
    return wrapper;
}

document.getElementById('newCaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let caseData = {};

    const inputs = e.target.querySelectorAll('input:not([type="checkbox"]), select, textarea');
    inputs.forEach(input => {
        if (input.offsetParent !== null && input.name) {
            caseData[input.getAttribute('data-label')] = input.value;
        }
    });

    const checkboxes = Array.from(e.target.querySelectorAll('input[type="checkbox"]:checked'));
    if (checkboxes.length > 0) {
        const groupedCheckboxes = checkboxes.reduce((acc, cb) => {
            const label = cb.getAttribute('data-label');
            if (!acc[label]) acc[label] = [];
            acc[label].push(cb.value);
            return acc;
        }, {});

        for (const label in groupedCheckboxes) {
            caseData[label] = groupedCheckboxes[label].join('، '); 
        }
    }

    caseData.stage = 'distribution';
    caseData.createdAt = firebase.firestore.FieldValue.serverTimestamp();

    try {
        const btnSubmit = e.target.querySelector('button[type="submit"]');
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> چاوەڕوانبە...';

        await db.collection("aid_cases").add(caseData);
        e.target.reset();

        e.target.querySelectorAll('.branch-container, .bg-light').forEach(el => {
            if (el.style.display !== '') el.style.display = 'none';
        });

        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane me-2"></i> ناردن بۆ دابەشکردن';

        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'کەیسەکە تۆمارکرا', showConfirmButton: false, timer: 2000 });

        if (currentUserPerms.role === 'owner' || currentUserPerms.canDistribute) {
            const distributeTab = new bootstrap.Tab(document.getElementById('distribute-tab'));
            distributeTab.show();
        }
    } catch (error) {
        console.error(error);
        alert("هەڵە لە ناردندا!");
    }
});

function loadCategories() {
    db.collection("aid_categories").onSnapshot(snapshot => {
        categoriesCache = [];
        
        const listContainer = document.getElementById('categories-list-container');
        if (!listContainer) return;
        
        let cats = [];
        snapshot.forEach(doc => {
            cats.push({ id: doc.id, ...doc.data() });
        });

        cats.sort((a, b) => {
            let orderA = (a.order !== undefined) ? a.order : 9999;
            let orderB = (b.order !== undefined) ? b.order : 9999;
            if(orderA === orderB) {
                let timeA = a.createdAt ? a.createdAt.seconds : 0;
                let timeB = b.createdAt ? b.createdAt.seconds : 0;
                return timeA - timeB;
            }
            return orderA - orderB;
        });

        listContainer.innerHTML = '';

        if (cats.length === 0) {
            listContainer.innerHTML = '<div class="col-12 text-center text-muted mt-4">هیچ بەشێک نییە. تکایە لە سێتینگ دروستی بکە.</div>';
            return;
        }

        cats.forEach(data => {
            categoriesCache.push(data);
            
            const catColor = data.color || '#03b6f7';
            
            listContainer.innerHTML += `
                <div class="col-md-4 col-lg-3">
                    <div class="card shadow-sm text-center h-100 position-relative" style="cursor: pointer; transition: 0.3s; background-color: var(--card-bg, #fff); border: 2px solid ${catColor} !important;" onclick="openCategory('${data.id}', '${data.name}')" onmouseover="this.classList.add('shadow')" onmouseout="this.classList.remove('shadow')">
                        <div class="card-body d-flex flex-column justify-content-center align-items-center py-4">
                            <div class="rounded-circle p-3 mb-3 d-flex align-items-center justify-content-center" style="width: 70px; height: 70px; background-color: ${catColor}15;">
                                <i class="fa-solid fa-folder-open" style="font-size: 2rem; color: ${catColor};"></i>
                            </div>
                            <h5 class="card-title fw-bold m-0" style="color: ${catColor};">${data.name}</h5>
                            
                            <div class="mt-3 badge bg-light text-muted border p-2 w-75 rounded-pill" id="countText-${data.id}" style="font-size: 0.85rem;">
                                <i class="fa-solid fa-spinner fa-spin"></i>
                            </div>

                        </div>
                    </div>
                </div>
            `;
        });
        
        updateCategoryCountsUI();
    });
}

function openCategory(categoryId, categoryName) {
    document.getElementById('categories-view').classList.add('d-none');
    document.getElementById('cases-view').classList.remove('d-none');
    document.getElementById('current-category-title').innerText = categoryName;

    // --- دروستکردنی خانەی گەڕان ئەگەر پێشتر نەبوو ---
    let searchBoxContainer = document.getElementById('categorySearchContainer');
    if (!searchBoxContainer) {
        const listContainer = document.getElementById('category-cases-container');
        const searchHtml = `
            <div id="categorySearchContainer" class="col-12 mb-4">
                <div class="input-group shadow-sm border rounded-pill overflow-hidden" style="background-color: var(--card-bg, #fff);">
                    <span class="input-group-text text-primary border-0 ms-2" style="background: transparent;"><i class="fa-solid fa-magnifying-glass"></i></span>
                    <input type="text" id="categorySearchBox" class="form-control border-0 shadow-none" style="background: transparent; color: inherit;" placeholder="گەڕان لەناو ئەم بەشە (ناو، تەلەفۆن، تێبینی...)" oninput="filterCategoryCases(this.value)">
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforebegin', searchHtml);
    } else {
        document.getElementById('categorySearchBox').value = ''; 
    }

    if (currentCategoryListener) {
        currentCategoryListener();
    }

    const list = document.getElementById('category-cases-container');
    list.innerHTML = '<div class="text-center text-muted w-100 mt-5"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>';

    currentCategoryListener = db.collection("aid_cases")
        .where("stage", "==", "category")
        .where("categoryId", "==", categoryId)
        .where("status", "==", "pending")
        .onSnapshot(snapshot => {
            currentCategoryCases = [];
            
            if (snapshot.empty) {
                list.innerHTML = '<div class="col-12 text-center text-muted mt-4">هیچ کەیسێکی نوێ لەم بەشەدا نییە</div>';
                return;
            }

            snapshot.forEach(doc => {
                currentCategoryCases.push({ id: doc.id, data: doc.data() });
            });
            
            currentCategoryCases.sort((a, b) => {
                const timeA = a.data.assignedAt ? (a.data.assignedAt.seconds || 0) : 0;
                const timeB = b.data.assignedAt ? (b.data.assignedAt.seconds || 0) : 0;
                return timeA - timeB; 
            });

            // پشکنین دەکات بزانێت ئەگەر گەڕانێک نووسرابوو با تەنها ئەوانە پیشان بدات، ئەگەرنا هەمووی
            const searchBox = document.getElementById('categorySearchBox');
            if (searchBox && searchBox.value.trim() !== '') {
                filterCategoryCases(searchBox.value);
            } else {
                renderCategoryCases(currentCategoryCases);
            }
        });
}

// فەنکشنی نوێ بۆ گەڕان و فلتەرکردنی کەیسەکان
function filterCategoryCases(term) {
    if (!term || term.trim() === '') {
        renderCategoryCases(currentCategoryCases);
        return;
    }
    
    // گۆڕینی ژمارەی کوردی ناو گەڕانەکە بۆ ئینگلیزی
    const numbers = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
    let normalizedTerm = term.replace(/[٠-٩۰-۹]/g, m => numbers[m]).toLowerCase().trim();
    
    const filtered = currentCategoryCases.filter(item => {
        for (let key in item.data) {
            let val = item.data[key];
            if (val && typeof val === 'string') {
                if (val.toLowerCase().includes(normalizedTerm)) return true;
            } else if (val && typeof val === 'number') {
                if (val.toString().includes(normalizedTerm)) return true;
            }
        }
        return false;
    });
    
    renderCategoryCases(filtered);
}

// فەنکشنی ڕێکخستنی شێوەی کەیسەکان کە پێشتر لەناو openCategory دابوو
function renderCategoryCases(casesArray) {
    const list = document.getElementById('category-cases-container');
    list.innerHTML = '';
    
    if (casesArray.length === 0) {
        list.innerHTML = '<div class="col-12 text-center text-muted mt-5"><i class="fa-solid fa-magnifying-glass mb-3 fa-2x opacity-50"></i><p>هیچ ئەنجامێک بۆ ئەم گەڕانە نەدۆزرایەوە</p></div>';
        return;
    }

    casesArray.forEach(item => {
        const docId = item.id;
        const data = item.data;
        const primaryText = getPrimaryText(data);
        const detailsHtml = generateDetailsHtml(data);
        
        const timeToCalculate = data.assignedAt || data.createdAt; 
        const assignedDays = calculateDaysPassed(timeToCalculate);
        const isDelayed = assignedDays >= 7;
        
        const cardClass = isDelayed ? "case-card border-top border-4 case-delayed-border" : "case-card border-top border-4 border-warning";
        const warningBadge = isDelayed ? `<div class="case-delayed-badge fw-bold"><i class="fa-solid fa-triangle-exclamation ms-1"></i> ئەم کەیسە ${assignedDays} ڕۆژە سەردانی نەکراوە!</div>` : '';

        list.innerHTML += `
        <div class="col-md-6 col-lg-6">
            <div class="${cardClass}">
                ${warningBadge}
                <h6 class="fw-bold mb-3"><i class="fa-solid fa-folder-open text-warning me-2"></i> ${primaryText}</h6>
                
                <div class="time-tracking-box">
                    <div class="d-flex justify-content-between mb-2 pb-2">
                        <span class="text-muted"><i class="fa-solid fa-share-nodes me-1"></i> نێردراوە بۆ بەش:</span>
                        <span class="text-dark" dir="ltr" style="font-size: 0.8rem; font-weight:500;">${formatDateTime(data.assignedAt || data.createdAt)}</span>
                    </div>
                    ${generateDaysTrackerHtml(assignedDays)}
                </div>
                
                ${detailsHtml}
                
                <div class="d-flex flex-wrap gap-2 pt-2 justify-content-center">
                    <button class="btn btn-sm btn-success action-btn flex-grow-1" onclick="updateStatus('${docId}', 'سەردانی کراوان')">
                        <i class="fa-solid fa-check-double"></i> سەردانی کراوە
                    </button>
                    <button class="btn btn-sm btn-danger action-btn flex-grow-1" onclick="updateStatus('${docId}', 'بەردەست نەبوو')">
                        <i class="fa-solid fa-xmark"></i> بەردەست نەبوو
                    </button>
                    <button class="btn btn-sm btn-secondary action-btn flex-grow-1" onclick="updateStatus('${docId}', 'پێویستی بە سەردان نەبوو')">
                        <i class="fa-solid fa-ban"></i> پێویست نەبوو
                    </button>
                    <button class="btn btn-sm btn-info action-btn flex-grow-1 text-white" onclick="updateStatus('${docId}', 'پێشتر سەردانی کراوە')">
                        <i class="fa-solid fa-clock-rotate-left"></i> پێشتر کراوە
                    </button>
                </div>
            </div>
        </div>
        `;
    });
}

function showCategoriesView() {
    document.getElementById('cases-view').classList.add('d-none');
    document.getElementById('categories-view').classList.remove('d-none');
    
    // پاککردنەوەی گەڕانەکە کاتێک دەگەڕێتەوە دواوە
    const searchBox = document.getElementById('categorySearchBox');
    if (searchBox) searchBox.value = '';

    if (currentCategoryListener) {
        currentCategoryListener();
        currentCategoryListener = null;
    }
}

function generateDetailsHtml(data) {
    let html = '<div class="mt-3 mb-3 p-2 border rounded shadow-sm bg-white" style="font-size: 0.9rem; max-height: 180px; overflow-y: auto;">';

    formFieldsCache.forEach(field => {
        const key = field.label;
        if (data[key] !== undefined && data[key] !== '') {
            html += `
                <div class="d-flex justify-content-between mb-2 border-bottom pb-1">
                    <span class="text-muted"><i class="fa-solid fa-angle-left me-1" style="font-size: 0.7rem;"></i> ${key}:</span>
                    <strong class="ms-2 text-start" style="max-width: 60%; word-wrap: break-word; color: var(--text-main);">${data[key]}</strong>
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

function loadDistributionCases() {
    db.collection("aid_cases").where("stage", "==", "distribution").onSnapshot(snapshot => {
        const list = document.getElementById('distributionList');
        if (!list) return;

        list.innerHTML = '';

        if (snapshot.empty) {
            list.innerHTML = '<div class="col-12 text-center text-muted mt-4">هیچ کەیسێک نییە بۆ دابەشکردن</div>';
            return;
        }

        let casesData = [];
        snapshot.forEach(doc => {
            casesData.push({ id: doc.id, data: doc.data() });
        });
        
        casesData.sort((a, b) => {
            const timeA = a.data.createdAt ? (a.data.createdAt.seconds || 0) : 0;
            const timeB = b.data.createdAt ? (b.data.createdAt.seconds || 0) : 0;
            return timeA - timeB; 
        });

        casesData.forEach(item => {
            const docId = item.id;
            const data = item.data;
            const primaryText = getPrimaryText(data);
            const detailsHtml = generateDetailsHtml(data);
            
            const submittedDays = calculateDaysPassed(data.createdAt);
            const isDelayed = submittedDays >= 7;
            
            const cardClass = isDelayed ? "case-card border-top border-4 case-delayed-border" : "case-card border-top border-4 border-primary";
            const warningBadge = isDelayed ? `<div class="case-delayed-badge fw-bold"><i class="fa-solid fa-triangle-exclamation ms-1"></i> ئەم کەیسە ${submittedDays} ڕۆژە نەنێردراوە!</div>` : '';

            list.innerHTML += `
                <div class="col-md-6 col-lg-4">
                    <div class="${cardClass}">
                        ${warningBadge}
                        <h6 class="fw-bold mb-3 text-primary"><i class="fa-solid fa-user-clock me-2"></i> ${primaryText}</h6>
                        
                        <div class="time-tracking-box">
                            <div class="d-flex justify-content-between mb-2 pb-2">
                                <span class="text-muted"><i class="fa-solid fa-pen-to-square me-1"></i> پڕکرایەوە:</span>
                                <span class="text-dark" dir="ltr" style="font-size: 0.8rem; font-weight:500;">${formatDateTime(data.createdAt)}</span>
                            </div>
                            ${generateDaysTrackerHtml(submittedDays)}
                        </div>
                        
                        ${detailsHtml}
                        
                        <div class="d-flex justify-content-between pt-2">
                            <button class="btn btn-sm btn-outline-danger action-btn" onclick="deleteCase('${docId}')">
                                <i class="fa-solid fa-trash"></i> سڕینەوە
                            </button>
                            <button class="btn btn-sm btn-primary action-btn" onclick="sendToCategory('${docId}')">
                                ناردن بۆ بەش <i class="fa-solid fa-share ms-1"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });
    });
}

async function deleteCase(id) {
    if (confirm("دڵنیایت لە سڕینەوەی ئەم کەیسە؟")) {
        await db.collection("aid_cases").doc(id).delete();
    }
}

async function sendToCategory(id) {
    if (categoriesCache.length === 0) return alert("هیچ بەشێک بوونی نییە، با ئەدمین دروستی بکات!");

    let optionsHtml = '';
    categoriesCache.forEach(cat => {
        optionsHtml += `<option value="${cat.id}">${cat.name}</option>`;
    });

    const { value: categoryId } = await Swal.fire({
        title: 'ناردن بۆ بەش',
        html: `<select id="swal-category" class="form-select mt-3">${optionsHtml}</select>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'ناردن',
        cancelButtonText: 'پاشگەزبوونەوە',
        preConfirm: () => {
            return document.getElementById('swal-category').value;
        }
    });

    if (categoryId) {
        await db.collection("aid_cases").doc(id).update({
            stage: 'category',
            categoryId: categoryId,
            status: 'pending',
            assignedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'نێردرا بۆ بەشەکە', showConfirmButton: false, timer: 1500 });
    }
}

async function updateStatus(id, newStatus) {
    if (confirm(`دڵنیایت کە دەتەوێت بیخەیتە باری: (${newStatus}) ؟`)) {
        await db.collection("aid_cases").doc(id).update({
            stage: 'archived',
            status: newStatus,
            completedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'کەیسەکە ئەرشیف کرا', showConfirmButton: false, timer: 1500 });
    }
}