import * as crypto from 'crypto';
import { verifySignature } from '../src/webhook/facebook';
import messageFixture from './fixtures/message.json';

const APP_SECRET = 'test_app_secret';

function signPayload(payload: Buffer, secret: string): string {
  const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hash}`;
}

describe('webhook/facebook.verifySignature (mục 15 bước 3)', () => {
  it('accepts a correctly signed payload from a message fixture', () => {
    const rawBody = Buffer.from(JSON.stringify(messageFixture));
    const signature = signPayload(rawBody, APP_SECRET);
    expect(verifySignature(rawBody, signature, APP_SECRET)).toBe(true);
  });

  it('rejects a payload signed with the wrong app secret', () => {
    const rawBody = Buffer.from(JSON.stringify(messageFixture));
    const signature = signPayload(rawBody, 'wrong_secret');
    expect(verifySignature(rawBody, signature, APP_SECRET)).toBe(false);
  });

  it('rejects a tampered payload whose signature no longer matches', () => {
    const rawBody = Buffer.from(JSON.stringify(messageFixture));
    const signature = signPayload(rawBody, APP_SECRET);
    const tamperedBody = Buffer.from(JSON.stringify({ ...messageFixture, object: 'tampered' }));
    expect(verifySignature(tamperedBody, signature, APP_SECRET)).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const rawBody = Buffer.from(JSON.stringify(messageFixture));
    expect(verifySignature(rawBody, undefined, APP_SECRET)).toBe(false);
  });

  it('rejects when the signature header has no sha256= prefix', () => {
    const rawBody = Buffer.from(JSON.stringify(messageFixture));
    expect(verifySignature(rawBody, 'sha1=deadbeef', APP_SECRET)).toBe(false);
  });
});
