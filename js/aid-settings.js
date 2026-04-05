// js/aid-settings.js

let currentOptionsList = []; // بۆ هەڵگرتنی هەڵبژاردنەکانی ناو مۆداڵەکە

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        const userDoc = await db.collection("users").doc(user.email).get();
        if (userDoc.exists && userDoc.data().role === 'owner') {
            loadCategories();
            initBuilder();
            loadExistingForm();
        } else {
            alert("تۆ دەسەڵاتی بینینی ئەم پەڕەیەت نییە!");
            window.location.href = "index.html";
        }
    }
});

// ==========================================
// ١. بەڕێوەبردنی بەشەکان لەگەڵ ڕەنگەکانیان (Drag & Drop زیادکرا)
// ==========================================
async function addCategory() {
    const catInput = document.getElementById('catName');
    const catColorInput = document.getElementById('catColor'); 
    
    const name = catInput.value.trim();
    const color = catColorInput ? catColorInput.value : '#03b6f7'; 
    
    if (!name) return alert("تکایە ناوی بەشەکە بنووسە!");
    
    try {
        await db.collection("aid_categories").add({ 
            name: name, 
            color: color, 
            order: 999, // بۆ ئەوەی هەمیشە بچێتە کۆتایی لیستەکە
            createdAt: firebase.firestore.FieldValue.serverTimestamp() 
        });
        
        catInput.value = '';
        if(catColorInput) catColorInput.value = '#03b6f7'; 
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'بەشەکە زیادکرا', showConfirmButton: false, timer: 1500 });
    } catch (error) { 
        alert("هەڵە ڕوویدا!"); 
    }
}

let isCatSortableInitialized = false;

function loadCategories() {
    const listContainer = document.getElementById('categoriesListContainer');
    if (!listContainer) return;

    // هێنانی داتاکان بەبێ orderBy بۆ ئەوەی بەشە کۆنەکان ون نەبن
    db.collection("aid_categories").onSnapshot((snapshot) => {
        let cats = [];
        snapshot.forEach(doc => {
            cats.push({ id: doc.id, ...doc.data() });
        });

        // ڕیزکردنی ناوخۆیی (ئەگەر order نەبوو، کاتی دروستکردنەکەی بەکاردێت)
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
            listContainer.innerHTML = '<div class="col-12 text-center text-muted">هیچ بەشێک نییە</div>';
            return;
        }

        cats.forEach(data => {
            const catColor = data.color || '#03b6f7'; 
            listContainer.innerHTML += `
                <div class="col-md-4 mb-3 category-item" data-id="${data.id}">
                    <div class="card shadow-sm h-100 border-0" style="border-right: 4px solid ${catColor} !important;">
                        <div class="card-body d-flex justify-content-between align-items-center p-3">
                            <div class="d-flex align-items-center">
                                <i class="fa-solid fa-grip-vertical text-muted me-3 drag-category-handle" style="cursor: grab; font-size: 1.2rem;"></i>
                                <h6 class="m-0 fw-bold">${data.name}</h6>
                            </div>
                            <button class="btn btn-sm btn-outline-danger border-0 rounded-circle" onclick="deleteCategory('${data.id}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        // دڵنیابوونەوە لەوەی بزوێنەرەکە تەنها یەکجار کار دەکات بۆ ئەوەی پەڕەکە تێکنەچێت
        if (!isCatSortableInitialized) {
            new Sortable(listContainer, {
                animation: 150,
                handle: '.drag-category-handle',
                onEnd: async function () {
                    const items = listContainer.querySelectorAll('.category-item');
                    const batch = db.batch();
                    
                    for(let i = 0; i < items.length; i++) {
                        const id = items[i].getAttribute('data-id');
                        if (id) {
                            batch.set(db.collection("aid_categories").doc(id), { order: i }, { merge: true });
                        }
                    }
                    
                    try {
                        await batch.commit();
                    } catch (error) {
                        console.error("هەڵە لە ڕێکخستنی بەشەکان: ", error);
                    }
                }
            });
            isCatSortableInitialized = true;
        }
    });
}

async function deleteCategory(id) {
    if (confirm("دڵنیایت لە سڕینەوە؟")) await db.collection("aid_categories").doc(id).delete();
}


// ==========================================
// ٢. دروستکەری فۆڕم (Drag & Drop Builder) مۆداڵ و Checkbox زیادکرا
// ==========================================
function initBuilder() {
    new Sortable(document.getElementById('toolbox'), {
        group: { name: 'shared', pull: 'clone', put: false },
        sort: false,
        animation: 150
    });

    initSortableCanvas(document.getElementById('form-canvas'));
}

function initSortableCanvas(element) {
    if (element.classList.contains('sortable-initialized')) return;

    new Sortable(element, {
        group: 'shared',
        animation: 150,
        handle: '.fa-grip-vertical',
        ghostClass: 'bg-light',
        onAdd: function (evt) {
            const item = evt.item;
            if (item.classList.contains('toolbox-item')) {
                const type = item.getAttribute('data-type');
                
                // ئەگەر جۆری هەڵبژاردن بوو، مۆداڵەکە دەکەینەوە لەبری دروستکردنی ڕاستەوخۆ
                if (type === 'select_one' || type === 'select_multiple') {
                    currentOptionsList = [];
                    renderOptionsUI();
                    
                    const modal = new bootstrap.Modal(document.getElementById('optionsModal'));
                    modal.show();
                    
                    document.getElementById('optionsModal').setAttribute('data-pending-type', type);
                    
                    const tempDiv = document.createElement('div');
                    tempDiv.id = 'temp-field-creator';
                    tempDiv.className = 'text-center p-3 text-muted border rounded my-2 border-primary form-element'; // form-element زیادکرا بۆ ئەوەی ڕەقەمی نەکات
                    tempDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> چاوەڕێی پڕکردنەوەی هەڵبژاردنەکانە لە مۆداڵەکە...';
                    item.replaceWith(tempDiv);
                    document.getElementById('empty-msg').style.display = 'none';
                    return;
                }

                const newField = createFieldHtml(type);
                item.replaceWith(newField);
                document.getElementById('empty-msg').style.display = 'none';
            }
        }
    });
    element.classList.add('sortable-initialized');
}

// فەنکشنەکانی مۆداڵی هەڵبژاردنەکان
function saveOptionsToField() {
    if (currentOptionsList.length === 0) {
        return alert("تکایە بەلایەنی کەمەوە یەک هەڵبژاردن زیاد بکە!");
    }
    
    const modalEl = document.getElementById('optionsModal');
    const type = modalEl.getAttribute('data-pending-type');
    
    const newHtml = createFieldHtml(type, { label: '', options: [...currentOptionsList] });
    
    const tempDiv = document.getElementById('temp-field-creator');
    if (tempDiv) {
        tempDiv.replaceWith(newHtml);
        if (type === 'select_one') {
            const nested = newHtml.querySelector('.nested-container');
            if (nested) initSortableCanvas(nested);
        }
    } 
    
    bootstrap.Modal.getInstance(modalEl).hide();
}

function addOptionToUI() {
    const input = document.getElementById('newOptionInput');
    const val = input.value.trim();
    if (val) {
        currentOptionsList.push(val);
        input.value = '';
        renderOptionsUI();
        input.focus();
    }
}

const newOptionInput = document.getElementById('newOptionInput');
if (newOptionInput) {
    newOptionInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addOptionToUI();
        }
    });
}

function renderOptionsUI() {
    const listUI = document.getElementById('optionsListUI');
    listUI.innerHTML = '';
    currentOptionsList.forEach((opt, index) => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center bg-light mb-1 border-0 rounded';
        li.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fa-solid fa-grip-vertical text-muted me-3 drag-option-handle" style="cursor: grab; font-size: 1.2rem;"></i> 
                <span class="fw-bold">${opt}</span>
            </div>
            <button type="button" class="btn btn-sm btn-outline-danger border-0" onclick="removeOptionFromUI(${index})">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        listUI.appendChild(li);
    });

    new Sortable(listUI, {
        animation: 150,
        handle: '.drag-option-handle',
        onEnd: function (evt) {
            const movedItem = currentOptionsList.splice(evt.oldIndex, 1)[0];
            currentOptionsList.splice(evt.newIndex, 0, movedItem);
        }
    });
}

function removeOptionFromUI(index) {
    currentOptionsList.splice(index, 1);
    renderOptionsUI();
}

// دروستکردنی کارتی خانەکە کاتێک فڕێدەدرێتە ناو Canvas
function createFieldHtml(type, existingData = null) {
    const div = document.createElement('div');
    div.className = 'form-element';
    div.setAttribute('data-type', type);

    let typeName = '', icon = '';
    if (type === 'text') { typeName = 'دەقی کورت'; icon = 'fa-font'; }
    else if (type === 'number') { typeName = 'ژمارە'; icon = 'fa-hashtag'; }
    else if (type === 'textarea') { typeName = 'دەقی درێژ'; icon = 'fa-align-right'; }
    else if (type === 'date') { typeName = 'بەروار'; icon = 'fa-calendar'; }
    else if (type === 'select_one') { typeName = 'هەڵبژاردن (دروستکردنی لق)'; icon = 'fa-caret-square-down'; }
    else if (type === 'select_multiple') { typeName = 'فرە هەڵبژاردن (Checkbox)'; icon = 'fa-list-check'; }

    const labelValue = existingData ? existingData.label : '';
    const optionsArray = (existingData && existingData.options) ? existingData.options : [];
    
    // سەیڤکردنی هەڵبژاردنەکان لەناو داتا ئەتریبیوت بۆ ئەوەی کاتی سەیڤکردن بیخوێنینەوە
    if(optionsArray.length > 0) {
        div.setAttribute('data-options', JSON.stringify(optionsArray));
    }

    let extraHtml = '';
    if (type === 'select_one' || type === 'select_multiple') {
        const displayOpts = optionsArray.join('، ');
        extraHtml = `
            <div class="mt-2 p-2 bg-light rounded small border">
                <i class="fa-solid fa-list text-muted me-1"></i> هەڵبژاردنەکان: <strong class="text-primary">${displayOpts}</strong>
            </div>
        `;
        if (type === 'select_one') {
            extraHtml += `<div class="nested-container mt-3" placeholder="خانەکانی پەیوەست بەم هەڵبژاردنە لێرە دابنێ..."></div>`;
        }
    }

    div.innerHTML = `
        <div class="element-header">
            <div class="fw-bold text-muted"><i class="fa-solid fa-grip-vertical me-2" style="cursor: grab;"></i> <i class="fa-solid ${icon} me-1"></i> ${typeName}</div>
            <div class="element-actions">
                <button onclick="this.closest('.form-element').remove()"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
        <div>
            <label class="small text-muted fw-bold">ناوی پرسیار:</label>
            <input type="text" class="form-control-custom field-label" placeholder="پرسیارەکە لێرە بنووسە..." value="${labelValue}">
        </div>
        ${extraHtml}
    `;

    return div;
}


// ==========================================
// ٣. پاشەکەوتکردن و هێنانەوەی فۆڕمەکە
// ==========================================

function getFormStructure(container) {
    const elements = [];
    const children = container.children;

    for (let child of children) {
        if (child.classList.contains('form-element') && child.id !== 'temp-field-creator') {
            const type = child.getAttribute('data-type');
            const labelInput = child.querySelector('.field-label');
            const label = labelInput ? labelInput.value.trim() : '';

            if (!label) continue; 

            let fieldData = {
                id: 'field_' + Math.random().toString(36).substr(2, 9),
                type: type,
                label: label
            };

            if (type === 'select_one' || type === 'select_multiple') {
                if (child.hasAttribute('data-options')) {
                    fieldData.options = JSON.parse(child.getAttribute('data-options'));
                } else {
                    fieldData.options = [];
                }

                if (type === 'select_one') {
                    const nestedContainer = child.querySelector('.nested-container');
                    if (nestedContainer) {
                        fieldData.children = getFormStructure(nestedContainer);
                    }
                }
            }

            elements.push(fieldData);
        }
    }
    return elements;
}

async function saveAidForm() {
    const mainCanvas = document.getElementById('form-canvas');
    const structure = getFormStructure(mainCanvas);

    if (structure.length === 0) return alert("تکایە بەلایەنی کەمەوە خانەیەک دابنێ یان ناویان لێ بنێ!");

    const btn = document.querySelector('button[onclick="saveAidForm()"]');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> چاوەڕوانبە...';
    btn.disabled = true;

    try {
        await db.collection("aid_fields").doc("main_form").set({
            fields: structure,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        Swal.fire({ icon: 'success', title: 'سەرکەوتوو', text: 'فۆڕمەکە بە سەرکەوتوویی پاشەکەوت کرا', timer: 2000, showConfirmButton: false });
    } catch (error) {
        console.error(error);
        alert("هەڵە لە پاشەکەوتکردندا!");
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk me-2"></i> پاشەکەوتکردنی فۆڕم';
        btn.disabled = false;
    }
}

async function loadExistingForm() {
    try {
        const doc = await db.collection("aid_fields").doc("main_form").get();
        if (doc.exists) {
            const data = doc.data();
            if (data.fields && data.fields.length > 0) {
                document.getElementById('empty-msg').style.display = 'none';
                const mainCanvas = document.getElementById('form-canvas');
                rebuildFormTree(data.fields, mainCanvas);
            }
        }
    } catch (error) {
        console.error("Error loading form:", error);
    }
}

function rebuildFormTree(fields, container) {
    fields.forEach(fieldData => {
        const newField = createFieldHtml(fieldData.type, fieldData);
        container.appendChild(newField);

        if (fieldData.type === 'select_one') {
            const nestedContainer = newField.querySelector('.nested-container');
            if (nestedContainer) {
                initSortableCanvas(nestedContainer); 
                if (fieldData.children && fieldData.children.length > 0) {
                    rebuildFormTree(fieldData.children, nestedContainer);
                }
            }
        }
    });
}