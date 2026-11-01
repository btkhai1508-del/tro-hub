/** Inlined so documents never depend on fetching a font file, which a Zalo webview may refuse. */
import regular from '../../assets/fonts/TimesNewRoman-Regular.ttf?inline';
import bold from '../../assets/fonts/TimesNewRoman-Bold.ttf?inline';
import italic from '../../assets/fonts/TimesNewRoman-Italic.ttf?inline';
import bolditalic from '../../assets/fonts/TimesNewRoman-BoldItalic.ttf?inline';

const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

export const FONT_BASE64 = {
  normal: base64(regular),
  bold: base64(bold),
  italic: base64(italic),
  bolditalic: base64(bolditalic),
};
