# Wallpaper sources

`macos26-light.webp` and `macos26-dark.webp` contain the original wallpaper
embedded in the user-supplied `Materials - Light.svg` and `Materials - Dark.svg`
(macOS 26 Community Figma kit, node `483-8848`). Extract the SVG `<image>` data
URI, not the whole material demonstration board: the latter includes labels,
five sample panels and `foreignObject` elements.

Both images retain the source **3024 × 1964** dimensions and composition. They
were encoded as WebP, quality 94, method 6; no resizing, crop, tint or blur was
applied to the files. Display opacity is 90% in CSS. ThemeContext selects the
active file; the hidden theme is not downloaded on the initial page load.

| Theme | Embedded PNG bytes | WebP bytes | RGB PSNR against PNG |
| --- | ---: | ---: | ---: |
| Light | 5,810,924 | 170,874 | 46.43 dB |
| Dark | 5,558,619 | 158,144 | 47.32 dB |

The WebP encoding is lossy. Both outputs combined are 329,018 bytes, about 97.1%
smaller than the embedded PNGs. The complete original SVG boards total 15,204,099
bytes and are not shipped to the browser.

Embedded source PNG SHA-256:

- Light: `35fcd289cf908d91242bf60bc971f6af8c2a3f55499f5b677908f92e6861f549`
- Dark: `92f9e6501f15135700fdb7e46326b83580e4488ee3d033f30088b5d8ab7ef92e`

The earlier `gradient-04-*.svg` uploads are retained for reference but are no
longer used as application wallpaper.
