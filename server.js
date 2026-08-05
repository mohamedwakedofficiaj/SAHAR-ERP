const { verifyToken } = require('./jwt');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'مطلوب تسجيل الدخول (لا يوجد Token).' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { userId, tenantId, roleName, permissions }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية، من فضلك سجّل الدخول مرة أخرى.' });
  }
}

module.exports = { requireAuth };
