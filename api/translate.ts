import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const getApiKey = () => {
  return process.env.GEMINI_API_KEY || process.env.API_KEY || "AIzaSyB1DwzdY7-KrTWRlgM0HPKicweKunEezmw";
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Parâmetro 'text' é obrigatório." });
    }

    const apiKey = getApiKey();
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `Traduza para o português de forma literal: ${text}`,
      config: {
        systemInstruction: "Você é um tradutor literal. Retorne apenas a tradução pura, sem notas.",
        temperature: 0,
      }
    });

    return res.status(200).json({ text: response.text || "" });
  } catch (error: any) {
    console.error("Erro na tradução:", error);
    return res.status(500).json({ error: error?.message || "Erro ao traduzir texto." });
  }
}
