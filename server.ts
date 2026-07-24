import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

// Allow large payloads for base64 audio files
app.use(express.json({ limit: "50mb" }));

// Initialize Gemini client on the server side
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
};

/**
 * Utility function to handle API calls with retries for rate limits (429 errors).
 */
const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 5, initialDelay = 3000): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = JSON.stringify(error).toLowerCase();
      const errorMessage = (error?.message || "").toLowerCase();
      
      const isRateLimit = 
        errorMessage.includes("429") || 
        errorMessage.includes("quota") || 
        errorMessage.includes("resource_exhausted") ||
        errorStr.includes("429") ||
        errorStr.includes("resource_exhausted");
      
      if (isRateLimit && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Rate limit reached. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// Health Check Endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Transcribe Audio Endpoint
app.post("/api/transcribe", async (req, res) => {
  try {
    const { base64Audio, mimeType } = req.body;
    if (!base64Audio || !mimeType) {
      return res.status(400).json({ error: "Parâmetros 'base64Audio' e 'mimeType' são obrigatórios." });
    }

    const ai = getGeminiClient();
    const prompt = "Transcreva este áudio na íntegra, palavra por palavra. Não remova, não resuma, não adicione comentários e não corrija erros de fala. O resultado deve ser exatamente o que foi dito (ipsis litteris).";

    const textResult = await withRetry(async () => {
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

      return response.text || "";
    });

    res.json({ text: textResult });
  } catch (error: any) {
    console.error("Erro na transcrição:", error);
    res.status(500).json({ error: error?.message || "Erro ao processar transcrição de áudio." });
  }
});

// Translate Endpoint
app.post("/api/translate", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Parâmetro 'text' é obrigatório." });
    }

    const ai = getGeminiClient();

    const translatedText = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: `Traduza para o português de forma literal: ${text}`,
        config: {
          systemInstruction: "Você é um tradutor literal. Retorne apenas a tradução pura, sem notas.",
          temperature: 0,
        }
      });
      return response.text || "";
    });

    res.json({ text: translatedText });
  } catch (error: any) {
    console.error("Erro na tradução:", error);
    res.status(500).json({ error: error?.message || "Erro ao traduzir texto." });
  }
});

// Summarize Endpoint
app.post("/api/summarize", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Parâmetro 'text' é obrigatório." });
    }

    const ai = getGeminiClient();

    const summaryText = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: `Crie um resumo executivo bem estruturado, claro e objetivo do seguinte texto transcrito. Destaque os pontos principais usando marcadores (bullet points):\n\n${text}`,
        config: {
          systemInstruction: "Você é um assistente de síntese e resumo executivo de reuniões e áudios. Responda em Português formatado em Markdown limpo.",
          temperature: 0.2,
        }
      });
      return response.text || "";
    });

    res.json({ text: summaryText });
  } catch (error: any) {
    console.error("Erro no resumo:", error);
    res.status(500).json({ error: error?.message || "Erro ao gerar resumo." });
  }
});

// Action Items Endpoint
app.post("/api/action-items", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Parâmetro 'text' é obrigatório." });
    }

    const ai = getGeminiClient();

    const actionItemsText = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: `Analise a transcrição de áudio abaixo e extraia:\n1. Lista de Tarefas / Ações Pendentes (Action Items)\n2. Principais Decisões Tomadas\n3. Participantes/Tópicos Relevantes (se houver)\n\nTranscrição:\n${text}`,
        config: {
          systemInstruction: "Você é um especialista em análise de produtividade de reuniões. Extraia apenas as tarefas e decisões em tópicos claros em Markdown.",
          temperature: 0.2,
        }
      });
      return response.text || "";
    });

    res.json({ text: actionItemsText });
  } catch (error: any) {
    console.error("Erro nos itens de ação:", error);
    res.status(500).json({ error: error?.message || "Erro ao extrair itens de ação." });
  }
});

// Setup Vite or Static File Serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
