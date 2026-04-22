// js/firebase-config.js

// ٢. زانیارییەکانی Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCMgwV15hUX0kruGcSZ48zTRCYCG1dUf_k",
  authDomain: "dynamic-form-builder-51249.firebaseapp.com",
  projectId: "dynamic-form-builder-51249",
  storageBucket: "dynamic-form-builder-51249.firebasestorage.app",
  messagingSenderId: "451980092153",
  appId: "1:451980092153:web:aaeb3f6819e4639a3bb828"
};

// پەیوەستبوون (Initialize)
// تێبینی: ئێمە کتێبخانەی compat بەکاردێنین لە html بۆیە بەم شێوەیە دەینوسین
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const storage = firebase.storage();
// چارەسەری کێشەی هێڵی کۆڕەک و بلۆکبوونی WebSockets
// چارەسەری کێشەی هێڵی کۆڕەک و بلۆکبوونی WebSockets
db.settings({
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  merge: true // ئەم دێڕە زیادکرا بۆ لابردنی ئێرۆرەکەی کۆنسۆڵ
});

// --- فەنکشنی تۆمارکردنی چاودێری (Audit Log) ---
window.logAuditAction = async function(actionType, collectionName, documentId, oldData = null, newData = null) {
    try {
        const user = firebase.auth().currentUser;
        if (!user) return;

        let ipAddress = "نەزانراو";
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            ipAddress = data.ip;
        } catch (ipError) {}

        // ١. دۆزینەوەی پەیکەری فۆڕمەکە لە هەر پەڕەیەک بین
        let availableFields = window.formFields || window.formFieldsCache || window.originalFormStructure || [];
        
        function findLabelById(fields, idToFind) {
            if (!fields || !Array.isArray(fields)) return idToFind;
            for (const field of fields) {
                if (field.id === idToFind) return field.label;
                if (field.ids && field.ids.includes(idToFind)) return field.label; // بۆ پەڕەی data.js
                if (field.branches) {
                    for (const opt in field.branches) {
                        const result = findLabelById(field.branches[opt], idToFind);
                        if (result !== idToFind) return result;
                    }
                }
                if (field.children) {
                    const result = findLabelById(field.children, idToFind);
                    if (result !== idToFind) return result;
                }
            }
            return idToFind;
        }

        // ٢. دۆزینەوەی ناوی کەسەکە (بە مەرجی توند: تەنها ئەگەر ناوی پرسیارەکە "ناوی سیانی" یان "ناو" بوو)
        let caseName = "";
        let targetData = newData || oldData;
        
        if (targetData && typeof targetData === 'object') {
            for (const key in targetData) {
                let labelName = findLabelById(availableFields, key);
                let strLabel = String(labelName).trim();
                
                // مەرجە توندەکە: دەبێت ناوی پرسیارەکە بە دیاریکراوی "ناوی سیانی" بێت، یان تێیدا بێت، یان تەنها "ناو" بێت
                if (strLabel === 'ناوی سیانی' || strLabel.includes('ناوی سیانی') || strLabel === 'ناو') {
                    let val = targetData[key];
                    if (val && typeof val === 'string' && val.trim().length > 0) {
                        caseName = val;
                        break;
                    }
                }
            }

            // پاککردنەوەی ناوەکە ئەگەر کۆمای تێدابوو (بۆ ئەوەی جوانتر دەربکەوێت)
            if (Array.isArray(caseName)) caseName = caseName.join('، ');
            if (typeof caseName === 'string') caseName = caseName.replace(/,/g, '، ');
        }

        // ٣. دەرهێنانی گۆڕانکارییەکان بە ناوە کوردییەکانەوە
        let changes = [];
        if (actionType === 'UPDATE' && oldData && newData) {
            const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
            
            allKeys.forEach(key => {
                let oldVal = oldData[key];
                let newVal = newData[key];

                function normalizeValue(v) {
                    if (v === undefined || v === null || v === '') return '';
                    if (Array.isArray(v)) return v.filter(item => item !== '' && item !== null).join(',').trim();
                    return String(v).trim();
                }

                let cleanOld = normalizeValue(oldVal);
                let cleanNew = normalizeValue(newVal);

                if (cleanOld !== cleanNew) {
                    let displayName = findLabelById(availableFields, key);
                    changes.push({
                        field: displayName,
                        old: cleanOld === '' ? 'بەتاڵە' : (Array.isArray(oldVal) ? oldVal.join('، ') : oldVal),
                        new: cleanNew === '' ? 'بەتاڵە' : (Array.isArray(newVal) ? newVal.join('، ') : newVal)
                    });
                }
            });

            if (changes.length === 0) return; 
        }

        const logEntry = {
            user: user.email.toLowerCase(),
            actionType: actionType,
            collection: collectionName,
            documentId: documentId,
            caseName: caseName ? String(caseName).substring(0, 100) : null, 
            ipAddress: ipAddress,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (changes.length > 0) logEntry.changes = changes;

        await db.collection("audit_logs").add(logEntry);

    } catch (error) {
        console.error("Error saving audit log: ", error);
    }
};