// api/my-plan.js
// Devuelve el plan del usuario que hace la petición. Mira primero si tiene
// un "regalo manual" (plan_grants, por email) — eso SIEMPRE gana, para que
// puedas dar o quitar acceso gratis a quien quieras sin depender de Stripe.
// Si no hay regalo manual, mira su suscripción real de pago en Stripe.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const authHeader = req.headers.authorization || '';
    const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!userToken) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesión no válida' });
    const userData = await userRes.json();

    const plan = await resolvePlan(SUPABASE_URL, SERVICE_KEY, userData.id, userData.email);
    return res.status(200).json({ plan });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}

// ---------- Función interna: resuelve el plan real de un usuario ----------
// (misma lógica duplicada, a propósito, en generate.js y visual-search.js —
// así cada archivo se puede pegar en GitHub de forma independiente, sin
// depender de importar entre archivos)
async function resolvePlan(SUPABASE_URL, SERVICE_KEY, userId, email) {
  // 1. ¿Tiene un regalo manual por email? (siempre gana)
  if (email) {
    const grantRes = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_grants?email=eq.${encodeURIComponent(email.toLowerCase())}&select=plan`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
    );
    const grantRows = await grantRes.json();
    if (grantRes.ok && grantRows.length) return grantRows[0].plan;
  }

  // 2. ¿Tiene una suscripción de pago activa?
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan,status`,
    { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
  );
  const subRows = await subRes.json();
  if (subRes.ok && subRows.length && ['active', 'trialing'].includes(subRows[0].status)) {
    return subRows[0].plan;
  }

  // 3. Por defecto, gratis
  return 'free';
}
