// Shared Bedrock client construction (lazy — never at module top level, so the app
// boots without AWS creds) and AWS→AppError mapping. ALL AWS error mapping lives here.
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockError } from "../errors/errors";

let client: BedrockRuntimeClient | null = null;

export function bedrockClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      // AWS_PROFILE picked up automatically by the default credential chain
    });
  }
  return client;
}

/** Maps AWS SDK errors (request-level and in-stream) to readable typed errors. */
export function mapBedrockError(err: unknown): never {
  if (err instanceof BedrockError) throw err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);

  switch (name) {
    case "AccessDeniedException":
      throw new BedrockError(
        "BEDROCK_ACCESS_DENIED",
        "Model access is not enabled in this AWS account/region, or the credentials lack permission.",
        403
      );
    case "ThrottlingException":
    case "ServiceQuotaExceededException":
      throw new BedrockError("BEDROCK_THROTTLED", "Bedrock rate limit hit — please retry shortly.", 429);
    case "ValidationException":
      throw new BedrockError("BEDROCK_VALIDATION", `Bedrock rejected the request: ${message}`, 400);
    case "ModelTimeoutException":
    case "TimeoutError":
      throw new BedrockError("BEDROCK_TIMEOUT", "The model took too long to respond — please retry.", 504);
    case "ModelNotReadyException":
      throw new BedrockError("BEDROCK_ERROR", "The model is not ready yet — please retry shortly.", 503);
    case "AbortError":
      throw err as Error; // aborts propagate as-is (Stop button)
    default:
      throw new BedrockError("BEDROCK_ERROR", `Bedrock call failed: ${message}`, 502);
  }
}
