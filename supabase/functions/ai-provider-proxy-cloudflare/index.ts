
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function responseJson(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractOpenAIText(result: any) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) return result.output_text.trim();
  const parts: string[] = [];
  for (const item of result?.output || []) {
    for (const content of item?.content || []) {
      if ((content?.type === "output_text" || content?.type === "text") && content?.text) {
        parts.push(String(content.text));
      }
    }
  }
  return parts.join("\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return responseJson(405, { error: "Method not allowed" });

  const started = Date.now();

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return responseJson(401, { error: "Missing Memora session" });

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return responseJson(401, { error: "Invalid Memora session" });

    const body = await req.json();
    const requestedProvider = String(body.provider || "").toLowerCase();

    // Try service-role lookup first. A caller-scoped RLS lookup is a
    // safe recovery path if the service-client query fails or returns no rows.
    const { data: serviceRows, error: serviceError } = await admin
      .from("connections")
      .select("provider,status")
      .eq("user_id", userData.user.id)
      .eq("status", "connected");

    let connected = (serviceRows || []).map((row: any) => String(row.provider || "").toLowerCase());
    if (serviceError) console.warn("Memora provider lookup:", serviceError.code || "query_error");

    if (!connected.length) {
      const callerKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceKey;
      const caller = createClient(url, callerKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: callerRows, error: callerError } = await caller
        .from("connections")
        .select("provider,status")
        .eq("user_id", userData.user.id)
        .eq("status", "connected");
      if (callerError) console.warn("Memora scoped provider lookup:", callerError.code || "query_error");
      connected = (callerRows || []).map((row: any) => String(row.provider || "").toLowerCase());
    }

    const provider = requestedProvider || (connected.includes("openai") ? "openai" : connected[0]);

    if (!provider) return responseJson(409, { error: "No connected AI provider was found for this account", code: "connection_lookup_empty" });
    if (!connected.includes(provider)) return responseJson(409, { error: `${provider} is not connected`, code: "provider_not_connected" });

    const { data: secret, error: secretError } = await admin.rpc("get_connection_secret_for_service", {
      p_user_id: userData.user.id,
      p_provider: provider,
    });
    if (secretError || !secret) return responseJson(500, { error: "Could not load the connected provider credential" });

    const instructions = String(body.instructions || "").slice(0, 14000);
    const prompt = String(body.prompt || "").slice(0, 30000);
    const imageDataUrl = typeof body.imageDataUrl === "string" && body.imageDataUrl.startsWith("data:image/")
      ? body.imageDataUrl
      : null;

    if (!prompt) return responseJson(400, { error: "Prompt is required" });

    if (provider === "openai") {
      const content: any[] = [{ type: "input_text", text: prompt }];
      if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl, detail: "high" });

      const models = ["gpt-5-mini", "gpt-4.1-mini"];
      let lastError = "OpenAI request failed";

      for (const model of models) {
        const ai = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          signal: AbortSignal.timeout(45000),
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            instructions,
            input: [{ role: "user", content }],
            max_output_tokens: 500,
            ...(model === "gpt-5-mini" ? { reasoning: { effort: "low" } } : {}),
            store: false,
          }),
        });

        const result = await ai.json().catch(() => ({}));
        if (!ai.ok) {
          lastError = String(result?.error?.message || result?.message || `OpenAI request failed (${ai.status})`).slice(0, 600);
          if (ai.status === 404 || /model/i.test(lastError)) continue;
          return responseJson(ai.status === 429 ? 429 : 502, {
            error: lastError,
            provider,
            model,
            latency_ms: Date.now() - started,
          });
        }

        const text = extractOpenAIText(result);
        if (!text) {
          lastError = "OpenAI returned an empty answer";
          continue;
        }

        return responseJson(200, {
          answer: text,
          provider,
          model: String(result?.model || model),
          latency_ms: Date.now() - started,
        });
      }

      return responseJson(502, { error: lastError, provider, latency_ms: Date.now() - started });
    }

    return responseJson(501, {
      error: `${provider} is connected for credential storage, but direct Memora reasoning is not enabled for this provider yet.`,
      provider,
    });
  } catch (error) {
    return responseJson(500, {
      error: error instanceof Error ? error.message : "Unexpected provider proxy error",
      latency_ms: Date.now() - started,
    });
  }
});
