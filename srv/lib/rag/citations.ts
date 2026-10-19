export interface CitationResult {
  /** Answer text with invalid citation markers removed. */
  text: string
  /** 1-based indexes of the excerpts the answer cites. */
  cited: Set<number>
  /** Markers that pointed to no excerpt and were removed. */
  invalid: number[]
}

/**
 * Extracts [n] citation markers and drops those that do not match one of the
 * `sourceCount` excerpts given to the model (ADR 0008).
 */
export function parseCitations(answer: string, sourceCount: number): CitationResult {
  const cited = new Set<number>()
  const invalid: number[] = []

  const text = answer
    .replace(/\[(\d+)\]/g, (marker, digits: string) => {
      const n = Number(digits)
      if (n >= 1 && n <= sourceCount) {
        cited.add(n)
        return marker
      }
      invalid.push(n)
      return ''
    })
    .replace(/ +([.,;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()

  return { text, cited, invalid }
}
