import { RAG } from "@convex-dev/rag";
import { components } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel } from "ai";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const EMBEDDING_DIM = 1024;

const nvidia = createOpenAI({
  baseURL: NVIDIA_BASE_URL,
});

function deterministicEmbedding(): EmbeddingModel {
  return {
    specificationVersion: "v4",
    provider: "deterministic-local",
    modelId: "hash-1024",
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    async doEmbed({ values }) {
      const embeddings = values.map((text): number[] => {
        const embedding = new Array(EMBEDDING_DIM).fill(0);
        for (let h = 0; h < text.length; h++) {
          const c = text.charCodeAt(h);
          for (let i = 0; i < EMBEDDING_DIM; i++) {
            const seed = (c * 31 + h * 7 + i * 2654435761) | 0;
            embedding[i] += Math.sin(seed) * 0.5;
          }
        }
        const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
        for (const token of tokens) {
          let h = 0;
          for (let i = 0; i < token.length; i++) {
            h = ((h << 5) - h + token.charCodeAt(i)) | 0;
          }
          for (let i = 0; i < EMBEDDING_DIM; i++) {
            const seed = (h + i * 2654435761) | 0;
            embedding[i] += Math.sin(seed);
          }
        }
        const mag = Math.sqrt(embedding.reduce((s, x) => s + x * x, 0)) || 1;
        return embedding.map((x) => x / mag);
      });
      return { embeddings, warnings: [] };
    },
  };
}

export const rag = new RAG(components.rag, {
  textEmbeddingModel: deterministicEmbedding(),
  embeddingDimension: EMBEDDING_DIM,
});

export const nvidiaChat = nvidia.chat("nvidia/nemotron-3-ultra-550b-a55b");
