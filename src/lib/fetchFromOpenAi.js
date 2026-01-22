const apiKey = process.env.NEXT_PUBLIC_OPEN_API_KEY;

export async function fetchFromOpenAi(body, timeout = 60000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return await response.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error(e);
    throw e;
  }
}

export async function fetchFromOpenAiImage(body, timeout = 60000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return await response.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    console.error(e);
    throw e;
  }
}

