// Response when versioning is enabled
export interface UploadTemplateVersionedResult {
  id: string;
  versionId: string;
  type: string;
  size: number;
  createdAt: number;
  /** UTC Unix timestamp of deployment; 0 when this version is not explicitly deployed. */
  deployedAt?: number;
}

// Response when versioning is disabled (backward compat)
export interface UploadTemplateLegacyResult {
  templateId: string;
  templateExtension?: string;
}

export type UploadTemplateResult = UploadTemplateVersionedResult | UploadTemplateLegacyResult;

/** PATCH /template/{id} response: the patched versionId, plus every field sent in the request, echoed back. */
export interface UpdateTemplateResult {
  versionId: string;
  id?: string;
  name?: string;
  comment?: string;
  category?: string;
  tags?: string[];
  deployedAt?: number;
  expireAt?: number;
}

export interface TemplateListItem {
  id: string;
  versionId: string;
  deployedAt?: number;
  createdAt?: number;
  expireAt?: number;
  size?: number;
  type?: string;
  name?: string;
  category?: string;
  comment?: string;
  tags?: string[];
  origin?: number;
}

export interface TemplateListResponse {
  templates:  TemplateListItem[];
  hasMore:    boolean;
  nextCursor?: string;
}

export interface ApiStatus {
  version: string;
  message: string;
}
