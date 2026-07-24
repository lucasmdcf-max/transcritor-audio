
/**
 * Transcribes audio by sending requests to the server API route.
 */
export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ base64Audio, mimeType }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erro na requisição: ${response.statusText}`);
  }

  const data = await response.json();
  return data.text || "";
};

/**
 * Translates text to Portuguese by sending requests to the server API route.
 */
export const translateToPortuguese = async (text: string): Promise<string> => {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erro na requisição: ${response.statusText}`);
  }

  const data = await response.json();
  return data.text || "";
};

/**
 * Generates an executive summary of the transcription.
 */
export const summarizeText = async (text: string): Promise<string> => {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erro na requisição: ${response.statusText}`);
  }

  const data = await response.json();
  return data.text || "";
};

/**
 * Extracts action items and tasks from the transcription.
 */
export const extractActionItems = async (text: string): Promise<string> => {
  const response = await fetch('/api/action-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erro na requisição: ${response.statusText}`);
  }

  const data = await response.json();
  return data.text || "";
};


