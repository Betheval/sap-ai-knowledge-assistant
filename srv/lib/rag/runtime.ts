import type { Runtime } from '../ports/retriever'

const JAVA = /\b(java|spring(\s*boot)?|maven|jvm|pom\.xml|junit)\b/i

/**
 * CAP runtime a question is about: Java when it says so, Node.js otherwise,
 * the default of this assistant (ADR 0008).
 */
export function detectRuntime(...texts: string[]): Runtime {
  return texts.some((t) => JAVA.test(t)) ? 'java' : 'node'
}

export const RUNTIME_NAMES: Record<Runtime, string> = { node: 'Node.js', java: 'Java' }
