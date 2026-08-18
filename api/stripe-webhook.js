// api/stripe-webhook.js
// Stripe llama a esta URL automáticamente cuando pasa algo relevante: un
// pago se completa, una suscripción se renueva, se cancela, etc. Aquí
// actualizamos la tabla "subscriptions" en consecuencia.
//
// IMPORTANTE: esta ruta necesita el CUERPO SIN PROCESAR (raw) de la
// petición para poder verificar que la llamada viene de verdad de Stripe
// (y no de cualquiera que se invente una petición). Por eso se desactiva
// el bodyParser de Vercel para esta función en concreto.
import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Verificación manual de la firma de Stripe (sin librería extra),
// siguiendo su algoritmo documentado: HMAC-SHA256 del timestamp + cuerpo.
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const computedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

async function upsertSubscription(SUPABASE_URL, SERVICE_KEY, row) {
  await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret || !verifyStripeSignature(rawBody, signature, webhookSecret)) {
      return res.status(400).json({ error: 'Firma de Stripe no válida' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (userId) {
        await upsertSubscription(SUPABASE_URL, SERVICE_KEY, {
          user_id: userId,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          status: 'active',
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const sub = event.data.object;
      const userId = sub.metadata?.supabase_user_id;
      const plan = sub.metadata?.plan;
      if (userId) {
        await upsertSubscription(SUPABASE_URL, SERVICE_KEY, {
          user_id: userId,
          plan: plan || 'pro',
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub.metadata?.supabase_user_id;
      if (userId) {
        await upsertSubscription(SUPABASE_URL, SERVICE_KEY, {
          user_id: userId,
          plan: 'free',
          status: 'canceled',
          updated_at: new Date().toISOString(),
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
