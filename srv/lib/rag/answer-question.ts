import type { ChatMessage, LLMProvider, TokenUsage } from '../ports/llm'
import type { RetrievedChunk, Retriever, Runtime } from '../ports/retriever'
import { parseCitations } from './citations'
import {
  ANSWER_SYSTEM_PROMPT,
  NO_ANSWER,
  buildAnswerUserMessage,
  buildRewriteMessages,
  formatChunk,
} from './prompts'
import { detectRuntime } from './runtime'
import { estimateTokens } from './tokens'

/** Share of the prompt budget kept free to absorb errors of the token estimate. */
const SAFETY_MARGIN = 0.1

export interface AnswerQuestionDeps {
  llm: LLMProvider
  retriever: Retriever
  config: {
    topK: number
    /** Maximum number of previous messages considered, before token trimming. */
    historyMessages: number
  }
  logger?: { warn(...args: unknown[]): void }
  /**
   * Runs each step of the pipeline, e.g. inside a tracing span (ADR 0017).
   * Timings are measured by the use case either way.
   */
  stage?: StageRunner
}

export type StageName = 'rewrite' | 'retrieve' | 'generate'
export type StageRunner = <T>(name: StageName, fn: () => Promise<T>) => Promise<T>

export interface StageTimings {
  /** Null when the step did not run (first turn, or abstention before generation). */
  rewriteMs: number | null
  retrievalMs: number
  generationMs: number | null
}

export interface AnswerQuestionInput {
  question: string
  /** Previous messages of the conversation, oldest first. */
  history: ChatMessage[]
}

export interface AnsweredSource extends RetrievedChunk {
  cited: boolean
}

export interface AnswerQuestionOutput {
  answer: string
  /** Query used for retrieval: the question itself, or its standalone rewrite (ADR 0007). */
  rewrittenQuery: string
  /** Sources given to the model, in citation order ([1] is the first). */
  sources: AnsweredSource[]
  /** Null when the assistant abstained without calling the model. */
  model: string | null
  timings: StageTimings
  usage?: TokenUsage
}

export async function answerQuestion(
  deps: AnswerQuestionDeps,
  input: AnswerQuestionInput,
): Promise<AnswerQuestionOutput> {
  const { llm, retriever, config, logger } = deps
  const run = timed(deps.stage ?? ((_, fn) => fn()))
  const history = input.history.slice(-config.historyMessages)

  // First turn: nothing to resolve, save one model call (ADR 0007)
  const rewrite =
    history.length === 0 ? null : await run('rewrite', () => rewriteQuery(llm, history, input.question))
  const rewrittenQuery = rewrite?.value ?? input.question

  // Node.js unless the question (or the conversation it continues) is about Java
  const runtime = detectRuntime(input.question, rewrittenQuery)
  const retrieval = await run('retrieve', () => retriever.search(rewrittenQuery, config.topK, { runtime }))
  const { messages, includedChunks } = buildAnswerPrompt(
    llm,
    retrieval.value,
    history,
    input.question,
    runtime,
  )

  // Nothing relevant (or nothing that fits): abstain instead of answering ungrounded (ADR 0008)
  if (includedChunks.length === 0) {
    const timings = { rewriteMs: rewrite?.ms ?? null, retrievalMs: retrieval.ms, generationMs: null }
    return { answer: NO_ANSWER, rewrittenQuery, sources: [], model: null, timings }
  }

  const generation = await run('generate', () => llm.chat(messages))
  const result = generation.value

  const citations = parseCitations(result.content, includedChunks.length)
  if (citations.invalid.length > 0) {
    logger?.warn('Removed citation markers without a matching source:', citations.invalid)
  }

  return {
    answer: citations.text,
    rewrittenQuery,
    sources: includedChunks.map((chunk, i) => ({ ...chunk, cited: citations.cited.has(i + 1) })),
    model: result.model,
    timings: { rewriteMs: rewrite?.ms ?? null, retrievalMs: retrieval.ms, generationMs: generation.ms },
    usage: result.usage,
  }
}

/** Wraps a stage runner so that each step also reports its duration. */
function timed(stage: StageRunner) {
  return async <T>(name: StageName, fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const start = performance.now()
    const value = await stage(name, fn)
    return { value, ms: Math.round(performance.now() - start) }
  }
}

async function rewriteQuery(llm: LLMProvider, history: ChatMessage[], question: string): Promise<string> {
  const result = await llm.chat(buildRewriteMessages(history, question))
  const rewritten = result.content
    .split('\n')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
  return rewritten || question
}

/**
 * Fits system prompt, excerpts, history and question into the model's context
 * window (ADR 0004). The system prompt and the question are always kept; excerpts
 * are added in rank order, then history from newest to oldest until the budget
 * runs out.
 */
function buildAnswerPrompt(
  llm: LLMProvider,
  chunks: RetrievedChunk[],
  history: ChatMessage[],
  question: string,
  runtime: Runtime,
): { messages: ChatMessage[]; includedChunks: RetrievedChunk[] } {
  const budget = Math.floor((llm.contextWindow - llm.maxOutputTokens) * (1 - SAFETY_MARGIN))
  let used =
    estimateTokens(ANSWER_SYSTEM_PROMPT) + estimateTokens(buildAnswerUserMessage([], question, runtime))

  const includedChunks: RetrievedChunk[] = []
  for (const chunk of chunks) {
    const cost = estimateTokens(formatChunk(chunk, includedChunks.length)) + 1
    if (used + cost > budget) continue
    includedChunks.push(chunk)
    used += cost
  }

  const includedHistory: ChatMessage[] = []
  for (const message of [...history].reverse()) {
    const cost = estimateTokens(message.content) + 4
    if (used + cost > budget) break
    includedHistory.unshift(message)
    used += cost
  }

  return {
    messages: [
      { role: 'system', content: ANSWER_SYSTEM_PROMPT },
      ...includedHistory,
      { role: 'user', content: buildAnswerUserMessage(includedChunks, question, runtime) },
    ],
    includedChunks,
  }
}
