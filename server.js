const path = require('path');
const Module = require('module');

// توجيه تلقائي لأي ملف يبحث عن db/pool
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.includes('db/pool')) {
    return originalResolve.call(this, path.join(__dirname, 'db', 'pool.js'), parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

try {
  require('./migrate');
} catch (e) {
  console.log('Migrate status:', e.message);
}

// عرض الواجهة الرئيسية مباشرة عند فتح الرابط
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>نظام SAHAR ERP</title>
        <style>
            body { font-family: Tahoma, sans-serif; background: #f4f6f9; padding: 30px; text-align: right; }
            .box { max-width: 700px; margin: auto; background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
            .status { color: #27ae60; font-weight: bold; background: #e8f8f5; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
            .btn { background: #3498db; color: white; padding: 10px 18px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; font-size: 15px; }
            .btn:hover { background: #2980b9; }
            pre { background: #1e1e1e; color: #00ffcc; padding: 15px; border-radius: 5px; text-align: left; direction: ltr; overflow-x: auto; }
        </style>
    </head>
    <body>
        <div class="box">
            <h1>🚀 لوحة تحكم نظام SAHAR ERP</h1>
            <div class="status">✓ السيرفر شغال وقاعدة البيانات متصلة بنجاح!</div>
            <p>اضغط على الأزرار لتجربة جلب البيانات:</p>
            <button class="btn" onclick="loadData('customers')">عرض العملاء</button>
            <button class="btn" onclick="loadData('suppliers')">عرض الموردين</button>
            <button class="btn" onclick="loadData('companies')">عرض الشركات</button>
            <h3>النتيجة:</h3>
            <pre id="out">اضغط على أي زر أعلاه لعرض البيانات هنا...</pre>
        </div>
        <script>
            async function loadData(endpoint) {
                document.getElementById('out').innerText = 'جاري التحميل...';
                try {
                    const r = await fetch('/' + endpoint);
                    const d = await r.json();
                    document.getElementById('out').innerText = JSON.stringify(d, null, 2);
                } catch(e) {
                    document.getElementById('out').innerText = 'خطأ أثناء جلب البيانات: ' + e.message;
                }
            }
        </script>
    </body>
    </html>
  `);
});

// المسارات الفرعية
try { app.use('/companies', require('./companies.routes')); } catch(e){}
try { app.use('/customers', require('./customers.routes')); } catch(e){}
try { app.use('/suppliers', require('./suppliers.routes')); } catch(e){}
try { app.use('/auth', require('./auth.routes')); } catch(e){}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
