import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";

const region = process.env.AWS_REGION ?? "us-east-1";
const client = new BedrockClient({ region });
const res = await client.send(new ListFoundationModelsCommand({}));
const interesting = (res.modelSummaries ?? []).filter(m =>
  /titan-embed|cohere\.embed|anthropic\.claude/.test(m.modelId ?? "")
);
for (const m of interesting) {
  console.log(JSON.stringify({
    id: m.modelId,
    name: m.modelName,
    inputs: m.inputModalities,
    outputs: m.outputModalities,
    streaming: m.responseStreamingSupported,
    inference: m.inferenceTypesSupported,
    lifecycle: m.modelLifecycle?.status,
  }));
}
