import { defineConfig, type Plugin } from 'vite';

/** Test build (`--mode test`): not indexed, "(test)" in the title and a TEST label. */
function testSite(): Plugin {
  return {
    name: 'test-site',
    transformIndexHtml(html) {
      return html
        .replace('<title>Topo Heli</title>', '<title>Topo Heli (test)</title>')
        .replace('</head>', '  <meta name="robots" content="noindex" />\n  </head>')
        .replace('</body>', '  <div class="test-badge">TEST</div>\n  </body>');
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset paths: works at any URL path, e.g. https://topoheli.com/test/.
  base: './',
  plugins: mode === 'test' ? [testSite()] : [],
}));
