import type { ChatMessage } from '../ports/llm'
import type { RetrievedChunk } from '../ports/retriever'

export const NO_ANSWER =
  "I couldn't find this in the CAP documentation (Capire). " +
  'Try rephrasing the question or asking about a more specific CAP topic.'

export const REWRITE_SYSTEM_PROMPT = `You rewrite follow-up questions about SAP CAP into standalone search queries.
Use the conversation to resolve references such as "it", "that" or "the same".
Return only the rewritten query, on a single line, without quotes or explanations.`

export const ANSWER_SYSTEM_PROMPT = `You are an assistant for SAP Cloud Application Programming Model (CAP) developers.
Answer using ONLY the numbered documentation excerpts provided in the user's message.
Rules:
- Put the citation right after the sentence it supports, e.g. "... in req.data [1]." or "... [2][3]." Never collect citations at the end.
- Do not add facts, definitions or acronym expansions that are not stated in the excerpts, even if you believe them to be true.
- If the excerpts do not contain the answer, say that the documentation provided does not cover it. Never invent APIs, annotations or configuration.
- Include short code examples when the excerpts contain them, keeping their indentation.
- CAP has a Node.js and a Java runtime. If the question does not name one and the excerpts cover a specific runtime, say which runtime your answer applies to.
- Be concise and technical.`

/**
 * Repeated after the question: small models follow instructions at the end of a
 * long prompt much better than rules given before several excerpts.
 */
export const ANSWER_REMINDER =
  'Answer using only the excerpts above. Cite them inline as [n] right after each statement they support.'

/** Marker the answer prompt starts with; also lets the fake LLM tell the two steps apart. */
export const CONTEXT_HEADER = 'Documentation excerpts:'

export function buildRewriteMessages(history: ChatMessage[], question: string): ChatMessage[] {
  const transcript = history.map((m) => `${m.role}: ${m.content}`).join('\n')
  return [
    { role: 'system', content: REWRITE_SYSTEM_PROMPT },
    { role: 'user', content: `Conversation:\n${transcript}\n\nFollow-up question: ${question}` },
  ]
}

export function formatChunk(chunk: RetrievedChunk, index: number): string {
  return `[${index + 1}] ${chunk.title}\n${chunk.content}`
}

export function buildAnswerUserMessage(chunks: RetrievedChunk[], question: string): string {
  return `${CONTEXT_HEADER}\n\n${chunks.map(formatChunk).join('\n\n')}\n\nQuestion: ${question}\n\n${ANSWER_REMINDER}`
}
