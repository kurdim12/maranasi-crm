import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';

describe('password hashing', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
  });
  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
  it('produces unique salts', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });
  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$notanumber$a$b')).toBe(false);
  });
});
