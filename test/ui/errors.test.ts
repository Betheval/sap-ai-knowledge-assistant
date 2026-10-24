import { describeAskError } from '../../app/assistant/webapp/util/errors'

describe('describeAskError', () => {
  it.each([
    [503, 'errorUnavailable', true],
    [504, 'errorTimeout', true],
    [404, 'errorNotFound', false],
    [400, 'errorInvalid', false],
  ])('maps HTTP %i to %s', (status, key, retryable) => {
    expect(describeAskError(Object.assign(new Error('x'), { status }))).toEqual({ key, retryable })
  })

  it('keeps the detail of unknown errors', () => {
    expect(describeAskError(new Error('Network down'))).toEqual({
      key: 'errorUnknown',
      detail: 'Network down',
      retryable: true,
    })
  })
})
