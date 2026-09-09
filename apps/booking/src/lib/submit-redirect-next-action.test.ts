import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { submitRedirectNextAction } from './submit-redirect-next-action';

describe('submitRedirectNextAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a hidden POST form and submits it', () => {
    const submit = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'form') {
        Object.defineProperty(el, 'submit', { value: submit });
      }
      return el;
    });

    submitRedirectNextAction({
      type: 'redirect',
      url: 'https://sis-t.redsys.es:25443/sis/realizarPago',
      method: 'POST',
      formFields: {
        Ds_SignatureVersion: 'HMAC_SHA512_V1',
        Ds_MerchantParameters: 'abc',
        Ds_Signature: 'sig',
      },
    });

    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    expect(form?.method.toLowerCase()).toBe('post');
    expect(form?.action).toContain('sis-t.redsys.es');
    const inputs = Array.from(form?.querySelectorAll('input') ?? []).map((i) => [
      i.name,
      i.value,
    ]);
    expect(inputs).toEqual([
      ['Ds_SignatureVersion', 'HMAC_SHA512_V1'],
      ['Ds_MerchantParameters', 'abc'],
      ['Ds_Signature', 'sig'],
    ]);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
