export interface PaperMetadata {
  title: string;
  abstract: string;
  authors: string[];
  url: string;
}

function cleanText(el: Element | null | undefined, prefixRe?: RegExp): string {
  const raw = el?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return prefixRe ? raw.replace(prefixRe, '').trim() : raw;
}

function collectTexts(doc: Document, selector: string): string[] {
  return Array.from(doc.querySelectorAll(selector))
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() || '')
    .filter(Boolean);
}

function collectMetaContents(doc: Document, name: string): string[] {
  return Array.from(doc.querySelectorAll(`meta[name="${name}"]`))
    .map((el) => el.getAttribute('content')?.replace(/\s+/g, ' ').trim() || '')
    .filter(Boolean);
}

/**
 * Extracts structured academic paper metadata from supported scholarly sites
 * (arXiv abs/html/pdf, bioRxiv/medRxiv, PubMed) or citation meta tags.
 */
export function extractPaperMetadata(doc: Document, loc: URL): PaperMetadata | null {
  const host = loc.hostname.toLowerCase();
  const path = loc.pathname;

  // 1. arXiv abstract page (/abs/...)
  if (host === 'arxiv.org' && path.startsWith('/abs/')) {
    const title = cleanText(doc.querySelector('h1.title'), /^Title:\s*/i);
    if (!title) return null;
    return {
      title,
      abstract: cleanText(doc.querySelector('blockquote.abstract'), /^Abstract:\s*/i),
      authors: collectTexts(doc, '.authors a'),
      url: loc.href,
    };
  }

  // 2. arXiv HTML full-text page (/html/...)
  if (host === 'arxiv.org' && path.startsWith('/html/')) {
    const title = cleanText(doc.querySelector('h1.ltx_title_document, .ltx_title_document, h1.ltx_title'));
    if (!title) return null;
    const abstract =
      collectTexts(doc, '.ltx_abstract p.ltx_p, .ltx_abstract p').join(' ') ||
      cleanText(doc.querySelector('.ltx_abstract'), /^Abstract\s*/i);
    return {
      title,
      abstract,
      authors: collectTexts(doc, '.ltx_authors .ltx_personname'),
      url: loc.href,
    };
  }

  // 3. arXiv PDF viewer URL (/pdf/...)
  if (host === 'arxiv.org' && path.startsWith('/pdf/')) {
    const arxivId = path.replace(/^\/pdf\//, '').replace(/\.pdf$/i, '').trim();
    const docTitle = doc.title?.trim();
    const title = docTitle && !docTitle.endsWith('.pdf') ? docTitle : `arXiv:${arxivId || 'PDF'}`;
    return {
      title,
      abstract: '',
      authors: [],
      url: loc.href,
    };
  }

  // 4. bioRxiv / medRxiv
  if (host.endsWith('biorxiv.org') || host.endsWith('medrxiv.org')) {
    const title =
      collectMetaContents(doc, 'citation_title')[0] ||
      cleanText(doc.querySelector('h1#page-title, h1.highwire-cite-title'));
    if (!title) return null;
    const authors = collectMetaContents(doc, 'citation_author');
    const abstract =
      collectTexts(doc, '#abstract-1 p, .section.abstract p').join(' ') ||
      cleanText(doc.querySelector('.section.abstract'), /^Abstract\s*/i);
    return {
      title,
      abstract,
      authors: authors.length ? authors : collectTexts(doc, '.highwire-citation-author'),
      url: loc.href,
    };
  }

  // 5. PubMed
  if (host === 'pubmed.ncbi.nlm.nih.gov') {
    const title = cleanText(doc.querySelector('h1.heading-title'));
    if (!title) return null;
    const abstract =
      collectTexts(doc, '#eng-abstract p, .abstract-content p').join(' ') ||
      cleanText(doc.querySelector('.abstract-content'));
    return {
      title,
      abstract,
      authors: collectTexts(doc, '.authors-list .full-name'),
      url: loc.href,
    };
  }

  // 6. Generic Highwire / Google Scholar citation meta tags fallback
  const metaTitle = collectMetaContents(doc, 'citation_title')[0];
  if (metaTitle) {
    const abstract =
      collectMetaContents(doc, 'citation_abstract')[0] ||
      cleanText(doc.querySelector('#abstract p, .abstract p, #abstract, .abstract'), /^Abstract[:\s]*/i);
    return {
      title: metaTitle,
      abstract,
      authors: collectMetaContents(doc, 'citation_author'),
      url: loc.href,
    };
  }

  return null;
}
