import {checkChatContent} from '../chatContentFilter';

describe('chatContentFilter.checkChatContent', () => {
  it('blocks a plain 10-digit Indian mobile number', () => {
    expect(checkChatContent('call me on 9876543210')).toEqual({blocked: true, reason: 'PHONE_NUMBER'});
  });

  it('blocks a +91-prefixed number (contiguous digits, per the regex\'s own [6-9]\\d{9} shape)', () => {
    expect(checkChatContent('reach me at +91-9876543210')).toEqual({blocked: true, reason: 'PHONE_NUMBER'});
  });

  it('blocks an email address', () => {
    expect(checkChatContent('email me at someone@example.com')).toEqual({blocked: true, reason: 'EMAIL'});
  });

  it('blocks a UPI VPA before the generic email pattern matches it', () => {
    expect(checkChatContent('pay me at someone@okhdfcbank')).toEqual({blocked: true, reason: 'UPI_VPA'});
  });

  it('blocks a WhatsApp mention', () => {
    expect(checkChatContent("what's your whatsapp?")).toEqual({blocked: true, reason: 'SOCIAL_HANDLE'});
  });

  it('blocks a bare URL', () => {
    expect(checkChatContent('check https://example.com/path')).toEqual({blocked: true, reason: 'URL'});
  });

  it('allows an ordinary message with no blocked pattern', () => {
    expect(checkChatContent("I'm 5 minutes away, look for a red car.")).toEqual({blocked: false});
  });
});
