// Response when versioning is enabled
export interface UploadTemplateVersionedResult {
  id: string;
  versionId: string;
  type: string;
  size: number;
  createdAt: number;
}

// Response when versioning is disabled (backward compat)
export interface UploadTemplateLegacyResult {
  templateId: string;
}

export type UploadTemplateResult = UploadTemplateVersionedResult | UploadTemplateLegacyResult;

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
