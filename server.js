const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// تفعيل مجلد الواجهة ليعمل السيستم بشكل متفاعل
app.use(express.static(path.join(__dirname, 'public')));

// مسار تسجيل الدخول
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'mohamedwakedofficial@gmail.com' && password === 'ChangeMe123!') {
        res.json({ token: 'sample-token-123', message: 'تم تسجيل الدخول بنجاح' });
    } else {
        res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحة' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running successfully on port ${PORT}`);
});
