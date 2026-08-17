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
// Incluye un límite diario global (protección de gasto) usando CountAPI,
// un contador público gratuito que no requiere cuenta ni configuración.
export const config = {
  maxDuration: 60,
};

const DAILY_LIMIT = 15; // máximo de generaciones 3D permitidas al día (ajustable)

function todayKey() {
  const d = new Date();
  return `assetscout-gen-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { fileToken, fileType, files } = req.body;

    // Modo multivista: llega un array "files" con 2-4 fotos ya subidas
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

    const key = todayKey();
    let count = 0;
    try {
      const counterRes = await fetch(`https://api.countapi.xyz/hit/assetscout-limits/${key}`);
      const counterData = await counterRes.json();
      count = counterData.value || 0;
    } catch (counterErr) {
      console.error('No se pudo consultar el contador, se permite la petición por seguridad', counterErr);
    }

    if (count > DAILY_LIMIT) {
      return res.status(429).json({
        error: `Límite diario de generaciones 3D alcanzado (${DAILY_LIMIT}/día). Vuelve a intentarlo mañana.`,
      });
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
