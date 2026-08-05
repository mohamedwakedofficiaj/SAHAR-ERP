# استخدام نسخة Node خفيفة ومستقرة
FROM node:20-alpine

# تحديد مجلد العمل الداخلي
WORKDIR /app

# نسخ ملفات حزم المكتبات
COPY package*.json ./

# تثبيت المكتبات
RUN npm install

# نسخ كافة ملفات المشروع إلى المجلد الرئيسي
COPY . .

# فتح المنفذ الخاص بالتطبيق
EXPOSE 3000

# أمر التشغيل المباشر لملف server.js
CMD ["node", "server.js"]
