exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { username, password } = JSON.parse(event.body);

    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'qum2025';

    if (username === ADMIN_USER && password === ADMIN_PASS) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, token: 'qum-admin-' + Date.now() })
      };
    }

    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: 'بيانات خاطئة' })
    };
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: 'خطأ في الطلب' })
    };
  }
};