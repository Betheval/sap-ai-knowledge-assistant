import { detectRuntime } from '../../srv/lib/rag/runtime'

describe('detectRuntime', () => {
  it.each([
    ['How do I implement an action in CAP?', 'node'],
    ['How do I write a handler in Node.js?', 'node'],
    ['How do I register an event handler in CAP Java?', 'java'],
    ['Configure mock users in a Spring Boot app', 'java'],
    ['Which dependency goes into my pom.xml?', 'java'],
    ['How do I use the cds-maven-plugin?', 'java'],
    ['Is JavaScript supported?', 'node'],
  ])('%s → %s', (question, runtime) => {
    expect(detectRuntime(question)).toBe(runtime)
  })

  it('detects Java in any of the given texts', () => {
    expect(detectRuntime('And how do I test it?', 'How do I test a CAP Java service?')).toBe('java')
  })
})
