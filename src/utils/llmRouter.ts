export const getBestLLMResponse = async (prompt: string): Promise<string> => {
  try {
    return await callOpenAI(prompt);
  } catch {
    try {
      return await callMistral(prompt);
    } catch {
      try {
        return await callClaude(prompt);
      } catch {
        return await callGemini(prompt);
      }
    }
  }
};

const callOpenAI = async (prompt: string) => {
  throw new Error('OpenAI limit hit');
};

const callMistral = async (prompt: string) => {
  throw new Error('Mistral limit hit');
};

const callClaude = async (prompt: string) => {
  throw new Error('Claude limit hit');
};

const callGemini = async (prompt: string) => {
  return 'Gemini response';
};
