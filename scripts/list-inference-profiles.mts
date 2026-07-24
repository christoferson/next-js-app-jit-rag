import { BedrockClient, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";

const client = new BedrockClient({ region: process.env.AWS_REGION ?? "us-east-1" });
let token: string | undefined;
do {
  const res = await client.send(new ListInferenceProfilesCommand({ maxResults: 100, nextToken: token }));
  for (const p of res.inferenceProfileSummaries ?? []) {
    if (/claude/.test(p.inferenceProfileId ?? "")) {
      console.log(JSON.stringify({ id: p.inferenceProfileId, name: p.inferenceProfileName, status: p.status }));
    }
  }
  token = res.nextToken;
} while (token);
