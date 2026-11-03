import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockNocClient } from './MockNocClient'

describe('MockNocClient auth (Part 8, Yassine 3 Nov)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('any email is accepted, 123456 verifies and returns the mock operator', async () => {
    const client = new MockNocClient()
    const r1 = await client.requestCode('anyone@example.com')
    expect(r1.ok).toBe(true)
    const r2 = await client.verifyCode('anyone@example.com', '123456')
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.value.operator.desks).toEqual([1, 2, 3, 4])
  })

  it('000000 is expired, not a wrong guess', async () => {
    const client = new MockNocClient()
    await client.requestCode('a@b.com')
    const r = await client.verifyCode('a@b.com', '000000')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CODE_EXPIRED')
    // Doesn't count toward the 3-strikes lock: two more real wrong guesses
    // land on attempt 2 and 3, not 3 and 4.
    const w1 = await client.verifyCode('a@b.com', '111111')
    if (!w1.ok) expect(w1.error.attemptsLeft).toBe(2)
  })

  it('3 wrong codes burns the code and locks the email for 15 minutes', async () => {
    const client = new MockNocClient()
    await client.requestCode('locked@b.com')
    await client.verifyCode('locked@b.com', '111111')
    await client.verifyCode('locked@b.com', '222222')
    const third = await client.verifyCode('locked@b.com', '333333')
    expect(third.ok).toBe(false)
    if (!third.ok) {
      expect(third.error.code).toBe('EMAIL_LOCKED')
      expect(third.error.retryAfterSec).toBe(15 * 60)
    }
    // Even the real code is refused while locked.
    const stillLocked = await client.verifyCode('locked@b.com', '123456')
    expect(stillLocked.ok).toBe(false)
    if (!stillLocked.ok) expect(stillLocked.error.code).toBe('EMAIL_LOCKED')

    // Unlocks on its own after 15 minutes.
    vi.advanceTimersByTime(15 * 60_000 + 1000)
    const afterWait = await client.verifyCode('locked@b.com', '123456')
    expect(afterWait.ok).toBe(true)
  })

  it('resend cooldown: a second request inside 30s is refused', async () => {
    const client = new MockNocClient()
    await client.requestCode('resend@b.com')
    const tooSoon = await client.requestCode('resend@b.com')
    expect(tooSoon.ok).toBe(false)
    if (!tooSoon.ok) expect(tooSoon.error.code).toBe('RESEND_TOO_SOON')

    vi.advanceTimersByTime(30_000)
    const afterCooldown = await client.requestCode('resend@b.com')
    expect(afterCooldown.ok).toBe(true)
  })

  it('rate limit: a 6th code inside an hour is refused', async () => {
    const client = new MockNocClient()
    for (let i = 0; i < 5; i++) {
      const r = await client.requestCode('rate@b.com')
      expect(r.ok).toBe(true)
      vi.advanceTimersByTime(30_000) // clear each resend cooldown
    }
    const sixth = await client.requestCode('rate@b.com')
    expect(sixth.ok).toBe(false)
    if (!sixth.ok) expect(sixth.error.code).toBe('RATE_LIMITED')
  })

  it('selectDesk requires a verified code first', async () => {
    const client = new MockNocClient()
    const r = await client.selectDesk(1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_STATE')
  })

  it('selectDesk rejects a desk the operator was not offered', async () => {
    const client = new MockNocClient()
    await client.requestCode('d@b.com')
    await client.verifyCode('d@b.com', '123456')
    const r = await client.selectDesk(9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('full sign-in: request, verify, pick a desk, lock, sign out', async () => {
    const client = new MockNocClient()
    await client.requestCode('full@b.com')
    await client.verifyCode('full@b.com', '123456')
    const picked = await client.selectDesk(2)
    expect(picked.ok).toBe(true)

    const locked = await client.lock()
    expect(locked.ok).toBe(true)

    const signedOut = await client.signOut()
    expect(signedOut.ok).toBe(true)

    // Locking with no session again (post sign-out) is refused.
    const lockAgain = await client.lock()
    expect(lockAgain.ok).toBe(false)
    if (!lockAgain.ok) expect(lockAgain.error.code).toBe('INVALID_STATE')
  })

  it('each email has independent lockout/rate state', async () => {
    const client = new MockNocClient()
    await client.requestCode('x@b.com')
    await client.verifyCode('x@b.com', '111111')
    await client.verifyCode('x@b.com', '222222')
    await client.verifyCode('x@b.com', '333333') // locks x@b.com

    const other = await client.requestCode('y@b.com')
    expect(other.ok).toBe(true)
    const verify = await client.verifyCode('y@b.com', '123456')
    expect(verify.ok).toBe(true)
  })
})
