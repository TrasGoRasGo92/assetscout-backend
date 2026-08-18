// api/generate.js
// Recibe un fileToken (del paso anterior, upload.js) y crea la tarea
// de generación 3D en Tripo3D. Devuelve un taskId para hacer seguimiento.
//
// Soporta dos modos:
//  - Una sola foto: { fileToken, fileType } → genera con "image_to_model" (como antes)
//  - Varias fotos (2-4): { files: [{fileToken, fileType}, ...] } → genera con
//    "multiview_to_model", que da mejor geometría/detalle al combinar ángulos
//    (orden esperado por Tripo3D: [frontal, lateral, trasera, otro lateral])
//
// Control de gasto: exige que el usuario haya iniciado sesión (Supabase) y
// comprueba/descuenta su límite diario de generaciones en la base de datos,
// en vez de un límite global compartido por todo el sitio.
export const config = {
  maxDuration: 60,
};

const DAILY_LIMIT = 15; // máximo de generaciones 3D permitidas al día, POR USUARIO

async function checkUsage(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, status: 401, error: 'Debes iniciar sesión para generar un modelo 3D.' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'Supabase no configurado en el servidor (SUPABASE_URL / SUPABASE_ANON_KEY)' };
  }

  // Llama a la función increment_usage en Supabase: comprueba e incrementa a la vez,
  // usando la sesión del propio usuario (auth.uid() dentro de la función SQL).
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_usage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ p_column: 'generations', p_limit: DAILY_LIMIT }),
  });

  if (!rpcRes.ok) {
    const errData = await rpcRes.json().catch(() => ({}));
    const msg = errData.message || errData.error_description || '';
    if (msg.includes('DAILY_LIMIT_EXCEEDED')) {
      return { ok: false, status: 429, error: `Límite diario de generaciones 3D alcanzado (${DAILY_LIMIT}/día). Vuelve a intentarlo mañana.` };
    }
    return { ok: false, status: 401, error: 'Sesión no válida. Vuelve a iniciar sesión.' };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { fileToken, fileType, files } = req.body;

    const isMultiview = Array.isArray(files) && files.length > 1;

    if (!isMultiview && !fileToken) {
      return res.status(400).json({ error: 'Falta fileToken (o un array "files" con varias fotos)' });
    }
    if (isMultiview && files.length > 4) {
      return res.status(400).json({ error: 'Como máximo se admiten 4 fotos por modelo' });
    }

    const apiKey = process.env.TRIPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'TRIPO_API_KEY no configurada en Vercel' });
    }

    // Control de gasto por usuario (requiere sesión iniciada)
    const usage = await checkUsage(req);
    if (!usage.ok) {
      return res.status(usage.status).json({ error: usage.error });
    }

    let body;
    if (isMultiview) {
      // Tripo3D exige EXACTAMENTE 4 posiciones en el array, en el orden
      // [frontal, lateral, trasera, otro lateral]. La frontal es obligatoria;
      // las que falten se rellenan con un objeto vacío {}.
      const slots = [null, null, null, null];
      files.slice(0, 4).forEach((f, i) => { slots[i] = f; });

      body = {
        type: 'multiview_to_model',
        files: slots.map((f) =>
          f ? { type: f.fileType || 'jpg', file_token: f.fileToken } : {}
        ),
        texture: true,
        pbr: true,
      };
    } else {
      body = {
        type: 'image_to_model',
        file: {
          type: fileType || 'jpg',
          file_token: fileToken,
        },
        texture: true,
        pbr: true,
      };
    }

    const taskRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const taskData = await taskRes.json();
    if (!taskRes.ok || taskData.code !== 0) {
      return res.status(502).json({ error: 'Error creando la tarea en Tripo3D', detail: taskData });
    }

    return res.status(200).json({ taskId: taskData.data.task_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
