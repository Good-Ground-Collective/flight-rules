export interface ConfluenceSpace {
  id: string
  key: string
}

export interface ConfluenceSpacesResponse {
  results: ConfluenceSpace[]
}

export interface ConfluencePage {
  id: string
  title: string
  body?: { storage?: { value: string }; atlas_doc_format?: { value: string } }
  version?: { number: number; createdAt?: string }
  _links?: { webui?: string }
}

export interface ConfluenceProperty {
  id: string
  key: string
  value: Record<string, unknown>
  version?: { number: number }
}

export interface ConfluencePropertiesResponse {
  results: ConfluenceProperty[]
}

export interface ConfluenceFooterComment {
  id: string
  body?: { atlas_doc_format?: { value: string } }
  version?: { number: number; createdAt?: string; authorId?: string }
}

export interface ConfluenceFooterCommentsResponse {
  results: ConfluenceFooterComment[]
  _links?: { next?: string }
}
