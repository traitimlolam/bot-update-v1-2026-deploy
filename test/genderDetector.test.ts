import {
  analyzeVietnameseName,
  formatPersonalizedMessage,
  removeVietnameseTones,
  detectGenderFromText,
  detectGenderFromAvatar,
  determineCustomerGender,
} from '../src/utils/genderDetector';

describe('genderDetector', () => {
  describe('removeVietnameseTones', () => {
    it('bỏ đúng dấu tiếng Việt và chuyển đ/Đ thành d/D', () => {
      expect(removeVietnameseTones('Nguyễn Trọng Hiếu')).toBe('Nguyen Trong Hieu');
      expect(removeVietnameseTones('Đình Thiệu')).toBe('Dinh Thieu');
      expect(removeVietnameseTones('Trần Thu Thuỷ')).toBe('Tran Thu Thuy');
    });
  });

  describe('detectGenderFromText', () => {
    it('bắt chính xác đại từ tự xưng Nam (Anh)', () => {
      expect(detectGenderFromText('Anh muốn hỏi lô 100m2 giá bao nhiêu?')).toBe('MALE');
      expect(detectGenderFromText('Báo giá anh nhé em')).toBe('MALE');
      expect(detectGenderFromText('cho anh xin thông tin')).toBe('MALE');
      expect(detectGenderFromText('anh dang can tim dat ven do')).toBe('MALE');
      expect(detectGenderFromText('Zalo anh là 0912345678')).toBe('MALE');
      expect(detectGenderFromText('Anh đây em')).toBe('MALE');
    });

    it('bắt chính xác đại từ tự xưng Nữ (Chị)', () => {
      expect(detectGenderFromText('Chị muốn xem sổ đỏ lô này')).toBe('FEMALE');
      expect(detectGenderFromText('Gửi chị bảng giá chi tiết nhé')).toBe('FEMALE');
      expect(detectGenderFromText('cho chi hoi gia bao nhieu')).toBe('FEMALE');
      expect(detectGenderFromText('Chi can xem phap ly')).toBe('FEMALE');
      expect(detectGenderFromText('Sđt chị là 0987654321')).toBe('FEMALE');
      expect(detectGenderFromText('Chị nhé em')).toBe('FEMALE');
    });

    it('không có từ tự xưng rõ ràng -> UNKNOWN', () => {
      expect(detectGenderFromText('Dự án ở đâu vậy em?')).toBe('UNKNOWN');
      expect(detectGenderFromText('Bao nhieu tien mot lo?')).toBe('UNKNOWN');
      expect(detectGenderFromText(null)).toBe('UNKNOWN');
      expect(detectGenderFromText('')).toBe('UNKNOWN');
    });
  });

  describe('analyzeVietnameseName', () => {
    it('nhận diện chính xác tên Nam (có dấu và không dấu)', () => {
      expect(analyzeVietnameseName('Nguyễn Trọng Hiếu')).toEqual({
        gender: 'MALE',
        callName: 'Hiếu',
      });
      expect(analyzeVietnameseName('Đình Thiệu')).toEqual({
        gender: 'MALE',
        callName: 'Thiệu',
      });
      expect(analyzeVietnameseName('Dương Hữu Công')).toEqual({
        gender: 'MALE',
        callName: 'Công',
      });
      expect(analyzeVietnameseName('Nguyen Van Tuan')).toEqual({
        gender: 'MALE',
        callName: 'Tuan',
      });
      expect(analyzeVietnameseName('Thành Long')).toEqual({
        gender: 'MALE',
        callName: 'Long',
      });
    });

    it('nhận diện chính xác tên Nữ (có đệm Thị hoặc tên nữ đặc trưng)', () => {
      expect(analyzeVietnameseName('Lê Thị Chung')).toEqual({
        gender: 'FEMALE',
        callName: 'Chung',
      });
      expect(analyzeVietnameseName('Trần Hương')).toEqual({
        gender: 'FEMALE',
        callName: 'Hương',
      });
      expect(analyzeVietnameseName('Nguyễn Trà My')).toEqual({
        gender: 'FEMALE',
        callName: 'My',
      });
      expect(analyzeVietnameseName('Hồng Hằng')).toEqual({
        gender: 'FEMALE',
        callName: 'Hằng',
      });
      expect(analyzeVietnameseName('Lan Nguyen')).toEqual({
        gender: 'FEMALE',
        callName: 'Lan',
      });
      expect(analyzeVietnameseName('Nguyễn Thị Khiêm')).toEqual({
        gender: 'FEMALE',
        callName: 'Khiêm',
      });
    });

    it('tên không rõ giới tính (trung tính hoặc nước ngoài) -> UNKNOWN kèm callName', () => {
      expect(analyzeVietnameseName('Bay Nguyen')).toEqual({
        gender: 'UNKNOWN',
        callName: 'Bay',
      });
      expect(analyzeVietnameseName('Bình')).toEqual({
        gender: 'UNKNOWN',
        callName: 'Bình',
      });
      expect(analyzeVietnameseName('Alex')).toEqual({
        gender: 'UNKNOWN',
        callName: 'Alex',
      });
      // Danh sách 11 tên trung tính theo chỉ thị kỹ thuật:
      const neutralNames = ['Anh', 'Bình', 'Hà', 'Giang', 'Khánh', 'Minh', 'Thanh', 'Dương', 'Tú', 'An', 'Quý'];
      for (const n of neutralNames) {
        expect(analyzeVietnameseName(n).gender).toBe('UNKNOWN');
      }
      // Tên trung tính nhưng có tên đệm rõ ràng:
      expect(analyzeVietnameseName('Nguyễn Thị Hà').gender).toBe('FEMALE');
      expect(analyzeVietnameseName('Trần Văn Minh').gender).toBe('MALE');
    });

    it('kết hợp ngữ cảnh tin nhắn (contextText) giải quyết tên trung tính hoặc không rõ', () => {
      expect(analyzeVietnameseName('Bình', 'Anh muốn xem sổ đỏ')).toEqual({
        gender: 'MALE',
        callName: 'Bình',
      });
      expect(analyzeVietnameseName('Bay Nguyen', 'Gửi chị bảng giá nhé')).toEqual({
        gender: 'FEMALE',
        callName: 'Bay',
      });
      expect(analyzeVietnameseName(null, 'Anh hỏi giá')).toEqual({
        gender: 'MALE',
        callName: '',
      });
    });

    it('trường hợp null, undefined hoặc rỗng -> UNKNOWN', () => {
      expect(analyzeVietnameseName(null)).toEqual({ gender: 'UNKNOWN', callName: '' });
      expect(analyzeVietnameseName(undefined)).toEqual({ gender: 'UNKNOWN', callName: '' });
      expect(analyzeVietnameseName('')).toEqual({ gender: 'UNKNOWN', callName: '' });
      expect(analyzeVietnameseName('   ')).toEqual({ gender: 'UNKNOWN', callName: '' });
    });
  });

  describe('formatPersonalizedMessage', () => {
    it('thay "Anh/chị" thành "Anh", "anh/chị" thành "anh" đối với khách Nam', () => {
      const template1 = 'Em chào anh/chị.';
      const template3 = 'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.';
      const template5 = 'Anh/Chị chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với anh chị ngay đây ạ.';

      expect(formatPersonalizedMessage(template1, 'Nguyễn Trọng Hiếu')).toBe('Em chào anh.');
      expect(formatPersonalizedMessage(template3, 'Nguyễn Trọng Hiếu')).toBe(
        'Anh nhắn em số zalo nhé. Em gửi vị trí anh tham khảo ạ.'
      );
      expect(formatPersonalizedMessage(template5, 'Đình Thiệu')).toBe(
        'Anh chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với anh ngay đây ạ.'
      );
    });

    it('thay "Anh/chị" thành "Chị", "anh/chị" thành "chị" đối với khách Nữ', () => {
      const template1 = 'Em chào anh/chị.';
      const template3 = 'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.';
      const template5 = 'Anh/Chị chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với anh chị ngay đây ạ.';

      expect(formatPersonalizedMessage(template1, 'Trần Hương')).toBe('Em chào chị.');
      expect(formatPersonalizedMessage(template3, 'Lê Thị Chung')).toBe(
        'Chị nhắn em số zalo nhé. Em gửi vị trí chị tham khảo ạ.'
      );
      expect(formatPersonalizedMessage(template5, 'Nguyễn Trà My')).toBe(
        'Chị chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với chị ngay đây ạ.'
      );
    });

    it('giữ nguyên "Anh/chị"/"anh/chị", tuyệt đối không gọi cộc lốc bằng tên riêng khi không xác định được giới tính', () => {
      const template1 = 'Em chào anh/chị.';
      const template3 = 'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.';
      const template5 = 'Anh/Chị chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với anh chị ngay đây ạ.';

      expect(formatPersonalizedMessage(template1, 'Bay Nguyen')).toBe('Em chào anh/chị.');
      expect(formatPersonalizedMessage(template3, 'Bay Nguyen')).toBe(
        'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.'
      );
      expect(formatPersonalizedMessage(template5, 'Bay Nguyen')).toBe(
        'Anh/Chị chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với anh/chị ngay đây ạ.'
      );

      expect(formatPersonalizedMessage(template1, 'Bình')).toBe('Em chào anh/chị.');
      expect(formatPersonalizedMessage(template3, 'Bình')).toBe(
        'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.'
      );
    });

    it('tên trung tính nhưng có contextText tự xưng -> xưng hô chính xác', () => {
      const template = 'Em chào anh/chị.';
      expect(formatPersonalizedMessage(template, 'Bình', 'Anh hỏi giá')).toBe('Em chào anh.');
      expect(formatPersonalizedMessage(template, 'Bay Nguyen', 'Chị cần xem')).toBe('Em chào chị.');
    });

    it('giữ nguyên template ban đầu khi không có tên khách (null / rỗng)', () => {
      const template1 = 'Em chào anh/chị.';
      const template3 = 'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.';

      expect(formatPersonalizedMessage(template1, null)).toBe('Em chào anh/chị.');
      expect(formatPersonalizedMessage(template3, '')).toBe(
        'Anh/chị nhắn em số zalo nhé. Em gửi vị trí anh/chị tham khảo ạ.'
      );
    });
  });

  describe('detectGenderFromAvatar', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('nhận diện NAM từ kết quả của Vision AI -> MALE', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'NAM' } }],
        }),
      } as Response);

      const result = await detectGenderFromAvatar('https://example.com/avatar.jpg');
      expect(result).toBe('MALE');
    });

    it('nhận diện NU từ kết quả của Vision AI -> FEMALE', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'NU' } }],
        }),
      } as Response);

      const result = await detectGenderFromAvatar('https://example.com/avatar.jpg');
      expect(result).toBe('FEMALE');
    });

    it('Vision AI trả về KHONG_RO -> UNKNOWN', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'KHONG_RO' } }],
        }),
      } as Response);

      const result = await detectGenderFromAvatar('https://example.com/avatar.jpg');
      expect(result).toBe('UNKNOWN');
    });

    it('URL rỗng hoặc không hợp lệ -> UNKNOWN ngay lập tức mà không gọi fetch', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      expect(await detectGenderFromAvatar(null)).toBe('UNKNOWN');
      expect(await detectGenderFromAvatar('')).toBe('UNKNOWN');
      expect(await detectGenderFromAvatar('invalid-url')).toBe('UNKNOWN');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('Fetch bị lỗi mạng hoặc timeout -> fallback an toàn về UNKNOWN', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

      const result = await detectGenderFromAvatar('https://example.com/avatar.jpg');
      expect(result).toBe('UNKNOWN');
    });
  });

  describe('determineCustomerGender (Kết hợp Bộ lọc tên + Avatar Vision)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('ưu tiên khách tự xưng trong tin nhắn (TEXT)', async () => {
      const result = await determineCustomerGender({
        customerName: 'Bình',
        contextText: 'Anh muốn xem sổ đỏ',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      expect(result.gender).toBe('MALE');
      expect(result.source).toBe('TEXT');
      expect(result.callName).toBe('Bình');
    });

    it('bộ lọc tên xác định rõ ràng Nam -> MALE (NAME)', async () => {
      const result = await determineCustomerGender({
        customerName: 'Nguyễn Trọng Hiếu',
      });
      expect(result.gender).toBe('MALE');
      expect(result.source).toBe('NAME');
      expect(result.callName).toBe('Hiếu');
    });

    it('bộ lọc tên xác định rõ ràng Nữ -> FEMALE (NAME)', async () => {
      const result = await determineCustomerGender({
        customerName: 'Trần Thị Mai',
      });
      expect(result.gender).toBe('FEMALE');
      expect(result.source).toBe('NAME');
      expect(result.callName).toBe('Mai');
    });

    it('Tầng 1 (tên) đã xác định rõ ràng -> KHÔNG gọi sang Tầng 2 (avatar), kể cả khi avatar mâu thuẫn', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'NU' } }] }),
      } as Response);
      global.fetch = mockFetch;

      const result = await determineCustomerGender({
        customerName: 'Nguyễn Trọng Hiếu',
        avatarUrl: 'https://example.com/avatar_conflicting.jpg',
      });
      expect(result.gender).toBe('MALE');
      expect(result.source).toBe('NAME');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('tên trung tính (Bình) kết hợp Avatar Nam -> MALE (AVATAR)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'NAM' } }],
        }),
      } as Response);

      const result = await determineCustomerGender({
        customerName: 'Bình',
        avatarUrl: 'https://example.com/avatar_male.jpg',
      });
      expect(result.gender).toBe('MALE');
      expect(result.source).toBe('AVATAR');
      expect(result.callName).toBe('Bình');
    });

    it('nickname (Mèo Béo) kết hợp Avatar Nữ -> FEMALE (AVATAR)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'NU' } }],
        }),
      } as Response);

      const result = await determineCustomerGender({
        customerName: 'Mèo Béo',
        avatarUrl: 'https://example.com/avatar_female.jpg',
      });
      expect(result.gender).toBe('FEMALE');
      expect(result.source).toBe('AVATAR');
    });

    it('tên trung tính + avatar là ảnh phong cảnh (KHONG_RO) -> UNKNOWN (DEFAULT)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'KHONG_RO' } }],
        }),
      } as Response);

      const result = await determineCustomerGender({
        customerName: 'Bình',
        avatarUrl: 'https://example.com/landscape.jpg',
      });
      expect(result.gender).toBe('UNKNOWN');
      expect(result.source).toBe('DEFAULT');
    });

    it('isSilhouette = true (avatar mặc định Facebook) -> không gọi fetch, trả về kết quả theo tên', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const result = await determineCustomerGender({
        customerName: 'Bình',
        avatarUrl: 'https://example.com/default.jpg',
        isSilhouette: true,
      });
      expect(result.gender).toBe('UNKNOWN');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('formatPersonalizedMessage với knownGender', () => {
    it('áp dụng knownGender = MALE bỏ qua tên trung tính', () => {
      const template = 'Em chào anh/chị.';
      expect(formatPersonalizedMessage(template, 'Bình', null, 'MALE')).toBe('Em chào anh.');
    });

    it('áp dụng knownGender = FEMALE bỏ qua tên trung tính', () => {
      const template = 'Em chào anh/chị.';
      expect(formatPersonalizedMessage(template, 'Bình', null, 'FEMALE')).toBe('Em chào chị.');
    });
  });
});
