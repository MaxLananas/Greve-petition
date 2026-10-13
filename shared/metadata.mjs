export function publicMetadata(html, value) {
  if (!value) return html
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) return html
    const base = url.origin
    const image = `<meta property="og:image" content="${base}/assets/partage.png" />`
    const canonical = `<link rel="canonical" href="${base}" />`
    const ogUrl = `<meta property="og:url" content="${base}" />`
    let output = html.replace(/<meta property="og:image" content="[^"]*"\s*\/>/, image)
    if (/<meta property="og:url"/.test(output)) output = output.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, ogUrl)
    else output = output.replace('</head>', `  ${ogUrl}\n  </head>`)
    if (/<link rel="canonical"/.test(output)) output = output.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, canonical)
    else output = output.replace('</head>', `  ${canonical}\n  </head>`)
    return output
  } catch { return html }
}
