import { loadMessages } from '../src/config/loadConfig';

describe('loadConfig', () => {
  it('loads all message codes M1-M7 variants', () => {
    const messages = loadMessages();
    expect(messages.M1).toBeTruthy();
    expect(messages.M2).toBeTruthy();
    expect(messages.M3).toBeTruthy();
    expect(messages.M4).toBeTruthy();
    expect(messages.M5).toBeTruthy();
    expect(messages.M6_SHORT).toContain('thiếu');
    expect(messages.M6_LONG).toContain('thừa');
    expect(messages.M6_INVALID).toBeTruthy();
    expect(messages.M7).toBeTruthy();
  });

  it('exposes the 3 quick-reply buttons with fixed payloads', () => {
    const messages = loadMessages();
    const payloads = messages.buttons.map((b) => b.payload);
    expect(payloads).toEqual(
      expect.arrayContaining(['BTN_LOCATION', 'BTN_LEGAL', 'BTN_PRICE'])
    );
  });
});
