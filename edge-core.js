/*
  Reads content from XM Cloud Experience Edge (GraphQL) and returns it in the same
  format as Export-Content.ps1, so compare.html can compare it.
  READ-ONLY: it only sends GraphQL queries. Used by compare.html and edge-export.mjs.
*/
(function (root) {
  const EDGE_URL = 'https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1';

  // Same list as Export-Content.ps1: standard fields worth comparing. Other "__" fields are skipped.
  const KEEP_STANDARD_FIELDS = [
    '__Renderings', '__Final Renderings', '__Display name', '__Hidden', '__Never publish', '__Hide version',
    '__Publish', '__Unpublish', '__Valid from', '__Valid to', '__Workflow', '__Workflow state',
    '__Base template', '__Insert Rules', '__Masters'
  ];

  const ITEM = 'id path name version hasChildren template { id name } fields { name value }';
  const Q_ITEM = `query ($path: String!, $lang: String!) { item(path: $path, language: $lang) { ${ITEM} } }`;
  const Q_CHILDREN = `query ($path: String!, $lang: String!, $after: String) {
    item(path: $path, language: $lang) {
      children(first: 20, after: $after) { pageInfo { hasNext endCursor } results { ${ITEM} } }
    }
  }`;

  // Edge returns IDs as 32 hex characters; Sitecore shows {XXXXXXXX-XXXX-...}. Use the Sitecore form.
  function normId(id) {
    const h = String(id || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return h.length === 32 ? `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}` : String(id || '');
  }

  // Experience Edge can return data AND errors together (e.g. "Template with id ... was not found").
  // Keep the data and record the errors as warnings instead of failing the whole run.
  async function gql(contextId, query, variables, warnings) {
    let res;
    try {
      res = await fetch(`${EDGE_URL}?sitecoreContextId=${encodeURIComponent(contextId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables })
      });
    } catch (e) {
      const blocked = new Error('The browser blocked the request (network or CORS).');
      blocked.blocked = true;
      throw blocked;
    }
    if (!res.ok) {
      let detail = '';
      try { const b = await res.json(); detail = b.detail || b.title || ''; } catch (e) { /* body was not JSON */ }
      throw new Error(`Experience Edge answered HTTP ${res.status}${detail ? ` ("${detail}")` : ''}` +
        ([401, 403, 404].includes(res.status) ? '. The Context ID was not recognised; check it was copied correctly.' : '.'));
    }
    const json = await res.json();
    const errors = (json.errors || []).map(e => e.message);
    if (!json.data) throw new Error(errors.length ? errors.join('; ') : 'Experience Edge returned no data. Response: ' + JSON.stringify(json).slice(0, 300));
    errors.forEach(m => warnings && warnings.add(m));
    return json.data;
  }

  function toItem(it, lang) {
    const fields = {};
    (it.fields || []).filter(Boolean).forEach(f => {
      // When a template has two fields with the same name, Live returns the second as "Name_<32-hex field ID>"
      // while Preview returns only one. Keep it under "Name [dup]" so compare.html can tell it is not a content difference.
      const m = f.name.match(/^(.*)_([0-9a-f]{32})$/i);
      const name = m ? m[1] : f.name;
      if (name.startsWith('__') && !KEEP_STANDARD_FIELDS.includes(name)) return;
      fields[name in fields ? `${name} [dup]` : name] = f.value == null ? '' : String(f.value);
    });
    return {
      id: normId(it.id), path: it.path, name: it.name,
      template: it.template ? it.template.name : '', templateId: normId(it.template && it.template.id),
      // Edge reports "UnknownTemplate" when the item's template has not been published
      templateMissing: !it.template || it.template.name === 'UnknownTemplate', language: lang, version: it.version, fields
    };
  }

  async function children(contextId, id, lang, warnings) {
    const out = [];
    let after = null;
    do {
      const data = await gql(contextId, Q_CHILDREN, { path: id, lang, after }, warnings);
      const ch = data.item && data.item.children;
      if (!ch) break;
      out.push(...(ch.results || []).filter(Boolean));
      after = ch.pageInfo && ch.pageInfo.hasNext ? ch.pageInfo.endCursor : null;
    } while (after);
    return out;
  }

  // Accept what people commonly paste: "SITECORE_EDGE_CONTEXT_ID=abc", quotes, spaces, or a URL containing ?sitecoreContextId=abc
  function cleanContextId(raw) {
    let v = String(raw || '').trim();
    const fromUrl = v.match(/sitecoreContextId=([^&\s"']+)/i);
    if (fromUrl) return fromUrl[1];
    v = v.replace(/^[A-Z_]*CONTEXT_ID\s*[=:]\s*/i, '');
    return v.replace(/^["']|["';]$/g, '').trim();
  }

  /**
   * opts: { contextId, environment, database, rootPaths: [], languages: [], maxItems, onProgress(count) }
   * Returns an export object in the same shape as Export-Content.ps1 produces.
   */
  async function exportFromEdge(opts) {
    opts = { ...opts, contextId: cleanContextId(opts.contextId) };
    const max = opts.maxItems || 5000;
    const items = [], notFound = [], warnings = new Set();
    for (const lang of opts.languages) {
      for (const rootPath of opts.rootPaths) {
        if (items.length >= max) break;
        const rootItem = (await gql(opts.contextId, Q_ITEM, { path: rootPath, lang }, warnings)).item;
        if (!rootItem) { notFound.push(`${rootPath} (${lang})`); continue; }
        items.push(toItem(rootItem, lang));
        const queue = rootItem.hasChildren ? [rootItem.id] : [];
        while (queue.length && items.length < max) {
          const batch = queue.splice(0, 4); // 4 requests at a time, to be gentle on the API
          const lists = await Promise.all(batch.map(id => children(opts.contextId, id, lang, warnings)));
          for (const list of lists) {
            for (const c of list) {
              if (items.length >= max) break;
              items.push(toItem(c, lang));
              if (c.hasChildren) queue.push(c.id);
            }
          }
          if (opts.onProgress) opts.onProgress(items.length);
        }
      }
    }
    const lookup = await lookupLayoutRefs(opts.contextId, items, opts.languages[0] || 'en', warnings);
    return {
      tool: 'content-compare', formatVersion: 1, source: 'experience-edge',
      environment: opts.environment, database: opts.database, rootPaths: opts.rootPaths,
      exportedAt: new Date().toISOString(), itemCount: items.length,
      truncated: items.length >= max, notFound, warnings: [...warnings], lookup, items
    };
  }

  // Page layouts refer to components and data sources by ID. Look up the names of any IDs
  // that are not among the exported items, so the report can say "Hero Banner" instead of a GUID.
  async function lookupLayoutRefs(contextId, items, lang, warnings) {
    const known = new Set(items.map(i => i.id.toUpperCase()));
    const ids = new Set();
    items.forEach(i => ['__Renderings', '__Final Renderings'].forEach(f => {
      (String(i.fields[f] || '').match(/\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/gi) || [])
        .forEach(id => { id = id.toUpperCase(); if (!known.has(id)) ids.add(id); });
    }));
    const list = [...ids].slice(0, 500), lookup = {};
    const safeLang = /^[\w-]+$/.test(lang) ? lang : 'en';
    for (let i = 0; i < list.length; i += 20) {
      const chunk = list.slice(i, i + 20);
      const query = '{ ' + chunk.map((id, n) => `i${n}: item(path: "${id}", language: "${safeLang}") { name path }`).join(' ') + ' }';
      try {
        const data = await gql(contextId, query, {}, warnings);
        chunk.forEach((id, n) => { const it = data[`i${n}`]; if (it) lookup[id] = { name: it.name, path: it.path }; });
      } catch (e) { /* names are a nice-to-have; the report falls back to IDs */ }
    }
    return lookup;
  }

  // Children of one item (name/path only), for browsing the content tree
  const Q_KIDS = `query ($path: String!, $lang: String!, $after: String) {
    item(path: $path, language: $lang) { children(first: 100, after: $after) { pageInfo { hasNext endCursor } results { name path hasChildren } } }
  }`;
  async function listChildren(contextId, path, lang) {
    const id = cleanContextId(contextId), out = [];
    let after = null;
    do {
      const data = await gql(id, Q_KIDS, { path, lang: lang || 'en', after });
      const ch = data.item && data.item.children;
      if (!ch) break;
      out.push(...(ch.results || []).filter(Boolean));
      after = ch.pageInfo && ch.pageInfo.hasNext ? ch.pageInfo.endCursor : null;
    } while (after);
    return out;
  }

  root.EdgeExport = { exportFromEdge, cleanContextId, listChildren };
})(typeof globalThis !== 'undefined' ? globalThis : window);
