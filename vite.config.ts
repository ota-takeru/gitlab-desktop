import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Matches a package directory in node_modules on any platform. */
const pkg = (names: string) => new RegExp(`node_modules[\\\\/](?:${names})[\\\\/]`)

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: 'localhost',
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo writes/locks native build artifacts while the frontend is running.
      ignored: ['**/src-tauri/**', '**/output/**', '**/.playwright-cli/**'],
    },
  },
  preview: {
    host: 'localhost',
    port: 1421,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Large libraries get their own chunks, so a change to the app does not rewrite them.
        codeSplitting: {
          groups: [
            { name: 'prosemirror', test: pkg('prosemirror-[^\\\\/]+|orderedmap|rope-sequence|w3c-keyname') },
            { name: 'editor', test: pkg('@tiptap|linkifyjs|markdown-it|mdurl|uc\\.micro|entities|punycode\\.js') },
            { name: 'mui', test: pkg('@mui|@emotion|@popperjs|react-transition-group') },
            { name: 'highlight', test: pkg('highlight\\.js|lowlight') },
            { name: 'markdown', test: pkg('react-markdown|remark-[^\\\\/]+|rehype-[^\\\\/]+|unified|mdast-[^\\\\/]+|micromark[^\\\\/]*|hast-[^\\\\/]+|unist-[^\\\\/]+|vfile[^\\\\/]*') },
            { name: 'react', test: pkg('react|react-dom|scheduler|@tanstack') },
          ],
        },
      },
    },
  },
})
