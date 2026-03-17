import buildSel from '../../Scrapers/Mizrahi/MizrahiSelectors.js';

describe('buildSel', () => {
  it('maps selector config keys to resolved CSS strings', () => {
    const result = buildSel({
      username: [{ kind: 'css', value: '#user' }],
      password: [{ kind: 'placeholder', value: 'סיסמה' }],
      submit: [{ kind: 'name', value: 'login' }],
    });
    expect(result.username).toBe('#user');
    expect(result.password).toBe('input[placeholder*="סיסמה"]');
    expect(result.submit).toBe('[name="login"]');
  });

  it('handles ariaLabel and xpath kinds', () => {
    const result = buildSel({
      field: [{ kind: 'ariaLabel', value: 'שם' }],
      btn: [{ kind: 'xpath', value: '//button' }],
    });
    expect(result.field).toBe('input[aria-label="שם"]');
    expect(result.btn).toBe('xpath=//button');
  });
});
