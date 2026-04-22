const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

// ناساندنی سێرڤەر
admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// ----------------------------------------------------
// فەنکشنی ١: دروستکردنی باکەپ بە دەستی (لە ڕێگەی دوگمەوە)
// ----------------------------------------------------
exports.createServerBackup = onCall(async (request) => {
    // دڵنیابوونەوە لەوەی کەسەکە چووەتە ژوورەوە
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "بۆ ئەم کارە دەبێت بچیتە ژوورەوە.");
    }
    
    try {
        await generateAndSaveBackup();
        return { success: true };
    } catch (error) {
        console.error("Manual Backup Error:", error);
        throw new HttpsError("internal", error.message);
    }
});

// ----------------------------------------------------
// فەنکشنی ٢: باکەپی ئۆتۆماتیکی (هەموو شەوێک کاتژمێر ١٢:٠٠)
// ----------------------------------------------------
exports.scheduledBackup = onSchedule({
    schedule: '0 0 * * *',
    timeZone: 'Asia/Baghdad' // کاتی کوردستان و عێراق
}, async (event) => {
    console.log('دەستپێکردنی باکەپی ئۆتۆماتیکی شەوانە...');
    await generateAndSaveBackup();
});

// ----------------------------------------------------
// فەنکشنی سەرەکی بۆ کۆکردنەوەی داتا و خەزنکردنی لە Storage
// ----------------------------------------------------
async function generateAndSaveBackup() {
    const collections = ["users", "aid_fields", "aid_categories", "aid_cases", "audit_logs"];
    
    let backupData = {
        version: "3.1",
        createdAt: new Date().toISOString(),
        type: "server_generated",
        forms: {}
    };

    // ١. هێنانی داتای کۆلێکشنە ئاساییەکان
    for (const col of collections) {
        backupData[col] = {};
        const snap = await db.collection(col).get();
        snap.forEach(doc => {
            backupData[col][doc.id] = doc.data();
        });
    }

    // ٢. هێنانی فۆڕمەکان و وەڵامەکانیان (Subcollections)
    const formsSnap = await db.collection("forms").get();
    for (const formDoc of formsSnap.docs) {
        backupData.forms[formDoc.id] = { details: formDoc.data(), submissions: {} };
        const subSnap = await formDoc.ref.collection("submissions").get();
        subSnap.forEach(subDoc => {
            backupData.forms[formDoc.id].submissions[subDoc.id] = subDoc.data();
        });
    }

    // ٣. ڕێکخستنی ناوی فایلەکە و خەزنکردنی لە Firebase Storage
    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().getTime();
    const fileName = `backups/backup_${dateStr}_${timeStr}.json`;

    const file = bucket.file(fileName);
    await file.save(JSON.stringify(backupData), {
        metadata: { contentType: "application/json" }
    });

    console.log(`Backup successfully saved to Storage: ${fileName}`);
}