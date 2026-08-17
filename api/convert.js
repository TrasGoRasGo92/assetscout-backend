// api/convert.js
// Convierte un modelo ya generado (por su taskId original) a otro formato
// de archivo: GLTF, FBX, USDZ, OBJ o STL. También permite pedir "quad"
// (malla limpia en cuadriláteros en vez de triángulos).

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
    const { originalTaskId, format, quad } = req.body;
    if (!originalTaskId || !format) {
      return res.status(400).json({ error: 'Falta originalTaskId o format' });
    }

    const apiKey = process.env.TRIPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'TRIPO_API_KEY no configurada en Vercel' });
    }

    const body = {
      type: 'convert_model',
      original_model_task_id: originalTaskId,
      format: format, // 'GLTF' | 'FBX' | 'USDZ' | 'OBJ' | 'STL'
    };
    if (quad) {
      body.quad = true; // fuerza salida FBX según la doc de Tripo
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
      return res.status(502).json({ error: 'Error creando la conversión en Tripo3D', detail: taskData });
    }

    return res.status(200).json({ taskId: taskData.data.task_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
