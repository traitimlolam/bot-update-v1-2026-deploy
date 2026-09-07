import {
  getVietnamDateRange,
  LAND_TOUR_REMINDER_TEMPLATE,
  runDailyReminderSweep,
} from '../src/services/reminderService';
import { formatPersonalizedMessage } from '../src/utils/genderDetector';
import {
  getConversation,
  getDb,
  updateConversationReminder,
  withLock,
} from '../src/state/firestore';
import { sendText } from '../src/webhook/facebook';

jest.mock('../src/state/firestore', () => ({
  getConversation: jest.fn(),
  updateConversationReminder: jest.fn().mockResolvedValue(undefined),
  logError: jest.fn().mockResolvedValue(undefined),
  withLock: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  getDb: jest.fn(),
}));

jest.mock('../src/webhook/facebook', () => ({
  sendText: jest.fn().mockResolvedValue('msg_123'),
  sendTypingOn: jest.fn().mockResolvedValue(undefined),
}));

const mockedGetConversation = getConversation as jest.Mock;
const mockedUpdateConversationReminder = updateConversationReminder as jest.Mock;
const mockedSendText = sendText as jest.Mock;
const mockedGetDb = getDb as jest.Mock;
const mockedWithLock = withLock as jest.Mock;

describe('reminderService: Rà soát & gửi tin nhắn nhắc lúc 20h hàng ngày', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.FB_PAGE_ACCESS_TOKEN = 'test_token';
    process.env.FB_PAGE_ID = 'PAGE_123';
    jest.clearAllMocks();

    const { windowStart, windowEnd } = getVietnamDateRange();
    const midWindowTime = new Date((windowStart.getTime() + windowEnd.getTime()) / 2).toISOString();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 't_1',
            updated_time: midWindowTime,
            participants: {
              data: [
                { id: 'PSID_MALE', name: 'Nguyễn Trọng Hiếu' },
                { id: 'PAGE_123', name: 'Fanpage' },
              ],
            },
          },
          {
            id: 't_2',
            updated_time: midWindowTime,
            participants: {
              data: [
                { id: 'PSID_FEMALE', name: 'Trần Hương' },
                { id: 'PAGE_123', name: 'Fanpage' },
              ],
            },
          },
          {
            id: 't_3',
            updated_time: midWindowTime,
            participants: {
              data: [
                { id: 'PSID_CLOSED', name: 'Đình Thiệu' },
                { id: 'PAGE_123', name: 'Fanpage' },
              ],
            },
          },
          {
            id: 't_4',
            updated_time: midWindowTime,
            participants: {
              data: [
                { id: 'PSID_ALREADY_SENT', name: 'Bay Nguyen' },
                { id: 'PAGE_123', name: 'Fanpage' },
              ],
            },
          },
          {
            id: 't_outside_window',
            // Tin nhắn lúc 19:50 hôm trước (ngoài khung 20h01)
            updated_time: new Date(windowStart.getTime() - 600000).toISOString(),
            participants: {
              data: [
                { id: 'PSID_OUTSIDE', name: 'Khách Cũ' },
                { id: 'PAGE_123', name: 'Fanpage' },
              ],
            },
          },
        ],
      }),
      text: async () => '',
    }) as unknown as typeof fetch;

    mockedGetDb.mockReturnValue({
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            docs: [],
          }),
        }),
      }),
    });
  });

  describe('getVietnamDateRange', () => {
    it('tính toán chính xác ngày, giờ và khung 20h01 hôm trước đến 20h00 hôm nay theo giờ VN (UTC+7)', () => {
      // 13:00 UTC ngày 2026-09-03 = 20:00 VN ngày 2026-09-03
      const testUtc = new Date('2026-09-03T13:00:00.000Z');
      const range = getVietnamDateRange(testUtc);

      expect(range.todayStr).toBe('2026-09-03');
      expect(range.vnHours).toBe(20);
      expect(range.vnMinutes).toBe(0);
      expect(range.startOfToday.toISOString()).toBe('2026-09-02T17:00:00.000Z');
      expect(range.endOfToday.toISOString()).toBe('2026-09-03T16:59:59.999Z');

      // 20h01 hôm trước (2026-09-02 20:01:00 VN) = 2026-09-02 13:01:00 UTC
      expect(range.windowStart.toISOString()).toBe('2026-09-02T13:01:00.000Z');
      // 20h00 hôm nay (2026-09-03 20:00:00 VN) = 2026-09-03 13:00:00 UTC
      expect(range.windowEnd.toISOString()).toBe('2026-09-03T13:00:00.000Z');
    });
  });

  describe('Personalization câu nhắc xe đưa đón', () => {
    it('cá nhân hoá đại từ phù hợp theo giới tính (Nam / Nữ / Họ tên đầy đủ)', () => {
      expect(formatPersonalizedMessage(LAND_TOUR_REMINDER_TEMPLATE, 'Nguyễn Trọng Hiếu')).toBe(
        'Thứ 7 này em có xe đưa đón xem đất miễn phí, anh có đi được không ạ?'
      );
      expect(formatPersonalizedMessage(LAND_TOUR_REMINDER_TEMPLATE, 'Lê Thị Chung')).toBe(
        'Thứ 7 này em có xe đưa đón xem đất miễn phí, chị có đi được không ạ?'
      );
      expect(formatPersonalizedMessage(LAND_TOUR_REMINDER_TEMPLATE, 'Bay Nguyen')).toBe(
        'Thứ 7 này em có xe đưa đón xem đất miễn phí, Bay Nguyen có đi được không ạ?'
      );
      expect(formatPersonalizedMessage(LAND_TOUR_REMINDER_TEMPLATE, null)).toBe(
        'Thứ 7 này em có xe đưa đón xem đất miễn phí, anh/chị có đi được không ạ?'
      );
    });
  });

  describe('runDailyReminderSweep', () => {
    it('chỉ gửi tin cho khách chưa cho SĐT trong ngày, bỏ qua khách CLOSED hoặc đã gửi', async () => {
      const { todayStr } = getVietnamDateRange();

      mockedGetConversation.mockImplementation(async (psid: string) => {
        if (psid === 'PSID_MALE') {
          return { state: 'IN_PROGRESS', phone: null, customerName: 'Nguyễn Trọng Hiếu' };
        }
        if (psid === 'PSID_FEMALE') {
          return { state: 'NEW', phone: null, customerName: 'Trần Hương' };
        }
        if (psid === 'PSID_CLOSED') {
          return { state: 'CLOSED', phone: '0987654321', customerName: 'Đình Thiệu' };
        }
        if (psid === 'PSID_ALREADY_SENT') {
          return {
            state: 'IN_PROGRESS',
            phone: null,
            customerName: 'Bay Nguyen',
            lastReminderSentDate: todayStr,
          };
        }
        return null;
      });

      const result = await runDailyReminderSweep();

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(2); // PSID_MALE và PSID_FEMALE
      expect(result.skippedCount).toBe(2); // PSID_CLOSED và PSID_ALREADY_SENT

      // Kiểm tra tin nhắn gửi cho PSID_MALE (Nam -> anh)
      expect(mockedSendText).toHaveBeenCalledWith(
        { id: 'PSID_MALE' },
        'Thứ 7 này em có xe đưa đón xem đất miễn phí, anh có đi được không ạ?'
      );

      // Kiểm tra tin nhắn gửi cho PSID_FEMALE (Nữ -> chị)
      expect(mockedSendText).toHaveBeenCalledWith(
        { id: 'PSID_FEMALE' },
        'Thứ 7 này em có xe đưa đón xem đất miễn phí, chị có đi được không ạ?'
      );

      // Đảm bảo updateConversationReminder được gọi lưu ngày đã gửi
      expect(mockedUpdateConversationReminder).toHaveBeenCalledWith('PSID_MALE', {
        state: 'IN_PROGRESS',
        phone: null,
        customerName: 'Nguyễn Trọng Hiếu',
        lastReminderSentDate: todayStr,
      });
      expect(mockedUpdateConversationReminder).toHaveBeenCalledWith('PSID_FEMALE', {
        state: 'NEW',
        phone: null,
        customerName: 'Trần Hương',
        lastReminderSentDate: todayStr,
      });

      // Tuyệt đối không gửi cho PSID_CLOSED hay PSID_ALREADY_SENT
      expect(mockedSendText).not.toHaveBeenCalledWith({ id: 'PSID_CLOSED' }, expect.any(String));
      expect(mockedSendText).not.toHaveBeenCalledWith({ id: 'PSID_ALREADY_SENT' }, expect.any(String));
    });

    it('dùng CHUNG 1 khoá theo ngày dù chạy force hay không, để 2 sweep không bao giờ chạy song song', async () => {
      mockedGetConversation.mockResolvedValue(null);
      const { todayStr } = getVietnamDateRange();

      await runDailyReminderSweep();
      await runDailyReminderSweep({ force: true });

      const dailySweepLockKeys = mockedWithLock.mock.calls
        .map((call) => call[0] as string)
        .filter((key) => key.startsWith('dailyReminderSweep:'));

      expect(dailySweepLockKeys).toEqual([
        `dailyReminderSweep:${todayStr}`,
        `dailyReminderSweep:${todayStr}`,
      ]);
    });
  });
});
