/* js/print-manager.js - Low Margins & Full Page Usage */

const PRINT_STYLES = `
    <style>
        /* پێناسەکردنی فۆنتی NRT */
        @font-face {
            font-family: 'NRT';
            src: url('NRT-Reg.ttf') format('truetype');
            font-weight: normal;
            font-style: normal;
        }

        /* سفرکردنی پەراوێزی چاپکەر */
        @page {
            size: A4;
            margin: 0mm; 
        }

        .print-container, .print-container * {
            color: #1e293b !important;
            background-color: #ffffff !important;
            border-color: #e2e8f0 !important;
        }

        body {
            font-family: 'NRT', 'Vazirmatn', sans-serif !important;
            direction: rtl;
            background: #fff;
            margin: 0;
            padding: 0;
        }

        .print-container {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            /* لێرە مەسافەکەم کەمکردەوە بۆ 15 پیکسڵ */
            padding: 25px 30px; 
            position: relative;
            box-sizing: border-box;
            background: white;
        }

        /* --- Header Design --- */
        .print-header {
            display: flex;
            justify-content: center;
            align-items: center;
            padding-bottom: 10px; /* کەمکرایەوە */
            margin-bottom: 20px; /* کەمکرایەوە */
            border-bottom: 3px solid #03b6f7 !important;
        }

        .logo-section img { 
            height: 140px; 
            width: auto; 
            object-fit: contain;
        }

        /* --- Data Grid --- */
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 30px; /* مەسافەی نێوان ستوونەکان کەمکرایەوە */
            row-gap: 15px;    /* مەسافەی نێوان دێڕەکان کەمکرایەوە */
            margin-bottom: 30px;
            margin-top: 10px;
        }

        .info-item {
            border-bottom: 1px solid #f1f5f9 !important;
            padding-bottom: 5px; /* کەمکرایەوە */
            page-break-inside: avoid;
        }

        .info-item.full-width { 
            grid-column: span 2; 
            margin-top: 5px;
            background-color: #f8fafc !important;
            padding: 10px;
            border-radius: 8px;
            border: 1px solid #e2e8f0 !important;
        }

        .label {
            display: block;
            font-size: 13px;
            color: #64748b !important;
            margin-bottom: 4px;
            font-weight: bold;
        }

        .value {
            display: block;
            font-size: 15px;
            color: #0f172a !important;
            font-weight: normal;
            line-height: 1.4;
        }

        /* Images */
        .img-box { margin-top: 5px; }
        .img-box img {
            max-width: 100%;
            height: auto;
            max-height: 200px;
            border-radius: 6px;
            border: 1px solid #e2e8f0 !important;
        }

        /* --- Footer --- */
        .footer {
            margin-top: 40px;
            display: flex;
            justify-content: flex-end;
            align-items: flex-end;
            page-break-inside: avoid;
            padding-bottom: 20px;
        }

        .signature-area {
            width: 200px;
            text-align: center;
        }
        .signature-line {
            border-bottom: 2px solid #cbd5e1 !important;
            height: 40px;
            margin-bottom: 8px;
            width: 100%;
        }
        .signature-text {
            font-size: 14px;
            color: #64748b !important;
            font-weight: bold;
        }

        @media print {
            body { -webkit-print-color-adjust: exact; }
            @page { margin: 0; } /* زۆر گرنگە بۆ لابردنی مەسافەی زیادە */
        }
    </style>
`;

async function printData(action) {
    const modalBody = document.getElementById('modalContent');
    if (!modalBody) return;

    // 1. Auto-Toggle Dark Mode
    const isDarkMode = document.body.classList.contains('dark-mode');
    if (isDarkMode) {
        document.body.classList.remove('dark-mode');
    }
    await new Promise(r => setTimeout(r, 100));

    // 2. Prepare Data
    let gridHTML = '';
    const rows = modalBody.querySelectorAll('.print-row');

    if (rows.length === 0) {
        alert("هیچ داتایەک نییە!");
        if (isDarkMode) document.body.classList.add('dark-mode');
        return;
    }

    rows.forEach(row => {
        const labelEl = row.querySelector('.print-label');
        const valueEl = row.querySelector('.print-value');

        if (labelEl && valueEl) {
            const label = labelEl.innerText.replace(':', '').trim();
            const imgEl = valueEl.querySelector('img');
            let content = '';

            if (imgEl) {
                content = `<div class="img-box"><img src="${imgEl.src}" crossorigin="anonymous"></div>`;
            } else {
                content = valueEl.innerText.trim();
            }

            const isFull = (content.length > 60) || imgEl || content.includes('\n');
            
            gridHTML += `
                <div class="info-item ${isFull ? 'full-width' : ''}">
                    <span class="label">${label}</span>
                    <span class="value">${content}</span>
                </div>
            `;
        }
    });

    const fullHTML = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>فۆڕمی زانیاری</title>
            ${PRINT_STYLES}
            <style>
                /* چارەسەری کێشەی دۆخی تاریک لە PDF دا */
                body, .print-container { background-color: #ffffff !important; color: #000000 !important; }
            </style>
        </head>
        <body style="background-color: #ffffff;">
            <div class="print-container" style="background-color: #ffffff;">
                <div class="print-header">
                    <div class="logo-section">
                        <img src="logo.png" alt="Logo" onerror="this.src='logo.jpg'"> 
                    </div>
                </div>

                <div class="info-grid">
                    ${gridHTML}
                </div>

                <div class="footer">
                    <div class="signature-area">
                        <div class="signature-line"></div>
                        <span class="signature-text">واژۆی سەرۆکی رێکخراو</span>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    // ===========================================
    // PRINT
    // ===========================================
    if (action === 'print') {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.width = '0px';
        iframe.style.height = '0px';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(fullHTML);
        doc.close();

        // چارەسەری کێشەی Allow کردن بە بەکارهێنانی onload
        iframe.onload = function() {
            setTimeout(() => {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
                setTimeout(() => { 
                    document.body.removeChild(iframe);
                    if (isDarkMode) document.body.classList.add('dark-mode');
                }, 1000);
            }, 500);
        };
    } 
    // ===========================================
    // PDF
    // ===========================================
    else if (action === 'pdf') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = fullHTML;
        const elementToPrint = tempDiv.querySelector('.print-container');
        
        document.body.appendChild(tempDiv);
        
        // چارەسەری کێشەی نەخوێندنەوەی html2pdf
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '0';
        tempDiv.style.top = '0';
        tempDiv.style.width = '210mm'; 
        tempDiv.style.zIndex = '-1000'; // لە پشتەوەی شاشەکە دەبێت نەک -9999 بۆ ئەوەی بزانێت بیخوێنێتەوە

        const opt = {
            margin: 5, 
            filename: `Form.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
                scale: 2, 
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff' // ئەمە چارەسەری پەڕە سپییەکەیە!
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const btn = document.querySelector('.btn-outline-danger');
        const originalBtnClass = btn.className;
        const originalBtnHtml = btn.innerHTML;
        
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
        btn.disabled = true;

        setTimeout(() => {
            html2pdf().set(opt).from(elementToPrint).save().then(() => {
                document.body.removeChild(tempDiv);
                
                btn.innerHTML = originalBtnHtml;
                btn.className = originalBtnClass;
                btn.disabled = false;

                if (isDarkMode) document.body.classList.add('dark-mode');

            }).catch(err => {
                console.error(err);
                alert("هەڵە لە دروستکردنی PDF");
                document.body.removeChild(tempDiv);
                btn.disabled = false;
                btn.innerHTML = originalBtnHtml;
                if (isDarkMode) document.body.classList.add('dark-mode');
            });
        }, 500);
    }
}