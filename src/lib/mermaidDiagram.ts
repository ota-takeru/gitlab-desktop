interface CodeBlockNode { tagName?: string; value?: string; properties?: { className?: unknown }; children?: CodeBlockNode[] }

/** The source of a ```mermaid code block, or null for any other block. */
export function mermaidSource(pre: CodeBlockNode | undefined): string | null {
  const code = pre?.children?.find((child) => child.tagName === 'code')
  const classes = code?.properties?.className
  if (!Array.isArray(classes) || !classes.includes('language-mermaid')) return null
  return code?.children?.map((child) => child.value ?? '').join('') ?? ''
}

interface Diagram {
  promise: Promise<string | null>
  /** Set once rendering ends, so a remounted comment shows its diagram at once; null when the source cannot be drawn. */
  image?: string | null
}

/** Rendered diagrams, most recently used last; reopening a thread reuses them. */
const diagrams = new Map<string, Diagram>()
const MAX_DIAGRAMS = 200

/** Mermaid's settings are global, so each diagram waits for the one before it. */
let queue: Promise<unknown> = Promise.resolve()
let nextId = 0

const diagramKey = (source: string, dark: boolean) => `${dark ? 'dark' : 'light'}\n${source}`

async function draw(source: string, dark: boolean): Promise<string> {
  // Mermaid is large and few bodies have a diagram, so it loads with the first one.
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    // Wide enough that a long identifier in a node is not split in the middle.
    flowchart: { htmlLabels: false, useMaxWidth: false, wrappingWidth: 400 },
    htmlLabels: false,
    securityLevel: 'strict',
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: dark ? 'dark' : 'neutral',
  })
  nextId += 1
  const { svg } = await mermaid.render(`mermaid-diagram-${nextId}`, source)
  // Bodies are written by other people. As an image, a diagram runs no script and loads nothing from the network.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The diagram already rendered for this source: an image URL, null if it cannot be drawn, undefined if not ready yet. */
export function finishedMermaidDiagram(source: string, dark: boolean): string | null | undefined {
  return diagrams.get(diagramKey(source, dark))?.image
}

/** Renders Mermaid source to an image URL, or null if it cannot be drawn. */
export function renderMermaidDiagram(source: string, dark: boolean): Promise<string | null> {
  const key = diagramKey(source, dark)
  const cached = diagrams.get(key)
  if (cached) {
    diagrams.delete(key)
    diagrams.set(key, cached)
    return cached.promise
  }
  const diagram: Diagram = {
    promise: queue.then(() => draw(source, dark)).catch(() => null).then((image) => {
      diagram.image = image
      return image
    }),
  }
  queue = diagram.promise
  diagrams.set(key, diagram)
  if (diagrams.size > MAX_DIAGRAMS) diagrams.delete(diagrams.keys().next().value!)
  return diagram.promise
}
