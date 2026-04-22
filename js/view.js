// js/view.js

const urlParams = new URLSearchParams(window.location.search);
const formId = urlParams.get('id');

const formEl = document.getElementById('publicForm');
const container = document.getElementById('dynamicInputs');
const titleEl = document.getElementById('formTitleDisplay');
const STORAGE_KEY = `autosave_data_${formId}`;
// --- زیادکراو بۆ ناسینەوەی کارمەند ---
let loggedInUserForLog = "بەکارهێنەری گشتی (لینک)";

firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        loggedInUserForLog = user.email.toLowerCase();
    }
});
// ------------------------------------

// گوێگرتن لە هەر گۆڕانکارییەک (نووسین یان هەڵبژاردن)
// --- فەنکشنی نوێ بۆ گۆڕینی ژمارەی کوردی و عەرەبی بە ئینگلیزی ---
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

// --- چارەسەری کێشەی بلۆکبوونی کیبۆردی کوردی لە خانەی ژمارەکان ---
document.addEventListener('focusin', function(e) {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
        e.target.type = 'text'; // دەیگۆڕین بۆ تێکست بۆ ئەوەی ڕێگە بە ژمارەی کوردی بدات
        e.target.setAttribute('inputmode', 'numeric'); // بۆ ئەوەی لە مۆبایل هەر کیبۆردی ژمارەکان بکرێتەوە
    }
});

// گوێگرتن لە هەر گۆڕانکارییەک (نووسین یان هەڵبژاردن)
if(formEl) {
    formEl.addEventListener('input', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            convertAllNumerals(e.target);
        }
        handleAutoSave(e); 
    });
    formEl.addEventListener('change', handleAutoSave);
}

// کۆگای وێنەکان
let photosStore = {};
// کۆگای خانە ناچارییەکان (بۆ پشکنین)
let requiredFieldsRegistry = [];
// کۆگای پەنجەمۆرەکان/واژۆکان
let fingerprintPads = {};

// 1. بارکردنی فۆڕم و پشکنینی دۆخی چالاکبوون
async function initView() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    
    // هەوڵ دەدات کۆنتەینەرەکە بدۆزێتەوە (چ بە ئایدی یان بە کلاس)
    let mainContainer = document.getElementById('mainFormContainer');
    if (!mainContainer) mainContainer = document.querySelector('.container.py-5'); 

    let inactiveMsg = document.getElementById('inactiveMessage');

    // ئەگەر پەیامی داخستن لە HTML نەبوو، دروستی دەکەین
    if (!inactiveMsg) {
        inactiveMsg = document.createElement('div');
        inactiveMsg.id = 'inactiveMessage';
        inactiveMsg.className = 'd-none text-center mt-5 pt-5';
        inactiveMsg.innerHTML = `
            <div class="bg-white p-5 rounded-4 shadow mx-auto" style="max-width: 500px;">
                <i class="fa-solid fa-lock text-danger fa-4x mb-3"></i>
                <h3 class="fw-bold">فۆڕمەکە داخراوە</h3>
                <p class="text-muted">ببورە، ئەم فۆڕمە لە ئێستادا ناچاڵاکە.</p>
            </div>
        `;
        document.body.appendChild(inactiveMsg);
    }

    if(!formId) {
        if(typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'هەڵە', text: 'لینکەکە هەڵەیە' });
        else alert('لینکەکە هەڵەیە');
        return;
    }

    try {
        const doc = await db.collection("forms").doc(formId).get();
        if (doc.exists) {
            const data = doc.data();

            // --- ١. ئەگەر ناچاڵاک بوو ---
            if (data.active === false) {
                if(loadingOverlay) loadingOverlay.style.display = 'none';
                if(mainContainer) mainContainer.classList.add('d-none'); // فۆڕم بشارەوە
                inactiveMsg.classList.remove('d-none'); // پەیام پیشان بدە
                return; 
            }

            // --- ٢. ئەگەر چالاک بوو ---
            if(mainContainer) mainContainer.classList.remove('d-none'); 
            inactiveMsg.classList.add('d-none');

            // بەردەوام بە لە بارکردنی داتا...
            titleEl.innerText = data.title;
            requiredFieldsRegistry = [];
            fingerprintPads = {}; 
            renderFields(data.fields || [], container);
            
            setTimeout(() => {
                restoreProgress();
            }, 300);
            
            const indicator = document.createElement('div');
            indicator.id = 'saveIndicator';
            indicator.className = 'text-muted small text-center mt-2 fw-bold text-primary';
            indicator.style.opacity = '0';
            indicator.style.transition = 'opacity 0.5s';
            indicator.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> خەزنکرا (کاتی)';
            if(titleEl && titleEl.parentNode) titleEl.parentNode.appendChild(indicator);

            if(loadingOverlay) loadingOverlay.style.display = 'none';
        } else {
            if(typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'نەدۆزرایەوە', text: 'فۆڕمەکە نەدۆزرایەوە!' });
            else alert('فۆرمەکە نەدۆزرایەوە!');
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

// 3. دروستکردنی دیزاینی خانەکان
function renderFields(fields, parentElement) {
    fields.forEach(field => {
        const fieldWrapper = document.createElement('div');
        fieldWrapper.className = 'field-wrapper mb-4 animate-up';
        
        const reqMark = field.required ? ' <span class="text-danger fw-bold">*</span>' : '';
        if(field.required) {
            requiredFieldsRegistry.push({ id: field.id, label: field.label, type: field.type });
        }

        const label = document.createElement('label');
        label.className = 'form-label fw-bold d-block mb-2 text-dark';
        label.innerHTML = field.label + reqMark;
        fieldWrapper.appendChild(label);

        let inputEl;
        let branchEls = {}; 

        // ----------------------------------------------------
        // 1. بەشی تایبەت بە ژمارە (NUMBER)
        // ----------------------------------------------------
        if (field.type === 'number') {
            inputEl = document.createElement('input');
            inputEl.type = "number"; 
            inputEl.className = 'form-control form-control-lg shadow-sm';
            inputEl.name = field.id; // گۆڕدرا بۆ ئایدی
            
            inputEl.setAttribute("inputmode", "decimal"); 
            inputEl.setAttribute("pattern", "[0-9]*");
            inputEl.setAttribute("step", "any"); 
            
            inputEl.addEventListener('wheel', function(e) { e.preventDefault(); });
            
            fieldWrapper.appendChild(inputEl);
        }

        // ----------------------------------------------------
        // 2. بەشی نووسینی ئاسایی (TEXT)
        // ----------------------------------------------------
        else if (field.type === 'text') {
            inputEl = createInput('text', field.id); // گۆڕدرا بۆ ئایدی
            
            if (field.label.includes("مۆبایل") || field.label.includes("Mobile")) {
                inputEl.dir = "ltr";  
                inputEl.setAttribute("inputmode", "tel");                 
                inputEl.addEventListener('input', function(e) {
                    let val = this.value;
                    const kurdishMap = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' };
                    this.value = val.replace(/[٠-٩]/g, match => kurdishMap[match]);
                });

                if(typeof Inputmask !== 'undefined') {
                    Inputmask({}).mask(inputEl);
                }
            }
            fieldWrapper.appendChild(inputEl);
        }

        // ----------------------------------------------------
        // 3. بەشی واژۆ (Fingerprint)
        // ----------------------------------------------------
        else if (field.type === 'fingerprint') {
            const padContainer = document.createElement('div');
            padContainer.className = 'border rounded shadow-sm bg-white';
            
            padContainer.innerHTML = `
                <div class="card-header bg-light d-flex justify-content-between align-items-center p-2 border-bottom">
                    <span class="fw-bold text-dark small"><i class="fa-solid fa-signature"></i> واژۆی ئەلیکترۆنی</span>
                </div>
                <div class="position-relative bg-white" style="height: 200px; touch-action: none;">
                    <canvas id="canvas_${field.id}" style="width: 100%; height: 100%; display: block; touch-action: none;"></canvas>
                    <div class="text-muted small position-absolute bottom-0 start-0 w-100 text-center py-2 pe-none opacity-50" style="pointer-events: none;">
                        لێرە واژۆ بکە
                    </div>
                </div>
                <div class="bg-light p-2 text-end border-top">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="clearFingerprint('${field.id}')">
                        <i class="fa-solid fa-eraser"></i> سڕینەوە
                    </button>
                </div>
            `;
            fieldWrapper.appendChild(padContainer);

            setTimeout(() => {
                const canvas = document.getElementById(`canvas_${field.id}`);
                if(canvas) {
                    if (typeof SignaturePad === 'undefined') return;

                    const resizeCanvas = () => {
                        const ratio = Math.max(window.devicePixelRatio || 1, 1);
                        canvas.width = canvas.offsetWidth * ratio;
                        canvas.height = canvas.offsetHeight * ratio;
                        canvas.getContext("2d").scale(ratio, ratio);
                    };
                    resizeCanvas();
                    window.addEventListener("resize", resizeCanvas);

                    fingerprintPads[field.id] = new SignaturePad(canvas, {
                        backgroundColor: 'rgba(255, 255, 255, 0)',
                        penColor: 'rgb(0, 0, 139)',
                        minWidth: 1.5,
                        maxWidth: 3.5,
                    });
                }
            }, 500);
        }

// ----------------------------------------------------
        // 4. وێنە (Photo) - ڕاستەوخۆ بەبێ سکانەر
        // ----------------------------------------------------
        else if (field.type === 'photo') {
            photosStore[field.id] = []; 
            const photoContainer = document.createElement('div');
            photoContainer.className = 'photo-uploader p-3 bg-light border rounded';

            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'd-flex gap-2 mb-3';
            
            const cameraBtn = document.createElement('button');
            cameraBtn.type = 'button';
            cameraBtn.className = 'btn btn-outline-primary flex-grow-1';
            cameraBtn.innerHTML = '<i class="fa-solid fa-camera fa-lg mb-1 d-block"></i> گرتنی وێنە';
            
            const galleryBtn = document.createElement('button');
            galleryBtn.type = 'button';
            galleryBtn.className = 'btn btn-outline-secondary flex-grow-1';
            galleryBtn.innerHTML = '<i class="fa-regular fa-images fa-lg mb-1 d-block"></i> گەلەری';

            buttonsDiv.appendChild(cameraBtn);
            buttonsDiv.appendChild(galleryBtn);

            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'file';
            hiddenInput.accept = 'image/*';
            hiddenInput.style.display = 'none';

            const previewContainer = document.createElement('div');
            previewContainer.className = 'd-flex flex-wrap gap-2';
            previewContainer.id = `preview_${field.id}`;

            cameraBtn.onclick = () => {
                hiddenInput.removeAttribute('multiple'); 
                hiddenInput.setAttribute('capture', 'environment');
                hiddenInput.click();
            };
            galleryBtn.onclick = () => {
                hiddenInput.removeAttribute('capture');
                hiddenInput.setAttribute('multiple', 'multiple');
                hiddenInput.click();
            };

            // لێرەدا ڕاستەوخۆ وێنەکە دەخرێتە ناو فۆڕمەکەوە
            hiddenInput.onchange = (e) => {
                if(e.target.files && e.target.files.length > 0) {
                    Array.from(e.target.files).forEach(file => {
                        photosStore[field.id].push(file);
                        const currentIndex = photosStore[field.id].length - 1;
                        
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const imgDiv = document.createElement('div');
                            imgDiv.className = 'position-relative shadow-sm rounded overflow-hidden animate-up';
                            imgDiv.style.width = '100px';
                            imgDiv.style.height = '100px';
                            
                            imgDiv.innerHTML = `
                                <img src="${event.target.result}" style="width: 100%; height: 100%; object-fit: cover;">
                                <button type="button" class="btn btn-danger btn-sm position-absolute top-0 end-0 p-0 d-flex justify-content-center align-items-center" 
                                        style="width: 24px; height: 24px; border-radius: 0 0 0 5px;" 
                                        onclick="removePhoto('${field.id}', ${currentIndex}, this)">
                                    <i class="fa-solid fa-times"></i>
                                </button>
                            `;
                            previewContainer.appendChild(imgDiv);
                        };
                        reader.readAsDataURL(file);
                    });
                }
                hiddenInput.value = ''; 
            };

            photoContainer.appendChild(buttonsDiv);
            photoContainer.appendChild(previewContainer);
            photoContainer.appendChild(hiddenInput);
            fieldWrapper.appendChild(photoContainer);
        }

        // ----------------------------------------------------
        // 5. Select One
        // ----------------------------------------------------
        else if (field.type === 'select_one') {
            inputEl = document.createElement('select');
            inputEl.className = 'form-select form-select-lg shadow-sm';
            inputEl.name = field.id; // گۆڕدرا بۆ ئایدی
            
            const defOpt = document.createElement('option');
            defOpt.innerText = 'هەڵبژێرە...';
            defOpt.value = '';
            inputEl.appendChild(defOpt);

            if(field.options) {
                field.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.innerText = opt;
                    inputEl.appendChild(option);
                });
            }
            fieldWrapper.appendChild(inputEl);

            if(field.branches) {
                const branchesContainer = createBranchContainer(field.branches, branchEls);
                fieldWrapper.appendChild(branchesContainer);
                inputEl.addEventListener('change', (e) => {
                    const selectedVal = e.target.value;
                    Object.values(branchEls).forEach(el => el.style.display = 'none');
                    if (branchEls[selectedVal]) branchEls[selectedVal].style.display = 'block';
                });
            }
        }

        // ----------------------------------------------------
        // 6. Select Many
        // ----------------------------------------------------
        else if (field.type === 'select_many') {
            const checkboxGroup = document.createElement('div');
            checkboxGroup.style.display = 'grid';
            checkboxGroup.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
            checkboxGroup.style.gap = '10px';
            checkboxGroup.className = 'p-3 border rounded bg-light';

            if(field.options) {
                let branchesContainer;
                if(field.branches) branchesContainer = createBranchContainer(field.branches, branchEls);

                field.options.forEach(opt => {
                    const checkWrapper = document.createElement('div');
                    checkWrapper.className = 'form-check d-flex align-items-center p-2 border rounded bg-white shadow-sm h-100';
                    checkWrapper.style.cursor = 'pointer';
                    
                    const checkbox = document.createElement('input');
                    checkbox.className = 'form-check-input ms-2';
                    checkbox.type = 'checkbox';
                    checkbox.value = opt;
                    checkbox.name = field.id + '[]'; // گۆڕدرا بۆ ئایدی
                    checkbox.id = `${field.id}_${opt.replace(/\s/g, '_')}`;

                    const checkLabel = document.createElement('label');
                    checkLabel.className = 'form-check-label w-100 cursor-pointer mb-0';
                    checkLabel.htmlFor = checkbox.id;
                    checkLabel.innerText = opt;

                    checkWrapper.appendChild(checkbox);
                    checkWrapper.appendChild(checkLabel);
                    checkboxGroup.appendChild(checkWrapper);

                    if(field.branches) {
                        checkbox.addEventListener('change', (e) => {
                            const val = e.target.value;
                            if (branchEls[val]) {
                                branchEls[val].style.display = e.target.checked ? 'block' : 'none';
                            }
                        });
                    }
                });

                fieldWrapper.appendChild(checkboxGroup);
                if(branchesContainer) fieldWrapper.appendChild(branchesContainer);
            }
        }

        // ----------------------------------------------------
        // 7. Date & Note
        // ----------------------------------------------------
        else if (field.type === 'date') {
            inputEl = createInput('date', field.id); // گۆڕدرا بۆ ئایدی
            fieldWrapper.appendChild(inputEl);
        } 
        else if (field.type === 'note') {
            inputEl = document.createElement('textarea');
            inputEl.className = 'form-control shadow-sm';
            inputEl.name = field.id; // گۆڕدرا بۆ ئایدی
            inputEl.rows = 3;
            fieldWrapper.appendChild(inputEl);
        }

        // پشکنینی ناچاری (Required Check) بۆ هەموو ئینپوتەکان
        if(inputEl && field.required && field.type !== 'select_many' && field.type !== 'photo') {
            inputEl.required = true;
            inputEl.oninvalid = function(e) { e.target.setCustomValidity('تکایە ئەم خانەیە پڕ بکەرەوە'); };
            inputEl.oninput = function(e) { e.target.setCustomValidity(''); };
        }

        parentElement.appendChild(fieldWrapper);
    });
}

window.removePhoto = function(fieldId, index, btn) { // Parameter گۆڕدرا
    photosStore[fieldId][index] = null;
    btn.parentElement.remove();
}

window.clearFingerprint = function(id) {
    if (fingerprintPads[id]) {
        fingerprintPads[id].clear();
    }
};

// --- STANDARD FUNCTIONS ---

function createBranchContainer(branchesData, branchElsRef) {
    const container = document.createElement('div');
    container.className = 'branches-container mt-3';

    for (const [optionName, childFields] of Object.entries(branchesData)) {
        const branchDiv = document.createElement('div');
        branchDiv.className = 'branch-group p-3 border-start border-4 border-primary bg-light rounded-end mt-2';
        branchDiv.style.display = 'none';
        
        const header = document.createElement('div');
        header.className = 'branch-header text-primary fw-bold small mb-2';
        header.innerHTML = `<i class="fa-solid fa-arrow-turn-down"></i> پەیوەست بە: ${optionName}`;
        branchDiv.appendChild(header);

        renderFields(childFields, branchDiv); 
        container.appendChild(branchDiv);
        branchElsRef[optionName] = branchDiv;
    }
    return container;
}

function createInput(type, name) {
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.className = 'form-control form-control-lg shadow-sm';
    return input;
}

// --- SUBMIT ---
formEl.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    
    // --- Validation Logic START ---
    let isValid = true;
    for (const reqField of requiredFieldsRegistry) {
        if (reqField.type === 'photo') {
            const hasPhotos = photosStore[reqField.id] && photosStore[reqField.id].some(p => p !== null); 
            if (!hasPhotos) {
                isValid = false;
                if(typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'warning', title: 'تکایە وێنە دابنێ', text: `خانەی "${reqField.label}" پێویستی بە وێنەیە.`, confirmButtonText: 'باشە', confirmButtonColor: '#6366f1' });
                } else alert(`وێنە بۆ "${reqField.label}" پێویستە`);
                return; 
            }
        } else if (reqField.type === 'select_many') {
            const checked = document.querySelectorAll(`input[name="${reqField.id}[]"]:checked`); 
            if (checked.length === 0) {
                isValid = false;
                if(typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'warning', title: 'هەڵبژاردن', text: `تکایە لانیکەم یەک دانە بۆ "${reqField.label}" هەڵبژێرە.`, confirmButtonText: 'باشە', confirmButtonColor: '#6366f1' });
                } else alert(`هەڵبژاردن بۆ "${reqField.label}" پێویستە`);
                return;
            }
        } else if (reqField.type === 'fingerprint') { 
            const pad = fingerprintPads[reqField.id];
            if (!pad || pad.isEmpty()) {
                isValid = false;
                if(typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'warning', title: 'واژۆ', text: `تکایە واژۆ لە خانەی "${reqField.label}" بکە.`, confirmButtonText: 'باشە', confirmButtonColor: '#6366f1' });
                } else alert(`واژۆ بۆ "${reqField.label}" پێویستە`);
                return;
            }
        }
    }
    // --- Validation Logic END ---

    // ==========================================
    // UI دەستپێکردنی Premium Progress
    // ==========================================
    const progressContainer = document.getElementById('premiumProgressContainer');
    const progressWrapper = document.getElementById('progressWrapper');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressMainText = document.getElementById('progressMainText');
    const progressSubText = document.getElementById('progressSubText');
    const progressIcon = document.getElementById('progressIcon');

    if(submitBtn) submitBtn.classList.add('d-none');
    
    let progress = 0;
    let progressInterval;
    
    if(progressContainer) {
        progressContainer.classList.remove('d-none');
        progressBar.style.width = '0%';
        progressText.innerText = '0%';
        progressWrapper.classList.remove('success-mode');
        progressIcon.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
        progressMainText.innerText = 'ئامادەکردنی داتا...';
        progressSubText.innerText = 'خەریکی ڕێکخستنی زانیارییەکانین';

        progressInterval = setInterval(() => {
            if (progress < 85) {
                progress += Math.floor(Math.random() * 5) + 1; 
                if (progress > 85) progress = 85;
                progressBar.style.width = progress + '%';
                progressText.innerText = progress + '%';
            }
        }, 300);
    }

    try {
        let formData = {};
        const elements = formEl.elements;

        for (let i = 0; i < elements.length; i++) {
            const item = elements[i];
            if (!item.name || item.type === 'submit' || item.type === 'file') continue;

            if (item.type === 'checkbox') {
                const cleanName = item.name.replace('[]', '');
                if (item.checked) {
                    if (!formData[cleanName]) formData[cleanName] = [];
                    formData[cleanName].push(item.value);
                }
                continue;
            }
            if (item.type === 'radio') {
                if (item.checked) formData[item.name] = item.value;
                continue;
            }
            if (item.value) formData[item.name] = item.value;
        }

        // Upload Photos
        let hasPhotos = false;
        for (const [fieldId, files] of Object.entries(photosStore)) { 
            const validFiles = files.filter(f => f !== null);
            if (validFiles.length > 0) {
                hasPhotos = true;
                if(progressSubText) {
                    progressMainText.innerText = 'بەرزکردنەوە...';
                    progressSubText.innerText = 'تکایە پەڕەکە دامەخە تا زانیارییەکان دەنێردرێن.';
                }
                let uploadedUrls = [];
                for (const file of validFiles) {
                    const url = await uploadImageToFirebase(file);
                    if(url) uploadedUrls.push(url);
                }
                if (uploadedUrls.length > 0) formData[fieldId] = uploadedUrls; 
            }
        }

        // Upload Signatures
        for (const [fieldId, pad] of Object.entries(fingerprintPads)) {
            if (!pad.isEmpty()) {
                if(progressSubText) {
                    progressMainText.innerText = 'بەرزکردنەوەی واژۆکان...';
                    progressSubText.innerText = 'خەریکی پاشەکەوتکردنی واژۆی ئەلیکترۆنین';
                }
                const dataURL = pad.toDataURL("image/png");
                const res = await fetch(dataURL);
                const blob = await res.blob();
                const file = new File([blob], "signature.png", { type: "image/png" });
                
                const url = await uploadImageToFirebase(file);
                if(url) formData[fieldId] = url; 
            }
        }

// Save to Database
        if(progressSubText) {
            progressMainText.innerText = 'پاشەکەوتکردنی کۆتایی...';
            progressSubText.innerText = 'پەیوەستبوون بە داتابەیسەوە';
        }

        // ١. خەزنکردنی داتاکە و وەرگرتنی ئایدییەکەی (docRef)
        const docRef = await db.collection("forms").doc(formId).collection("submissions").add({
            data: formData,
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

// ٢. ناردنی ڕاستەوخۆ بۆ پەڕەی چاودێری (Audit Log)
// ٢. ناردنی ڕاستەوخۆ بۆ پەڕەی چاودێری (Audit Log)
        try {
            const userEmail = loggedInUserForLog;
            const formTitleText = titleEl ? titleEl.innerText : 'فۆڕمێکی نەزانراو';

            // -- هەوڵدان بۆ دۆزینەوەی ناو لەناو فۆڕمەکە --
            let extractedName = null;
            const allLabels = document.querySelectorAll('.field-wrapper label');
            
            // ١. گەڕان بەدوای ئەو خانەیەی کە وشەی 'ناو' ی تێدایە
            for (let label of allLabels) {
                if (label.innerText.includes('ناو')) {
                    const input = label.parentElement.querySelector('input');
                    if (input && input.value) {
                        extractedName = input.value;
                        break; // هەرکە یەکەم 'ناو'ی دۆزیەوە دەوەستێت
                    }
                }
            }
            
            // ٢. ئەگەر بە وشەی 'ناو' نەیدۆزیەوە، یەکەم خانەی نوسین (text) وەردەگرێت
            if (!extractedName) {
                const firstTextInput = document.querySelector('.field-wrapper input[type="text"]');
                if (firstTextInput && firstTextInput.value) {
                    extractedName = firstTextInput.value;
                }
            }

            // ناوی کۆتایی کە دەچێتە ئەرشیف
            const caseDisplayName = extractedName ? extractedName : `وەڵامێکی نوێ بۆ: ${formTitleText}`;
            // --------------------------------------------

            await db.collection("audit_logs").add({
                user: userEmail,
                actionType: 'CREATE',
                collection: 'submissions', 
                documentId: docRef.id, 
                caseName: caseDisplayName, 
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (logError) {
            console.error("نەتوانرا لە تۆماری چاودێری خەزن بکرێت:", logError);
        }
                localStorage.removeItem(STORAGE_KEY);

        // ==========================================
        // تەواوبوون بە دیزاینی Premium
        // ==========================================
        if(progressContainer) {
            clearInterval(progressInterval);
            progressBar.style.width = '100%';
            progressText.innerText = '100%';
            progressWrapper.classList.add('success-mode');
            progressIcon.innerHTML = '<i class="fa-solid fa-check"></i>';
            progressMainText.innerText = 'بە سەرکەوتوویی نێردرا!';
            progressSubText.innerText = 'زانیارییەکانت گەیشتنە لامان';
        }

        setTimeout(() => {
            if(typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'سەرکەوتوو بوو',
                    text: 'زانیارییەکان بە سەرکەوتوویی نێردران!',
                    showConfirmButton: false,
                    timer: 2000
                }).then(() => {
                    window.location.reload();
                });
            } else {
                alert('سەرکەوتوو بوو!');
                window.location.reload();
            }
        }, 1200);

    } catch (error) {
        console.error("Error:", error);
        
        if(progressContainer) {
            clearInterval(progressInterval);
            progressContainer.classList.add('d-none');
            progressBar.style.width = '0%';
        }
        if(submitBtn) {
            submitBtn.classList.remove('d-none');
            submitBtn.disabled = false;
        }

        if(typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'error', title: 'هەڵە ڕوویدا', text: error.message, confirmButtonText: 'باشە' });
        } else alert(error.message);
    }
});

// ==========================================
// FIREBASE UPLOAD FUNCTION
// ==========================================
async function uploadImageToFirebase(file) {
    if (!file) return null;
    
    // دروستکردنی ناوێکی تایبەت بۆ ئەوەی وێنەکان یان واژۆکان تێکەڵ نەبن
    const uniqueFileName = 'form_photos/' + Date.now() + '_' + file.name;
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(uniqueFileName);
    
    try {
        // بەرزکردنەوەی فایلەکە بۆ Firebase Storage
        const snapshot = await fileRef.put(file);
        // وەرگرتنی لینکی فایلەکە
        const downloadURL = await snapshot.ref.getDownloadURL();
        return downloadURL;
        
    } catch (error) {
        console.error("Firebase Upload Error:", error);
        if(typeof Swal !== 'undefined') {
             Swal.fire({ icon: 'error', title: 'هەڵە', text: 'کێشە لە بارکردنی فایلەکە ڕوویدا' });
        } else {
             alert("کێشە لە بارکردنی وێنە: " + error.message);
        }
        return null;
    }
}

// --- فەنکشنەکانی Auto-Save ---
function handleAutoSave(e) {
    if(e.target.type === 'file') return;
    saveProgress();
    const badge = document.getElementById('saveIndicator');
    if(badge) {
        badge.style.opacity = '1';
        clearTimeout(window.saveTimer);
        window.saveTimer = setTimeout(() => badge.style.opacity = '0', 1500);
    }
}

function saveProgress() {
    const formData = new FormData(formEl);
    let dataToSave = {};
    for (const [key, value] of formData.entries()) {
        if (value instanceof File) continue; 
        if (dataToSave[key]) {
            if (!Array.isArray(dataToSave[key])) {
                dataToSave[key] = [dataToSave[key]];
            }
            dataToSave[key].push(value);
        } else {
            dataToSave[key] = value;
        }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
}

function restoreProgress() {
    const savedJSON = localStorage.getItem(STORAGE_KEY);
    if (!savedJSON) return;
    try {
        const savedData = JSON.parse(savedJSON);
        Object.keys(savedData).forEach(key => {
            const val = savedData[key];
            const inputs = document.querySelectorAll(`[name="${key}"]`);
            inputs.forEach(input => {
                if(input.type === 'checkbox' || input.type === 'radio') {
                    const valuesToCheck = Array.isArray(val) ? val : [val];
                    if(valuesToCheck.includes(input.value)) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } else {
                    input.value = val;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    } catch (e) {
        console.error("Auto-save restore failed", e);
    }
}

initView();