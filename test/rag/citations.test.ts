import { parseCitations } from '../../srv/lib/rag/citations'

describe('parseCitations', () => {
  it('collects valid markers and keeps them in the text', () => {
    const result = parseCitations('Use an on handler [1]. Parameters are in req.data [2][1].', 3)

    expect([...result.cited].sort()).toEqual([1, 2])
    expect(result.invalid).toEqual([])
    expect(result.text).toBe('Use an on handler [1]. Parameters are in req.data [2][1].')
  })

  it('removes markers that point to no source', () => {
    const result = parseCitations('Deploy with cf deploy [4]. Build with mbt [1].', 2)

    expect([...result.cited]).toEqual([1])
    expect(result.invalid).toEqual([4])
    expect(result.text).toBe('Deploy with cf deploy. Build with mbt [1].')
  })

  it('treats [0] as invalid', () => {
    expect(parseCitations('Text [0].', 1).invalid).toEqual([0])
  })

  it('returns no citations for plain text', () => {
    const result = parseCitations('No citations here.', 2)

    expect(result.cited.size).toBe(0)
    expect(result.text).toBe('No citations here.')
  })
})
