import { processInput, newConversation, ConversationRecord, getPhoneCadence } from '../src/flow/flowEngine';

describe('flowEngine.processInput', () => {
  describe('quick-reply buttons (mục 5.2)', () => {
    it('BTN_LOCATION -> AI_TOPIC(location) and state becomes IN_PROGRESS (AC1)', () => {
      const result = processInput(newConversation(), { type: 'BUTTON', payload: 'BTN_LOCATION' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_TOPIC', topic: 'location' }]);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('BTN_PRICE -> AI_TOPIC(price) (AC1)', () => {
      const result = processInput(newConversation(), { type: 'BUTTON', payload: 'BTN_PRICE' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_TOPIC', topic: 'price' }]);
    });

    it('BTN_LEGAL -> AI_TOPIC(legal) (AC2)', () => {
      const result = processInput(newConversation(), { type: 'BUTTON', payload: 'BTN_LEGAL' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_TOPIC', topic: 'legal' }]);
    });
  });

  describe('free text (mục 5.2, 4.2, AC3, AC9)', () => {
    it('free text on NEW state -> AI_FREE_TEXT (AC3)', () => {
      const result = processInput(newConversation(), { type: 'TEXT', text: 'cho hoi gia the nao' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('free text on IN_PROGRESS with no phone number (dòng thứ 2) -> AI_FREE_TEXT (AC9)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: 'con hang khong ban' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('customer sends 1st message, then 2nd message, then valid phone sends AI_PHONE_CONFIRMED', () => {
      // Dòng 1: khách nhắn lần đầu -> nhận AI_FREE_TEXT
      const turn1 = processInput(newConversation(), { type: 'TEXT', text: 'cho em hoi dat' });
      expect(turn1.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
      expect(turn1.record.state).toBe('IN_PROGRESS');

      // Dòng 2: khách nhắn thêm -> vẫn nhận AI_FREE_TEXT
      const turn2 = processInput(turn1.record, { type: 'TEXT', text: 'dat o xa nao em' });
      expect(turn2.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
      expect(turn2.record.state).toBe('IN_PROGRESS');

      // Dòng 3: khách nhắn thêm tiếp -> vẫn nhận AI_FREE_TEXT
      const turn3 = processInput(turn2.record, { type: 'TEXT', text: 'co so do chua' });
      expect(turn3.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
      expect(turn3.record.state).toBe('IN_PROGRESS');

      // Dòng 4: khách cho số điện thoại hợp lệ -> chốt lead, nhận AI_PHONE_CONFIRMED
      const turn4 = processInput(turn3.record, { type: 'TEXT', text: '0912345678' });
      expect(turn4.messagesToSend).toEqual([{ kind: 'AI_PHONE_CONFIRMED' }]);
      expect(turn4.record.state).toBe('CLOSED');
      expect(turn4.leadPhone).toBe('0912345678');
    });

    it('repeat-ask sends AI_FREE_TEXT every time until a valid phone arrives', () => {
      let record: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      for (let i = 0; i < 3; i++) {
        const result = processInput(record, { type: 'TEXT', text: `hoi lai lan ${i}` });
        expect(result.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
        record = result.record;
      }
    });

    it('free text on CLOSED state -> replies AI_FOLLOWUP_CLOSED, no state change, no new lead, tracked for follow-up (AC6)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'Nguyễn Văn A' };
      const result = processInput(closed, { type: 'TEXT', text: 'anh hoi them chut nua' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FOLLOWUP_CLOSED' }]);
      expect(result.record).toEqual(closed);
      expect(result.leadPhone).toBeNull();
      expect(result.correctedPhone).toBeNull();
      expect(result.trackFollowUp).toBe(true);
    });
  });

  describe('phone number handling (mục 5.2, 7)', () => {
    it('valid phone -> AI_PHONE_CONFIRMED, state CLOSED, leadPhone set for Sheet/round-robin (AC4)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: 'sdt em 0912345678 nhe' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_PHONE_CONFIRMED' }]);
      expect(result.record.state).toBe('CLOSED');
      expect(result.record.phone).toBe('0912345678');
      expect(result.leadPhone).toBe('0912345678');
    });

    it('9-digit phone (thiếu) -> AI_PHONE_INVALID(missing), no state change, no leadPhone (AC5)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: '091234567' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'missing' }]);
      expect(result.record.state).toBe('IN_PROGRESS');
      expect(result.leadPhone).toBeNull();
    });

    it('11-digit phone (thừa) -> AI_PHONE_INVALID(excess), no state change, no leadPhone (AC5)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: '09123456789' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'excess' }]);
      expect(result.leadPhone).toBeNull();
    });

    it('10-digit phone with invalid prefix -> AI_PHONE_INVALID(invalidPrefix), no state change, no leadPhone (AC5)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'TEXT', text: '0112345678' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'invalidPrefix' }]);
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

    it('different valid phone while state=CLOSED -> replies AI_FOLLOWUP_CLOSED, corrects record.phone, sets correctedPhone (mục 6, 8c)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'TEXT', text: '0987654321' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FOLLOWUP_CLOSED' }]);
      expect(result.record).toEqual({ state: 'CLOSED', phone: '0987654321', assignedStaff: 'A' });
      expect(result.leadPhone).toBeNull();
      expect(result.correctedPhone).toBe('0987654321');
      expect(result.trackFollowUp).toBe(true);
    });

    it('same valid phone repeated while state=CLOSED -> replies AI_FOLLOWUP_CLOSED, no correction needed', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'TEXT', text: 'sdt em van la 0912345678 nhe' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FOLLOWUP_CLOSED' }]);
      expect(result.record).toEqual(closed);
      expect(result.correctedPhone).toBeNull();
      expect(result.trackFollowUp).toBe(true);
    });

    it('invalid-format phone while state=CLOSED -> replies AI_PHONE_INVALID with the right errorType, does not touch Sheet (mục 7 điểm 6)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };

      const short = processInput(closed, { type: 'TEXT', text: '091234567' });
      expect(short.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'missing' }]);
      expect(short.record).toEqual(closed);
      expect(short.trackFollowUp).toBe(false);
      expect(short.correctedPhone).toBeNull();

      const long = processInput(closed, { type: 'TEXT', text: '09123456789' });
      expect(long.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'excess' }]);
      expect(long.trackFollowUp).toBe(false);

      const invalidPrefix = processInput(closed, { type: 'TEXT', text: '0112345678' });
      expect(invalidPrefix.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'invalidPrefix' }]);
      expect(invalidPrefix.trackFollowUp).toBe(false);
    });
  });

  describe('feed/comment không kèm text hoặc không có số điện thoại (mục 5.3, AC8)', () => {
    it('first comment on NEW state -> AI_FREE_TEXT', () => {
      const result = processInput(newConversation(), { type: 'FEED_COMMENT' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
      expect(result.record.state).toBe('IN_PROGRESS');
    });

    it('comment on IN_PROGRESS state without phone -> sends AI_FREE_TEXT (AC8/AC9)', () => {
      const inProgress: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };
      const result = processInput(inProgress, { type: 'FEED_COMMENT' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FREE_TEXT' }]);
    });

    it('comment on CLOSED state -> replies AI_FOLLOWUP_CLOSED, không tạo lead mới (không còn im lặng tuyệt đối)', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'FEED_COMMENT', text: 'hoi lai' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FOLLOWUP_CLOSED' }]);
      expect(result.leadPhone).toBeNull();
      expect(result.trackFollowUp).toBe(true);
    });

    it('comment on CLOSED state kèm số điện thoại khác -> vẫn phát hiện correctedPhone giống kênh nhắn tin', () => {
      const closed: ConversationRecord = { state: 'CLOSED', phone: '0912345678', assignedStaff: 'A' };
      const result = processInput(closed, { type: 'FEED_COMMENT', text: 'sdt moi cua em la 0987654321' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_FOLLOWUP_CLOSED' }]);
      expect(result.correctedPhone).toBe('0987654321');
      expect(result.record.phone).toBe('0987654321');
    });
  });

  describe('feed/comment kèm số điện thoại ngay trong nội dung (mục 5.3, AC10)', () => {
    it('comment chứa số điện thoại hợp lệ -> chốt lead ngay, AI_PHONE_CONFIRMED, không có ý định nào khác trước đó', () => {
      const result = processInput(newConversation(), {
        type: 'FEED_COMMENT',
        text: 'chi cho em xin gia, sdt 0912345678 nhe',
      });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_PHONE_CONFIRMED' }]);
      expect(result.record.state).toBe('CLOSED');
      expect(result.leadPhone).toBe('0912345678');
    });

    it('comment chứa số điện thoại không hợp lệ -> AI_PHONE_INVALID tương ứng, không tác động Sheet', () => {
      const result = processInput(newConversation(), { type: 'FEED_COMMENT', text: 'sdt em 091234567' });
      expect(result.messagesToSend).toEqual([{ kind: 'AI_PHONE_INVALID', errorType: 'missing' }]);
      expect(result.leadPhone).toBeNull();
      expect(result.record.state).toBe('NEW');
    });
  });
  describe('quy tắc 3 mốc xin số điện thoại theo lượt tin nhắn (getPhoneCadence)', () => {
    it('Mốc 1 (Ngay lượt hỏi đầu tiên): cố định 3 bong bóng và xin số Zalo kèm tài liệu', () => {
      expect(getPhoneCadence(1, 'alo em')).toEqual({ askPhone: true, milestone: 1 });
    });

    it('lượt 2 đến lượt 5: chỉ giải đáp 1-2 câu, tuyệt đối không xin dồn dập (cờ tắt)', () => {
      expect(getPhoneCadence(2, 'dat o dau em')).toEqual({ askPhone: false });
      expect(getPhoneCadence(3, 'gia the nao em')).toEqual({ askPhone: false });
      expect(getPhoneCadence(4, 'duong vao rong bao nhieu')).toEqual({ askPhone: false });
      expect(getPhoneCadence(5, 'co gan cho khong em')).toEqual({ askPhone: false });
    });

    it('Mốc 2 (Tin nhắn thứ 6 của khách): lịch sự nhắc xin số lần thứ 2 nhẹ nhàng', () => {
      expect(getPhoneCadence(6, 'dien nuoc co san khong')).toEqual({ askPhone: true, milestone: 2 });
    });

    it('Mốc 3 (Từ tin thứ 7 trở đi - câu hỏi thường): tuyệt đối không xin dồn dập, cờ tắt', () => {
      expect(getPhoneCadence(7, 'khu nay dong dan cu khong')).toEqual({ askPhone: false });
      expect(getPhoneCadence(8, 'cach trung tam bao xa')).toEqual({ askPhone: false });
      expect(getPhoneCadence(9, 'xung quanh co truong hoc khong')).toEqual({ askPhone: false });
      expect(getPhoneCadence(10, 'co gan tram y te khong')).toEqual({ askPhone: false });
    });

    it('Mốc 3 (Từ tin thứ 7 trở đi - chu kỳ 4-5 lượt chat): bật cờ nhắc nhẹ ở lượt 11, 16', () => {
      expect(getPhoneCadence(11, 'hoi them chut nua')).toEqual({ askPhone: true, milestone: 3 });
      expect(getPhoneCadence(12, 'hoi tiep')).toEqual({ askPhone: false });
      expect(getPhoneCadence(16, 'hoi tiep lan nua')).toEqual({ askPhone: true, milestone: 3 });
    });

    it('Mốc 3 (Từ tin thứ 7 trở đi - khách hỏi sâu về thủ tục pháp lý, đặt cọc, xem đất thực tế): bật cờ xin số ngay', () => {
      expect(getPhoneCadence(7, 'thu tuc phap ly the nao em, co so do chua')).toEqual({ askPhone: true, milestone: 3 });
      expect(getPhoneCadence(8, 'muon dat coc giu cho thi lam the nao')).toEqual({ askPhone: true, milestone: 3 });
      expect(getPhoneCadence(9, 'cuoi tuan dan anh di xem dat thuc te nhe')).toEqual({ askPhone: true, milestone: 3 });
    });

    it('processInput tăng customerMessageCount chính xác khi được truyền vào', () => {
      const turn0: ConversationRecord = { state: 'NEW', phone: null, assignedStaff: null, customerMessageCount: 0 };
      const turn1 = processInput(turn0, { type: 'TEXT', text: 'alo em' });
      expect(turn1.record.customerMessageCount).toBe(1);

      const turn2 = processInput(turn1.record, { type: 'TEXT', text: 'dat o dau' });
      expect(turn2.record.customerMessageCount).toBe(2);

      const turn3 = processInput(turn2.record, { type: 'TEXT', text: 'cho anh gia' });
      expect(turn3.record.customerMessageCount).toBe(3);
    });
  });


  describe('Khống chế số intent trong messagesToSend (Chống nhồi nhét nhiều kịch bản cùng lúc)', () => {
    it('mọi nhánh trong processInput luôn trả về chính xác 1 intent duy nhất', () => {
      const rec = newConversation();
      
      const resText = processInput(rec, { type: 'TEXT', text: 'cho anh hỏi đất' });
      expect(resText.messagesToSend).toHaveLength(1);

      const resBtn = processInput(rec, { type: 'BUTTON', payload: 'BTN_PRICE' });
      expect(resBtn.messagesToSend).toHaveLength(1);

      const resPhone = processInput(rec, { type: 'TEXT', text: '0912345678' });
      expect(resPhone.messagesToSend).toHaveLength(1);

      const resInvalidPhone = processInput(rec, { type: 'TEXT', text: '0912345' });
      expect(resInvalidPhone.messagesToSend).toHaveLength(1);

      const closedRec: ConversationRecord = { ...rec, state: 'CLOSED', phone: '0912345678' };
      const resClosed = processInput(closedRec, { type: 'TEXT', text: 'alo bạn' });
      expect(resClosed.messagesToSend).toHaveLength(1);
    });
  });
});
