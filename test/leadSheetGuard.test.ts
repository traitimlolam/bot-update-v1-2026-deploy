/**
 * Mục 13 (mới): với mọi số điện thoại KHÔNG hợp lệ, sheetsService.appendLead() tuyệt đối
 * không được gọi. Test này spy trực tiếp appendLead ở tầng orchestration (runFlowTurn trong
 * webhook/facebook.ts) — nơi duy nhất trong hệ thống được phép gọi appendLead — để đảm bảo
 * hành vi thật, không chỉ suy luận từ flowEngine thuần.
 */
import { ConversationRecord } from '../src/flow/flowEngine';

jest.mock('../src/state/firestore', () => ({
  getConversation: jest.fn(),
  saveConversation: jest.fn().mockResolvedValue(undefined),
  touchFollowUpTracked: jest.fn().mockResolvedValue(undefined),
  updateAiHistory: jest.fn().mockResolvedValue(undefined),
  setLastCommentId: jest.fn().mockResolvedValue(undefined),
  logError: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: jest.fn().mockResolvedValue(undefined),
      })),
    })),
  })),
  withLock: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('../src/services/sheetsService', () => ({
  appendLead: jest.fn().mockResolvedValue('Lê Cường'),
  copyLeadToFollowUpSheet: jest.fn().mockResolvedValue(undefined),
  updateLeadPhoneAndCopyToFollowUpSheet: jest.fn().mockResolvedValue(undefined),
}));

// Mục 4.2: nhánh free text không có SĐT giờ gọi sang geminiService — mock để test không gọi API
// Gemini thật, tương tự cách sheetsService/firestore đã được mock ở trên.
jest.mock('../src/ai/geminiService', () => ({
  generateAiReply: jest.fn().mockResolvedValue('Đây là câu trả lời AI mẫu.'),
}));

import {
  getConversation,
  saveConversation,
  touchFollowUpTracked,
  updateAiHistory,
  setLastCommentId,
  logError,
} from '../src/state/firestore';
import {
  appendLead,
  copyLeadToFollowUpSheet,
  updateLeadPhoneAndCopyToFollowUpSheet,
} from '../src/services/sheetsService';
import { generateAiReply } from '../src/ai/geminiService';
import { runFlowTurn, handleFeedChange } from '../src/webhook/facebook';

const mockedGetConversation = getConversation as jest.Mock;
const mockedSaveConversation = saveConversation as jest.Mock;
const mockedTouchFollowUpTracked = touchFollowUpTracked as jest.Mock;
const mockedUpdateAiHistory = updateAiHistory as jest.Mock;
const mockedSetLastCommentId = setLastCommentId as jest.Mock;
const mockedLogError = logError as jest.Mock;
const mockedAppendLead = appendLead as jest.Mock;
const mockedCopyLeadToFollowUpSheet = copyLeadToFollowUpSheet as jest.Mock;
const mockedUpdateLeadPhoneAndCopyToFollowUpSheet = updateLeadPhoneAndCopyToFollowUpSheet as jest.Mock;
const mockedGenerateAiReply = generateAiReply as jest.Mock;

/** Giả lập Firestore Timestamp — chỉ cần `toMillis()` (đúng shape mà `isFollowUpDebounceElapsed` dùng). */
function timestampMinutesAgo(minutes: number): { toMillis(): number } {
  return { toMillis: () => Date.now() - minutes * 60 * 1000 };
}

const IN_PROGRESS: ConversationRecord = { state: 'IN_PROGRESS', phone: null, assignedStaff: null };

describe('runFlowTurn: appendLead chỉ được gọi khi số điện thoại chính xác hợp lệ (mục 7/8/13)', () => {
  beforeEach(() => {
    process.env.FB_PAGE_ACCESS_TOKEN = 'test_page_access_token';
    jest.clearAllMocks();
    mockedGetConversation.mockResolvedValue(IN_PROGRESS);
    mockedAppendLead.mockResolvedValue('Lê Cường');
    mockedGenerateAiReply.mockResolvedValue('Đây là câu trả lời AI mẫu.');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipient_id: 'RESOLVED_PSID' }),
      text: async () => '',
    }) as unknown as typeof fetch;
  });

  it.each([
    ['thiếu số (9 chữ số)', '091234567'],
    ['thừa số (11 chữ số)', '09123456789'],
    ['đúng 10 số nhưng sai đầu số', '0112345678'],
    ['không phải số điện thoại', 'anh chi cho hoi vi tri lo dat'],
  ])(
    '%s -> appendLead không được gọi (AC5)',
    async (_label, text) => {
      await runFlowTurn('PSID_TEST', { type: 'TEXT', text }, async () => 'Khách A');

      expect(mockedAppendLead).not.toHaveBeenCalled();
    },
    10000 // "không phải số điện thoại" trả về M1->M2->M3 thật (2s delay/tin, không mock timer) — nới
    // timeout để tránh flaky khi máy chạy chậm, thay vì chỉ vừa đủ sát ngưỡng mặc định 5000ms.
  );

  it('free text không có SĐT trên state IN_PROGRESS -> gọi generateAiReply đúng 1 lần và lưu lại aiHistory (mục 4.2)', async () => {
    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'duong o to may met vay em' }, async () => 'Khách A');

    expect(mockedGenerateAiReply).toHaveBeenCalledTimes(1);
    expect(mockedGenerateAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: { kind: 'AI_FREE_TEXT' },
        userText: 'duong o to may met vay em',
        history: [],
        customerName: 'Khách A',
      })
    );

    expect(mockedUpdateAiHistory).toHaveBeenCalledTimes(1);
    const [historyPsid, historyEntries] = mockedUpdateAiHistory.mock.calls[0];
    expect(historyPsid).toBe('PSID_TEST');
    expect(historyEntries).toEqual([
      { role: 'user', text: 'duong o to may met vay em' },
      { role: 'model', text: 'Đây là câu trả lời AI mẫu.' },
    ]);

    expect(mockedAppendLead).not.toHaveBeenCalled();
  });

  it('generateAiReply lỗi -> vẫn gửi tin cho khách (fallback M2), log lỗi, không im lặng (AC16)', async () => {
    mockedGenerateAiReply.mockRejectedValueOnce(new Error('Gemini timeout'));

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'quy hoach the nao em' }, async () => 'Khách A');

    expect(mockedLogError).toHaveBeenCalledWith('generateAiReply', expect.any(Error), expect.anything());

    // Vẫn gửi đủ 2 tin thật (fallback thay AI_REPLY, rồi M3) — không bỏ lượt, không im lặng.
    const sentTexts = (global.fetch as jest.Mock).mock.calls
      .map((c) => JSON.parse(c[1].body as string))
      .filter((body) => typeof body.message?.text === 'string')
      .map((body) => body.message.text as string);
    expect(sentTexts).toHaveLength(2);
    expect(sentTexts[0]).toContain('Hiện tại bên em đang có nhiều lô đất giá rẻ'); // nguyên văn M2 (fallback)
    expect(sentTexts[1]).toContain('nhắn em số zalo nhé'); // M3 vẫn được gửi bình thường (đại từ có thể đã được cá nhân hoá)

    expect(mockedUpdateAiHistory).toHaveBeenCalledTimes(1);
    const [, historyEntries] = mockedUpdateAiHistory.mock.calls[0];
    expect(historyEntries[1].text).toContain('Hiện tại bên em đang có nhiều lô đất giá rẻ');
  });

  it('số điện thoại chính xác hợp lệ qua tin nhắn Messenger -> appendLead được gọi đúng 1 lần, cột E = "Tin nhắn" (AC4/AC13)', async () => {
    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'sdt em 0912345678 nhe' }, async () => 'Khách A');

    expect(mockedAppendLead).toHaveBeenCalledTimes(1);
    expect(mockedAppendLead).toHaveBeenCalledWith({
      phone: '0912345678',
      customerName: 'Khách A',
      source: 'Tin nhắn',
    });

    const savedRecord = mockedSaveConversation.mock.calls[0][1] as ConversationRecord;
    expect(savedRecord.state).toBe('CLOSED');
    expect(savedRecord.phone).toBe('0912345678');
    expect(savedRecord.assignedStaff).toBe('Lê Cường');
  });

  it('số điện thoại hợp lệ ngay trong comment (PSID đã map) -> appendLead cột E = "Cmt" (mục 5.3, AC10/AC13)', async () => {
    await runFlowTurn(
      'PSID_TEST',
      { type: 'FEED_COMMENT', text: 'chi cho em xin sdt 0912345678 nhe' },
      async () => 'Khách A'
    );

    expect(mockedAppendLead).toHaveBeenCalledTimes(1);
    expect(mockedAppendLead).toHaveBeenCalledWith({
      phone: '0912345678',
      customerName: 'Khách A',
      source: 'Cmt',
    });
  });

  it('conversation đã CLOSED, khách gửi số điện thoại KHÁC số cũ -> không ghi lead mới, mà sửa lại số trên Sheet + copy sang "Hỏi lại" (mục 6, 8c)', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: '0912345678' }, async () => 'Khách A');

    expect(mockedAppendLead).not.toHaveBeenCalled();
    expect(mockedCopyLeadToFollowUpSheet).not.toHaveBeenCalled();
    expect(mockedUpdateLeadPhoneAndCopyToFollowUpSheet).toHaveBeenCalledTimes(1);
    expect(mockedUpdateLeadPhoneAndCopyToFollowUpSheet).toHaveBeenCalledWith('0987654321', '0912345678');

    const savedRecord = mockedSaveConversation.mock.calls[0][1] as ConversationRecord;
    expect(savedRecord.phone).toBe('0912345678');
    expect(savedRecord.state).toBe('CLOSED');
  });

  it('conversation đã CLOSED, khách gửi lại đúng số cũ -> chỉ copy nguyên trạng, không gọi hàm sửa số', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'sdt em van la 0987654321' }, async () => 'Khách A');

    expect(mockedUpdateLeadPhoneAndCopyToFollowUpSheet).not.toHaveBeenCalled();
    expect(mockedCopyLeadToFollowUpSheet).toHaveBeenCalledTimes(1);
    expect(mockedCopyLeadToFollowUpSheet).toHaveBeenCalledWith('0987654321');
  });

  it('conversation đã CLOSED, khách gõ số sai định dạng -> nhận đúng thông báo thiếu/thừa số, không đụng Sheet/Hỏi lại (mục 7 điểm 6)', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: '091234567' }, async () => 'Khách A');

    expect(mockedAppendLead).not.toHaveBeenCalled();
    expect(mockedCopyLeadToFollowUpSheet).not.toHaveBeenCalled();
    expect(mockedUpdateLeadPhoneAndCopyToFollowUpSheet).not.toHaveBeenCalled();
  });

  it('conversation đã CLOSED, khách nhắn lại -> gửi M7 và copy dòng lead cũ (theo SĐT đã ghi) sang tab "Hỏi lại" (mục 6 phiên bản mới)', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'anh hoi them chut nua' }, async () => 'Khách A');

    expect(mockedAppendLead).not.toHaveBeenCalled();
    expect(mockedCopyLeadToFollowUpSheet).toHaveBeenCalledTimes(1);
    expect(mockedCopyLeadToFollowUpSheet).toHaveBeenCalledWith('0987654321');
    expect(mockedTouchFollowUpTracked).toHaveBeenCalledWith('PSID_TEST');
  });

  it('conversation đã CLOSED, khách nhắn lại trong vòng 30 phút kể từ lần ghi "Hỏi lại" gần nhất -> KHÔNG ghi thêm dòng (debounce mới)', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
      lastFollowUpTrackedAt: timestampMinutesAgo(5),
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'anh hoi them chut nua' }, async () => 'Khách A');

    expect(mockedAppendLead).not.toHaveBeenCalled();
    expect(mockedCopyLeadToFollowUpSheet).not.toHaveBeenCalled();
    expect(mockedTouchFollowUpTracked).not.toHaveBeenCalled();
  });

  it('conversation đã CLOSED, khách nhắn lại sau khi đã quá 30 phút kể từ lần ghi "Hỏi lại" gần nhất -> ghi thêm 1 dòng mới', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
      lastFollowUpTrackedAt: timestampMinutesAgo(31),
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'anh hoi them chut nua' }, async () => 'Khách A');

    expect(mockedCopyLeadToFollowUpSheet).toHaveBeenCalledTimes(1);
    expect(mockedCopyLeadToFollowUpSheet).toHaveBeenCalledWith('0987654321');
    expect(mockedTouchFollowUpTracked).toHaveBeenCalledWith('PSID_TEST');
  });

  it('conversation đã CLOSED, khách SỬA số điện thoại dù mới ghi "Hỏi lại" cách đây vài phút -> vẫn ghi ngay, không bị debounce chặn', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: '0987654321',
      assignedStaff: 'Trần Thị B',
      lastFollowUpTrackedAt: timestampMinutesAgo(5),
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: '0912345678' }, async () => 'Khách A');

    expect(mockedAppendLead).not.toHaveBeenCalled();
    expect(mockedUpdateLeadPhoneAndCopyToFollowUpSheet).toHaveBeenCalledTimes(1);
    expect(mockedUpdateLeadPhoneAndCopyToFollowUpSheet).toHaveBeenCalledWith('0987654321', '0912345678');
    expect(mockedTouchFollowUpTracked).toHaveBeenCalledWith('PSID_TEST');
  });

  it('conversation đã CLOSED nhưng lỡ chưa có số điện thoại lưu -> không gọi copyLeadToFollowUpSheet', async () => {
    mockedGetConversation.mockResolvedValue({
      state: 'CLOSED',
      phone: null,
      assignedStaff: 'Trần Thị B',
    });

    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'anh hoi them chut nua' }, async () => 'Khách A');

    expect(mockedCopyLeadToFollowUpSheet).not.toHaveBeenCalled();
  });

  it('handleFeedChange bỏ qua comment của chính Fanpage (from.id === pageId), không gửi tin hay ghi Sheet', async () => {
    await handleFeedChange(
      {
        item: 'comment',
        verb: 'add',
        comment_id: 'CMT_PAGE',
        from: { id: 'PAGE_123', name: 'Trang BĐS' },
        message: 'Hotline công ty 0912345678',
      },
      'PAGE_123'
    );

    expect(mockedAppendLead).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('runFlowTurn với overrideRecipient ({ comment_id }) -> gửi tin nhắn tới comment_id thay vì psid (tránh lỗi 551)', async () => {
    await runFlowTurn(
      'PSID_TEST',
      { type: 'FEED_COMMENT', text: 'cho em hoi gia' },
      async () => 'Khách A',
      { comment_id: 'CMT_456' }
    );

    expect(global.fetch).toHaveBeenCalled();
    const calls = (global.fetch as jest.Mock).mock.calls;
    const sentBodies = calls.map((c) => JSON.parse(c[1].body as string));
    for (const body of sentBodies) {
      expect(body.recipient).toEqual({ comment_id: 'CMT_456' });
    }
  });

  it('runFlowTurn từ 1 lượt bình luận -> lưu lại lastCommentId để reminderService dùng {comment_id} sau này (mục 5.3/5.4)', async () => {
    await runFlowTurn(
      'PSID_TEST',
      { type: 'FEED_COMMENT', text: 'cho em hoi gia' },
      async () => 'Khách A',
      { comment_id: 'CMT_456' }
    );

    expect(mockedSetLastCommentId).toHaveBeenCalledWith('PSID_TEST', 'CMT_456');
  });

  it('runFlowTurn từ 1 lượt nhắn tin trực tiếp -> xoá lastCommentId về null (đã chứng minh {id} gửi được)', async () => {
    await runFlowTurn('PSID_TEST', { type: 'TEXT', text: 'cho em hoi gia' }, async () => 'Khách A');

    expect(mockedSetLastCommentId).toHaveBeenCalledWith('PSID_TEST', null);
  });

  it('handleFeedChange sau khi xử lý comment xong -> tự động gọi Graph API ẩn comment (is_hidden=true)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recipient_id: 'RESOLVED_PSID' }),
      text: async () => '',
    });

    await handleFeedChange({
      item: 'comment',
      verb: 'add',
      comment_id: 'CMT_USER_123',
      from: { id: 'USER_123', name: 'Nguyễn Văn A' },
      message: 'Inbox em nhé 0912345678',
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const hideCall = calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('CMT_USER_123') && c[0].includes('is_hidden=true')
    );
    expect(hideCall).toBeDefined();
    expect(hideCall[1]?.method).toBe('POST');
  });
});
