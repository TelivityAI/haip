/** Auto-submit a Redsys (or any PSP) hosted-checkout POST form. */
export type RedirectNextAction = {
  type: 'redirect';
  url: string;
  method: 'POST';
  formFields: Record<string, string>;
};

export function submitRedirectNextAction(nextAction: RedirectNextAction): void {
  if (typeof document === 'undefined') {
    throw new Error('submitRedirectNextAction requires a browser document');
  }
  if (nextAction.type !== 'redirect' || nextAction.method !== 'POST') {
    throw new Error(`Unsupported nextAction: ${nextAction.type}/${nextAction.method}`);
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = nextAction.url;
  form.style.display = 'none';
  form.acceptCharset = 'UTF-8';

  for (const [name, value] of Object.entries(nextAction.formFields ?? {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
