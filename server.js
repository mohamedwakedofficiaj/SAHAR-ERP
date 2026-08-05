const express = require('express');
const cors = require('cors');
const path = require('path');
const { bootstrap, authRoutes, companiesRoutes, customersRoutes, suppliersRoutes } = require('./migrate');

const app = express();

app.use(cors());
app.use(express.json());

// تشغيل الشاشات والواجهة من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

// المسارات الخاصة بالبيانات
if (authRoutes) app.use('/auth', authRoutes);
if (companiesRoutes) app.use('/companies', companiesRoutes);
if (customersRoutes) app.use('/customers', customersRoutes);
if (suppliersRoutes) app.use('/suppliers', suppliersRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
