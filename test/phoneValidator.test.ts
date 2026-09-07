import { checkPhone } from '../src/flow/phoneValidator';

describe('phoneValidator.checkPhone', () => {
  it('returns valid:false, errorType:null when there is no long digit run (normal chat text)', () => {
    expect(checkPhone('em chào anh chị')).toEqual({ valid: false, normalizedPhone: null, errorType: null });
    expect(checkPhone('giá 200tr nhé anh')).toEqual({ valid: false, normalizedPhone: null, errorType: null });
    expect(checkPhone('con số 1234567 thôi')).toEqual({ valid: false, normalizedPhone: null, errorType: null }); // 7 digits, dưới ngưỡng 8
  });

  it('accepts a valid 10-digit Vietnamese mobile number', () => {
    const result = checkPhone('sdt em la 0912345678 nhe');
    expect(result).toEqual({ valid: true, normalizedPhone: '0912345678', errorType: null });
  });

  it.each(['03', '05', '07', '08', '09'])('accepts valid prefix %s', (prefix) => {
    const phone = `${prefix}12345678`;
    expect(checkPhone(phone).valid).toBe(true);
  });

  it('flags a 9-digit number as errorType "missing" (thiếu số) and valid=false', () => {
    const result = checkPhone('0912345678'.slice(0, 9));
    expect(result.valid).toBe(false);
    expect(result.errorType).toBe('missing');
  });

  it('flags an 11-digit number as errorType "excess" (thừa số) and valid=false', () => {
    const result = checkPhone('09123456789');
    expect(result.valid).toBe(false);
    expect(result.errorType).toBe('excess');
  });

  it('flags a 10-digit number with invalid prefix as errorType "invalidPrefix" and valid=false', () => {
    const result = checkPhone('0112345678');
    expect(result.valid).toBe(false);
    expect(result.errorType).toBe('invalidPrefix');
  });

  it('normalizes +84 country code to leading 0', () => {
    const result = checkPhone('lien he +84912345678 giup em');
    expect(result).toEqual({ valid: true, normalizedPhone: '0912345678', errorType: null });
  });

  it('normalizes 84 country code (no plus) to leading 0', () => {
    const result = checkPhone('84912345678');
    expect(result).toEqual({ valid: true, normalizedPhone: '0912345678', errorType: null });
  });

  it('strips spaces and dashes before validating', () => {
    expect(checkPhone('091-234-5678').valid).toBe(true);
    expect(checkPhone('091 234 5678').valid).toBe(true);
    expect(checkPhone('0912.345.678').valid).toBe(true);
  });

  it('does not misfire on short numeric mentions under 8 digits', () => {
    expect(checkPhone('gia 2000000 dong')).toEqual({ valid: false, normalizedPhone: null, errorType: null });
  });

  it('prefers a genuinely valid phone number over an earlier unrelated long digit run (address/unit code)', () => {
    const result = checkPhone('toà B, mã căn 20345678, sđt em là 0912345678 nhé');
    expect(result).toEqual({ valid: true, normalizedPhone: '0912345678', errorType: null });
  });

  it('does not merge two unrelated digit runs separated by only a plain space into 1 bogus candidate', () => {
    const result = checkPhone('so nha 20345678 sdt 0912345678');
    expect(result).toEqual({ valid: true, normalizedPhone: '0912345678', errorType: null });
  });

  it('recognizes a valid phone typed twice separated by a space as still valid (not merged into garbage)', () => {
    const result = checkPhone('0912345678 0912345678');
    expect(result).toEqual({ valid: true, normalizedPhone: '0912345678', errorType: null });
  });

  it('falls back to the first candidate for error classification when no candidate validates', () => {
    const result = checkPhone('mã căn 20345678, số nhà 0112345678');
    expect(result.valid).toBe(false);
    expect(result.normalizedPhone).toBe('20345678');
    expect(result.errorType).toBe('missing');
  });

  it('never returns valid=true together with a non-null errorType', () => {
    const cases = ['0912345678', '091234567', '09123456789', '0112345678', 'khong co so dien thoai'];
    for (const text of cases) {
      const result = checkPhone(text);
      if (result.valid) {
        expect(result.errorType).toBeNull();
      }
    }
  });
});
