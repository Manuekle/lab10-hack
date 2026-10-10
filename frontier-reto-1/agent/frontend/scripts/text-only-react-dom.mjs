import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const supportedVersion = '19.3.0';

// This observatory renders API data as React text. Remove the two raw HTML
// setters and the inert-script constructor from the pinned production renderer.
// A future React upgrade must review this adapter before the build can pass.
export function textOnlyReactDom() {
  return {
    name: 'observatorio-text-only-react-dom',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/react-dom/cjs/react-dom-client.production.js')) return null;
      const version = require('react-dom/package.json').version;
      if (version !== supportedVersion) throw new Error(`Review the text-only React DOM adapter for React ${version}.`);

      const unsafeWrites = code.match(/\.innerHTML\s*=/g) || [];
      const scriptBranch = /case "script":\s+nextResource = ownerDocument\.createElement\("div"\);\s+nextResource\.innerHTML = "<script>\\x3c\/script>";\s+nextResource = nextResource\.removeChild\(\s+nextResource\.firstChild\s+\);\s+break;/g;
      const htmlBranches = /case "dangerouslySetInnerHTML":\s+if \(null != value\) \{[\s\S]*?\n\s+break;/g;
      const scripts = [...code.matchAll(scriptBranch)];
      const html = [...code.matchAll(htmlBranches)];
      if (unsafeWrites.length !== 3 || scripts.length !== 1 || html.length !== 2 || html.some(([branch]) => !/domElement\.innerHTML\s*=/.test(branch))) {
        throw new Error('React DOM raw HTML branches changed; review the text-only adapter.');
      }
      const textOnly = code
        .replace(scriptBranch, 'case "script": throw Error("Script elements are not allowed in the observatory UI.");')
        .replace(htmlBranches, 'case "dangerouslySetInnerHTML": if (null != value) throw Error("Raw HTML is not allowed in the observatory UI."); break;');
      if (/\.innerHTML\s*=/.test(textOnly)) throw new Error('The text-only React DOM adapter left a raw HTML setter.');
      return {code: textOnly, map: null};
    },
  };
}
