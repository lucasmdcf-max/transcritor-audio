import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const getApiKey = () => {
  return process.env.GEMINI_API_KEY || process.env.API_KEY || "AIzaSyB1DwzdY7-KrTWRlgM0HPKicweKunEezmw";
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { base64Audio, mimeType } = req.body;
    if (!base64Audio || !mimeType) {
      return res.status(400).json({ error: "Parâmetros 'base64Audio' e 'mimeType' são obrigatórios." });
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

    const prompt = "Transcreva este áudio na íntegra, palavra por palavra. Não remova, não resuma, não adicione comentários e não corrija erros de fala. O resultado deve ser exatamente o que foi dito (ipsis litteris).";

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: prompt
          }
        ]
      },
      config: {
        systemInstruction: "Você é um transcritor literal de alta velocidade. Sua única tarefa é converter fala em texto sem qualquer alteração, omissão ou adição de metadados.",
        temperature: 0,
      }
    });

    return res.status(200).json({ text: response.text || "" });
  } catch (error: any) {
    console.error("Erro na transcrição:", error);
    return res.status(500).json({ error: error?.message || "Erro ao processar transcrição de áudio." });
  }
}
