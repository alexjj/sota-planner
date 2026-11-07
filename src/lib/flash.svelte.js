// A one-line message shown under the header, e.g. after saving to GitHub.
export const flash = $state({ text: '' });

export function showFlash(text) {
  flash.text = text;
}
