import { z } from 'zod'

/**
 * Accepts an Atlassian host as either a bare domain or a full URL
 * (`https://acme.atlassian.net/`) and normalizes to the bare domain. The API
 * clients prepend the scheme themselves, so a verbatim full URL would build
 * `https://https://…//rest/api/3`.
 */
export const JiraHostSchema = z
  .string()
  .transform((host) => host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''))
