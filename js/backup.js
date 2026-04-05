// js/backup.js

// ئەو کۆلێکشنانەی کە دەتەوێت باکەپ بکرێن (جگە لە forms کە subcollectionی هەیە)
// بۆ داهاتوو هەر پەڕە یان بەشێکی نوێت زیادکرد، تەنها ناوی کۆلێکشنەکەی لێرە زیاد بکە
const standardCollections = [
    "users",
    "aid_fields",
    "aid_categories",
    "aid_cases"
];

// ==========================================
// 1. بەشی هەڵگرتنی باکەپ (EXPORT)
// ==========================================
async function createBackup() {
    const btn = document.getElementById('btnBackup');
    const originalText = btn.innerHTML;
    
    // دیزاینی دوگمە
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> خەریکە داتا کۆدەکرێتەوە...';

    try {
        let backupData = {
            version: "3.0", // وەشانەکەمان بەرزکردەوە
            createdAt: new Date().toISOString(),
            forms: {} // فۆڕمەکان بە جیا دادەنێین بەهۆی subcollection
        };

        console.log("Starting backup process...");

        // 1. هێنانی کۆلێکشنە ستانداردەکان بە شێوەی داینامیکی
        await Promise.all(standardCollections.map(async (collectionName) => {
            backupData[collectionName] = {};
            const snap = await db.collection(collectionName).get();
            snap.forEach(doc => {
                backupData[collectionName][doc.id] = doc.data();
            });
            console.log(`${collectionName} fetched: ${snap.size}`);
        }));

        // 2. هێنانی فۆڕمەکان و وەڵامەکان (Submissions)
        const formsSnap = await db.collection("forms").get();
        
        await Promise.all(formsSnap.docs.map(async (formDoc) => {
            const formData = formDoc.data();
            const formId = formDoc.id;

            // دروستکردنی پەیکەری فۆڕمەکە
            backupData.forms[formId] = {
                details: formData,
                submissions: {} 
            };

            // هێنانی Submissions (وەڵامەکان)
            const subSnap = await db.collection("forms").doc(formId).collection("submissions").get();
            subSnap.forEach(subDoc => {
                backupData.forms[formId].submissions[subDoc.id] = subDoc.data();
            });
        }));
        
        console.log(`Forms fetched: ${formsSnap.size}`);

        // 3. دروستکردنی فایل و دابەزاندن
        const filename = `Mrovdostan_Backup_${new Date().toISOString().slice(0,10)}.json`;
        downloadJSON(backupData, filename);

        Swal.fire({
            icon: 'success',
            title: 'سەرکەوتوو بوو',
            text: 'فایلی باکەپەکە ئامادەیە.'
        });

    } catch (error) {
        console.error("Backup Error:", error);
        Swal.fire('هەڵە', 'کێشەیەک ڕوویدا: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// فەنکشنی یارمەتیدەر بۆ دابەزاندن
function downloadJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


// ==========================================
// 2. بەشی گێڕانەوەی باکەپ (IMPORT)
// ==========================================
function triggerRestore() {
    document.getElementById('backupFileInput').click();
}

async function handleRestore(input) {
    const file = input.files[0];
    if (!file) return;

    // پرسیاری دڵنیابوونەوە
    const result = await Swal.fire({
        title: 'دڵنیایت؟',
        text: "گێڕانەوەی باکەپ داتاکانی پێشوو تێکەڵ دەکات. ئەگەر هەمان ئایدی هەبێت، داتاکە نوێ دەکرێتەوە.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#f0ad4e',
        cancelButtonColor: '#d33',
        confirmButtonText: 'بەڵێ، دەستپێبکە',
        cancelButtonText: 'پاشگەزبوونەوە'
    });

    if (!result.isConfirmed) {
        input.value = ''; 
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            console.log("Reading file...");
            const data = JSON.parse(e.target.result);
            await restoreProcess(data);
        } catch (error) {
            console.error("File Parse Error:", error);
            Swal.fire('هەڵە', 'فایلەکە تێکچووە یان جۆرەکەی هەڵەیە', 'error');
        } finally {
            // پاککردنەوەی ئینپوتەکە بۆ ئەوەی ئەگەر هەمان فایل هەڵبژێرێتەوە کار بکات
            input.value = '';
        }
    };
    reader.readAsText(file);
}

async function restoreProcess(data) {
    const btn = document.getElementById('btnRestore');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> چاوەڕوانبە...';

    // *** Batch Setup ***
    const BATCH_SIZE = 450;
    let batches = [];
    let currentBatch = db.batch();
    let operationCount = 0;

    // فەنکشنێک بۆ زیادکردنی داتا بۆ Batch
    function addToBatch(ref, docData) {
        currentBatch.set(ref, docData, { merge: true });
        operationCount++;

        if (operationCount >= BATCH_SIZE) {
            batches.push(currentBatch);
            currentBatch = db.batch();
            operationCount = 0;
        }
    }

    try {
        console.log("Starting restore logic...");

        // 1. گێڕانەوەی کۆلێکشنە ستانداردەکان بە شێوەی داینامیکی
        for (const collectionName of standardCollections) {
            if (data[collectionName]) {
                for (const [id, docData] of Object.entries(data[collectionName])) {
                    const docRef = db.collection(collectionName).doc(id);
                    addToBatch(docRef, docData);
                }
            }
        }

        // 2. گێڕانەوەی Forms & Submissions
        if (data.forms) {
            for (const [formId, formData] of Object.entries(data.forms)) {
                
                // ئا. گێڕانەوەی زانیاری فۆڕمەکە
                if (formData.details) {
                    const formRef = db.collection("forms").doc(formId);
                    addToBatch(formRef, formData.details);
                }

                // ب. گێڕانەوەی وەڵامەکان (Submissions)
                if (formData.submissions) {
                    for (const [subId, subData] of Object.entries(formData.submissions)) {
                        const subRef = db.collection("forms").doc(formId).collection("submissions").doc(subId);
                        addToBatch(subRef, subData);
                    }
                }
            }
        }

        // زیادکردنی بەشی کۆتایی (ئەگەر مابێتەوە)
        if (operationCount > 0) {
            batches.push(currentBatch);
        }

        console.log(`Total batches to commit: ${batches.length}`);

        // جێبەجێکردنی هەموو Batchـەکان
        for (let i = 0; i < batches.length; i++) {
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> خەریکە... (${i + 1}/${batches.length})`;
            await batches[i].commit();
            console.log(`Batch ${i + 1} committed.`);
        }

        Swal.fire({
            icon: 'success',
            title: 'تەواو!',
            text: 'داتاکان بە سەرکەوتوویی گەڕێندرانەوە.',
            timer: 2000,
            showConfirmButton: false
        }).then(() => {
            location.reload();
        });

    } catch (error) {
        console.error("Restore Execution Error:", error);
        Swal.fire('هەڵە', 'کێشە لە گێڕانەوەی داتا: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}