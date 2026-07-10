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
  body?: { storage?: { value: string } }
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
