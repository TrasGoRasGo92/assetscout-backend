// api/create-checkout.js
// Crea una "sesión de pago" (Checkout Session) de Stripe para que el usuario
// se suscriba al plan Pro o Estudio. Devuelve una URL de Stripe a la que
// el frontend redirige al usuario para que pague.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const authHeader = req.headers.authorization || '';
    const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!userToken) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const { plan } = req.body || {};
    if (plan !== 'pro' && plan !== 'estudio') {
      return res.status(400).json({ error: 'Plan no válido (usa "pro" o "estudio")' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ESTUDIO;

    if (!STRIPE_SECRET_KEY || !priceId) {
      return res.status(500).json({ error: 'Stripe no está configurado del todo en el servidor' });
    }

    // Verificar quién es el usuario
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesión no válida' });
    const userData = await userRes.json();

    // Crear la sesión de pago en Stripe (llamada directa a su API REST,
    // sin librería extra que instalar)
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', 'https://vrvision.es/?pago=exito');
    params.append('cancel_url', 'https://vrvision.es/?pago=cancelado');
    params.append('client_reference_id', userData.id);
    params.append('customer_email', userData.email);
    // Guardamos el user_id también en los metadatos de la suscripción,
    // para poder identificarlo luego en el webhook con total seguridad
    params.append('subscription_data[metadata][supabase_user_id]', userData.id);
    params.append('subscription_data[metadata][plan]', plan);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok) {
      return res.status(502).json({ error: 'Error creando el pago en Stripe', detail: stripeData });
    }

    return res.status(200).json({ url: stripeData.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
