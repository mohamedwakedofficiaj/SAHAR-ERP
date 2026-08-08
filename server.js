const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// 1. أولاً: تفعيل مجلد public ليعرض الواجهة وصفحة تسجيل الدخول على الرابط الأساسي
app.use(express.static(path.join(__dirname, 'public')));

// 2. ثانياً: ربط راوتر المصروفات تحت مسار الـ API الصحيح وليس على الجذر
const expensesRouter = require('./routes/expenses'); // تأكد من مسار الملف الصحيح لديك
app.use('/api/expenses', expensesRouter);

// مسار تسجيل الدخول
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'mohamedwakedofficial@gmail.com' && password === 'ChangeMe123!') {
        res.json({ token: 'sample-token-123' });
    } else {
        res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحة' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
