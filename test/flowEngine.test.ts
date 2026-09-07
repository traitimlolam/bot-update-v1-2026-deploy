import { processInput, newConversation, ConversationRecord } from '../src/flow/flowEngine';

describe('flowEngine.processInput', () => {
  describe('quick-reply buttons (mục 5.2)', () => {
    it('BTN_LOCATION -> M1, M2, M3 and state becomes IN_PROGRESS (AC1)', () => {
      const result = processInput(newConversation(), { type: 'BUTTON', payload: 'BTN_LOCATION' });
      expect(result.messagesToSend).toEqual(['M1', 'M2', 'M3']);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('BTN_PRICE -> M1, M2, M3 (AC1)', () => {
      const result = processInput(newConversation(), { type: 'BUTTON', payload: 'BTN_PRICE' });
      expect(result.messagesToSend).toEqual(['M1', 'M2', 'M3']);
    });

    it('BTN_LEGAL -> M1, M4, M3 (AC2)', () => {
      const result = processInput(newConversation(), { type: 'BUTTON', payload: 'BTN_LEGAL' });
      expect(result.messagesToSend).toEqual(['M1', 'M4', 'M3']);
    });
  });

  describe('free text (mục 5.2, 4.2, AC3, AC9)', () => {
    it('free text on NEW state -> M1, AI_REPLY, M3 (AC3)', () => {
      const result = processInput(newConversation(), { type: 'TEXT', text: 'cho hoi gia the nao' });
      expect(result.messagesToSend).toEqual(['M1', 'AI_REPLY', 'M3']);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('free text on IN_PROGRESS with no phone number (dòng thứ 2) -> AI_REPLY rồi M3, không có M1 (AC9)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: 'con hang khong ban' });
      expect(result.messagesToSend).toEqual(['AI_REPLY', 'M3']);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('customer sends 1st message (M1-AI_REPLY-M3), then 2nd message sends AI_REPLY-M3, then valid phone sends M5', () => {
      // Dòng 1: khách nhắn lần đầu -> nhận M1, AI_REPLY, M3
      const turn1 = processInput(newConversation(), { type: 'TEXT', text: 'cho em hoi dat' });
      expect(turn1.messagesToSend).toEqual(['M1', 'AI_REPLY', 'M3']);
      expect(turn1.record.state).toBe('IN_PROGRESS');

      // Dòng 2: khách nhắn thêm -> nhận AI_REPLY rồi M3
      const turn2 = processInput(turn1.record, { type: 'TEXT', text: 'dat o xa nao em' });
      expect(turn2.messagesToSend).toEqual(['AI_REPLY', 'M3']);
      expect(turn2.record.state).toBe('IN_PROGRESS');

      // Dòng 3: khách nhắn thêm tiếp -> vẫn nhận AI_REPLY rồi M3
      const turn3 = processInput(turn2.record, { type: 'TEXT', text: 'co so do chua' });
      expect(turn3.messagesToSend).toEqual(['AI_REPLY', 'M3']);
      expect(turn3.record.state).toBe('IN_PROGRESS');

      // Dòng 4: khách cho số điện thoại hợp lệ -> chốt lead, nhận M5
      const turn4 = processInput(turn3.record, { type: 'TEXT', text: '0912345678' });
      expect(turn4.messagesToSend).toEqual(['M5']);
      expect(turn4.record.state).toBe('CLOSED');
      expect(turn4.leadPhone).toBe('0912345678');
    });

    it('repeat-ask sends AI_REPLY + M3 every time until a valid phone arrives', () => {
      let record: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      for (let i = 0; i < 3; i++) {
        const result = processInput(record, { type: 'TEXT', text: `hoi lai lan ${i}` });
        expect(result.messagesToSend).toEqual(['AI_REPLY', 'M3']);
        record = result.record;
      }
    });

    it('free text on CLOSED state -> replies M7 (reassurance), no state change, no new lead, tracked for follow-up (AC6)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'Nguyễn Văn A' };
      const result = processInput(closed, { type: 'TEXT', text: 'anh hoi them chut nua' });
      expect(result.messagesToSend).toEqual(['M7']);
      expect(result.record).toEqual(closed);
      expect(result.leadPhone).toBeNull();
      expect(result.correctedPhone).toBeNull();
      expect(result.trackFollowUp).toBe(true);
    });
  });

  describe('phone number handling (mục 5.2, 7)', () => {
    it('valid phone -> M5, state CLOSED, leadPhone set for Sheet/round-robin (AC4)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: 'sdt em 0912345678 nhe' });
      expect(result.messagesToSend).toEqual(['M5']);
      expect(result.record.state).toBe('CLOSED');
      expect(result.record.phone).toBe('0912345678');
      expect(result.leadPhone).toBe('0912345678');
    });

    it('9-digit phone (thiếu) -> M6_SHORT, no state change, no leadPhone (AC5)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: '091234567' });
      expect(result.messagesToSend).toEqual(['M6_SHORT']);
      expect(result.record.state).toBe('IN_PROGRESS');
      expect(result.leadPhone).toBeNull();
    });

    it('11-digit phone (thừa) -> M6_LONG, no state change, no leadPhone (AC5)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: '09123456789' });
      expect(result.messagesToSend).toEqual(['M6_LONG']);
      expect(result.leadPhone).toBeNull();
    });

    it('10-digit phone with invalid prefix -> M6_INVALID, no state change, no leadPhone (AC5)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: '0112345678' });
      expect(result.messagesToSend).toEqual(['M6_INVALID']);
      expect(result.record).toEqual(inProgress);
      expect(result.leadPhone).toBeNull();
    });

    it('leadPhone is null for every invalid-phone case (mục 7 điểm 6 / mục 13: guard trước khi có thể gọi appendLead)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const invalidTexts = ['091234567', '09123456789', '0112345678'];
      for (const text of invalidTexts) {
        const result = processInput(inProgress, { type: 'TEXT', text });
        expect(result.leadPhone).toBeNull();
      }
    });

    it('different valid phone while state=CLOSED -> replies M7, corrects record.phone, sets correctedPhone (mục 6, 8c)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'TEXT', text: '0987654321' });
      expect(result.messagesToSend).toEqual(['M7']);
      expect(result.record).toEqual({ state: 'CLOSED', phone: '0987654321', assignedStaff: 'A' });
      expect(result.leadPhone).toBeNull();
      expect(result.correctedPhone).toBe('0987654321');
      expect(result.trackFollowUp).toBe(true);
    });

    it('same valid phone repeated while state=CLOSED -> replies M7, no correction needed', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'TEXT', text: 'sdt em van la 0912345678 nhe' });
      expect(result.messagesToSend).toEqual(['M7']);
      expect(result.record).toEqual(closed);
      expect(result.correctedPhone).toBeNull();
      expect(result.trackFollowUp).toBe(true);
    });

    it('invalid-format phone while state=CLOSED -> replies with the missing/excess/invalid-prefix message, does not touch Sheet (mục 7 điểm 6)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };

      const short = processInput(closed, { type: 'TEXT', text: '091234567' });
      expect(short.messagesToSend).toEqual(['M6_SHORT']);
      expect(short.record).toEqual(closed);
      expect(short.trackFollowUp).toBe(false);
      expect(short.correctedPhone).toBeNull();

      const long = processInput(closed, { type: 'TEXT', text: '09123456789' });
      expect(long.messagesToSend).toEqual(['M6_LONG']);
      expect(long.trackFollowUp).toBe(false);

      const invalidPrefix = processInput(closed, { type: 'TEXT', text: '0112345678' });
      expect(invalidPrefix.messagesToSend).toEqual(['M6_INVALID']);
      expect(invalidPrefix.trackFollowUp).toBe(false);
    });
  });

  describe('feed/comment không kèm text hoặc không có số điện thoại (mục 5.3, AC8)', () => {
    it('first comment on NEW state -> M1, AI_REPLY, M3', () => {
      const result = processInput(newConversation(), { type: 'FEED_COMMENT' });
      expect(result.messagesToSend).toEqual(['M1', 'AI_REPLY', 'M3']);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('comment on IN_PROGRESS state without phone -> sends AI_REPLY then M3 (AC8/AC9)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'FEED_COMMENT' });
      expect(result.messagesToSend).toEqual(['AI_REPLY', 'M3']);
    });

    it('comment on CLOSED state -> replies M7, không tạo lead mới (không còn im lặng tuyệt đối)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'FEED_COMMENT', text: 'hoi lai' });
      expect(result.messagesToSend).toEqual(['M7']);
      expect(result.leadPhone).toBeNull();
      expect(result.trackFollowUp).toBe(true);
    });

    it('comment on CLOSED state kèm số điện thoại khác -> vẫn phát hiện correctedPhone giống kênh nhắn tin', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'FEED_COMMENT', text: 'sdt moi cua em la 0987654321' });
      expect(result.messagesToSend).toEqual(['M7']);
      expect(result.correctedPhone).toBe('0987654321');
      expect(result.record.phone).toBe('0987654321');
    });
  });

  describe('feed/comment kèm số điện thoại ngay trong nội dung (mục 5.3, AC10)', () => {
    it('comment chứa số điện thoại hợp lệ -> chốt lead ngay, M5, không có M1-M3 nào trước đó', () => {
      const result = processInput(newConversation(), {
        type: 'FEED_COMMENT',
        text: 'chi cho em xin gia, sdt 0912345678 nhe',
      });
      expect(result.messagesToSend).toEqual(['M5']);
      expect(result.record.state).toBe('CLOSED');
      expect(result.leadPhone).toBe('0912345678');
    });

    it('comment chứa số điện thoại không hợp lệ -> M6 tương ứng, không tác động Sheet', () => {
      const result = processInput(newConversation(), { type: 'FEED_COMMENT', text: 'sdt em 091234567' });
      expect(result.messagesToSend).toEqual(['M6_SHORT']);
      expect(result.leadPhone).toBeNull();
      expect(result.record.state).toBe('NEW');
    });
  });
});
