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
      contents: `Analise a transcrição de áudio abaixo e extraia:\n1. Lista de Tarefas / Ações Pendentes (Action Items)\n2. Principais Decisões Tomadas\n3. Participantes/Tópicos Relevantes (se houver)\n\nTranscrição:\n${text}`,
      config: {
        systemInstruction: "Você é um especialista em análise de produtividade de reuniões. Extraia apenas as tarefas e decisões em tópicos claros em Markdown.",
        temperature: 0.2,
      }
    });

    return res.status(200).json({ text: response.text || "" });
  } catch (error: any) {
    console.error("Erro nos itens de ação:", error);
    return res.status(500).json({ error: error?.message || "Erro ao extrair itens de ação." });
  }
}
