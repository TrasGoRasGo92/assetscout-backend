// api/generate.js
// Recibe un fileToken (del paso anterior, upload.js) y crea la tarea
// de generación 3D en Tripo3D. Devuelve un taskId para hacer seguimiento.

export const config = {
  maxDuration: 60,
};

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
    const { fileToken, fileType } = req.body;
    if (!fileToken) {
      return res.status(400).json({ error: 'Falta fileToken' });
    }

    const apiKey = process.env.TRIPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'TRIPO_API_KEY no configurada en Vercel' });
    }

    const taskRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        type: 'image_to_model',
        file: {
          type: fileType || 'jpg',
          file_token: fileToken,
        },
        texture: true,
        pbr: true,
        generate_parts: true,
      }),
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
