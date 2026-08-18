// api/save-model.js
// Se llama justo después de que un modelo termine de generarse. El enlace
// que da Tripo3D caduca a los 5 minutos, así que aquí:
//   1. Descargamos el modelo desde ese enlace temporal
//   2. Lo volvemos a subir a nuestro propio almacén (Supabase Storage),
//      donde el enlace ya no caduca nunca
//   3. Guardamos una fila en la tabla "generated_models" con ese enlace
//      permanente, para que aparezca en el historial — tanto en la web
//      como más adelante en los plugins de 3ds Max / Blender / etc.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb', // solo para la miniatura en base64, el modelo se descarga aparte
    },
  },
  maxDuration: 60,
};

async function getUserId(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return null;
  const userData = await userRes.json();
  return userData.id || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { modelUrl, nombre, tipo, estilo, thumbnailBase64 } = req.body;
    if (!modelUrl) return res.status(400).json({ error: 'Falta modelUrl' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: 'Supabase no configurado del todo en el servidor (falta SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const userId = await getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sesión no válida' });

    // 1. Descargar el modelo desde el enlace temporal de Tripo3D
    const modelRes = await fetch(modelUrl);
    if (!modelRes.ok) return res.status(502).json({ error: 'No se pudo descargar el modelo generado' });
    const modelBuffer = Buffer.from(await modelRes.arrayBuffer());

    // 2. Subirlo a nuestro almacén permanente (bucket "models")
    const timestamp = Date.now();
    const modelPath = `${userId}/${timestamp}.glb`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/models/${modelPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'model/gltf-binary',
      },
      body: modelBuffer,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return res.status(502).json({ error: 'No se pudo guardar el modelo en el almacén', detail: errText });
    }
    const permanentModelUrl = `${SUPABASE_URL}/storage/v1/object/public/models/${modelPath}`;

    // 3. Miniatura (opcional) — la manda el frontend ya recortada, como
    //    en el guardado local de "Mis modelos"
    let permanentThumbUrl = null;
    if (thumbnailBase64) {
      const thumbBuffer = Buffer.from(thumbnailBase64, 'base64');
      const thumbPath = `${userId}/${timestamp}_thumb.jpg`;
      const thumbUploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/models/${thumbPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: thumbBuffer,
      });
      if (thumbUploadRes.ok) {
        permanentThumbUrl = `${SUPABASE_URL}/storage/v1/object/public/models/${thumbPath}`;
      }
    }

    // 4. Guardar la fila en el historial
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/generated_models`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        nombre: nombre || 'Modelo 3D',
        tipo: tipo || null,
        estilo: estilo || null,
        model_url: permanentModelUrl,
        thumbnail_url: permanentThumbUrl,
      }),
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(502).json({ error: 'No se pudo guardar en el historial', detail: errText });
    }
    const inserted = await insertRes.json();

    return res.status(200).json({
      id: inserted[0]?.id,
      model_url: permanentModelUrl,
      thumbnail_url: permanentThumbUrl,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
