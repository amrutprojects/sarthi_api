import { appConfig } from '../../../src/config/app.config';
import { edpSms, otpSmsText, smsAccepted } from '../../../src/modules/students/edp/edp.sms';

describe('EDP OTP SMS', () => {
  it('fills the code and the validity (in whole minutes, at least 1) into the template', () => {
    expect(otpSmsText('725319', 300)).toContain('725319');
    expect(otpSmsText('725319', 60)).toContain('60 seconds');
    expect(otpSmsText('725319', 300)).toContain('300 seconds');
    expect(otpSmsText('725319', 300)).not.toMatch(/[{}]/);
  });

  describe('smsAccepted', () => {
    it.each([
      [200, '{"type":"success","message":"3a4b5c"}', true],
      [200, '{"status":"OK"}', true],
      [200, '{"type":"error","message":"Invalid template"}', false],
      [200, 'Message submitted successfully, id 998877', true],
      [200, 'ERR: Insufficient balance', false],
      [200, '', false],
      [500, '{"type":"success"}', false],
      [403, 'ok', false],
    ])('status %s, body %j → %s', (status, body, expected) => {
      expect(smsAccepted(status, body)).toBe(expected);
    });
  });

  describe('sendOtp', () => {
    const sms = appConfig.edp.sms as { authKey?: string; sender?: string; templateId?: string };
    const saved = { ...sms };
    afterEach(() => {
      Object.assign(sms, saved);
      jest.restoreAllMocks();
    });
    const configure = () => Object.assign(sms, { authKey: 'k3y', sender: 'SMGTCH', templateId: '1207174427425038676' });

    it('calls the gateway with the mobile, message, sender, route, country and DLT template', async () => {
      configure();
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"type":"success"}', { status: 200 }));
      await edpSms.sendOtp('9876543210', '123456', 300);
      const url = new URL(String(fetchMock.mock.calls[0][0]));
      expect(url.searchParams.get('mobiles')).toBe('9876543210');
      expect(url.searchParams.get('message')).toContain('123456');
      expect(url.searchParams.get('sender')).toBe('SMGTCH');
      expect(url.searchParams.get('DLT_TE_ID')).toBe('1207174427425038676');
      expect(url.searchParams.get('country')).toBe('91');
      expect(url.searchParams.get('authkey')).toBe('k3y');
    });

    it('answers 503 SMS_UNAVAILABLE when the gateway rejects the message or cannot be reached', async () => {
      configure();
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('{"type":"error"}', { status: 200 }));
      await expect(edpSms.sendOtp('9876543210', '123456', 300)).rejects.toMatchObject({ statusCode: 503, code: 'SMS_UNAVAILABLE' });
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(edpSms.sendOtp('9876543210', '123456', 300)).rejects.toMatchObject({ statusCode: 503, code: 'SMS_UNAVAILABLE' });
    });

    it('without a gateway key does not call out (development logs the code instead)', async () => {
      Object.assign(sms, { authKey: undefined });
      const fetchMock = jest.spyOn(global, 'fetch');
      await edpSms.sendOtp('9876543210', '123456', 300);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
