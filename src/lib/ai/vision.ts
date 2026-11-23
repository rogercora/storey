/**
 * Provider adapters for multimodal structured output.
 * Plain fetch (no SDKs). Server-side only: API keys never reach the browser.
 */
export interface VisionImage {
  mimeType: string;
  base64: string;
}

export interface VisionRequest {
  system: string;
  user: string;
  images: VisionImage[];
  jsonSchema: object;
}

export interface VisionResponse {
  json: unknown;
  provider: "gemini" | "openai";
  model: string;
  latencyMs: number;
}

export class VisionError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "VisionError";
  }
}

const TIMEOUT_MS = 55_000;
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
];

export async function runVision(req: VisionRequest): Promise<VisionResponse> {
  const provider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const started = Date.now();

  if (provider === "openai") {
    const model = process.env.OPENAI_MODEL ?? "gpt-4.1";
    const json = await callOpenAI(req, model);
    return { json, provider: "openai", model, latencyMs: Date.now() - started };
  }
  if (provider === "gemini") {
    const preferred = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
    const { json, model } = await callGeminiWithFallback(req, preferred);
    return { json, provider: "gemini", model, latencyMs: Date.now() - started };
  }
  throw new VisionError(`Unsupported AI_PROVIDER "${provider}"`, 500);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Log the provider detail server-side only; keep the client message generic.
      console.error("[vision] provider error", res.status, text.slice(0, 500));
      throw new VisionError(
        res.status === 429 ? "AI service is busy, please retry shortly." : "AI analysis failed.",
        502,
        res.status,
      );
    }
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof VisionError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new VisionError("AI analysis timed out.", 504);
    console.error("[vision] request failed", e);
    throw new VisionError("AI analysis failed.", 502);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ OpenAI ---
async function callOpenAI(req: VisionRequest, model: string): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new VisionError("OPENAI_API_KEY is not configured.", 500);

  const data = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${key}` },
    {
      model,
      temperature: 0,
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            { type: "text", text: req.user },
            ...req.images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" },
            })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "shelf_analysis", strict: true, schema: req.jsonSchema },
      },
    },
  );

  const msg = data?.choices?.[0]?.message;
  if (msg?.refusal) throw new VisionError("AI declined to analyse this image.", 422);
  return parseModelJson(msg?.content);
}

// ------------------------------------------------------------------ Gemini ---
async function callGeminiWithFallback(
  req: VisionRequest,
  preferredModel: string,
): Promise<{ json: unknown; model: string }> {
  const candidates = Array.from(new Set([preferredModel, ...GEMINI_FALLBACK_MODELS]));
  let lastError: unknown;

  for (const model of candidates) {
    try {
      const json = await callGemini(req, model);
      return { json, model };
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof VisionError &&
        (err.upstreamStatus === 404 || err.upstreamStatus === 503 || err.upstreamStatus === 429);
      if (!retryable) throw err;
      console.warn(`[vision] model ${model} unavailable (${err.upstreamStatus}), trying next fallback`);
    }
  }

  throw lastError instanceof Error ? lastError : new VisionError("AI analysis failed.", 502);
}

async function callGemini(req: VisionRequest, model: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new VisionError("GEMINI_API_KEY is not configured.", 500);

  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": key },
    {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: req.user },
            ...req.images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: req.jsonSchema,
      },
    },
  );

  const cand = data?.candidates?.[0];
  if (!cand || data?.promptFeedback?.blockReason) throw new VisionError("AI declined to analyse this image.", 422);
  const text = cand.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  return parseModelJson(text);
}

function parseModelJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim() === "") throw new VisionError("AI returned an empty response.", 502);
  try {
    return JSON.parse(raw);
  } catch {
    console.error("[vision] non-JSON model output", raw.slice(0, 300));
    throw new VisionError("AI returned an invalid response.", 502);
  }
}

