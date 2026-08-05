# The reference environment for the screenshot regression tests.
#
# Pixel-identical rendering is only meaningful against a frozen environment:
# Chromium build, font files and FreeType/fontconfig settings all change what
# comes out of `page.screenshot()`. So the baselines in `e2e/screenshots/` are
# defined to be "what this image renders", and both CI and `npm run
# test:e2e:screenshots` run the suite in here rather than on the host.
#
# The base image is pinned by digest, and the Chromium build is pinned by the
# `PLAYWRIGHT_VERSION` build argument — the npm scripts pass the exact version
# from package.json, so a `playwright-core` bump cannot silently drift the
# browser away from the one the baselines were made with.
#
# Rebuilt only when this file (or that version) changes; see README.md.
FROM node:24@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584

# Must match `devDependencies.playwright-core` in the root package.json. The
# `test:e2e:screenshots*` scripts read it from there and pass it in.
ARG PLAYWRIGHT_VERSION

# Outside the default per-user cache so the tests can run as an arbitrary
# host UID (`--user`), which keeps root-owned build output out of the mount.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN test -n "$PLAYWRIGHT_VERSION" \
    && npx --yes "playwright-core@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /root/.npm

# Freeze font rasterisation. Without this, the result depends on fontconfig
# defaults: subpixel (RGB) antialiasing would make every glyph edge differ from
# a grayscale-antialiased render, and hinting changes glyph advance widths.
RUN printf '%s\n' \
    '<?xml version="1.0"?>' \
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
    '<fontconfig>' \
    '  <match target="font">' \
    '    <edit name="antialias" mode="assign"><bool>true</bool></edit>' \
    '    <edit name="hinting" mode="assign"><bool>true</bool></edit>' \
    '    <edit name="hintstyle" mode="assign"><const>hintslight</const></edit>' \
    '    <edit name="rgba" mode="assign"><const>none</const></edit>' \
    '    <edit name="lcdfilter" mode="assign"><const>lcdnone</const></edit>' \
    '  </match>' \
    '</fontconfig>' \
    > /etc/fonts/local.conf
