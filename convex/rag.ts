import { RAG } from "@convex-dev/rag";
import { components } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const EMBEDDING_DIM = 2048;

const nvidia = createOpenAI({
  baseURL: NVIDIA_BASE_URL,
});

export const rag = new RAG(components.rag, {
  textEmbeddingModel: nvidia.embedding("nvidia/nemotron-3-embed-1b"),
  embeddingDimension: EMBEDDING_DIM,
});

export const nvidiaChat = nvidia.chat("nvidia/nemotron-3-ultra-550b-a55b");
