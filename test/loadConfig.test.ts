import { loadMessages } from '../src/config/loadConfig';

describe('loadConfig', () => {
  it('loads the AI-failure fallback text (mục 4.2, AC16) — câu trả lời cố định DUY NHẤT còn lại', () => {
    const messages = loadMessages();
    expect(messages.aiFallbackText).toBeTruthy();
  });

  it('exposes the 3 quick-reply buttons with fixed payloads', () => {
    const messages = loadMessages();
    const payloads = messages.buttons.map((b) => b.payload);
    expect(payloads).toEqual(
      expect.arrayContaining(['BTN_LOCATION', 'BTN_LEGAL', 'BTN_PRICE'])
    );
  });
});
