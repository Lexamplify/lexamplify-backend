import re,sys
p=sys.argv[1]
s=open(p).read()
s=s.replace("""  downloadOriginal: async""","""  destinations: (signal) => json('/api/vault/destinations', { signal }),
  saveAs: (id, body) => json(`/api/vault/documents/${id}/save-as`, { method: 'POST', json: body }),
  exportBlob: async (id, body, fallbackName = 'document') => {
    const res = await raw(`/api/vault/documents/${id}/export`, { method: 'POST', json: body });
    return { blob: await res.blob(), filename: fileNameFrom(res, fallbackName) };
  },
  downloadOriginal: async""")
open(p,'w').write(s)
