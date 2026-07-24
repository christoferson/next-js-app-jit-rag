// Bedrock streaming generation (Anthropic Messages family). Envelope verified by live
// probe (VERIFICATION.md §1.2): chunk bytes → JSON events; text at
// content_block_delta.delta.text; usage at message_delta.usage.
import { InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import type { GenerateOptions, LLMAdapter, LLMStreamHandle } from "./llm-adapter";
import { bedrockClient, mapBedrockError } from "./bedrock-common";
import { getLLMModel } from "../models/factory";
import { BedrockError } from "../errors/errors";

const dec = new TextDecoder();

export class BedrockLLMAdapter implements LLMAdapter {
  async generateStream(options: GenerateOptions): Promise<LLMStreamHandle> {
    const model = getLLMModel(options.modelId);

    const body: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Math.min(options.maxTokens ?? 2048, model.maxOutputTokens),
      system: options.system,
      messages: [{ role: "user", content: [{ type: "text", text: options.userMessage }] }],
    };
    if (model.supportsTemperature && options.temperature !== undefined) {
      // clamp; never send top_p alongside temperature (Sonnet/Haiku 4.5 restriction)
      body.temperature = Math.min(1, Math.max(0, options.temperature));
    }

    let stream: Awaited<ReturnType<typeof sendStream>>;
    const sendStream = () =>
      bedrockClient().send(
        new InvokeModelWithResponseStreamCommand({
          modelId: model.id,
          body: JSON.stringify(body),
          contentType: "application/json",
          accept: "application/json",
        }),
        { abortSignal: options.signal }
      );
    try {
      stream = await sendStream();
    } catch (err) {
      mapBedrockError(err);
    }

    const usage: { inputTokens?: number; outputTokens?: number } = {};

    async function* deltas(): AsyncGenerator<string> {
      try {
        for await (const event of stream.body ?? []) {
          // in-stream error members of the event union
          const streamErr =
            event.internalServerException ??
            event.modelStreamErrorException ??
            event.validationException ??
            event.throttlingException;
          if (streamErr) mapBedrockError(Object.assign(new Error(streamErr.message), { name: streamErr.name }));

          if (!event.chunk?.bytes) continue;
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(dec.decode(event.chunk.bytes));
          } catch {
            continue; // tolerate a malformed frame
          }
          switch (json.type) {
            case "content_block_delta": {
              const delta = json.delta as { type?: string; text?: string } | undefined;
              if (delta?.type === "text_delta" && typeof delta.text === "string") yield delta.text;
              break;
            }
            case "message_start": {
              const msg = json.message as { usage?: { input_tokens?: number } } | undefined;
              if (msg?.usage?.input_tokens !== undefined) usage.inputTokens = msg.usage.input_tokens;
              break;
            }
            case "message_delta": {
              const u = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
              if (u?.input_tokens !== undefined) usage.inputTokens = u.input_tokens;
              if (u?.output_tokens !== undefined) usage.outputTokens = u.output_tokens;
              break;
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // Stop button
        if (err instanceof BedrockError) throw err;
        mapBedrockError(err);
      }
    }

    return { deltas: deltas(), usage: () => usage };
  }
}
